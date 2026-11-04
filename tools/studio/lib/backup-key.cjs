'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('./atomic-json.cjs');
function readBackupKey(root, encryption) {
  const pairing = path.join(root, 'backup-pairing-token'), saved = path.join(root, 'backup-private.json');
  if (!fs.existsSync(pairing) && !fs.existsSync(saved)) return '';
  if (!encryption.isEncryptionAvailable()) throw new Error('Windows private storage is unavailable for backup pairing.');
  if (fs.existsSync(pairing)) {
    const key = fs.readFileSync(pairing, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid backup pairing.');
    writeJson(saved, { secret: encryption.encryptString(key).toString('base64') });
    fs.unlinkSync(pairing);
  }
  const key = encryption.decryptString(Buffer.from(JSON.parse(fs.readFileSync(saved, 'utf8')).secret, 'base64'));
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('The backup connection needs pairing again.');
  return key;
}
module.exports = { readBackupKey };
