const fs = require('fs');
const path = require('path');

function modPow(base, exponent, modulus) {
  if (modulus === 1n) return 0n;
  let result = 1n;
  base = base % modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    exponent >>= 1n;
    base = (base * base) % modulus;
  }
  return result;
}

function paillierDecrypt(c, privateKey, n) {
  const lambda = BigInt(privateKey.lambda);
  const mu = BigInt(privateKey.mu);
  const nsq = n * n;

  // u = c^lambda mod n^2
  const u = modPow(c, lambda, nsq);
  // L(u) = (u - 1) / n
  const lu = (u - 1n) / n;
  const m = (lu * mu) % n;
  return m; // BigInt plaintext
}

function parseCsvRows(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    // a simple CSV split - works for our generated CSV where fields don't contain commas
    const parts = line.split(',');
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = parts[i] !== undefined ? parts[i].trim() : '';
    }
    return obj;
  });
  return { header, rows };
}

function formatBigIntDivision(numeratorBig, denominator, precision = 4) {
  const denomBig = BigInt(denominator);
  const intPart = numeratorBig / denomBig;
  const rem = numeratorBig % denomBig;
  if (precision <= 0) return intPart.toString();
  // compute fractional part as (rem * 10^precision) / denom
  const factor = 10n ** BigInt(precision);
  const frac = (rem * factor) / denomBig;
  // pad fractional with leading zeros if necessary
  let fracStr = frac.toString();
  if (fracStr.length < precision) {
    fracStr = '0'.repeat(precision - fracStr.length) + fracStr;
  }
  return `${intPart.toString()}.${fracStr}`;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const buildDir = path.join(repoRoot, 'build');
  const keysPath = path.join(buildDir, 'he_keys.json');
  const csvPath = path.join(buildDir, 'privacy_baseline.csv');

  if (!fs.existsSync(keysPath)) {
    console.error('Paillier keys not found at', keysPath);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(csvPath)) {
    console.error('Ciphertext CSV not found at', csvPath);
    process.exitCode = 1;
    return;
  }

  const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
  const n = BigInt(keys.publicKey.n);
  const nsq = n * n;

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const { header, rows } = parseCsvRows(csvText);

  const encTempCol = 'encTemperature';
  const encHumCol = 'encHumidity';
  const plainTempCol = 'temperature';
  const plainHumCol = 'humidity';

  const encTemps = [];
  const encHums = [];
  const plainTemps = [];
  const plainHums = [];

  for (const r of rows) {
    const encT = r[encTempCol] || '';
    const encH = r[encHumCol] || '';
    const pT = r[plainTempCol] || '';
    const pH = r[plainHumCol] || '';
    if (encT) {
      try { encTemps.push(BigInt(encT)); } catch (e) { /* skip malformed */ }
    }
    if (encH) {
      try { encHums.push(BigInt(encH)); } catch (e) { /* skip malformed */ }
    }
    if (pT) {
      const nT = Number(pT);
      if (!Number.isNaN(nT)) plainTemps.push(nT);
    }
    if (pH) {
      const nH = Number(pH);
      if (!Number.isNaN(nH)) plainHums.push(nH);
    }
  }

  if (encTemps.length === 0 && encHums.length === 0) {
    console.error('No encrypted temperature or humidity values found in CSV.');
    process.exitCode = 1;
    return;
  }

  // Multiply ciphertexts modulo n^2 to get ciphertext of sum
  function multiplyMod(ciphers) {
    return ciphers.reduce((acc, c) => (acc * c) % nsq, 1n);
  }

  const summary = {
    temperature: null,
    humidity: null,
    metadata: {
      countTemperature: encTemps.length,
      countHumidity: encHums.length,
      n: n.toString()
    }
  };

  if (encTemps.length > 0) {
    const aggEncTemp = multiplyMod(encTemps);
    const decSumTemp = paillierDecrypt(aggEncTemp, keys.privateKey, n);
    const avgTempBig = encTemps.length > 0 ? decSumTemp / BigInt(encTemps.length) : 0n;
    // Compute plaintext sums/avg for comparison (if available)
    const plainSumTemp = plainTemps.length > 0 ? plainTemps.reduce((a,b)=>a+b,0) : null;
    const plainAvgTemp = plainSumTemp !== null ? plainSumTemp / (plainTemps.length || 1) : null;

    summary.temperature = {
      encryptedAggregate: aggEncTemp.toString(),
      decryptedSum: decSumTemp.toString(),
      decryptedAverageInteger: avgTempBig.toString(),
      decryptedAverageNumber: formatBigIntDivision(decSumTemp, encTemps.length, 4),
      plaintextSum: plainSumTemp,
      plaintextAverage: plainAvgTemp,
      count: encTemps.length
    };
  }

  if (encHums.length > 0) {
    const aggEncHum = multiplyMod(encHums);
    const decSumHum = paillierDecrypt(aggEncHum, keys.privateKey, n);
    const avgHumBig = encHums.length > 0 ? decSumHum / BigInt(encHums.length) : 0n;
    const plainSumHum = plainHums.length > 0 ? plainHums.reduce((a,b)=>a+b,0) : null;
    const plainAvgHum = plainSumHum !== null ? plainSumHum / (plainHums.length || 1) : null;

    summary.humidity = {
      encryptedAggregate: aggEncHum.toString(),
      decryptedSum: decSumHum.toString(),
      decryptedAverageInteger: avgHumBig.toString(),
      decryptedAverageNumber: formatBigIntDivision(decSumHum, encHums.length, 4),
      plaintextSum: plainSumHum,
      plaintextAverage: plainAvgHum,
      count: encHums.length
    };
  }

  const outPath = path.join(buildDir, 'he_aggregate_summary.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('Homomorphic aggregation demo finished. Summary written to', outPath);
  console.log('Summary (short):');
  if (summary.temperature) {
    console.log('- Temperature: count=%d decryptedSum=%s decryptedAvg(int)=%s decryptedAvg(num)=%s plaintextAvg=%s',
      summary.temperature.count,
      summary.temperature.decryptedSum,
      summary.temperature.decryptedAverageInteger,
      summary.temperature.decryptedAverageNumber,
      String(summary.temperature.plaintextAverage)
    );
  }
  if (summary.humidity) {
    console.log('- Humidity: count=%d decryptedSum=%s decryptedAvg(int)=%s decryptedAvg(num)=%s plaintextAvg=%s',
      summary.humidity.count,
      summary.humidity.decryptedSum,
      summary.humidity.decryptedAverageInteger,
      summary.humidity.decryptedAverageNumber,
      String(summary.humidity.plaintextAverage)
    );
  }
}

main().catch(err => {
  console.error('Error in he_aggregate_demo:', err);
  process.exitCode = 1;
});
