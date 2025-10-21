const { ethers } = require('ethers');
// Context validation function (Step 2)
function validateContext(payload) {
  // 1. Status check
  if (payload.status !== "active") {
    throw new Error("Context invalid: device not active");
  }
  // 2. Location check (example rule)
  if (payload.location !== "Zone3") {
    throw new Error("Context invalid: wrong zone");
  }
  // 3. Timestamp freshness (within 5 minutes)
  const now = Date.now();
  const diffMs = now - new Date(payload.timestamp).getTime();
  if (diffMs > 5 * 60 * 1000) {
    throw new Error("Context invalid: stale timestamp");
  }
  // 4. Role-based rule (optional)
  if (payload.role !== "env_sensor") {
    throw new Error("Context invalid: unauthorized role");
  }
  return true;
}
const GanacheCore = require('ganache-core');
const Web3 = require('web3');
const FS = require('fs');
const PATH = require('path');
const SOLC = require('solc');

function nowMs(){return Date.now();}
function pQuantile(arr, q){ if(!arr.length) return 0; const s=arr.slice().sort((a,b)=>a-b); const idx=Math.max(0, Math.min(s.length-1, Math.floor(q*(s.length-1)))); return s[idx]; }
function avg(arr){ if(!arr.length) return 0; return arr.reduce((a,b)=>a+b,0)/arr.length; }

// Produce a concise, structured error summary without huge nested objects
function sanitizeError(err){
  const summary = {
    errCode: err && err.code ? String(err.code) : undefined,
    errReason: err && err.reason ? String(err.reason) : undefined,
    errSummary: undefined,
    txHash: undefined,
    blockNumber: undefined,
    gasUsed: undefined,
    status: undefined
  };
  // short, single-line message
  if (err && err.message) {
    const firstLine = String(err.message).split('\n')[0];
    summary.errSummary = firstLine.length > 200 ? firstLine.slice(0,200) + '…' : firstLine;
  }
  // receipt fields if present
  if (err && err.receipt) {
    const r = err.receipt;
    summary.txHash = r.transactionHash;
    summary.blockNumber = r.blockNumber;
    summary.gasUsed = r.gasUsed;
    summary.status = r.status;
  }
  return summary;
}

async function compileContract(){
  const source = FS.readFileSync(PATH.resolve(__dirname,'..','contracts','ContextAwareSmartContract.sol'),'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'ContextAwareSmartContract.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { '*': { '*': ['abi','evm.bytecode'] } }
    }
  };
  const output = JSON.parse(SOLC.compile(JSON.stringify(input)));
  if(output.errors){ for(const e of output.errors) console.error(e.formattedMessage); throw new Error('compile failed'); }
  const name = Object.keys(output.contracts['ContextAwareSmartContract.sol'])[0];
  return { abi: output.contracts['ContextAwareSmartContract.sol'][name].abi, bytecode: output.contracts['ContextAwareSmartContract.sol'][name].evm.bytecode.object };
}

// simple total variation distance between two discrete distributions with same support keys
function totalVariationDist(p, q){ let keys = new Set([...Object.keys(p), ...Object.keys(q)]); let sum=0; keys.forEach(k=>{ const pv = p[k]||0; const qv = q[k]||0; sum += Math.abs(pv-qv); }); return sum/2; }

// compute entropy base2
function entropy(pArr){ let H=0; for(const p of pArr){ if(p>0) H -= p*Math.log2(p); } return H; }

(async function main(){
  console.log('Starting measurement run: performance + PDS');
  const server = GanacheCore.server({ wallet: { totalAccounts: 32 } });
  await server.listen(8545);
  const web3 = new Web3('http://127.0.0.1:8545');

  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registrar = accounts[1];

  const {abi, bytecode} = await compileContract();
  const Contract = new web3.eth.Contract(abi);
  const deployed = await Contract.deploy({ data: '0x'+bytecode }).send({ from: owner, gas: 6000000 });
  console.log('Contract deployed', deployed.options.address);

  // grant registrar
  await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('REGISTRAR_ROLE')), registrar).send({ from: owner });

  // parameters (overridable via CLI)
  function getArg(name, fallback){ const idx = process.argv.indexOf(name); if(idx>=0 && process.argv.length>idx+1) return process.argv[idx+1]; return fallback; }
  const NUM_DEVICES = parseInt(getArg('--devices','20'),10);
  const UPDATES_PER_DEVICE = parseInt(getArg('--updates','5'),10);
  const OVERPRIV_RATE = parseFloat(getArg('--overpriv','0.1'));
  const VERBOSE = process.argv.includes('--verbose');
  const FAIL_RATE = parseFloat(getArg('--failRate','0'));
  const SEND_ON_CONTEXT = process.argv.includes('--sendOnContextViolation');
  // new flags: --failDevices "0,3,5" and --failMode invalidSig|outOfRange
  const FAIL_DEVICES_ARG = getArg('--failDevices', '');
  const FAIL_MODE = getArg('--failMode', 'random');

  // create devices
  const devices = [];
  for(let i=0;i<NUM_DEVICES;i++){ devices.push(web3.eth.accounts.create()); }
  for(const d of devices){ await deployed.methods.authorizeDevice(d.address).send({ from: registrar }); }

  // gateway
  const gateway = web3.eth.accounts.create();
  await web3.eth.sendTransaction({ from: owner, to: gateway.address, value: web3.utils.toWei('1','ether') });
  await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('GATEWAY_ROLE')), gateway.address).send({ from: owner });

  // measurement collectors
  const perf = { submitTimes: [], minedTimes: [], latencies: [], authzMs: [], txHashes: [], failures: [] };
  const logs = []; // per-update attribute logs for PDS computation

  // helper to send gateway tx
  async function gatewaySubmit(device, temperature, humidity, options = {}){
    // sign payload
  const nonce = Number(await deployed.methods.nonces(device.address).call());
  const hourVal = (new Date()).getHours();
    // contextHash must be passed in options
    const contextHash = options.contextHash || '0x0000000000000000000000000000000000000000000000000000000000000000';
    // Values for signing (must match Solidity hash ordering, including address(this) and contextHash)
    const signTypes = [
      'uint256','uint256','uint256','uint256','uint256',
      'uint256','uint256','uint256','uint256','uint256','address','bytes32'
    ];
    const signVals = [
      temperature, humidity, 0, 0, hourVal,
      0, 0, 0, 0, nonce, deployed.options.address, contextHash
    ];
    const encoded = web3.eth.abi.encodeParameters(signTypes, signVals);
    const hash = web3.utils.keccak256(encoded);

    // device signs
    const t0 = nowMs();
    // support failing invalid signature by using wrong key when requested
    let sig;
    if(options.failType === 'invalidSig' && options.badKey) {
      sig = web3.eth.accounts.sign(hash, options.badKey.privateKey);
    } else {
      sig = web3.eth.accounts.sign(hash, device.privateKey);
    }

    // gateway verifies device signature (measure authZ time)
    const tVerifyStart = nowMs();
    const recovered = web3.eth.accounts.recover(hash, sig.signature);
    const tVerifyEnd = nowMs();
    perf.authzMs.push(tVerifyEnd - tVerifyStart);

    // prepare tx
    const v=sig.v, r=sig.r, s=sig.s;
    // Pass the struct as an object with named fields to ensure correct ABI encoding
    const callData = {
      temperature: temperature,
      humidity: humidity,
      totalMeterSignal: 0,
      totalDevicesPowerValue: 0,
      hour: hourVal,
      ac1Power: 0,
      ac2Power: 0,
      ac3Power: 0,
      carBatteryPowerStatus: 0,
      nonce: nonce,
      contextHash: contextHash
    };
    const data = deployed.methods.setContextDataViaGateway(callData, v, r, s).encodeABI();
    const txCount = await web3.eth.getTransactionCount(gateway.address);
    const gasPrice = await web3.eth.getGasPrice();
    const txObj = { nonce: web3.utils.toHex(txCount), to: deployed.options.address, gas: web3.utils.toHex(300000), gasPrice: web3.utils.toHex(gasPrice), data };
    const signed = await web3.eth.accounts.signTransaction(txObj, gateway.privateKey);

    const submitTime = nowMs();
    if(VERBOSE){
      // Print a concise, masked device id and payload to terminal
      console.log(`→ sending: device=${device.address.slice(0,10)}..., temp=${temperature}, hum=${humidity}, nonce=${nonce}, ts=${new Date(submitTime).toISOString()}`);
    }
    perf.submitTimes.push(submitTime);
    try{
      const sendPromise = web3.eth.sendSignedTransaction(signed.rawTransaction);
      // await receipt
      const receipt = await sendPromise;
      const minedTime = nowMs();
      perf.minedTimes.push(minedTime);
      perf.latencies.push(minedTime - submitTime);
      perf.txHashes.push(receipt.transactionHash);

  // successful verification: record timing, tx hash and attribute log for PDS
  logs.push({ device: device.address, temperature, humidity, hour: hourVal, device_class: 'sensor-'+(device.address.slice(2,6)), decision: 'allow', timestamp: submitTime });
      if (VERBOSE) {
        console.log(`✓ mined: device=${device.address.slice(0,10)}... nonce=${nonce} tx=${receipt.transactionHash} gas=${receipt.gasUsed}`);
      }
      return { ok: true, receipt };
    } catch(err){
      // record concise failure info
      const clean = sanitizeError(err);
      const tsNow = nowMs();
      perf.failures.push({
        device: device.address,
        deviceIdx: options.deviceIdx,
        failType: options.failType || 'unknown',
        errCode: clean.errCode,
        errReason: clean.errReason,
        errSummary: clean.errSummary || 'tx reverted',
        txHash: clean.txHash,
        blockNumber: clean.blockNumber,
        gasUsed: clean.gasUsed,
        status: clean.status,
        ts: tsNow
      });
      // also log the failed attempt for PDS analysis
  logs.push({ device: device.address, temperature, humidity, hour: hourVal, device_class: 'sensor-'+(device.address.slice(2,6)), decision: 'revert', reason: clean.errSummary || 'tx reverted', timestamp: submitTime });
  if(VERBOSE) {
        const parts = [
          `↯ reverted: device=${device.address.slice(0,10)}...`,
          `nonce=${nonce}`,
          clean.errReason ? `reason=${clean.errReason}` : (clean.errCode ? `code=${clean.errCode}` : `reason=${clean.errSummary||'revert'}`),
          clean.txHash ? `tx=${clean.txHash}` : null,
          typeof clean.gasUsed !== 'undefined' ? `gas=${clean.gasUsed}` : null,
          typeof clean.blockNumber !== 'undefined' ? `block=${clean.blockNumber}` : null
        ].filter(Boolean);
        console.warn(parts.join(' '));
      }
      return { ok: false };
    }
  }

  // run workload with per-device dynamic patterns
  console.log('Running workload:', NUM_DEVICES, 'devices x', UPDATES_PER_DEVICE, 'updates');
  const startAll = nowMs();
  // --- TEST TEMPLATE: 2 valid, 4 invalid devices for context validation ---
  const deviceProfiles = [
    {
      id: "dev_01",
      baseTemp: 28,
      baseHum: 42,
      trend: 0.1,
      spikeProb: 0.05,
      location: "Zone3",
      role: "env_sensor",
      status: "active"
    },
    {
      id: "dev_02",
      baseTemp: 25,
      baseHum: 40,
      trend: 0.05,
      spikeProb: 0.02,
      location: "Zone3",
      role: "env_sensor",
      status: "active"
    },
    {
      id: "dev_03",
      baseTemp: 29,
      baseHum: 45,
      trend: 0.05,
      spikeProb: 0.02,
      location: "Zone3",
      role: "env_sensor",
      status: "active"
    },
    {
      id: "dev_04",
      baseTemp: 26,
      baseHum: 37,
      trend: 0.05,
      spikeProb: 0.01,
      location: "Zone3",
      role: "env_sensor",
      status: "active"
    },
    {
      id: "dev_05",
      baseTemp: 27,
      baseHum: 36,
      trend: 0.04,
      spikeProb: 0.02,
      location: "Zone3",
      role: "env_sensor",
      status: "active"
    },
    {
      id: "dev_06",
      baseTemp: 30,
      baseHum: 39,
      trend: 0.03,
      spikeProb: 0.02,
      location: "Zone3",
      role: "env_sensor",
      status: "active"
    }
  ];

  // determine failing devices
  const failTypes = {}; // idx->type
  const badKeys = {}; // idx->key for invalidSig
  if(FAIL_DEVICES_ARG && FAIL_DEVICES_ARG.trim().length){
    // parse explicit list
    const parts = FAIL_DEVICES_ARG.split(',').map(s=>s.trim()).filter(Boolean);
    for(const p of parts){ const i = parseInt(p,10); if(!isNaN(i) && i>=0 && i<NUM_DEVICES){
      const mode = (FAIL_MODE === 'random') ? ((Math.random()<0.5)?'invalidSig':'outOfRange') : FAIL_MODE;
      failTypes[i] = mode;
      if(mode === 'invalidSig') badKeys[i] = web3.eth.accounts.create();
    }}
  } else {
    // random selection according to FAIL_RATE
    const numFail = Math.round(NUM_DEVICES * Math.max(0, Math.min(1, FAIL_RATE)));
    const failIndices = new Set();
    while(failIndices.size < numFail){ failIndices.add(Math.floor(Math.random()*NUM_DEVICES)); }
    for(const idx of failIndices){
      let mode;
      if (FAIL_MODE === 'random') {
        const r = Math.random();
        mode = r < 1/3 ? 'invalidSig' : (r < 2/3 ? 'outOfRange' : 'contextInvalid');
      } else {
        mode = FAIL_MODE;
      }
      failTypes[idx] = mode;
      if(mode === 'invalidSig') badKeys[idx] = web3.eth.accounts.create();
    }
  }

  for(let t=0;t<UPDATES_PER_DEVICE;t++){
    for(let idx=0; idx<devices.length; idx++){
      const d = devices[idx];
      const prof = deviceProfiles[idx];
      // apply base + trend * t + random jitter + occasional spike
      let temp = Math.round(prof.baseTemp + prof.trend * t + (Math.random()-0.5)*2);
      if (Math.random() < prof.spikeProb) temp += 6 + Math.floor(Math.random()*6); // spike
      let hum = Math.round(prof.baseHum + (Math.random()-0.5)*4);
      if (Math.random() < prof.spikeProb*0.5) hum += 5;
      // (removed failType declaration here to avoid redeclaration)
      if(failTypes[idx] === 'outOfRange'){
        temp = 2000;
      }
      const options = {};
      if(failTypes[idx] === 'invalidSig') options.failType = 'invalidSig', options.badKey = badKeys[idx], options.deviceIdx = idx;
      else if(failTypes[idx] === 'outOfRange') options.failType = 'outOfRange', options.deviceIdx = idx;

      // --- build context-aware payload ---
      let location = prof.location;
      let role = prof.role;
      let status = prof.status;
      // Inject context invalidation if selected for this device
      if (failTypes[idx] === 'contextInvalid') {
        // break status or zone
        status = 'inactive';
        location = 'ZoneX';
      }
      // Use static valid context for all devices to ensure all pass
      const contextPayload = {
        deviceId: prof.id,
        deviceType: role,
        temperature: temp,
        humidity: hum,
        nonce: null, // will be filled in gatewaySubmit if needed
        timestamp: new Date().toISOString(),
        location,
        role,
        status
      };
      // For now, just log the contextPayload (optional)
      if (VERBOSE) console.log('ContextPayload:', contextPayload);

      // Step 2: Validate context before sending
      let contextHash = null;
      let contextDecision = "allow";
      let failType = null;
      try {
        validateContext(contextPayload);
        // Generate context hash
        const contextString = `${contextPayload.location}|${contextPayload.role}|${contextPayload.status}|${contextPayload.timestamp}`;
        contextHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contextString));
      } catch (err) {
        contextDecision = "context_violation";
        // If we want to send even when context is invalid, still compute a hash
        if (SEND_ON_CONTEXT) {
          const contextString = `${contextPayload.location}|${contextPayload.role}|${contextPayload.status}|${contextPayload.timestamp}`;
          contextHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contextString));
        } else {
          contextHash = null;
        }
        // Parse failType from error message
        if (err.message.includes("not active")) failType = "not_active";
        else if (err.message.includes("wrong zone")) failType = "wrong_zone";
        else if (err.message.includes("stale timestamp")) failType = "stale_timestamp";
        else if (err.message.includes("unauthorized role")) failType = "unauthorized_role";
        else failType = "context_other";
        if (VERBOSE) console.error(`[CONTEXT-BLOCKED] ${contextPayload.deviceId}: ${err.message}`);
      }

      // Log context decision for measurement
      logs.push({
        deviceId: contextPayload.deviceId,
        timestamp: contextPayload.timestamp,
        decision: contextDecision,
        contextHash,
        location: contextPayload.location,
        role: contextPayload.role,
        status: contextPayload.status,
        failType
      });

      if (contextDecision === "allow") {
        // Only send tx if context is valid, and pass contextHash to gatewaySubmit
        await gatewaySubmit(d, temp, hum, { ...options, contextHash });
      } else if (contextDecision === "context_violation" && SEND_ON_CONTEXT) {
        // Send anyway to observe on-chain behavior but classify as a policy failure in results
        const sendRes = await gatewaySubmit(d, temp, hum, { ...options, contextHash });
        // Record a policy failure regardless of tx success
        const tsNow = nowMs();
        perf.failures.push({
          device: d.address,
          deviceIdx: idx,
          failType: 'context_violation',
          errCode: undefined,
          errReason: 'context invalid',
          errSummary: 'gateway-enforced policy violation',
          txHash: sendRes && sendRes.receipt ? sendRes.receipt.transactionHash : undefined,
          blockNumber: sendRes && sendRes.receipt ? sendRes.receipt.blockNumber : undefined,
          gasUsed: sendRes && sendRes.receipt ? sendRes.receipt.gasUsed : undefined,
          status: sendRes && sendRes.receipt ? sendRes.receipt.status : undefined,
          ts: tsNow
        });
      } else if (contextDecision === "context_violation" && !SEND_ON_CONTEXT) {
        // Strict mode: block at gateway and do not send to chain; record as failure
        const tsNow = nowMs();
        perf.failures.push({
          device: d.address,
          deviceIdx: idx,
          failType: 'context_violation',
          errCode: undefined,
          errReason: 'context invalid',
          errSummary: 'blocked at gateway (not sent on-chain)',
          txHash: undefined,
          blockNumber: undefined,
          gasUsed: undefined,
          status: undefined,
          ts: tsNow
        });
        if (VERBOSE) {
          console.warn(`⊘ blocked: device=${d.address.slice(0,10)}... reason=context invalid (not sent)`);
        }
      }
      // small jitter between submissions
      await new Promise(r=>setTimeout(r, Math.floor(Math.random()*40)));
    }
  }
  const endAll = nowMs();

  // Performance calculations
  const totalCommitted = perf.txHashes.length;
  const totalWindowSec = (endAll - startAll)/1000;
  const TPS = totalCommitted / Math.max(1,totalWindowSec);
  const p50 = pQuantile(perf.latencies, 0.5);
  const p95 = pQuantile(perf.latencies, 0.95);
  const p99 = pQuantile(perf.latencies, 0.99);
  const authz_p95 = pQuantile(perf.authzMs, 0.95);
  const authz_p50 = pQuantile(perf.authzMs, 0.5);

  // PDS calculations
  // R_struct: k-anonymity on quasi-identifiers (device_class, hour)
  const eqMap = {}; // key -> {count, sensCounts}
  const globalSensitiveCounts = {};
  for(const rec of logs){
    const key = rec.device_class + '|' + rec.hour;
    if(!eqMap[key]) eqMap[key] = {count:0, sensCounts:{}};
    eqMap[key].count++;
    eqMap[key].sensCounts[rec.decision] = (eqMap[key].sensCounts[rec.decision]||0)+1;
    globalSensitiveCounts[rec.decision] = (globalSensitiveCounts[rec.decision]||0)+1;
  }
  const eqSizes = Object.values(eqMap).map(x=>x.count);
  const minEq = eqSizes.length?Math.min(...eqSizes):Infinity;
  const r_k = minEq===Infinity?0:1/minEq;
  // l-diversity: min distinct sensitive per eq
  const distinctPerEq = Object.values(eqMap).map(x=>Object.keys(x.sensCounts).length);
  const minL = distinctPerEq.length?Math.min(...distinctPerEq):Infinity;
  const r_l = minL===Infinity?0:1/minL;
  // t-closeness: for each eq compute TVD between P(S|E) and global P(S)
  const totalGlobal = Object.values(globalSensitiveCounts).reduce((a,b)=>a+b,0)||1;
  const globalP = {}; Object.keys(globalSensitiveCounts).forEach(k=>globalP[k]=globalSensitiveCounts[k]/totalGlobal);
  let maxTVD = 0;
  for(const k of Object.keys(eqMap)){
    const e = eqMap[k]; const tot = e.count; const p={}; Object.keys(e.sensCounts).forEach(s=>p[s]=e.sensCounts[s]/tot);
    const tvd = totalVariationDist(p, globalP);
    if(tvd>maxTVD) maxTVD = tvd;
  }
  const r_t = maxTVD; // already between 0 and 1
  const w_k=0.4, w_l=0.3, w_t=0.3;
  const R_struct = w_k*r_k + w_l*r_l + w_t*r_t;

  // R_chain: anonymity set A = number of devices; r_A = 1/A
  const A = devices.length; const r_A = 1/Math.max(1,A);
  // entropy of activity distribution
  const countsPerDevice = {}; for(const rec of logs) countsPerDevice[rec.device]=(countsPerDevice[rec.device]||0)+1;
  const totalUpdates = logs.length; const pArr = Object.values(countsPerDevice).map(c=>c/Math.max(1,totalUpdates));
  const H = entropy(pArr); const Hmax = Math.log2(Math.max(1,Object.keys(countsPerDevice).length));
  const r_H = Hmax?1 - (H/Hmax):1;
  // linkability heuristic: fraction of unique attribute tuples
  const tupleCounts = {}; for(const rec of logs){ const tup = Math.floor(rec.temperature/5)+'|'+Math.floor(rec.humidity/5); tupleCounts[tup]=(tupleCounts[tup]||0)+1; }
  const uniqueTuples = Object.values(tupleCounts).filter(c=>c===1).length; const r_L = totalUpdates?uniqueTuples/totalUpdates:0;
  const r_C = 1.0; // no additional privacy tech
  const v_A=0.3, v_H=0.4, v_L=0.2, v_C=0.1;
  const R_chain = v_A*r_A + v_H*r_H + v_L*r_L + v_C*r_C;

  // R_policy: R_struct_logs approximated by R_struct; r_LP simulated
  const r_LP = OVERPRIV_RATE; const u_s=0.6, u_LP=0.4; const R_policy = u_s*R_struct + u_LP*r_LP;

  const alpha=0.3, beta=0.5, gamma=0.2;
  const PDS = alpha*R_struct + beta*R_chain + gamma*R_policy;

  const totalAttempts = perf.txHashes.length + perf.failures.length;


  // --- Privacy Metrics ---
  // 1. Privacy Leakage Probability (PLP)
  const hashToContext = {};
  logs.forEach(log => {
    if (!log.contextHash) return;
    const key = log.contextHash;
    hashToContext[key] = hashToContext[key] || new Set();
    hashToContext[key].add(`${log.location}|${log.role}|${log.status}`);
  });
  let successfulGuesses = 0;
  Object.values(hashToContext).forEach(set => {
    if (set.size === 1) successfulGuesses++;
  });
  const plp = Object.keys(hashToContext).length ? (successfulGuesses / Object.keys(hashToContext).length) : 0;

  // 2. Shannon Entropy
  function entropy(values) {
    const counts = {};
    values.forEach(val => counts[val] = (counts[val] || 0) + 1);
    const total = values.length;
    return Object.values(counts).reduce((acc, c) => {
      const p = c / total;
      return acc - p * Math.log2(p);
    }, 0);
  }
  const H_location = entropy(logs.map(l => l.location));
  const H_role = entropy(logs.map(l => l.role));
  const H_status = entropy(logs.map(l => l.status));

  // 3. Context Linkability
  const deviceContexts = {};
  logs.forEach(log => {
    if (!log.contextHash) return;
    const id = log.deviceId;
    deviceContexts[id] = deviceContexts[id] || new Set();
    deviceContexts[id].add(log.contextHash);
  });
  const linkabilityScore = Object.keys(deviceContexts).length ?
    (Object.values(deviceContexts).reduce((sum, s) => sum + 1 / s.size, 0) / Object.keys(deviceContexts).length) : 0;

  const summary = {
    params: { NUM_DEVICES, UPDATES_PER_DEVICE },
    performance: { TPS, totalCommitted, totalWindowSec, latency_p50:p50, latency_p95:p95, latency_p99:p99, authz_p50, authz_p95, avgAuthzMs: avg(perf.authzMs) },
    pds: { R_struct, components:{r_k, r_l, r_t}, R_chain, components_chain:{r_A, r_H, r_L, r_C}, R_policy, PDS },
    verification: {
      totalAttempts,
      successful: totalCommitted,
      failures: perf.failures.length,
      failures_by_type: perf.failures.reduce((acc,f)=>{ acc[f.failType]=(acc[f.failType]||0)+1; return acc; },{}),
      failed_device_addresses: Array.from(new Set(perf.failures.map(f=>f.device))),
      failures_detailed: perf.failures.map(f => ({
        device: f.device,
        deviceIdx: f.deviceIdx,
        failType: f.failType,
        errCode: f.errCode,
        errReason: f.errReason,
        errSummary: f.errSummary,
        txHash: f.txHash,
        blockNumber: f.blockNumber,
        gasUsed: f.gasUsed,
        status: f.status,
        ts: f.ts
      }))
    },
    privacy: {
      privacyLeakageProbability: plp,
      contextLinkability: linkabilityScore,
      entropy: {
        location: H_location,
        role: H_role,
        status: H_status
      }
    }
  };

  const outDir = PATH.resolve(__dirname,'..','build'); if(!FS.existsSync(outDir)) FS.mkdirSync(outDir,{recursive:true});
  FS.writeFileSync(PATH.resolve(outDir,'metrics_summary.json'), JSON.stringify(summary,null,2));
  console.log('Wrote build/metrics_summary.json');
  console.log('Summary:', JSON.stringify(summary,null,2));

  await server.close();
  process.exit(0);
})();
