// scripts/sign_payload.js
// Usage: node scripts/sign_payload.js [<privKey>] [outPath]
// If no privKey provided, generate a new random key and save it to runs/device_privkey.txt
const fs = require('fs');
const { ethers } = require('ethers');

const priv = process.argv[2];
const outPath = process.argv[3] || 'runs/payload_dev01.json';
if (!fs.existsSync('runs')) fs.mkdirSync('runs');

(async ()=>{
  let wallet;
  if (priv) {
    wallet = new ethers.Wallet(priv);
  } else {
    wallet = ethers.Wallet.createRandom();
    fs.writeFileSync('runs/device_privkey.txt', wallet.privateKey + '\n');
    console.log('Generated new private key and saved to runs/device_privkey.txt');
  }
  // example payload — adapt fields to match your ContextPayload shape
  const payload = {
    deviceId: 'dev_01',
    deviceType: 'env_sensor',
    temperature: 28,
    humidity: 43,
    timestamp: new Date().toISOString(),
    location: 'Zone3',
    role: 'env_sensor',
    status: 'active',
    nonce: 9999
  };
  const msg = JSON.stringify(payload);
  const signature = await wallet.signMessage(msg);
  const signer = wallet.address;
  const out = { payload, signature, signer };
  fs.writeFileSync(outPath, JSON.stringify(out,null,2));
  console.log('Wrote', outPath, 'signed by', signer);
})();
