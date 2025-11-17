const FS = require('fs');
const Ethers = require('ethers');

function loadPayload(p){ return JSON.parse(FS.readFileSync(p,'utf8')); }

async function main(){
  const p = 'runs/payload_dev01.json';
  if(!FS.existsSync(p)){ console.error('missing payload', p); process.exit(1); }
  const o = loadPayload(p);
  const signer = o.signer;
  const attempts = 18; let success=0, failed=0;
  for(let i=0;i<attempts;i++){
    const tam = JSON.parse(JSON.stringify(o.payload));
    if(typeof tam.temperature !== 'undefined') tam.temperature = (tam.temperature === 99 ? 98 : 99) + i;
    else tam.extraTamper = 'tampered'+i;
    const msg = JSON.stringify(tam);
    try{
      const recovered = Ethers.verifyMessage(msg, o.signature);
      if(recovered.toLowerCase() !== signer.toLowerCase()){
        console.log('Attempt', i+1, 'tamper detected (signature mismatch) recovered=', recovered, 'signer=', signer);
        failed++;
      } else {
        console.log('Attempt', i+1, 'UNEXPECTED signature matched', recovered);
        success++;
      }
    }catch(e){
      console.log('Attempt', i+1, 'error verifying signature', e.message);
      failed++;
    }
  }
  console.log('Summary:', { attempts, success, failed });
  FS.writeFileSync('runs/attacks_results_batch_tamper_local.json', JSON.stringify({ attempts, success, failed }, null, 2));
}

main().catch(e=>{ console.error(e); process.exit(1); });
