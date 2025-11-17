const FS = require('fs');
const axios = require('axios');

async function main(){
  console.log('Starting batch tamper test: POSTing tampered payload to gateway verifier 18 times');
  if(!fsCheck('runs/payload_dev01.json')){ console.error('payload runs/payload_dev01.json not found'); process.exit(1); }
  const payload = JSON.parse(require('fs').readFileSync('runs/payload_dev01.json','utf8'));
  let attempts = 18; let success=0, failed=0;
  for(let i=0;i<attempts;i++){
    const tam = JSON.parse(JSON.stringify(payload));
    if(tam.payload && typeof tam.payload.temperature !== 'undefined') tam.payload.temperature = 99 + i;
    try{
      const res = await axios.post('http://127.0.0.1:3000/submit', tam, { headers:{ 'Content-Type':'application/json' }, timeout: 2000 });
      console.log('Attempt', i+1, 'unexpected accepted', res.status, res.data);
      success++;
    }catch(e){
      if(e.response){
        console.log('Attempt', i+1, 'rejected as expected', e.response.status, e.response.data.err || e.response.data);
      } else {
        console.log('Attempt', i+1, 'error', e.message);
      }
      failed++;
    }
  }
  console.log('Summary:', { attempts, success, failed });
  require('fs').writeFileSync('runs/attacks_results_batch_tamper.json', JSON.stringify({ attempts, success, failed }, null, 2));
}

function fsCheck(p){ try{ return require('fs').existsSync(p); }catch(e){return false;} }

main().catch(e=>{ console.error(e); process.exit(1); });
