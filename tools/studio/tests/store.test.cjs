'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store.cjs');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-store-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
test('durable jobs recover paused and retain transfer IDs and destinations', t => {
  const root = fixture(t), store = new Store(root);
  store.add({ id: 'job', status: 'uploading', uploadId: 'server-id', destination: { kind: 'mabel', channel: 2 }, preparedPath: 'original.mp4' });
  const restored = new Store(root);
  assert.equal(restored.job('job').status, 'paused'); assert.equal(restored.job('job').uploadId, 'server-id');
  assert.equal(restored.job('job').destination.channel, 2); assert.equal(restored.state.sourceId, store.state.sourceId);
});
test('damaged primary uses the durable backup without replacing it with corrupt data', t => {
  const root = fixture(t), store = new Store(root);
  store.add({ id: 'retained', status: 'complete' }); store.save();
  fs.writeFileSync(store.file, 'broken'); const restored = new Store(root);
  assert.equal(restored.job('retained').status, 'complete'); assert.match(restored.warning, /Recovered/);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(store.file + '.bak', 'utf8')));
});
test('unreadable journal never silently empties the queue', t => {
  const root = fixture(t); fs.writeFileSync(path.join(root, 'transfers.json'), '{broken');
  assert.throws(() => new Store(root), /could not be read/);
});

test('temporary Windows replacement locks preserve the journal and its backup', t => {
  const store = new Store(fixture(t));
  store.add({ id: 'kept', status: 'prepared' });
  const rename = fs.renameSync; let attempts = 0;
  t.mock.method(fs, 'renameSync', (...args) => {
    if (++attempts === 1) throw Object.assign(new Error('File temporarily locked'), { code: 'EPERM' });
    return rename(...args);
  });
  store.update('kept', { originalRemoved: true });
  assert.equal(attempts, 2);
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).jobs[0].originalRemoved, true);
  assert.equal(JSON.parse(fs.readFileSync(store.file + '.bak', 'utf8')).jobs[0].status, 'prepared');
});
