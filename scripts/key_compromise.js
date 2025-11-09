// scripts/key_compromise.js
const Web3 = require('web3');
const fs = require('fs');
const web3 = new Web3('http://127.0.0.1:8545');
const {ethers} = require('ethers');

const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

async function sendFakeTxWithKey(deviceAddress, privKey, gatewayUrl){
  const payload = {
    deviceId: deviceAddress,
    deviceType: 'env_sensor',
    temperature: 99,
    humidity: 99,
    timestamp: new Date().toISOString(),
    location: 'ZoneX',
    nonce: 9999
  };
  const wallet = new ethers.Wallet(privKey, provider);
  const msg = JSON.stringify(payload);
  const sig = await wallet.signMessage(msg);
  const body = {payload, signature: sig, signer: wallet.address};
  const fetch = require('node-fetch');
  const start = Date.now();
  const r = await fetch(gatewayUrl, { method:'POST', body: JSON.stringify(body), headers:{'Content-Type':'application/json'}});
  const text = await r.text();
  const t = Date.now() - start;
  console.log('Submitted fake tx, gateway status', r.status, 'time ms', t, 'body', text);
  return {status:r.status, text, elapsed:t, signedBy:wallet.address};
}

async function revokeDeviceOnContract(adminPrivKey, deviceAddr, contractAddr, abi){
  const wallet = new ethers.Wallet(adminPrivKey, provider);
  const contract = new ethers.Contract(contractAddr, abi, wallet);
  const tx = await contract.revokeDevice(deviceAddr);
  const rec = await tx.wait();
  console.log('Revoke tx mined', rec.transactionHash);
  return rec;
}

(async()=>{
  const compromisedPriv = process.argv[2]; // privKey for compromised device
  const deviceAddr = process.argv[3] || 'dev_02';
  const gateway = process.argv[4] || 'http://127.0.0.1:3000/submit';
  const adminPriv = process.argv[5]; // admin for revoke
  const contractAddr = process.argv[6];
  const abiPath = process.argv[7];

  if(!compromisedPriv){ console.log('usage: node scripts/key_compromise.js <compPrivKey> <deviceId> <gatewayUrl> <adminPrivKey> <contractAddr> <abiPath>'); process.exit(1); }

  console.log('Sending fake tx with compromised key...');
  const before = Date.now();
  const fake = await sendFakeTxWithKey(deviceAddr, compromisedPriv, gateway);
  if(adminPriv && contractAddr && abiPath){
    const abi = JSON.parse(fs.readFileSync(abiPath));
    console.log('Revoking device key on contract...');
    const rec = await revokeDeviceOnContract(adminPriv, deviceAddr, contractAddr, abi);
    const after = Date.now();
    const dt = after - before;
    console.log('Time to revoke (ms):', dt);
    if(!fs.existsSync('runs')) fs.mkdirSync('runs');
    fs.appendFileSync('runs/attacks_results.csv', `key_compromise,device=${deviceAddr},fake_tx_status=${fake.status},time_to_revoke_ms=${dt}\n`);
  } else {
    console.log('No admin revoke provided. You should revoke via your admin UI/contract and record time manually.');
  }

})();
