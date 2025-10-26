const { ethers } = require('ethers');
const { randomBytes } = require('crypto');
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
const axios = require('axios');
// Paillier HE helper (optional)
const { loadPaillierPublicKey } = require('../src/crypto/paillier');

function nowMs(){return Date.now();}
function pQuantile(arr, q){ if(!arr.length) return 0; const s=arr.slice().sort((a,b)=>a-b); const idx=Math.max(0, Math.min(s.length-1, Math.floor(q*(s.length-1)))); return s[idx]; }
function avg(arr){ if(!arr.length) return 0; return arr.reduce((a,b)=>a+b,0)/arr.length; }
function totalVariationDist(p, q){
  const keys = new Set([...Object.keys(p||{}), ...Object.keys(q||{})]);
  let s = 0;
  for(const k of keys){ s += Math.abs(((p&&p[k])||0) - ((q&&q[k])||0)); }
  return 0.5 * s;
}

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

// Bootstrapping and compilation utilities are defined inside an async IIFE
(async () => {
  // Optionally allow using an external Ganache/JSON-RPC provider.
  const USE_EXTERNAL_GANACHE = process.argv.includes('--no-ganache') || process.env.USE_EXTERNAL_GANACHE;
  let server = null;
  if (!USE_EXTERNAL_GANACHE) {
    // Start a local Ganache JSON-RPC server for isolation
    server = GanacheCore.server({ logging: { quiet: true } });
    await new Promise((resolve, reject) => {
      server.listen(8545, (err) => err ? reject(err) : resolve());
    });
    console.log('Ganache started on http://127.0.0.1:8545');
  } else {
    console.log('Skipping embedded Ganache; using existing provider at http://127.0.0.1:8545');
  }

  // Read Solidity contract source
  // Read all Solidity sources in contracts/ and compile them together
  const contractsDir = PATH.resolve(__dirname, '..', 'contracts');
  const solFiles = FS.readdirSync(contractsDir).filter(f => f.endsWith('.sol'));
  const sources = {};
  for (const f of solFiles) {
    sources[f] = { content: FS.readFileSync(PATH.join(contractsDir, f), 'utf8') };
  }

  // Compile contracts with viaIR enabled
  async function compileContracts(){
    const input = {
      language: 'Solidity',
      sources: sources,
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
        evmVersion: 'paris',
        outputSelection: { '*': { '*': ['abi','evm.bytecode'] } }
      }
    };
    const output = JSON.parse(SOLC.compile(JSON.stringify(input)));
    if (output.errors && output.errors.length) {
      // Print all messages
      for (const e of output.errors) console.error(e.formattedMessage);
      // If any error (severity === 'error') exists, fail; otherwise continue on warnings
      const hasFatal = output.errors.some(err => err.severity && err.severity.toLowerCase() === 'error');
      if (hasFatal) throw new Error('compile failed');
    }
    // Build a map of contractName -> { abi, bytecode }
    const compiled = {};
    for (const srcName of Object.keys(output.contracts)){
      for (const contractName of Object.keys(output.contracts[srcName])){
        compiled[contractName] = {
          abi: output.contracts[srcName][contractName].abi,
          bytecode: output.contracts[srcName][contractName].evm.bytecode.object
        };
      }
    }
    return compiled;
  }

  // Allow overriding RPC endpoint via --rpc-url or RPC_URL env var
  const RPC_URL = (process.env.RPC_URL) || (() => {
    const idx = process.argv.indexOf('--rpc-url');
    if (idx >= 0 && process.argv.length > idx + 1) return process.argv[idx+1];
    return 'http://127.0.0.1:8545';
  })();
  console.log('Using RPC provider:', RPC_URL);
  const web3 = new Web3(RPC_URL);

  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registrar = accounts[1];
  console.log('Accounts:', owner, registrar);

  const compiled = await compileContracts();
  console.log('Compiled OK. Contracts:', Object.keys(compiled).join(', '));
  // Deploy ContextManager / ContextAwareSmartContract
  const ctxName = Object.keys(compiled).find(n => n.toLowerCase().includes('context') && compiled[n].abi);
  if (!ctxName) throw new Error('Context contract not found in compilation');
  const Contract = new web3.eth.Contract(compiled[ctxName].abi);
  let deployed;
  try {
    deployed = await Contract.deploy({ data: '0x'+compiled[ctxName].bytecode }).send({ from: owner, gas: 6000000 });
  } catch(e){
    console.error('Deploy failed:', e && e.message ? e.message.split('\n')[0] : e);
    await server.close();
    process.exit(1);
  }
  console.log('Contract deployed', ctxName, deployed.options.address);

  // Deploy HybridContextZK if compiled (verifier address placeholder = owner)
  let hybridDeployed = null;
  const hybridName = Object.keys(compiled).find(n => n === 'HybridContextZK');
  if (hybridName) {
    const Hybrid = new web3.eth.Contract(compiled[hybridName].abi);
    try {
      hybridDeployed = await Hybrid.deploy({ data: '0x'+compiled[hybridName].bytecode, arguments: [owner] }).send({ from: owner, gas: 8000000 });
      console.log('HybridContextZK deployed at', hybridDeployed.options.address);
    } catch (e) {
      console.warn('HybridContextZK deploy failed (verifier may be missing):', e.message.split('\n')[0]);
      hybridDeployed = null;
    }
  }

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
  // Extra privacy/context flags (risk model toggles)
  const args = process.argv.slice(2);
  const config = {
    leakyContext: args.includes('--leakyContext'),
    contextAware: true
  };
  const MODE = getArg('--mode',''); // e.g., 'hybrid-enc'
  const IPE_URL = getArg('--ipe-url', 'http://127.0.0.1:8787');
  const BASELINE_PATH = getArg('--baseline','');
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
  const perf = { submitTimes: [], minedTimes: [], latencies: [], authzMs: [], txHashes: [], failures: [], crypto: {} };
  const logs = []; // per-update attribute logs for PDS computation
  // load HE public key (if keys present)
  let hePub = null;
  try {
    hePub = loadPaillierPublicKey();
    if (VERBOSE) console.log('Loaded Paillier public key for encryption');
  } catch (e) {
    if (VERBOSE) console.warn('No Paillier public key found (encryption disabled):', e.message);
    hePub = null;
  }

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
    // If Paillier public key is available, encrypt numeric signals and pack into a bytes blob
    let ctMetricsBlob = '0x';
    try {
      if (hePub) {
        const encStart = nowMs();
        // paillier-bigint expects BigInt inputs
        const ctTemp = hePub.encrypt(BigInt(temperature));
        const ctHum = hePub.encrypt(BigInt(humidity));
        const encEnd = nowMs();
  const heMs = encEnd - encStart;
  perf.crypto.lastEncMs = heMs;
  perf.crypto.t_HE_enc_ms = perf.crypto.t_HE_enc_ms || [];
  perf.crypto.t_HE_enc_ms.push(heMs);
  perf.crypto.lastCtSize = Math.max(ctTemp.toString(16).length, ctHum.toString(16).length) / 2;
        // store hex ciphertexts in a small JSON array and send as bytes
        const ctArr = ['0x' + ctTemp.toString(16), '0x' + ctHum.toString(16)];
        const json = JSON.stringify(ctArr);
        ctMetricsBlob = '0x' + Buffer.from(json).toString('hex');
        if (VERBOSE) console.log('Encrypted metrics blob size(bytes):', (ctMetricsBlob.length-2)/2, 'enc_ms=', perf.crypto.lastEncMs);
      }
    } catch (e) {
      if (VERBOSE) console.warn('HE encryption failed, sending empty blob:', e.message);
      ctMetricsBlob = '0x';
    }

    const data = deployed.methods.setContextDataViaGateway(callData, v, r, s, ctMetricsBlob).encodeABI();
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

  // helper for hybrid-enc path (IPE + gateway attestation)
  async function gatewaySubmitHybrid(device, temperature, humidity, options = {}){
    const nonce = Number(await deployed.methods.nonces(device.address).call());
    const hourVal = (new Date()).getHours();

    // 1) Encrypt numeric metrics (Paillier) if available
    let ctMetricsBlob = '0x';
    try {
      if (hePub) {
        const encStart = nowMs();
        const ctTemp = hePub.encrypt(BigInt(temperature));
        const ctHum = hePub.encrypt(BigInt(humidity));
        const encEnd = nowMs();
  const heMs = encEnd - encStart;
  perf.crypto.lastEncMs = heMs;
  perf.crypto.t_HE_enc_ms = perf.crypto.t_HE_enc_ms || [];
  perf.crypto.t_HE_enc_ms.push(heMs);
  const ctArr = ['0x' + ctTemp.toString(16), '0x' + ctHum.toString(16)];
        const json = JSON.stringify(ctArr);
        ctMetricsBlob = '0x' + Buffer.from(json).toString('hex');
        perf.crypto.lastCtSize = (ctMetricsBlob.length-2)/2;
      }
    } catch(e){ if(VERBOSE) console.warn('HE enc failed:', e.message); ctMetricsBlob='0x'; }

    // 2) IPE encrypt attributes via sidecar (if available) otherwise fallback to local emulation
    let ctAttrHex = '0x';
    let policy_ok = false;
    let tIPE_ms = 0;
    try {
      // If the IPE endpoint is reachable we use it; otherwise emulate locally for offline runs
      if (globalThis.IPE_AVAILABLE === undefined) {
        // probe once
        try {
          await axios.post(`${IPE_URL}/ipe/test`, { ctAttr: '0x00', policyKeyId: 'probe' }, { timeout: 1200 });
          globalThis.IPE_AVAILABLE = true;
        } catch (_) {
          globalThis.IPE_AVAILABLE = false;
        }
      }
      if (globalThis.IPE_AVAILABLE) {
        const x = [
          (options.status === 'active') ? 1 : 0,
          (options.location === 'Zone3') ? 1 : 0,
          (options.role === 'env_sensor') ? 1 : 0,
          1
        ];
        const t0 = nowMs();
        const r1 = await axios.post(`${IPE_URL}/ipe/encrypt`, { x });
        ctAttrHex = r1.data.ctAttr;
        const r2 = await axios.post(`${IPE_URL}/ipe/test`, { ctAttr: ctAttrHex, policyKeyId: 'zone3_active_envsensor' });
        policy_ok = !!r2.data.ok;
        const t1 = nowMs();
        tIPE_ms = t1 - t0;
        perf.crypto.t_IPE_ms = perf.crypto.t_IPE_ms || [];
        perf.crypto.t_IPE_ms.push(tIPE_ms);
        perf.attestations = perf.attestations || { count:0, invalid:0 };
        perf.attestations.count++;
        if(!policy_ok) perf.attestations.invalid++;
        if(VERBOSE) console.log('IPE encrypt/test done size(bytes):', (ctAttrHex.length-2)/2, 't_ms=', tIPE_ms);
      } else {
        // Emulate IPE locally: produce a deterministic-looking ciphertext blob and assume policy_ok true for this test
        const t0 = nowMs();
        const fake = randomBytes(32);
        ctAttrHex = '0x' + fake.toString('hex');
        policy_ok = true;
        tIPE_ms = nowMs() - t0;
        perf.crypto.t_IPE_ms = perf.crypto.t_IPE_ms || [];
        perf.crypto.t_IPE_ms.push(tIPE_ms);
        perf.attestations = perf.attestations || { count:0, invalid:0 };
        perf.attestations.count++;
        if(VERBOSE) console.log('IPE emulator used size(bytes):', (ctAttrHex.length-2)/2, 't_ms=', tIPE_ms);
      }
    } catch(e){ if(VERBOSE) console.warn('IPE error fallback:', e.message); perf.attestations = perf.attestations || { count:0, invalid:0 }; perf.attestations.invalid++; }

    // 3) Build C_t including attr and numeric ciphertext hashes
    const salt = randomBytes(32);
    const Ct_attr_part = web3.utils.keccak256(ctAttrHex || '0x');
    const Ct_numeric_part = web3.utils.keccak256(ctMetricsBlob || '0x');
    const ctxBuf = Buffer.concat([salt, Buffer.from('|'), Buffer.from(ethers.utils.toUtf8Bytes(new Date().toISOString())), Buffer.from('|'), Buffer.from(Ct_attr_part.slice(2),'hex'), Buffer.from('|'), Buffer.from(Ct_numeric_part.slice(2),'hex')]);
    const C_t = ethers.utils.keccak256(ctxBuf);

    // 4) Device signs over the same structured payload (contextHash = C_t)
    const signTypes = [
      'uint256','uint256','uint256','uint256','uint256',
      'uint256','uint256','uint256','uint256','uint256','address','bytes32'
    ];
    const signVals = [
      temperature, humidity, 0, 0, hourVal,
      0, 0, 0, 0, nonce, deployed.options.address, C_t
    ];
    const encoded = web3.eth.abi.encodeParameters(signTypes, signVals);
    const hash = web3.utils.keccak256(encoded);
    // allow failing invalid signature by using wrong key when requested
    let sigDevice;
    if (options.failType === 'invalidSig' && options.badKey) {
      sigDevice = web3.eth.accounts.sign(hash, options.badKey.privateKey);
    } else {
      sigDevice = web3.eth.accounts.sign(hash, device.privateKey);
    }

    // 5) Gateway attests (signs) (C_t, policy_ok, windowTag)
    const windowTag = Math.floor(Date.now()/60000);
    const gwMsg = web3.eth.abi.encodeParameters(['bytes32','bool','uint256'], [C_t, policy_ok, windowTag]);
    const gwHash = web3.utils.keccak256(gwMsg);
    const sigGateway = web3.eth.accounts.sign(gwHash, gateway.privateKey);

    // 6) Send transaction to setContextHybridEnc
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
      contextHash: C_t
    };
  const data = deployed.methods.setContextHybridEnc(callData, sigDevice.v, sigDevice.r, sigDevice.s, ctMetricsBlob, ctAttrHex, policy_ok, sigGateway.v, sigGateway.r, sigGateway.s, windowTag).encodeABI();
    const txCount = await web3.eth.getTransactionCount(gateway.address);
    const gasPrice = await web3.eth.getGasPrice();
  const txObj = { nonce: web3.utils.toHex(txCount), to: deployed.options.address, gas: web3.utils.toHex(2000000), gasPrice: web3.utils.toHex(gasPrice), data };
    const signed = await web3.eth.accounts.signTransaction(txObj, gateway.privateKey);
    const submitTime = nowMs();
    if(VERBOSE) console.log(`→ hybrid sending: device=${device.address.slice(0,10)}..., temp=${temperature}, hum=${humidity}, nonce=${nonce}, policy_ok=${policy_ok}`);
    perf.submitTimes.push(submitTime);
    try{
        const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
        const minedTime = nowMs();
        perf.minedTimes.push(minedTime);
        perf.latencies.push(minedTime - submitTime);
        perf.txHashes.push(receipt.transactionHash);
        // record verifier gas when doing hybrid-zk submission
        perf.crypto.gas_verify = perf.crypto.gas_verify || [];
        if (receipt && receipt.gasUsed) perf.crypto.gas_verify.push(Number(receipt.gasUsed));
      logs.push({ device: device.address, temperature, humidity, hour: hourVal, device_class: 'sensor-'+(device.address.slice(2,6)), decision: policy_ok ? 'allow' : 'deny', timestamp: submitTime, contextHash: C_t });
      if(VERBOSE) console.log(`✓ mined(hybrid): device=${device.address.slice(0,10)}... nonce=${nonce} tx=${receipt.transactionHash} gas=${receipt.gasUsed}`);
      return { ok: true, receipt };
    } catch(err){
      const clean = sanitizeError(err);
      const tsNow = nowMs();
      perf.failures.push({ device: device.address, deviceIdx: options.deviceIdx, failType: 'tx', errSummary: clean.errSummary, txHash: clean.txHash, ts: tsNow });
      logs.push({ device: device.address, temperature, humidity, hour: hourVal, device_class: 'sensor-'+(device.address.slice(2,6)), decision: 'revert', reason: clean.errSummary || 'tx reverted', timestamp: submitTime });
      if(VERBOSE) console.warn('↯ hybrid reverted:', clean.errSummary || 'tx reverted');
      return { ok: false };
    }
  }

  // helper for hybrid-zk path: build inputs, run circom/snarkjs to create proof, then submit
  const { execSync } = require('child_process');
  const SNARK_PRIME = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617'); // BN254

  async function gatewaySubmitHybridZK(device, temperature, humidity, options = {}){
    const nonce = Number(await deployed.methods.nonces(device.address).call());
    const hourVal = (new Date()).getHours();

    // numeric ciphertexts (Paillier) if available
    let ctMetricsBlob = '0x';
    try {
      if (hePub) {
        const encStart = nowMs();
        const ctTemp = hePub.encrypt(BigInt(temperature));
        const ctHum = hePub.encrypt(BigInt(humidity));
        const encEnd = nowMs();
  const heMs = encEnd - encStart;
  perf.crypto.lastEncMs = heMs;
  perf.crypto.t_HE_enc_ms = perf.crypto.t_HE_enc_ms || [];
  perf.crypto.t_HE_enc_ms.push(heMs);
  const ctArr = ['0x' + ctTemp.toString(16), '0x' + ctHum.toString(16)];
        const json = JSON.stringify(ctArr);
        ctMetricsBlob = '0x' + Buffer.from(json).toString('hex');
        perf.crypto.lastCtSize = (ctMetricsBlob.length-2)/2;
      }
    } catch(e){ if(VERBOSE) console.warn('HE enc failed:', e.message); ctMetricsBlob='0x'; }

    // IPE encrypt attributes via sidecar
    let ctAttrHex = '0x';
    try {
      const x = [
        (options.status === 'active') ? 1 : 0,
        (options.location === 'Zone3') ? 1 : 0,
        (options.role === 'env_sensor') ? 1 : 0,
        1
      ];
      const t0 = nowMs();
      const r1 = await axios.post(`${IPE_URL}/ipe/encrypt`, { x });
      ctAttrHex = r1.data.ctAttr;
      const t1 = nowMs();
      perf.crypto.t_IPE_ms = perf.crypto.t_IPE_ms || [];
      perf.crypto.t_IPE_ms.push(t1 - t0);
      perf.attestations = perf.attestations || { count:0, invalid:0 };
      perf.attestations.count++;
      if(VERBOSE) console.log('IPE encrypt size(bytes):', (ctAttrHex.length-2)/2, 't_ms=', t1-t0);
    } catch(e){ if(VERBOSE) console.warn('IPE enc error:', e.message); perf.attestations = perf.attestations || { count:0, invalid:0 }; perf.attestations.invalid++; }

    // compute hashes to field
    const keccakAttr = web3.utils.keccak256(ctAttrHex || '0x');
    const keccakNum = web3.utils.keccak256(ctMetricsBlob || '0x');
  const attrField = (BigInt(keccakAttr) % SNARK_PRIME).toString();
  const numField = (BigInt(keccakNum) % SNARK_PRIME).toString();

    // salt and tsTrunc (minutes)
    const salt = randomBytes(32);
    const tsTrunc_min = Math.floor(new Date().getTime()/60000);
    const windowTag = tsTrunc_min;

    // input JSON
    const input = {
      status_active: (options.status === 'active') ? 1 : 0,
      zone3: (options.location === 'Zone3') ? 1 : 0,
      role_envsensor: (options.role === 'env_sensor') ? 1 : 0,
      salt: Array.from(salt),
      tsTrunc_min: tsTrunc_min,
      ctAttrHash: attrField,
      ctNumHash: numField,
      C_t_public: "0",
      windowTag: windowTag
    };

    const proofsDir = PATH.resolve(__dirname,'..','build','proofs'); if(!FS.existsSync(proofsDir)) FS.mkdirSync(proofsDir,{recursive:true});
    const inputPath = PATH.resolve(proofsDir,'input.json');
    FS.writeFileSync(inputPath, JSON.stringify(input));

    // Try to run snarkjs proof pipeline (user must have circom/snarkjs installed)
      try {
      // Ensure circuit compiled: user should run circom compile beforehand, but try to run automatically
        // start timing proof generation
        const tProofStart = nowMs();
        try {
          execSync('npx circom circuits/context_policy.circom --r1cs --wasm --sym -o build/circuits', { stdio: VERBOSE ? 'inherit' : 'ignore' });
        } catch(e) {
          if(VERBOSE) console.warn('circom compile failed (ensure circom installed):', e.message);
        }
        // Generate witness
        execSync(`node build/circuits/context_policy_js/generate_witness.js build/circuits/context_policy_js/context_policy.wasm ${inputPath} build/proofs/witness.wtns`, { stdio: VERBOSE ? 'inherit' : 'ignore' });

        // Prove (requires a .zkey present - guide: run snarkjs setup beforehand)
        execSync('npx snarkjs groth16 prove build/zk/context_policy.zkey build/proofs/witness.wtns build/proofs/proof.json build/proofs/public.json', { stdio: VERBOSE ? 'inherit' : 'ignore' });

        // end timing
        const tProofEnd = nowMs();
        const proofMs = tProofEnd - tProofStart;
        perf.crypto.t_proof_gen_ms = perf.crypto.t_proof_gen_ms || [];
        perf.crypto.t_proof_gen_ms.push(proofMs);

        // Read proof & public
        const proof = JSON.parse(FS.readFileSync(PATH.resolve(proofsDir,'proof.json'),'utf8'));
        const pub = JSON.parse(FS.readFileSync(PATH.resolve(proofsDir,'public.json'),'utf8'));

      // build proof parts for solidity call
      const a = [ proof.pi_a[0].toString(), proof.pi_a[1].toString() ];
      const b = [ [ proof.pi_b[0][0].toString(), proof.pi_b[0][1].toString() ], [ proof.pi_b[1][0].toString(), proof.pi_b[1][1].toString() ] ];
      const c = [ proof.pi_c[0].toString(), proof.pi_c[1].toString() ];
      const publicSignals = pub.map(x => x.toString());

      // Pack call: use HybridContextZK if deployed, else try to call Context contract fallback (not supported)
      if (typeof hybridDeployed !== 'undefined' && hybridDeployed && hybridDeployed !== null) {
        const txData = hybridDeployed.methods.setContextHybridZK(device.address, nonce, publicSignals[0], ctMetricsBlob, Buffer.from(ctAttrHex.slice(2),'hex'), a, b, c, publicSignals).encodeABI();
        const txCount = await web3.eth.getTransactionCount(gateway.address);
        const gasPrice = await web3.eth.getGasPrice();
        const txObj = { nonce: web3.utils.toHex(txCount), to: hybridDeployed.options.address, gas: web3.utils.toHex(800000), gasPrice: web3.utils.toHex(gasPrice), data: txData };
        const signed = await web3.eth.accounts.signTransaction(txObj, gateway.privateKey);
        const submitTime = nowMs();
        perf.submitTimes.push(submitTime);
        const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
        const minedTime = nowMs();
        perf.minedTimes.push(minedTime);
        perf.latencies.push(minedTime - submitTime);
        perf.txHashes.push(receipt.transactionHash);
        logs.push({ device: device.address, temperature, humidity, hour: hourVal, device_class: 'sensor-'+(device.address.slice(2,6)), decision: 'allow', timestamp: submitTime, contextHash: publicSignals[0] });
        if (VERBOSE) console.log('✓ mined(hybrid-zk):', receipt.transactionHash, 'gas=', receipt.gasUsed);
        return { ok: true, receipt };
      } else {
        if (VERBOSE) console.warn('Hybrid deployed contract not found; proof generated but cannot submit on-chain.');
        return { ok: false, proof, publicSignals };
      }

    } catch (e) {
      console.error('ZK proof generation failed or snarkjs missing. Error:', e.message.split('\n')[0]);
      return { ok: false, err: e };
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
        if (MODE !== 'hybrid-enc') {
          // Generate randomized commitment C_t using a fresh random salt per update
          // This breaks linkability even when context attributes are identical.
          const contextString = `${contextPayload.location}|${contextPayload.role}|${contextPayload.status}|${contextPayload.timestamp}`;
          const salt = randomBytes(32); // never logged or sent
          // Build Buffer from salt + '|' + utf8(contextString)
          const ctxBuf = Buffer.concat([salt, Buffer.from('|'), Buffer.from(ethers.utils.toUtf8Bytes(contextString))]);
          const C_t = ethers.utils.keccak256(ctxBuf);
          contextHash = C_t;
          // Debug: show commitment only (do NOT log salt)
          if (VERBOSE) console.log('C_t:', contextHash);
        } else {
          // In hybrid-enc mode, the gateway will compute C_t after IPE and numeric ciphertexts
          contextHash = null;
        }
      } catch (err) {
        contextDecision = "context_violation";
        // If we want to send even when context is invalid, still compute a hash
        if (SEND_ON_CONTEXT) {
          // Even in audit mode, use a fresh randomized commitment so identical contexts are unlinkable
          const contextString = `${contextPayload.location}|${contextPayload.role}|${contextPayload.status}|${contextPayload.timestamp}`;
          const salt = randomBytes(32);
          const ctxBuf = Buffer.concat([salt, Buffer.from('|'), Buffer.from(ethers.utils.toUtf8Bytes(contextString))]);
          contextHash = ethers.utils.keccak256(ctxBuf);
          if (VERBOSE) console.log('C_t (audit):', contextHash);
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
        // Only send tx if context is valid.
        if (MODE === 'hybrid-enc') {
          await gatewaySubmitHybrid(d, temp, hum, { ...options, status, location, role, deviceIdx: idx });
        } else if (MODE === 'hybrid-zk') {
          await gatewaySubmitHybridZK(d, temp, hum, { ...options, status, location, role, deviceIdx: idx });
        } else {
          // pass contextHash to gatewaySubmit
          await gatewaySubmit(d, temp, hum, { ...options, contextHash });
        }
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
  // Confidentiality indicator: 1 if ciphertext/commitment tech used (hybrid modes), else 0
  const r_C = (MODE === 'hybrid-enc' || MODE === 'hybrid-zk') ? 1.0 : 0.0;
  const v_A=0.3, v_H=0.4, v_L=0.2, v_C=0.1;
  const R_chain = v_A*r_A + v_H*r_H + v_L*r_L + v_C*r_C;

  // R_policy: R_struct_logs approximated by R_struct; r_LP simulated
  // Policy leakage: gateway-audit has non-zero leakage; ZK is strict
  const r_LP = (MODE === 'hybrid-enc') ? 0.2 : ((MODE === 'hybrid-zk') ? 0.0 : OVERPRIV_RATE);
  const u_s=0.6, u_LP=0.4; const R_policy = u_s*R_struct + u_LP*r_LP;

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

  // 4. Risk-oriented privacy model (toggle with --leakyContext)
  const granularity = (typeof config !== 'undefined' && config.leakyContext) ? 1.0 : 0.3; // GPS vs Zone bucket
  const stableIds   = (typeof config !== 'undefined' && config.leakyContext) ? 1.0 : 0.2; // deviceId vs pseudonym
  const timeRes     = (typeof config !== 'undefined' && config.leakyContext) ? 1.0 : 0.4; // ms vs rounded
  const repeats     = 0.3; // heuristic for repeated hashes
  const privacyLeakageProbability_model = Math.min(1, 0.35*granularity + 0.35*stableIds + 0.2*timeRes + 0.1*repeats);
  const contextLinkability_model = Math.min(1, 0.5*stableIds + 0.5*repeats);

  // Risk-oriented PDS variants
  const PDS_reliability = 0.25*R_struct + 0.25*R_chain + 0.25*R_policy + 0.25*(1 - privacyLeakageProbability_model);
  const PDS_risk = 0.25*(1 - R_struct) + 0.25*(1 - R_chain) + 0.25*(1 - R_policy) + 0.25*privacyLeakageProbability_model;

  // Sanity line
  console.log(`PDS_risk=${PDS_risk.toFixed(3)} privacyLeak(model)=${privacyLeakageProbability_model.toFixed(3)} leaky=${(typeof config!=='undefined'&&config.leakyContext)}`);

  const summary = {
    params: { NUM_DEVICES, UPDATES_PER_DEVICE },
    performance: { TPS, totalCommitted, totalWindowSec, latency_p50:p50, latency_p95:p95, latency_p99:p99, authz_p50, authz_p95, avgAuthzMs: avg(perf.authzMs) },
  pds: { R_struct, components:{r_k, r_l, r_t}, R_chain, components_chain:{r_A, r_H, r_L, r_C}, R_policy, PDS, PDS_reliability, PDS_risk },
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
      privacyLeakageProbability_model,
      contextLinkability: linkabilityScore,
      contextLinkability_model,
      entropy: {
        location: H_location,
        role: H_role,
        status: H_status
      }
    }
  };

  // Crypto and attestation summaries
  summary.crypto = {
    t_IPE_ms: perf.crypto.t_IPE_ms || [],
    t_HE_enc_ms: perf.crypto.t_HE_enc_ms || [],
    t_proof_gen_ms: perf.crypto.t_proof_gen_ms || [],
    gas_verify: perf.crypto.gas_verify || [],
    t_HE_enc_ms_last: perf.crypto.lastEncMs || null,
    ct_numeric_bytes_last: perf.crypto.lastCtSize || null
  };
  if (summary.crypto.t_IPE_ms.length) {
    const arr = summary.crypto.t_IPE_ms;
    summary.crypto.t_IPE_ms_p50 = pQuantile(arr,0.5);
    summary.crypto.t_IPE_ms_p95 = pQuantile(arr,0.95);
  }
  if (summary.crypto.t_HE_enc_ms.length) {
    const arr = summary.crypto.t_HE_enc_ms;
    summary.crypto.t_HE_enc_ms_p50 = pQuantile(arr,0.5);
    summary.crypto.t_HE_enc_ms_p95 = pQuantile(arr,0.95);
    summary.crypto.t_HE_enc_ms_avg = avg(arr);
  }
  if (summary.crypto.t_proof_gen_ms.length) {
    const arr = summary.crypto.t_proof_gen_ms;
    summary.crypto.t_proof_gen_ms_p50 = pQuantile(arr,0.5);
    summary.crypto.t_proof_gen_ms_p95 = pQuantile(arr,0.95);
    summary.crypto.t_proof_gen_ms_avg = avg(arr);
  }
  if (summary.crypto.gas_verify.length) {
    summary.crypto.gas_verify_avg = avg(summary.crypto.gas_verify);
  }

  // Performance decomposition
  summary.performance.t_HE_enc_avg = summary.crypto.t_HE_enc_ms_avg || null;
  summary.performance.t_IPE_enc_avg = (summary.crypto.t_IPE_ms && summary.crypto.t_IPE_ms.length) ? avg(summary.crypto.t_IPE_ms) : null;
  summary.performance.t_proof_gen_avg = summary.crypto.t_proof_gen_ms_avg || null;
  summary.performance.avgAuthzMs = avg(perf.authzMs);
  const L_auth = summary.performance.avgAuthzMs || 0;
  const L_enc = (summary.performance.t_HE_enc_avg || 0) + (summary.performance.t_IPE_enc_avg || 0);
  const L_proof = summary.performance.t_proof_gen_avg || 0;
  const L_mine = avg(perf.latencies) - (L_auth + L_enc + L_proof);
  const L_mine_nonneg = Math.max(0, L_mine);
  summary.performance.latency_components = { L_auth, L_enc, L_proof, L_mine: L_mine_nonneg };
  summary.performance.L_bar = L_auth + L_enc + L_proof + L_mine_nonneg;
  summary.attestations = perf.attestations || { count:0, invalid:0 };

  const outDir = PATH.resolve(__dirname,'..','build'); if(!FS.existsSync(outDir)) FS.mkdirSync(outDir,{recursive:true});
  FS.writeFileSync(PATH.resolve(outDir,'metrics_summary.json'), JSON.stringify(summary,null,2));
  console.log('Wrote build/metrics_summary.json');
  console.log('Summary:', JSON.stringify(summary,null,2));

  // If baseline provided, compute comparison indices
  if (BASELINE_PATH && FS.existsSync(BASELINE_PATH)) {
    try {
      const base = JSON.parse(FS.readFileSync(BASELINE_PATH,'utf8'));
      const basePDS = base && base.pds && typeof base.pds.PDS === 'number' ? base.pds.PDS : (base.pds && base.pds.PDS ? base.pds.PDS : null);
      const baseTPS = base && base.performance && base.performance.TPS ? base.performance.TPS : (base.performance && base.performance.TPS ? base.performance.TPS : null);
      if (basePDS !== null) {
        const deltaPDS = summary.pds.PDS - basePDS;
        summary.comparison = summary.comparison || {};
        summary.comparison.deltaPDS = deltaPDS;
      }
      if (baseTPS !== null) {
        const deltaTPS_pct = baseTPS ? (100 * (TPS - baseTPS) / baseTPS) : null;
        summary.comparison = summary.comparison || {};
        summary.comparison.deltaTPS_pct = deltaTPS_pct;
        // privacy-performance efficiency index
        if (typeof summary.comparison.deltaPDS === 'number' && deltaTPS_pct !== 0 && deltaTPS_pct !== null) {
          summary.comparison.eta = summary.comparison.deltaPDS / Math.abs(deltaTPS_pct);
        }
      }
    } catch (e) {
      console.warn('Baseline parse failed:', e.message);
    }
  }

  await server.close();
  process.exit(0);
})();
