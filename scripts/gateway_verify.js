// scripts/gateway_verify.js
// Minimal Express gateway that verifies a signature over JSON payload.
// Usage: node scripts/gateway_verify.js
const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');

const app = express();
app.use(bodyParser.json({ limit: '2mb' }));

// POST /submit { payload: {...}, signature: "0x..." , signer?: "0x..." }
// Verifies signature = signMessage(JSON.stringify(payload))
app.post('/submit', (req, res) => {
  try {
    const { payload, signature, signer } = req.body;
    if (!payload || !signature) {
      return res.status(400).json({ ok:false, err: 'missing payload or signature' });
    }
    const msg = JSON.stringify(payload);
    let recovered;
    try {
      recovered = ethers.utils.verifyMessage(msg, signature);
    } catch (e) {
      return res.status(400).json({ ok:false, err: 'signature_verify_failed', detail: e.message });
    }
    // If signer field provided, compare; otherwise just return recovered address
    if (signer && signer.toLowerCase() !== recovered.toLowerCase()) {
      return res.status(400).json({ ok:false, err:'signer_mismatch', recovered, signer });
    }
    // Accept only if matches (payload untouched)
    return res.status(200).json({ ok:true, recovered });
  } catch (e) {
    return res.status(500).json({ ok:false, err: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Gateway verify listening http://127.0.0.1:${port}/submit`));
