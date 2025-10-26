const { readFileSync } = require('fs');
let paillierBigint = null;
try {
  // optional dependency
  paillierBigint = require('paillier-bigint');
} catch (e) {
  // Not installed in this environment — provide graceful fallbacks.
  paillierBigint = null;
}

function loadPaillierPublicKey() {
  if (!paillierBigint) throw new Error('paillier-bigint not installed');
  const raw = JSON.parse(readFileSync(require('path').resolve(__dirname, '..', '..', 'crypto', 'paillier_keys.json'), 'utf8'));
  const { paillier } = raw;
  const n = BigInt('0x' + paillier.n);
  const g = BigInt('0x' + paillier.g);
  return new paillierBigint.PublicKey(n, g);
}

function loadPaillierPrivateKey() {
  if (!paillierBigint) throw new Error('paillier-bigint not installed');
  const raw = JSON.parse(readFileSync(require('path').resolve(__dirname, '..', '..', 'crypto', 'paillier_keys.json'), 'utf8'));
  const { paillier } = raw;
  const n = BigInt('0x' + paillier.n);
  const g = BigInt('0x' + paillier.g);
  const lambda = BigInt('0x' + paillier.lambda);
  const mu = BigInt('0x' + paillier.mu);
  const pub = new paillierBigint.PublicKey(n, g);
  const priv = new paillierBigint.PrivateKey(lambda, mu, pub);
  return { pub, priv };
}

module.exports = { loadPaillierPublicKey, loadPaillierPrivateKey };
