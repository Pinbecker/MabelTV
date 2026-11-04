'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freeCloudCache, releaseCloudCaches } = require('../lib/cloud-cache.cjs');
const { CompanionJobs } = require('../lib/companion-jobs.cjs');
const { Store } = require('../lib/store.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cache-test-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('studio-cache-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  const store = new Store(path.join(root, 'state'));
  store.state.settings.iCloudRoot = path.join(root, 'iCloud');
  const media = path.join(store.state.settings.iCloudRoot, 'Media'); fs.mkdirSync(media, { recursive: true });
  const file = path.join(media, "Film ' $(literal).mp4"); fs.writeFileSync(file, 'video');
  return { root, store, media, file, signal: new AbortController().signal };
}
test('cache release passes filenames as data and preserves the file identity and bytes', async t => {
  const f = fixture(t);
  const result = await freeCloudCache(f.file, 5, f.signal, async (command, args, options) => {
    assert.equal(command, 'powershell.exe'); assert.equal(options.windowsHide, true);
    assert.equal(options.env.MABEL_STUDIO_CLOUD_TARGET, f.file);
    assert.ok(!args.join(' ').includes(f.file));
    return { stdout: '{"status":"cloud_only","allocated":0}' };
  });
  assert.equal(result.status, 'cloud_only'); assert.equal(fs.readFileSync(f.file, 'utf8'), 'video');
  await assert.rejects(freeCloudCache(f.file, 6, f.signal), /changed/);
});
test('cache release follows a confirmed moved cloud identity and deduplicates Both', async t => {
  const f = fixture(t), receipt = { id: 'cloud', path: 'old.mp4', bytes: 5, modified: 'same', remoteId: 'remote', confirmed: true };
  const local = { id: 'b'.repeat(32), savedCloudCopies: { original: receipt, optimised: receipt } }; f.store.add(local);
  let calls = 0;
  await releaseCloudCaches({ destination: { temporaryWork: true } }, local, f.store,
    { api: async () => ({ ...receipt, path: path.basename(f.file) }) }, f.signal,
    async (file, bytes) => { calls++; assert.equal(file, f.file); assert.equal(bytes, 5); return { status: 'cloud_only', allocated: 0 }; });
  assert.equal(calls, 1); assert.equal(local.cloudCacheReleased, true);
  await releaseCloudCaches({ destination: { temporaryWork: true } }, local, f.store, {}, f.signal);
});
test('changed cloud versions and paths outside Media cannot be freed', async t => {
  const f = fixture(t), receipt = { id: 'cloud', path: 'old.mp4', bytes: 5, modified: 'same', remoteId: 'remote', confirmed: true };
  const local = { savedCloudCopies: { original: receipt } }, remote = { destination: { temporaryWork: true } };
  const release = async () => { throw new Error('Must not reach provider'); };
  await assert.rejects(releaseCloudCaches(remote, local, f.store, { api: async () => ({ ...receipt, remoteId: 'replacement' }) }, f.signal, release), /changed/);
  await assert.rejects(releaseCloudCaches(remote, local, f.store, { api: async () => ({ ...receipt, path: '../other.mp4' }) }, f.signal, release), /Invalid cloud/);
});
test('non-saving cloud optimisation keeps the original and avoids another upload', async t => {
  const f = fixture(t), id = 'b'.repeat(32), remoteId = 'a'.repeat(32);
  const directory = path.join(f.store.state.settings.workspace, 'Film - ' + id.slice(0, 8)); fs.mkdirSync(directory, { recursive: true });
  const source = path.join(directory, 'source.mkv'), prepared = path.join(directory, 'prepared.mp4');
  fs.writeFileSync(source, 'video'); fs.writeFileSync(prepared, 'larger video');
  const local = { id, remoteId, status: 'prepared', sourcePath: source, preparedPath: prepared, directory, destination: { compression: 'compact' } };
  f.store.add(local);
  const item = { id: 'cloud', path: path.basename(f.file), bytes: 5, modified: 'same', remoteId: 'remote' };
  const remote = { id: remoteId, source: { type: 'cloud', ...item }, destination: { kind: 'icloud', optimiseCloud: true, temporaryWork: true } };
  let released = 0;
  const queue = { releaseCloudCaches: async () => { if (!local.cloudCacheReleased) { released++; assert.ok(fs.existsSync(prepared)); local.cloudCacheReleased = true; } } };
  const portal = { api: async route => { assert.ok(route.startsWith('/api/studio/cloud/item?') || ['/api/studio/cloud/confirm', '/api/studio/provenance'].includes(route)); return route.includes('/item?') ? item : { confirmed: true }; } };
  const state = {};
  await new CompanionJobs(f.store, queue, {}, portal).run(remote, state, f.signal);
  assert.equal(state.progress.result.unchanged, true); assert.equal(released, 1);
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'video'); assert.equal(fs.existsSync(prepared), false);
  await new CompanionJobs(f.store, queue, {}, portal).run(remote, {}, f.signal);
});
