const { generateRandomKeys } = require('paillier-bigint');
const { writeFileSync, mkdirSync } = require('fs');
const PATH = require('path');

(async () => {
  try {
    const { publicKey, privateKey } = await generateRandomKeys(2048);
    const keys = {
      paillier: {
        n: publicKey.n.toString(16),
        g: publicKey.g.toString(16),
        lambda: privateKey.lambda.toString(16),
        mu: privateKey.mu.toString(16)
      }
    };
    const outDir = PATH.resolve(__dirname, '..', 'crypto');
    try { mkdirSync(outDir, { recursive: true }); } catch(e){}
    writeFileSync(PATH.resolve(outDir, 'paillier_keys.json'), JSON.stringify(keys, null, 2));
    console.log('Saved to crypto/paillier_keys.json');
  } catch (e) {
    console.error('Key generation failed:', e);
    process.exit(1);
  }
})();
