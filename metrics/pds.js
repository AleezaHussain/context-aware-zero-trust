// metrics/pds.js
function computeAttributePDS(attrs, plaintextSent, ciphertextSent, wCipher = 0.25) {
  const total = attrs.length;
  let sum = 0;
  for (const a of attrs) {
    const ePlain = plaintextSent && plaintextSent[a] ? 1 : 0;
    const eCipher = ciphertextSent && ciphertextSent[a] ? 1 : 0;
    sum += ePlain + wCipher * eCipher;
  }
  return sum / total;
}

function computeSignerPDS({ gatewaySigns, anonSigUsed = false }) {
  const signerHidden = gatewaySigns || anonSigUsed;
  return signerHidden ? 0 : 1;
}

function combinedPDS(attributePDS, signerPDS) {
  return (attributePDS + signerPDS) / 2;
}

module.exports = { computeAttributePDS, computeSignerPDS, combinedPDS };
