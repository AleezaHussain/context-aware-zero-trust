const FS = require('fs');
const PATH = require('path');

function modPow(base, exponent, modulus) {
  if (modulus === 1n) return 0n;
  let result = 1n;
  base = base % modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    exponent = exponent >> 1n;
    base = (base * base) % modulus;
  }
  return result;
}

function loadKeysRaw() {
  const keysPath = PATH.resolve(__dirname, '..', 'build', 'he_keys.json');
  if (!FS.existsSync(keysPath)) { console.error('No HE keys found at build/he_keys.json'); process.exit(1); }
  const raw = JSON.parse(FS.readFileSync(keysPath, 'utf8'));
  // return raw numeric components as BigInt
  return {
    n: BigInt(raw.publicKey.n),
    g: BigInt(raw.publicKey.g),
    lambda: BigInt(raw.privateKey.lambda),
    mu: BigInt(raw.privateKey.mu),
  };
}

(async () => {
  const keys = loadKeysRaw();
  // support overriding csv file via CLI: node decrypt_demo.js privacy_baseline.csv
  const argCsv = process.argv[2] || 'privacy_baseline.csv';
  const csvPath = PATH.resolve(__dirname, '..', 'build', argCsv);
  if (!FS.existsSync(csvPath)) { console.error('No CSV found at', csvPath); process.exit(1); }
  const lines = FS.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const encTempIdx = header.indexOf('encTemperature');
  const encHumIdx = header.indexOf('encHumidity');
  const tempIdx = header.indexOf('temperature');
  const humIdx = header.indexOf('humidity');
  if (encTempIdx < 0 || encHumIdx < 0) { console.error('CSV does not contain encTemperature/encHumidity columns'); process.exit(1); }

  const n = keys.n;
  const nsq = n * n;

  console.log('Reading:', csvPath);
  console.log('Rows (including header):', lines.length);
  console.log('Printing original (CSV) vs decrypted values where ciphertexts exist:\n');
  console.log('row | csv_temp | csv_hum | decrypted_temp | decrypted_hum');
  console.log('----|---------:|--------:|---------------:|--------------:');

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const rawCsvTemp = tempIdx >= 0 ? cols[tempIdx] : '';
    const rawCsvHum = humIdx >= 0 ? cols[humIdx] : '';
    const encTraw = cols[encTempIdx] ? String(cols[encTempIdx]).trim().replace(/^"|"$/g, '') : '';
    const encHraw = cols[encHumIdx] ? String(cols[encHumIdx]).trim().replace(/^"|"$/g, '') : '';

    let decT = '';
    let decH = '';
    try {
      if (encTraw) {
        const cT = BigInt(encTraw);
        const uT = modPow(cT, keys.lambda, nsq);
        const L_T = (uT - 1n) / n;
        const mT = (L_T * keys.mu) % n;
        decT = mT.toString();
      }
    } catch (e) { decT = 'ERR'; }
    try {
      if (encHraw) {
        const cH = BigInt(encHraw);
        const uH = modPow(cH, keys.lambda, nsq);
        const L_H = (uH - 1n) / n;
        const mH = (L_H * keys.mu) % n;
        decH = mH.toString();
      }
    } catch (e) { decH = 'ERR'; }

    console.log([i, '|', rawCsvTemp || '-', '|', rawCsvHum || '-', '|', decT || '-', '|', decH || '-'].join(' '));
  }

  console.log('\nDone.');
})();
