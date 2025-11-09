const FS = require('fs');
const PATH = require('path');
const inPath = PATH.resolve('build','compare_results.json');
if(!FS.existsSync(inPath)){ console.error('compare_results.json not found at', inPath); process.exit(2); }
const data = JSON.parse(FS.readFileSync(inPath,'utf8'));
const outPath = PATH.resolve('build','compare_results.csv');
const hdr = ['file','TPS','latency_p50_ms','latency_p95_ms','t_HE_enc_avg_ms','t_IPE_enc_avg_ms','PDS'];
const lines = [hdr.join(',')];
for(const f of data.files){
  const name = f.path ? f.path.split(/[\\/]/).pop() : '';
  const row = [name, f.TPS===null? '': f.TPS, f.latency_p50===null? '': f.latency_p50, f.latency_p95===null? '': f.latency_p95, f.t_HE_enc_avg===null? '': Math.round(f.t_HE_enc_avg), f.t_IPE_enc_avg===null? '': f.t_IPE_enc_avg, f.PDS===null? '': f.PDS];
  lines.push(row.join(','));
}
FS.writeFileSync(outPath, lines.join('\n'));
console.log('Wrote', outPath);
