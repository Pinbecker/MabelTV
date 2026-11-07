'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store.cjs');
const { finishTemporaryWork } = require('../lib/companion-cleanup.cjs');
const { CompanionTorrents } = require('../lib/companion-torrents.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cleanup-test-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('studio-cleanup-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  const store = new Store(path.join(root, 'state')), id = 'a'.repeat(32);
  const directory = path.join(store.state.settings.workspace, 'Film - ' + id.slice(0, 8)); fs.mkdirSync(directory, { recursive: true });
  const sourcePath = path.join(directory, 'original.mkv'), preparedPath = path.join(directory, 'prepared.mp4');
  fs.writeFileSync(sourcePath, 'source'); fs.writeFileSync(preparedPath, 'prepared');
  const original = { id: 'cloud', path: 'Films/Original.mkv', confirmed: true, bytes: 6, modified: 'same', remoteId: 'version' };
  const local = store.add({ id, directory, sourcePath, preparedPath, result: { complete: true }, savedCloudCopies: { original } });
  const remote = { id: 'b'.repeat(32), source: { type: 'cloud', ...original }, destination: { kind: 'film', saveCloud: true, cloudCopies: 'original', temporaryWork: true } };
  return { root, store, local, remote, signal: new AbortController().signal, portal: { api: async () => ({ confirmed: true }) } };
}

test('verified working files are removed while cloud cache delays retry automatically', async t => {
  const f = fixture(t), statuses = [], releases = []; let attempts = 0, waits = 0;
  const queue = { resources: { release: key => releases.push(key) }, releaseCloudCaches: async () => {
    assert.equal(fs.existsSync(f.local.sourcePath), false); assert.equal(fs.existsSync(f.local.preparedPath), false);
    if (++attempts === 1) throw Object.assign(new Error('Provider busy'), { code: 'CLOUD_CACHE_PENDING' });
  } };
  await finishTemporaryWork(f.remote, f.local, f.store, f.portal, queue, f.signal, state => statuses.push(state.stage), async () => { waits++; });
  assert.equal(attempts, 2); assert.equal(waits, 1); assert.equal(f.local.workingRemoved, true);
  assert.deepEqual(releases, [f.remote.id, f.remote.id]);
  assert.ok(statuses.every(value => value === 'freeing-space')); assert.equal(f.local.cleanupWarning, '');
});

test('shutdown during cache release resumes from receipts with no working media', async t => {
  const f = fixture(t), controller = new AbortController();
  const queue = { releaseCloudCaches: async () => { throw Object.assign(new Error('Provider busy'), { code: 'CLOUD_CACHE_PENDING' }); } };
  await assert.rejects(finishTemporaryWork(f.remote, f.local, f.store, f.portal, queue, controller.signal, () => {}, async () => { controller.abort(); controller.signal.throwIfAborted(); }));
  const reopened = new Store(f.store.root), restored = reopened.job(f.local.id);
  assert.equal(restored.cleanupVerified, true); assert.equal(restored.workingRemoved, true);
  await finishTemporaryWork(f.remote, restored, reopened, f.portal, { releaseCloudCaches: async () => {} }, f.signal, () => {});
  assert.equal(fs.existsSync(restored.sourcePath), false); assert.equal(fs.existsSync(restored.preparedPath), false);
});

test('missing cloud or TV confirmation keeps working files', async t => {
  const f = fixture(t);
  await assert.rejects(finishTemporaryWork(f.remote, f.local, f.store, { api: async () => ({ confirmed: false }) }, {}, f.signal, () => {}), /kept/);
  f.local.result.complete = false;
  await assert.rejects(finishTemporaryWork(f.remote, f.local, f.store, f.portal, {}, f.signal, () => {}), /publication/);
  assert.ok(fs.existsSync(f.local.sourcePath)); assert.ok(fs.existsSync(f.local.preparedPath));
});

test('temporary Windows file locks retry cleanup without another download', async t => {
  const f = fixture(t), unlink = fs.unlinkSync; let locked = true, waits = 0;
  t.mock.method(fs, 'unlinkSync', file => {
    if (file === f.local.preparedPath && locked) { locked = false; throw Object.assign(new Error('File is busy'), { code: 'EBUSY' }); }
    return unlink(file);
  });
  await finishTemporaryWork(f.remote, f.local, f.store, f.portal, {}, f.signal, () => {}, async () => { waits++; });
  assert.equal(waits, 1); assert.equal(f.local.workingRemoved, true);
  assert.equal(fs.existsSync(f.local.preparedPath), false); assert.equal(fs.existsSync(f.local.sourcePath), false);
});

test('title warnings do not retain a fully delivered torrent pack', async () => {
  let cleaned = 0;
  const downloads = { download: async () => ({ files: [{ index: 0, file: '/managed/Film.mp4', path: 'Film.mp4', bytes: 6 }] }), cleanup: () => { cleaned++; } };
  const jobs = { run: async (_remote, child) => { child.finishing = true; child.progress = { result: { complete: true }, metadataWarning: 'Choose a title match' }; } };
  const state = {};
  await new CompanionTorrents(downloads, jobs).run({ id: 'a'.repeat(32), title: 'Film', source: { type: 'torrent' }, destination: { kind: 'film', temporaryWork: true } }, state, new AbortController().signal);
  assert.equal(cleaned, 1); assert.equal(state.progress.status, 'complete'); assert.match(state.progress.metadataWarning, /title/);
});
