// scripts/export_per_tx_from_metrics.js
// Simple exporter: reconstructs a per-tx CSV from build/metrics_summary.json
const fs = require('fs');
const outDir = 'runs';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const mPath = 'build/metrics_summary.json';
if (!fs.existsSync(mPath)) {
  console.error('Missing', mPath, ' — run compute_pds_and_perf.js first');
  process.exit(1);
}
const m = JSON.parse(fs.readFileSync(mPath));
const arm = process.argv[2] || 'A3';
// Map arrays to per-tx rows
const he = Array.isArray(m.crypto?.t_HE_enc_ms) ? m.crypto.t_HE_enc_ms : [];
const gas = Array.isArray(m.crypto?.gas_verify) ? m.crypto.gas_verify : [];
const ipe = Array.isArray(m.crypto?.t_IPE_ms) ? m.crypto.t_IPE_ms : [];
const txHashes = Array.isArray(m.crypto?.tx_hashes) ? m.crypto.tx_hashes : [];
const ctLast = m.crypto?.ct_numeric_bytes_last ?? null;
const n = Math.max(he.length, gas.length, ipe.length, txHashes.length, he.length?he.length:0);
const rows = [];
for (let i = 0; i < n; i++) {
  rows.push({
    run_id: 'latest',
    arm,
    tx_index: i,
    device_id: `dev_${(i % (m.params?.NUM_DEVICES||6)) + 1}`,
    txHash: txHashes[i] || '',
    t_HE_enc_ms: he[i] ?? '',
    t_IPE_ms: ipe[i] ?? '',
    gas_used: gas[i] ?? '',
    ct_numeric_bytes: (ctLast && i===n-1) ? ctLast : ''
  });
}
const header = 'run_id,arm,tx_index,device_id,txHash,t_HE_enc_ms,t_IPE_ms,gas_used,ct_numeric_bytes';
const csv = [header, ...rows.map(r => `${r.run_id},${r.arm},${r.tx_index},${r.device_id},${r.txHash},${r.t_HE_enc_ms},${r.t_IPE_ms},${r.gas_used},${r.ct_numeric_bytes}`)].join('\n');
fs.writeFileSync(`${outDir}/per_tx.csv`, csv);
console.log('Wrote', `${outDir}/per_tx.csv`);
