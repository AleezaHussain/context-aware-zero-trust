// scripts/replay_attack.js
const Web3 = require('web3');
const fs = require('fs');
const web3 = new Web3('http://127.0.0.1:8545');

async function chainLevelReplay(txHash){
  const tx = await web3.eth.getTransaction(txHash);
  if(!tx){
    console.log('tx not found', txHash); return;
  }
  console.log('Fetched tx:', txHash, 'nonce', tx.nonce, 'from', tx.from);
  // raw transaction not directly stored in getTransaction result; try to resend if raw available in logs
  if(tx.raw) {
    try{
      const res = await web3.eth.sendSignedTransaction(tx.raw);
      console.log('Resend accepted', res.transactionHash);
      return {accepted:true, txHash:res.transactionHash};
    }catch(e){
      console.log('Resend error (expected if nonce used):', e.message);
      return {accepted:false, error:e.message};
    }
  } else {
    console.log('No raw tx available; chain-level replay via resend likely not possible.');
    return {accepted:false, error:'no_raw'};
  }
}

async function gatewayLevelReplay(payloadPath, gatewayUrl){
  const body = JSON.parse(fs.readFileSync(payloadPath));
  const fetch = require('node-fetch');
  try{
    const r = await fetch(gatewayUrl, { method: 'POST', body: JSON.stringify(body), headers:{'Content-Type':'application/json'}});
    const j = await r.text();
    console.log('Gateway response:', r.status, j);
    return {status:r.status, body:j};
  }catch(e){
    console.log('Gateway call failed', e.message); return {error:e.message};
  }
}

const mode = process.argv[2]; // 'chain' or 'gateway'
const arg = process.argv[3]; // txHash or payloadPath
const gatewayUrl = process.argv[4] || 'http://127.0.0.1:3000/submit';

(async()=>{
  if(mode === 'chain'){
    const r = await chainLevelReplay(arg);
    console.log(JSON.stringify(r,null,2));
  } else if(mode === 'gateway'){
    const r = await gatewayLevelReplay(arg, gatewayUrl);
    console.log(JSON.stringify(r,null,2));
  } else {
    console.log('usage: node scripts/replay_attack.js chain <txHash>');
    console.log('   or: node scripts/replay_attack.js gateway <payload.json> <gatewayUrl>');
  }
})();
