const FS = require('fs');
const PATH = require('path');

function safeLoad(p){ try{ return JSON.parse(FS.readFileSync(p,'utf8')); }catch(e){ console.error('Failed to read',p,e.message); return null; } }
function pickSummary(m){ if(!m) return null; return {
  name: m.params ? `devices=${m.params.NUM_DEVICES} updates=${m.params.UPDATES_PER_DEVICE}` : 'unknown',
  TPS: m.performance && m.performance.TPS ? m.performance.TPS : null,
  latency_p50: m.performance && m.performance.latency_p50 ? m.performance.latency_p50 : null,
  latency_p95: m.performance && m.performance.latency_p95 ? m.performance.latency_p95 : null,
  t_HE_enc_avg: m.performance && typeof m.performance.t_HE_enc_avg !== 'undefined' ? m.performance.t_HE_enc_avg : (m.crypto && m.crypto.t_HE_enc_ms_avg ? m.crypto.t_HE_enc_ms_avg : null),
  t_IPE_enc_avg: m.performance && typeof m.performance.t_IPE_enc_avg !== 'undefined' ? m.performance.t_IPE_enc_avg : (m.crypto && m.crypto.t_IPE_ms_p50 ? m.crypto.t_IPE_ms_p50 : null),
  PDS: m.pds && typeof m.pds.PDS !== 'undefined' ? m.pds.PDS : null
}; }

async function main(){
  const args = process.argv.slice(2);
  if(args.length < 1){
    console.error('Usage: node tools/compare_metrics.js <metrics1.json> [metrics2.json ...]');
    process.exit(2);
  }
  const rows = [];
  for(const a of args){
    const p = PATH.resolve(a);
    const m = safeLoad(p);
    const s = pickSummary(m);
    s.__path = p;
    rows.push(s);
  }
  // Build markdown table
  const header = ['file','TPS','latency_p50_ms','latency_p95_ms','t_HE_enc_avg_ms','t_IPE_enc_avg_ms','PDS'];
  const md = [];
  md.push('| ' + header.join(' | ') + ' |');
  md.push('|' + header.map(()=> '---').join('|') + '|');
  for(const r of rows){
    md.push(`| ${r.__path.split(/[\\/]/).pop()} | ${r.TPS===null?'-':r.TPS.toFixed(3)} | ${r.latency_p50===null?'-':r.latency_p50} | ${r.latency_p95===null?'-':r.latency_p95} | ${r.t_HE_enc_avg===null?'-':Math.round(r.t_HE_enc_avg)} | ${r.t_IPE_enc_avg===null?'-':r.t_IPE_enc_avg} | ${r.PDS===null?'-':r.PDS.toFixed(3)} |`);
  }
  const out = md.join('\n');
  console.log('\nComparison table:\n');
  console.log(out);
  // Save structured results
  const outObj = { files: rows.map(r=> ({ path: r.__path, TPS: r.TPS, latency_p50: r.latency_p50, latency_p95: r.latency_p95, t_HE_enc_avg: r.t_HE_enc_avg, t_IPE_enc_avg: r.t_IPE_enc_avg, PDS: r.PDS })) };
  const outPath = PATH.resolve('build','compare_results.json');
  try{ if(!FS.existsSync('build')) FS.mkdirSync('build'); FS.writeFileSync(outPath, JSON.stringify(outObj,null,2)); console.log('\nWrote', outPath); } catch(e){ console.error('Failed to write compare_results.json', e.message); }
}

main();

// Additional: write CSV for easy consumption
try{
  const csvPath = PATH.resolve('build','compare_results.csv');
  const hdr = ['file','TPS','latency_p50_ms','latency_p95_ms','t_HE_enc_avg_ms','t_IPE_enc_avg_ms','PDS'];
  const lines = [hdr.join(',')];
  for(const f of (outObj && outObj.files) || []){
    const name = f.path ? f.path.split(/[\\/]/).pop() : '';
    const row = [name, f.TPS===null? '': f.TPS, f.latency_p50===null? '': f.latency_p50, f.latency_p95===null? '': f.latency_p95, f.t_HE_enc_avg===null? '': Math.round(f.t_HE_enc_avg), f.t_IPE_enc_avg===null? '': f.t_IPE_enc_avg, f.PDS===null? '': f.PDS];
    lines.push(row.join(','));
  }
  FS.writeFileSync(csvPath, lines.join('\n'));
  console.log('Wrote', csvPath);
}catch(e){ /* non-fatal */ }
