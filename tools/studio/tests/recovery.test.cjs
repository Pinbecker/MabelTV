'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeJson } = require('../lib/atomic-json.cjs');
const { profileSnapshot, reconcileSnapshot, BackupBridge } = require('../lib/backup.cjs');
const { Store } = require('../lib/store.cjs');
const crypto = require('node:crypto');
const { compressionPlan } = require('../lib/compression.cjs');
test('restore retains completed receipts and never resumes missing partial media at a recorded offset', () => {
  const input = { version: 1, sourceId: 'a'.repeat(32), settings: { workspace: 'C:/Media' }, jobs: [
    { id: 'complete', status: 'complete', result: { complete: true }, savedCloudCopies: { original: { confirmed: true } } },
    { id: 'active', source: 'iplayer', sourcePath: 'missing.mp4', preparedPath: 'missing-prepared.mp4', status: 'uploading', percent: 80 },
    { id: 'import', source: 'file', sourcePath: 'user-file.mp4', status: 'preparing' }] };
  const result = reconcileSnapshot(input, () => false);
  assert.equal(result.jobs[0].status, 'complete'); assert.equal(result.jobs[0].result.complete, true);
  assert.equal(result.jobs[1].sourcePath, ''); assert.equal(result.jobs[1].preparedPath, ''); assert.equal(result.jobs[1].percent, 0);
  assert.equal(result.jobs[2].status, 'paused'); assert.match(result.jobs[2].message, /reattach/i);
  const snapshot = profileSnapshot({ snapshot: () => ({ ...input, cookies: 'excluded', settings: { ...input.settings, password: 'excluded' } }) });
  assert.equal(snapshot.cookies, undefined); assert.equal(snapshot.settings.password, undefined);
});
test('temporary journal sharing locks retry; permanent failure preserves the previous valid primary', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-journal-lock-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'state.json'); writeJson(file, { generation: 1 });
  let failures = 2;
  const io = Object.create(fs); io.renameSync = (...args) => { if (failures-- > 0) throw Object.assign(new Error('locked'), { code: 'EPERM' }); return fs.renameSync(...args); };
  writeJson(file, { generation: 2 }, { io, wait: () => {} });
  assert.equal(JSON.parse(fs.readFileSync(file)).generation, 2);
  io.renameSync = () => { throw Object.assign(new Error('locked'), { code: 'EACCES' }); };
  assert.throws(() => writeJson(file, { generation: 3 }, { io, wait: () => {} }), /locked/);
  assert.equal(JSON.parse(fs.readFileSync(file)).generation, 2);
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});
test('source-aware policy keeps heavily compressed ready inputs and retains original size basis', () => {
  const ready = { ready: true, bytes: 350e6, duration: 7200, width: 1920, height: 1080, fps: 24, hasAudio: true };
  assert.equal(compressionPlan(ready, 'compact').keepExisting, true);
  assert.equal(compressionPlan(ready, 'compact').risky, true);
  const prepared = { ...ready, bytes: 3e9, compressionProof: { sourceBytes: 8e9, profile: 'compact' } };
  assert.equal(compressionPlan(prepared, 'compact').keepExisting, true);
  assert.equal(compressionPlan(prepared, 'smallest').sourceBytes, 8e9);
});
test('backup delivery retains local archive and last verified time while the new upload is pending', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root), payload = Buffer.from('test-only archive bytes');
  store.state.settings.iCloudRoot = path.join(root, 'Cloud');
  store.state.backupStatus = { verified: 123 };
  const name = 'MabelTV-Backup-2026-11-04T120000Z.tar.gz';
  const info = { available: true, name, bytes: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex'),
    path: 'Backups/MabelTV/snapshots/2026/11/' + name };
  const calls = [];
  const portal = { current: { base: 'http://127.0.0.1' }, transport: async () => new Response(payload, { headers: { 'content-type': 'application/gzip' } }),
    api: async (route, options) => { calls.push(route); return route.endsWith('/profile') ? { ok: true } : route.endsWith('/confirm') ? { confirmed: false } : info; } };
  const bridge = new BackupBridge(store, portal);
  await bridge.tick(); bridge.close();
  assert.deepEqual(fs.readFileSync(path.join(store.state.settings.iCloudRoot, ...info.path.split('/'))), payload);
  assert.ok(fs.existsSync(path.join(root, 'Backups', name)));
  assert.equal(store.state.backupStatus.verified, 123);
  assert.match(store.state.backupStatus.message, /Waiting/);
  assert.deepEqual(calls, ['/api/studio/backup/profile', '/api/studio/backup', '/api/studio/backup/confirm']);
});
