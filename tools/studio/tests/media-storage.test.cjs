'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store.cjs');
const { migrateWorkspace } = require('../lib/workspace.cjs');
const { cleanupDownload } = require('../lib/media-cleanup.cjs');
const { Queue } = require('../lib/queue.cjs');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-storage-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
test('workspace migration survives interruption and updates only app-owned file paths', t => {
  const root = fixture(t), store = new Store(path.join(root, 'data')), to = path.join(root, 'Videos', 'MabelTV Studio');
  const directory = path.join(store.state.settings.workspace, 'job'); fs.mkdirSync(directory, { recursive: true });
  const original = path.join(directory, 'Original.mp4'); fs.writeFileSync(original, 'media');
  const external = path.join(root, 'Imported.mp4'); fs.writeFileSync(external, 'external');
  store.add({ id: 'one', status: 'prepared', directory, sourcePath: original, preparedPath: original });
  store.add({ id: 'two', status: 'complete', directory, sourcePath: external, preparedPath: original });
  // Simulate a crash after moving an item but before saving updated paths.
  store.state.workspaceMigration = { from: store.state.settings.workspace, to }; store.save();
  fs.mkdirSync(to, { recursive: true }); fs.renameSync(directory, path.join(to, 'job'));
  const restored = new Store(store.root); migrateWorkspace(restored, to);
  assert.equal(restored.job('one').sourcePath, path.join(to, 'job', 'Original.mp4'));
  assert.equal(restored.job('two').sourcePath, external); assert.equal(fs.readFileSync(external, 'utf8'), 'external');
  assert.equal(restored.state.settings.workspace, to); assert.ok(fs.existsSync(restored.job('one').preparedPath));
});
test('only a validated converted iPlayer original inside its own job is removed', async t => {
  const root = fixture(t), directory = path.join(root, 'job'); fs.mkdirSync(path.join(directory, 'Original'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'Prepared')); const sourcePath = path.join(directory, 'Original', 'b09g3jlh.mp4');
  const preparedPath = path.join(directory, 'Prepared', 'Banana.mp4'); fs.writeFileSync(sourcePath, 'original'); fs.writeFileSync(preparedPath, 'converted');
  const job = { source: 'iplayer', directory, sourcePath, preparedPath, converted: true, metadata: { pid: 'b09g3jlh' }, destination: { kind: 'mabel' } };
  await assert.rejects(cleanupDownload(job, { inspect: async () => ({ ready: false }) }), /retained/);
  assert.ok(fs.existsSync(sourcePath));
  assert.equal(await cleanupDownload({ ...job, source: 'file' }, { inspect: async () => ({ ready: true }) }), false);
  assert.ok(fs.existsSync(sourcePath));
  assert.equal(await cleanupDownload(job, { inspect: async () => ({ ready: true }) }), true);
  assert.equal(fs.existsSync(sourcePath), false); assert.equal(fs.readFileSync(preparedPath, 'utf8'), 'converted');
});
test('removed iPlayer originals do not prevent upload retry or narrower re-preparation', async t => {
  const root = fixture(t), store = new Store(root), prepared = path.join(root, 'kept.mp4'); fs.writeFileSync(prepared, 'prepared');
  store.add({ id: 'job', source: 'iplayer', sourcePath: path.join(root, 'removed.mp4'), preparedPath: prepared,
    originalRemoved: true, converted: true, status: 'paused', metadata: { title: 'Film' }, destination: { kind: 'film', profile: 'mytv', label: 'My TV' } });
  let uploads = 0;
  const queue = new Queue(store, {}, {}, { upload: async () => { uploads++; return { status: 'complete' }; } });
  await queue.execute(store.job('job'), new AbortController().signal); assert.equal(uploads, 1);
  queue.stopping = true; store.update('job', { status: 'prepared' });
  await queue.action('job', 'send', { kind: 'mabel', profile: 'mabel', channel: 1 });
  assert.equal(store.job('job').sourcePath, prepared); assert.equal(store.job('job').preparedPath, '');
  assert.equal(fs.readFileSync(prepared, 'utf8'), 'prepared');
  await queue.shutdown();
});
