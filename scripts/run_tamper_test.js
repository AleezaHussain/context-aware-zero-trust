// scripts/run_tamper_test.js
// Post a tampered payload to the gateway_verify server using axios
const FS = require('fs');
const axios = require('axios');
async function main(){
  const p = JSON.parse(FS.readFileSync('./runs/payload_dev01.json'));
  const tam = JSON.parse(JSON.stringify(p));
  if(tam.payload && typeof tam.payload.temperature !== 'undefined') tam.payload.temperature = 99;
  try{
    const res = await axios.post('http://127.0.0.1:3000/submit', tam, { headers:{ 'Content-Type':'application/json' } });
    console.log('gateway response', res.status, res.data);
  }catch(e){
    if(e.response) console.log('gateway response', e.response.status, e.response.data);
    else console.log('error', e.message);
  }
}
main();
