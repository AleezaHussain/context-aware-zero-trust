// Clean privacy_disclosure.js
// This script deploys the ContextAwareSmartContract to an in-memory Ganache,
// simulates devices sending signed context updates, and measures
// baseline (per-update signatures) vs gateway session reuse (short-lived tokens).

const GanacheCore = require('ganache-core');
const Web3Core = require('web3');
const FS = require('fs');
const PATH = require('path');
const SOLC = require('solc');
// Optional Homomorphic Encryption (Paillier)
let paillierBigint = null;
try { paillierBigint = require('paillier-bigint'); } catch (e) { /* not installed */ }

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function compileContract() {
  const contractPath = PATH.resolve(__dirname, '..', 'contracts', 'ContextAwareSmartContract.sol');
  const source = FS.readFileSync(contractPath, 'utf8');
  const input = { language: 'Solidity', sources: { 'ContextAwareSmartContract.sol': { content: source } }, settings: { outputSelection: { '*': { '*': ['abi','evm.bytecode'] } } } };
  const output = JSON.parse(SOLC.compile(JSON.stringify(input)));
  if (output.errors) { for (const e of output.errors) console.error(e.formattedMessage); throw new Error('Solidity compile failed'); }
  const contractName = Object.keys(output.contracts['ContextAwareSmartContract.sol'])[0];
  const abi = output.contracts['ContextAwareSmartContract.sol'][contractName].abi;
  const bytecode = output.contracts['ContextAwareSmartContract.sol'][contractName].evm.bytecode.object;
  return { abi, bytecode };
}

async function main() {
  console.log('privacy_disclosure: starting');

  // CLI for HE: --he to enable
  const heEnabled = process.argv.includes('--he');
  let heKeys = null;
  async function initHE() {
    if (!heEnabled) return;
    if (!paillierBigint) throw new Error('HE enabled but package "paillier-bigint" not installed. Run: npm install paillier-bigint');
    console.log('Generating Paillier keys (this may take a few seconds)...');
    heKeys = await paillierBigint.generateRandomKeys(2048);
    // persist keys (stringify bigints)
    const outDirKeys = PATH.resolve(__dirname, '..', 'build'); if (!FS.existsSync(outDirKeys)) FS.mkdirSync(outDirKeys, { recursive: true });
    const toSave = {
      publicKey: { n: heKeys.publicKey.n.toString(), g: heKeys.publicKey.g.toString() },
      privateKey: { lambda: heKeys.privateKey.lambda.toString(), mu: heKeys.privateKey.mu.toString() }
    };
    FS.writeFileSync(PATH.resolve(outDirKeys, 'he_keys.json'), JSON.stringify(toSave, null, 2));
    console.log('HE keys saved to build/he_keys.json');
  }

  const server = GanacheCore.server({ wallet: { totalAccounts: 6 } });
  const PORT = 8545;
  await server.listen(PORT);
  const provider = 'http://127.0.0.1:' + PORT;
  const web3 = new Web3Core(provider);

  const accounts = await web3.eth.getAccounts();
  const deployer = accounts[0];
  const registrar = accounts[1];

  await initHE();

  const { abi, bytecode } = await compileContract();

  // allow overrides via CLI: --devices=N --updates=M
  function getArg(name, fallback) {
    const idx = process.argv.indexOf(name);
    if (idx >= 0 && process.argv.length > idx+1) return process.argv[idx+1];
    return fallback;
  }

  const NUM_DEVICES = parseInt(getArg('--devices', '20'), 10);
  const UPDATES_PER_DEVICE = parseInt(getArg('--updates', '10'), 10);

  const devices = [];
  for (let i = 0; i < NUM_DEVICES; i++) devices.push(web3.eth.accounts.create());

  async function deployAndAuthorize() {
    const Contract = new web3.eth.Contract(abi);
    const deployed = await Contract.deploy({ data: '0x' + bytecode }).send({ from: deployer, gas: 6000000 });
    try { await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('REGISTRAR_ROLE')), registrar).send({ from: deployer, gas: 200000 }); } catch(e) {}
    for (const d of devices) { try { await deployed.methods.authorizeDevice(d.address).send({ from: registrar, gas: 100000 }); } catch (e) {} }
    return deployed;
  }

  async function analyze(deployedLocal, originalRecords, numDevicesLocal) {
    const events = await deployedLocal.getPastEvents('ContextUpdated', { fromBlock: 0, toBlock: 'latest' });
    const latest = await web3.eth.getBlockNumber();
    const relevantTxs = [];
    for (let b = 0; b <= latest; b++) {
      const block = await web3.eth.getBlock(b, true);
      if (!block || !block.transactions) continue;
      for (const tx of block.transactions) { if (!tx.to) continue; if (tx.to.toLowerCase() === deployedLocal.options.address.toLowerCase()) relevantTxs.push({ tx, blockTimestamp: block.timestamp }); }
    }

    const contractFields = ['temperature','humidity','totalMeterSignal','totalDevicesPowerValue','hour','ac1Power','ac2Power','ac3Power','carBatteryPowerStatus'];
    const fieldsInEvents = new Set();
    for (const ev of events) for (const f of contractFields) if (ev.returnValues && ev.returnValues[f] !== undefined) fieldsInEvents.add(f);
    const pctFieldsExposed = fieldsInEvents.size / contractFields.length;

    const tupleTypes = 'tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)';
    const funcTypes = [tupleTypes, 'uint8', 'bytes32', 'bytes32'];
    let totalFieldsInTxs = 0, visibleFieldsInTxs = 0;
    for (const item of relevantTxs) {
      const input = item.tx.input; if (!input || input === '0x') continue; const data = '0x' + input.slice(10);
      try { const decoded = web3.eth.abi.decodeParameters(funcTypes, data); totalFieldsInTxs += contractFields.length; visibleFieldsInTxs += contractFields.length; } catch (e) {}
    }
    const txVisibilityRatio = totalFieldsInTxs === 0 ? 0 : (visibleFieldsInTxs / totalFieldsInTxs);

    const eventsWithRaw = events.filter(e => contractFields.some(f => e.returnValues && e.returnValues[f] !== undefined));
    const eventExposureRatio = events.length === 0 ? 0 : (eventsWithRaw.length / events.length);

    const recoveredSigners = new Set();
    for (const item of relevantTxs) {
      const input = item.tx.input; if (!input || input === '0x') continue; const data = '0x' + input.slice(10);
      try {
        const decoded = web3.eth.abi.decodeParameters(funcTypes, data);
        const tupleObj = decoded[0]; const vals = [];
        for (let i = 0; i < 10; i++) vals.push(tupleObj[i]);
        const encoded = web3.eth.abi.encodeParameters(['uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','address'], [...vals, deployedLocal.options.address]);
        const hash = web3.utils.keccak256(encoded);
        const v = Number(decoded[1]); const r = decoded[2]; const s = decoded[3];
        const sigStr = r + s.slice(2) + (v.toString(16).length === 2 ? v.toString(16) : v.toString(16).padStart(2,'0'));
        try { const recovered = web3.eth.accounts.recover(hash, '0x' + sigStr); if (recovered) recoveredSigners.add(recovered); } catch (e) { try { const rec2 = web3.eth.accounts.recover(hash, v, r, s); if (rec2) recoveredSigners.add(rec2); } catch (ee) {} }
      } catch (e) {}
    }
    const uniqueSignersCount = recoveredSigners.size;
    const metadataLeakage = uniqueSignersCount / numDevicesLocal;

    let totalFields = 0, recoveredFields = 0;
    const eventIndex = events.map(e => ({ args: e.returnValues, blockNumber: e.blockNumber }));
    for (const rec of originalRecords) {
      totalFields += contractFields.length;
      const match = eventIndex.find(ev => contractFields.every(f => String(ev.args[f]) === String(rec[f])));
      if (match) recoveredFields += contractFields.length; else { let best = 0; for (const ev of eventIndex) { let cnt = 0; for (const f of contractFields) if (String(ev.args[f]) === String(rec[f])) cnt++; if (cnt > best) best = cnt; } recoveredFields += best; }
    }
    const reconstructionAccuracy = totalFields === 0 ? 0 : (recoveredFields / totalFields);

    // attribute-level disclosure counts (how many times each field is visible in events/txs)
    const attrCounts = {};
    for (const f of contractFields) attrCounts[f] = { inEvents: 0, inTxs: 0 };
    for (const ev of events) for (const f of contractFields) if (ev.returnValues && ev.returnValues[f] !== undefined) attrCounts[f].inEvents++;
    for (const item of relevantTxs) {
      const input = item.tx.input; if (!input || input === '0x') continue; const data = '0x' + input.slice(10);
      try { const decoded = web3.eth.abi.decodeParameters(funcTypes, data); const tupleObj = decoded[0]; for (let i = 0; i < contractFields.length; i++) { if (tupleObj[i] !== undefined) attrCounts[contractFields[i]].inTxs++; } } catch (e) {}
    }

    const m1 = pctFieldsExposed, m2 = txVisibilityRatio, m3 = eventExposureRatio, m4 = metadataLeakage, m5 = reconstructionAccuracy;
    const PDS = (m1 + m2 + m3 + m4 + m5) / 5.0;
    return { PDS, m1, m2, m3, m4, m5, events, relevantTxs, attrCounts };
  }

  // types used for encoding
  const types = ['uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','address'];

  // --- Baseline experiment ---
  console.log('\n--- Baseline experiment (per-update signature verification) ---');
  const deployedA = await deployAndAuthorize();
  const originalA = [];
  const baselineAuthTimes = [];
  for (const dev of devices) {
    for (let t = 0; t < UPDATES_PER_DEVICE; t++) {
      const baseTemp = 20 + devices.indexOf(dev);
  const temperature = baseTemp + Math.round(t * 0.2) + randInt(-1,1);
  const humidity = 30 + randInt(0,10);
      const totalMeterSignal = 0;
      const ac1Power = randInt(0,5);
      const ac2Power = randInt(0,5);
      const ac3Power = randInt(0,5);
      const totalDevicesPowerValue = ac1Power + ac2Power + ac3Power;
      const hour = (8 + t) % 24;
      const carBatteryPowerStatus = randInt(30,100);

      const nonce = Number(await deployedA.methods.nonces(dev.address).call());
      // If HE enabled, encrypt sensitive numeric fields (temperature, humidity)
      let encTemp = null, encHum = null;
      if (heEnabled && heKeys) {
        encTemp = heKeys.publicKey.encrypt(BigInt(temperature)).toString();
        encHum = heKeys.publicKey.encrypt(BigInt(humidity)).toString();
      }
      // For on-chain call we send plaintext zeros when HE is enabled (to avoid leaks)
      const onchainTemperature = (heEnabled ? 0 : temperature);
      const onchainHumidity = (heEnabled ? 0 : humidity);
      const vals = [onchainTemperature, onchainHumidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus, nonce, deployedA.options.address];
      const encoded = web3.eth.abi.encodeParameters(types, vals);
      const hash = web3.utils.keccak256(encoded);
      const signature = web3.eth.accounts.sign(hash, dev.privateKey);

      const ta = Date.now();
      const recovered = web3.eth.accounts.recover(hash, signature.signature);
      const auth = await deployedA.methods.authorizedDevice(dev.address).call();
      const tb = Date.now();
      baselineAuthTimes.push(tb - ta);

  originalA.push({ device: dev.address, temperature, humidity, encTemp, encHum, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus, nonce, signature: signature.signature });

  await deployedA.methods.setContextDataSigned([onchainTemperature, onchainHumidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus, nonce], signature.v, signature.r, signature.s).send({ from: deployer, gas: 400000 });
    }
  }

  const baselineAnalysis = await analyze(deployedA, originalA, NUM_DEVICES);
  const baselineAvgAuthMs = baselineAuthTimes.reduce((a,b)=>a+b,0) / baselineAuthTimes.length;
  console.log('Baseline avg authorization time (ms):', baselineAvgAuthMs.toFixed(2));

  // compute per-attribute disclosure percentages for baseline
  const attrList = Object.keys(baselineAnalysis.attrCounts);
  const baselineAttrDisclosure = {};
  for (const f of attrList) {
    const inEvents = baselineAnalysis.attrCounts[f].inEvents;
    const inTxs = baselineAnalysis.attrCounts[f].inTxs;
    // percentage of updates where attribute was observable in events or txs
    const totalObservations = Math.max(1, originalA.length);
    const pctEvent = inEvents / totalObservations;
    const pctTx = inTxs / totalObservations;
    baselineAttrDisclosure[f] = { inEvents, inTxs, pctEvent, pctTx };
  }

  console.log('\nBaseline attribute disclosure:');
  for (const f of attrList) console.log(`${f}: events=${baselineAttrDisclosure[f].inEvents}, txs=${baselineAttrDisclosure[f].inTxs}, pctEvent=${(baselineAttrDisclosure[f].pctEvent*100).toFixed(2)}%, pctTx=${(baselineAttrDisclosure[f].pctTx*100).toFixed(2)}%`);

  // --- Gateway experiment ---
  console.log('\n--- Gateway experiment (session reuse) ---');
  const deployedB = await deployAndAuthorize();
  const originalB = [];
  const gatewayAuthTimes = [];

  const gatewayKey = web3.eth.accounts.create();
  const gatewayAddr = gatewayKey.address;
  const sessionsB = {};
  const SESSION_TTL = 60;

  function computeCtxHash(obj, deployedLocal) {
    const typesForHash = ['uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','address'];
    const vals = [obj.temperature, obj.humidity, obj.totalMeterSignal, obj.totalDevicesPowerValue, obj.hour, obj.ac1Power, obj.ac2Power, obj.ac3Power, obj.carBatteryPowerStatus, deployedLocal.options.address];
    return web3.utils.keccak256(web3.eth.abi.encodeParameters(typesForHash, vals));
  }

  function issueToken(device, ctxHash) {
    const exp = Math.floor(Date.now()/1000) + SESSION_TTL;
    const claims = JSON.stringify({ device, ctxHash, exp });
    const claimsHash = web3.utils.keccak256(claims);
    const sig = web3.eth.accounts.sign(claimsHash, gatewayKey.privateKey);
    return { claims, signature: sig.signature };
  }

  function verifyTokenLocal(token) { try { const claimsHash = web3.utils.keccak256(token.claims); const recovered = web3.eth.accounts.recover(claimsHash, token.signature); if (recovered.toLowerCase() !== gatewayAddr.toLowerCase()) return null; return JSON.parse(token.claims); } catch (e) { return null; } }

  function fuzzyCompare(prevObj, newObj) {
    if (!prevObj) return false;
    if (Math.abs(prevObj.temperature - newObj.temperature) > 1) return false;
    if (Math.abs(prevObj.totalDevicesPowerValue - newObj.totalDevicesPowerValue) > 2) return false;
    if (Math.abs(prevObj.carBatteryPowerStatus - newObj.carBatteryPowerStatus) > 5) return false;
    if (Math.abs(prevObj.hour - newObj.hour) > 1) return false;
    return true;
  }

  for (const dev of devices) {
    for (let t = 0; t < UPDATES_PER_DEVICE; t++) {
      const baseTemp = 20 + devices.indexOf(dev);
  const temperature = baseTemp + Math.round(t * 0.2) + randInt(-1,1);
  const humidity = 30 + randInt(0,10);
      const totalMeterSignal = 0;
      const ac1Power = randInt(0,5);
      const ac2Power = randInt(0,5);
      const ac3Power = randInt(0,5);
      const totalDevicesPowerValue = ac1Power + ac2Power + ac3Power;
      const hour = (8 + t) % 24;
      const carBatteryPowerStatus = randInt(30,100);

      const nonce = Number(await deployedB.methods.nonces(dev.address).call());
  let encTemp = null, encHum = null;
  if (heEnabled && heKeys) { encTemp = heKeys.publicKey.encrypt(BigInt(temperature)).toString(); encHum = heKeys.publicKey.encrypt(BigInt(humidity)).toString(); }
  const onchainTemperature = (heEnabled ? 0 : temperature);
  const onchainHumidity = (heEnabled ? 0 : humidity);
  const vals = [onchainTemperature, onchainHumidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus, nonce, deployedB.options.address];
  const encoded = web3.eth.abi.encodeParameters(types, vals);
  const hash = web3.utils.keccak256(encoded);
      const signature = web3.eth.accounts.sign(hash, dev.privateKey);

  originalB.push({ device: dev.address, temperature, humidity, encTemp, encHum, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus, nonce, signature: signature.signature });

      const nowSec = Math.floor(Date.now()/1000);
      const sess = sessionsB[dev.address];
      if (!sess || sess.expiry < nowSec) {
        const ta = Date.now();
        const recovered = web3.eth.accounts.recover(hash, signature.signature);
        const auth = await deployedB.methods.authorizedDevice(dev.address).call();
        const tb = Date.now();
        gatewayAuthTimes.push(tb - ta);

        if (recovered.toLowerCase() !== dev.address.toLowerCase()) throw new Error('sig fail');
        if (!auth) throw new Error('not authorized');

        const payloadObj = { temperature, humidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus };
        const ctxHash = computeCtxHash(payloadObj, deployedB);
        const token = issueToken(dev.address, ctxHash);
        sessionsB[dev.address] = { ctxHash, expiry: nowSec + SESSION_TTL, lastObj: payloadObj, token };

  await deployedB.methods.setContextData(onchainTemperature, onchainHumidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus).send({ from: deployer, gas: 400000 });
      } else {
        const ta = Date.now();
        const token = sessionsB[dev.address].token;
        const claims = verifyTokenLocal(token);
        const allowed = claims && (claims.device.toLowerCase() === dev.address.toLowerCase()) && (claims.exp >= nowSec) && fuzzyCompare(sessionsB[dev.address].lastObj, { temperature, humidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus });
        const tb = Date.now();
        gatewayAuthTimes.push(tb - ta);

        if (!allowed) { delete sessionsB[dev.address]; t = t - 1; continue; }

  await deployedB.methods.setContextData(onchainTemperature, onchainHumidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus).send({ from: deployer, gas: 400000 });
        sessionsB[dev.address].lastObj = { temperature, humidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus };
        sessionsB[dev.address].expiry = nowSec + SESSION_TTL;
      }
    }
  }

  const gatewayAnalysis = await analyze(deployedB, originalB, NUM_DEVICES);
  const gatewayAvgAuthMs = gatewayAuthTimes.reduce((a,b)=>a+b,0) / gatewayAuthTimes.length;
  console.log('Gateway avg authorization time (ms):', gatewayAvgAuthMs.toFixed(2));

  // compute per-attribute disclosure percentages for gateway
  const gatewayAttrDisclosure = {};
  for (const f of attrList) {
    const inEvents = gatewayAnalysis.attrCounts[f].inEvents;
    const inTxs = gatewayAnalysis.attrCounts[f].inTxs;
    const totalObservations = Math.max(1, originalB.length);
    const pctEvent = inEvents / totalObservations;
    const pctTx = inTxs / totalObservations;
    gatewayAttrDisclosure[f] = { inEvents, inTxs, pctEvent, pctTx };
  }

  console.log('\nGateway attribute disclosure:');
  for (const f of attrList) console.log(`${f}: events=${gatewayAttrDisclosure[f].inEvents}, txs=${gatewayAttrDisclosure[f].inTxs}, pctEvent=${(gatewayAttrDisclosure[f].pctEvent*100).toFixed(2)}%, pctTx=${(gatewayAttrDisclosure[f].pctTx*100).toFixed(2)}%`);

  const improvement = ((baselineAvgAuthMs - gatewayAvgAuthMs) / baselineAvgAuthMs) * 100;
  console.log('\n=== Comparison ===');
  console.log('Baseline avg auth (ms):', baselineAvgAuthMs.toFixed(2));
  console.log('Gateway avg auth (ms):', gatewayAvgAuthMs.toFixed(2));
  console.log('Latency reduction (%):', improvement.toFixed(2));

  console.log('\nPDS baseline:', baselineAnalysis.PDS.toFixed(3));
  console.log('PDS gateway:', gatewayAnalysis.PDS.toFixed(3));

  const outDir = PATH.resolve(__dirname, '..', 'build'); if (!FS.existsSync(outDir)) FS.mkdirSync(outDir, { recursive: true });
  const csvA = ['device,temperature,humidity,encTemperature,encHumidity,totalDevicesPowerValue,hour,ac1,ac2,ac3,battery,nonce,signature'];
  for (const r of originalA) csvA.push([r.device, r.temperature, r.humidity, (r.encTemp||''), (r.encHum||''), r.totalDevicesPowerValue, r.hour, r.ac1Power, r.ac2Power, r.ac3Power, r.carBatteryPowerStatus, r.nonce, '"' + r.signature + '"'].join(','));
  FS.writeFileSync(PATH.resolve(outDir, 'privacy_baseline.csv'), csvA.join('\n'));
  const csvB = ['device,temperature,humidity,encTemperature,encHumidity,totalDevicesPowerValue,hour,ac1,ac2,ac3,battery,nonce,signature'];
  for (const r of originalB) csvB.push([r.device, r.temperature, r.humidity, (r.encTemp||''), (r.encHum||''), r.totalDevicesPowerValue, r.hour, r.ac1Power, r.ac2Power, r.ac3Power, r.carBatteryPowerStatus, r.nonce, '"' + r.signature + '"'].join(','));
  FS.writeFileSync(PATH.resolve(outDir, 'privacy_gateway.csv'), csvB.join('\n'));
  console.log('Exported CSVs to', outDir);

  // Export attribute CSVs
  const attrCsvA = ['attribute,inEvents,inTxs,pctEvent,pctTx'];
  for (const f of attrList) {
    const d = baselineAttrDisclosure[f];
    attrCsvA.push([f, d.inEvents, d.inTxs, (d.pctEvent*100).toFixed(2), (d.pctTx*100).toFixed(2)].join(','));
  }
  FS.writeFileSync(PATH.resolve(outDir, 'privacy_attributes_baseline.csv'), attrCsvA.join('\n'));

  const attrCsvB = ['attribute,inEvents,inTxs,pctEvent,pctTx'];
  for (const f of attrList) {
    const d = gatewayAttrDisclosure[f];
    attrCsvB.push([f, d.inEvents, d.inTxs, (d.pctEvent*100).toFixed(2), (d.pctTx*100).toFixed(2)].join(','));
  }
  FS.writeFileSync(PATH.resolve(outDir, 'privacy_attributes_gateway.csv'), attrCsvB.join('\n'));
  console.log('Exported attribute CSVs to', outDir);

  // --- Extra scenario: Gateway high-churn (short TTL) ---
  console.log('\n--- Gateway high-churn experiment (short TTL, more re-auth) ---');
  const deployedC = await deployAndAuthorize();
  const originalC = [];
  const gatewayAuthTimesC = [];
  const sessionsC = {};
  const HIGH_TTL = 5; // seconds

  for (const dev of devices) {
    for (let t = 0; t < UPDATES_PER_DEVICE; t++) {
      const baseTemp = 20 + devices.indexOf(dev);
  const temperature = baseTemp + Math.round(t * 0.2) + randInt(-1,1);
  const humidity = 30 + randInt(0,10);
      const totalMeterSignal = 0;
      const ac1Power = randInt(0,5);
      const ac2Power = randInt(0,5);
      const ac3Power = randInt(0,5);
      const totalDevicesPowerValue = ac1Power + ac2Power + ac3Power;
      const hour = (8 + t) % 24;
      const carBatteryPowerStatus = randInt(30,100);

      const nonce = Number(await deployedC.methods.nonces(dev.address).call());
  let encTemp = null, encHum = null;
  if (heEnabled && heKeys) { encTemp = heKeys.publicKey.encrypt(BigInt(temperature)).toString(); encHum = heKeys.publicKey.encrypt(BigInt(humidity)).toString(); }
  const onchainTemperature = (heEnabled ? 0 : temperature);
  const onchainHumidity = (heEnabled ? 0 : humidity);
  const vals = [onchainTemperature, onchainHumidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus, nonce, deployedC.options.address];
  const encoded = web3.eth.abi.encodeParameters(types, vals);
  const hash = web3.utils.keccak256(encoded);
      const signature = web3.eth.accounts.sign(hash, dev.privateKey);

  originalC.push({ device: dev.address, temperature, humidity, encTemp, encHum, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus, nonce, signature: signature.signature });

      const nowSec = Math.floor(Date.now()/1000);
      const sess = sessionsC[dev.address];
      if (!sess || sess.expiry < nowSec) {
        const ta = Date.now();
        const recovered = web3.eth.accounts.recover(hash, signature.signature);
        const auth = await deployedC.methods.authorizedDevice(dev.address).call();
        const tb = Date.now();
        gatewayAuthTimesC.push(tb - ta);

        if (recovered.toLowerCase() !== dev.address.toLowerCase()) throw new Error('sig fail');
        if (!auth) throw new Error('not authorized');

        const payloadObj = { temperature, humidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus };
        const ctxHash = computeCtxHash(payloadObj, deployedC);
        const token = issueToken(dev.address, ctxHash);
        sessionsC[dev.address] = { ctxHash, expiry: nowSec + HIGH_TTL, lastObj: payloadObj, token };

  await deployedC.methods.setContextData(onchainTemperature, onchainHumidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus).send({ from: deployer, gas: 400000 });
      } else {
        const ta = Date.now();
        const token = sessionsC[dev.address].token;
        const claims = verifyTokenLocal(token);
        const allowed = claims && (claims.device.toLowerCase() === dev.address.toLowerCase()) && (claims.exp >= nowSec) && fuzzyCompare(sessionsC[dev.address].lastObj, { temperature, humidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus });
        const tb = Date.now();
        gatewayAuthTimesC.push(tb - ta);

        if (!allowed) { delete sessionsC[dev.address]; t = t - 1; continue; }

  await deployedC.methods.setContextData(onchainTemperature, onchainHumidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus).send({ from: deployer, gas: 400000 });
        sessionsC[dev.address].lastObj = { temperature, humidity, totalMeterSignal, totalDevicesPowerValue, hour, ac1Power, ac2Power, ac3Power, carBatteryPowerStatus };
        sessionsC[dev.address].expiry = nowSec + HIGH_TTL;
      }
    }
  }

  const highChurnAnalysis = await analyze(deployedC, originalC, NUM_DEVICES);
  const gatewayHighAvgAuthMs = gatewayAuthTimesC.reduce((a,b)=>a+b,0) / gatewayAuthTimesC.length;
  console.log('Gateway high-churn avg authorization time (ms):', gatewayHighAvgAuthMs.toFixed(2));
  console.log('PDS gateway high-churn:', highChurnAnalysis.PDS.toFixed(3));

  // export CSVs for high-churn
  const csvC = ['device,temperature,humidity,encTemperature,encHumidity,totalDevicesPowerValue,hour,ac1,ac2,ac3,battery,nonce,signature'];
  for (const r of originalC) csvC.push([r.device, r.temperature, r.humidity, (r.encTemp||''), (r.encHum||''), r.totalDevicesPowerValue, r.hour, r.ac1Power, r.ac2Power, r.ac3Power, r.carBatteryPowerStatus, r.nonce, '"' + r.signature + '"'].join(','));
  FS.writeFileSync(PATH.resolve(outDir, 'privacy_gateway_highchurn.csv'), csvC.join('\n'));

  const attrCsvC = ['attribute,inEvents,inTxs,pctEvent,pctTx'];
  for (const f of attrList) {
    const d = highChurnAnalysis.attrCounts[f];
    const totalObservations = Math.max(1, originalC.length);
    attrCsvC.push([f, d.inEvents, d.inTxs, ((d.inEvents/totalObservations)*100).toFixed(2), ((d.inTxs/totalObservations)*100).toFixed(2)].join(','));
  }
  FS.writeFileSync(PATH.resolve(outDir, 'privacy_attributes_gateway_highchurn.csv'), attrCsvC.join('\n'));
  console.log('Exported high-churn CSVs to', outDir);

  await server.close();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
