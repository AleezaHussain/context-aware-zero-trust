// scripts/tamper_attack.js
const Web3 = require('web3');
const fs = require('fs');
const web3 = new Web3('http://127.0.0.1:8545');
const {ethers} = require('ethers');

async function loadPayload(payloadPath){
  return JSON.parse(fs.readFileSync(payloadPath));
}

async function submitToGateway(body, gatewayUrl){
  const fetch = require('node-fetch');
  const r = await fetch(gatewayUrl, { method:'POST', body: JSON.stringify(body), headers:{'Content-Type':'application/json'}});
  const text = await r.text();
  return {status:r.status, body:text};
}

async function tamperAfterSigning(payloadPath, gatewayUrl){
  const o = await loadPayload(payloadPath);
  const origSig = o.signature;
  const tampered = JSON.parse(JSON.stringify(o));
  // change a field
  if(typeof tampered.payload.temperature !== 'undefined') tampered.payload.temperature = 99;
  else tampered.payload.extraTamper = 'tampered';
  tampered.signature = origSig; // keep orig signature -> should not verify
  const res = await submitToGateway(tampered, gatewayUrl);
  console.log('Tamper after signing response:', res);
  return res;
}

async function signWithCompromisedKey(payloadPath, compromisedPrivateKey, gatewayUrl){
  const o = await loadPayload(payloadPath);
  const tampered = JSON.parse(JSON.stringify(o));
  if(typeof tampered.payload.temperature !== 'undefined') tampered.payload.temperature = 99;
  else tampered.payload.extraTamper = 'tampered';
  const msg = JSON.stringify(tampered.payload);
  const wallet = new ethers.Wallet(compromisedPrivateKey);
  const sig = await wallet.signMessage(msg);
  tampered.signature = sig;
  const res = await submitToGateway(tampered, gatewayUrl);
  console.log('Tamper with compromised key response:', res);
  return res;
}

const mode = process.argv[2]; // aftersign | compromised
const payloadPath = process.argv[3];
const gatewayUrl = process.argv[4] || 'http://127.0.0.1:3000/submit';
const priv = process.argv[5]; // compromised private key

(async()=>{
  if(mode === 'aftersign'){
    await tamperAfterSigning(payloadPath, gatewayUrl);
  } else if(mode === 'compromised'){
    if(!priv){console.log('need private key for compromised mode'); return;}
    await signWithCompromisedKey(payloadPath, priv, gatewayUrl);
  } else {
    console.log('usage: node scripts/tamper_attack.js aftersign <payload.json> <gatewayUrl>');
    console.log('   or: node scripts/tamper_attack.js compromised <payload.json> <gatewayUrl> <privKey>');
  }
})();
