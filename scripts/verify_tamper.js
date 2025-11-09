// scripts/verify_tamper.js
// Local verifier: loads runs/payload_dev01.json, tampers payload, and verifies signature
const fs = require('fs');
const Ethers = require('ethers');

const inPath = process.argv[2] || 'runs/payload_dev01.json';
if(!fs.existsSync(inPath)){
  console.error('payload file not found:', inPath); process.exit(1);
}
const o = JSON.parse(fs.readFileSync(inPath));
const origPayload = o.payload;
const signature = o.signature;
const signer = o.signer;
console.log('Loaded payload signed by', signer);

// Tamper: change temperature (or add field)
const tampered = JSON.parse(JSON.stringify(origPayload));
if(typeof tampered.temperature !== 'undefined') tampered.temperature = (tampered.temperature === 99? 98 : 99);
else tampered.extraTamper = 'tampered';

const msgTampered = JSON.stringify(tampered);
const recovered = Ethers.verifyMessage(msgTampered, signature);
console.log('Recovered address from tampered payload signature:', recovered);
if(signer && recovered.toLowerCase() !== signer.toLowerCase()){
  console.log('Signature DOES NOT match signer (tamper detected)');
  fs.writeFileSync('runs/attack_logs.txt', `tamper: signer_mismatch\nrecovered=${recovered}\nsigner=${signer}\n`);
  process.exit(0);
} else {
  console.log('Signature matches signer (unexpected)');
  fs.writeFileSync('runs/attack_logs.txt', `tamper: signature_matches\nrecovered=${recovered}\nsigner=${signer}\n`);
  process.exit(0);
}
