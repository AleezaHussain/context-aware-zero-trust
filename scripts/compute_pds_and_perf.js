const GanacheCore = require('ganache-core');
const Web3 = require('web3');
const FS = require('fs');
const PATH = require('path');
const SOLC = require('solc');

function nowMs(){return Date.now();}
function pQuantile(arr, q){ if(!arr.length) return 0; const s=arr.slice().sort((a,b)=>a-b); const idx=Math.max(0, Math.min(s.length-1, Math.floor(q*(s.length-1)))); return s[idx]; }
function avg(arr){ if(!arr.length) return 0; return arr.reduce((a,b)=>a+b,0)/arr.length; }

async function compileContract(){
  const source = FS.readFileSync(PATH.resolve(__dirname,'..','contracts','ContextAwareSmartContract.sol'),'utf8');
  const input = { language: 'Solidity', sources: { 'ContextAwareSmartContract.sol': { content: source } }, settings:{ outputSelection: { '*': { '*': ['abi','evm.bytecode'] }}}};
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
    const types = ['uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','address'];
    const vals = [temperature, humidity, 0, 0, (new Date()).getHours(), 0,0,0,0, nonce, deployed.options.address];
    const encoded = web3.eth.abi.encodeParameters(types, vals);
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
    const data = deployed.methods.setContextDataViaGateway(vals.slice(0,10), v, r, s).encodeABI();
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
  logs.push({ device: device.address, temperature, humidity, hour: vals[4], device_class: 'sensor-'+(device.address.slice(2,6)), decision: 'allow', timestamp: submitTime });
      return { ok: true, receipt };
    } catch(err){
      // record minimal failure info (concise)
      const errMsg = (err && err.message) ? err.message : 'device failed zero trust verification';
      perf.failures.push({ device: device.address, deviceIdx: options.deviceIdx, failType: options.failType || 'unknown', errMsg, ts: nowMs() });
      // also log the failed attempt for PDS analysis
      logs.push({ device: device.address, temperature, humidity, hour: vals[4], device_class: 'sensor-'+(device.address.slice(2,6)), decision: 'revert', reason: errMsg, timestamp: submitTime });
      if(VERBOSE) console.warn(`↯ failed send device=${device.address.slice(0,10)}... reason=device failed zero trust verification`);
      return { ok: false };
    }
  }

  // run workload with per-device dynamic patterns
  console.log('Running workload:', NUM_DEVICES, 'devices x', UPDATES_PER_DEVICE, 'updates');
  const startAll = nowMs();
  // assign per-device base and small trend params
  const deviceProfiles = devices.map((d, idx) => ({
    // make bases diverge more clearly by index
    baseTemp: 15 + idx * 3 + Math.floor(Math.random()*4),
    baseHum: 30 + idx * 2 + Math.floor(Math.random()*5),
    trend: (Math.random() - 0.45) * (0.8 + idx*0.05), // device-specific trend
    spikeProb: 0.02 + (idx % 4) * 0.08 + Math.random()*0.02
  }));

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
      const mode = (FAIL_MODE === 'random') ? ((Math.random()<0.5)?'invalidSig':'outOfRange') : FAIL_MODE;
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
      const failType = failTypes[idx] || null;
      if(failType === 'outOfRange'){
        temp = 2000;
      }
      const options = {};
      if(failType === 'invalidSig') options.failType = 'invalidSig', options.badKey = badKeys[idx], options.deviceIdx = idx;
      else if(failType === 'outOfRange') options.failType = 'outOfRange', options.deviceIdx = idx;
      await gatewaySubmit(d, temp, hum, options);
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

  const summary = {
    params: { NUM_DEVICES, UPDATES_PER_DEVICE },
    performance: { TPS, totalCommitted, totalWindowSec, latency_p50:p50, latency_p95:p95, latency_p99:p99, authz_p50, authz_p95, avgAuthzMs: avg(perf.authzMs) },
    pds: { R_struct, components:{r_k, r_l, r_t}, R_chain, components_chain:{r_A, r_H, r_L, r_C}, R_policy, PDS },
    verification: { totalAttempts, successful: totalCommitted, failures: perf.failures.length, failures_by_type: perf.failures.reduce((acc,f)=>{ acc[f.failType]=(acc[f.failType]||0)+1; return acc; },{}) }
  };

  const outDir = PATH.resolve(__dirname,'..','build'); if(!FS.existsSync(outDir)) FS.mkdirSync(outDir,{recursive:true});
  FS.writeFileSync(PATH.resolve(outDir,'metrics_summary.json'), JSON.stringify(summary,null,2));
  console.log('Wrote build/metrics_summary.json');
  console.log('Summary:', JSON.stringify(summary,null,2));

  await server.close();
  process.exit(0);
})();
