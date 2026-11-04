'use strict';
// Explicit offline recovery tool. Never overwrites an existing profile.
const fs = require('node:fs');
const path = require('node:path');
const { reconcileSnapshot } = require('../lib/backup.cjs');
const [snapshotFile, target] = process.argv.slice(2);
if (!snapshotFile || !target || !path.isAbsolute(target)) throw new Error('Usage: node restore-profile.cjs SNAPSHOT.json ABSOLUTE-EMPTY-TARGET');
if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('Choose an empty recovery folder.');
const record = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
const restored = reconcileSnapshot(record.snapshot || record);
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'transfers.json'), JSON.stringify(restored, null, 2), { flag: 'wx', mode: 0o600 });
process.stdout.write('Studio recovery profile created. Portal and torrent credentials require sign-in on a different device.\n');
