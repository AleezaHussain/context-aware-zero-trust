const fs = require('fs');
const crypto = require('crypto');

// Simple local keystore: AES-256-CBC encrypt/decrypt a private key with a password.
// NOT production-grade; demonstrates removing raw PRIVATE_KEY usage from env.

function encryptPrivateKey(privateKeyHex, password) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(privateKeyHex, 'hex')), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptPrivateKey(encrypted, password) {
  const [ivHex, dataHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const key = crypto.scryptSync(password, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('hex');
}

function saveKeystore(filePath, privateKeyHex, password) {
  const content = encryptPrivateKey(privateKeyHex.replace(/^0x/, ''), password);
  fs.writeFileSync(filePath, content, { mode: 0o600 });
}

function loadKeystore(filePath, password) {
  if (!fs.existsSync(filePath)) throw new Error('keystore not found');
  const content = fs.readFileSync(filePath, 'utf8').trim();
  return '0x' + decryptPrivateKey(content, password);
}

module.exports = { saveKeystore, loadKeystore, encryptPrivateKey, decryptPrivateKey };
