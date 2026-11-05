'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Store } = require('../lib/store.cjs');
const { saveCloud, verifyCloudCopies, replaceCloudOriginal } = require('../lib/cloud-archive.cjs');
const { cleanWorkingCopies } = require('../lib/working-cleanup.cjs');

function fixture(t, copies = 'both') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cloud-archive-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('studio-cloud-archive-')); fs.rmSync(root, { recursive: true, force: true }); });
  const store = new Store(path.join(root, 'state')), id = 'b'.repeat(32);
  const directory = path.join(store.state.settings.workspace, 'Film - ' + id.slice(0, 8));
  fs.mkdirSync(path.join(directory, 'Original'), { recursive: true }); fs.mkdirSync(path.join(directory, 'Prepared'));
  store.state.settings.iCloudRoot = path.join(root, 'iCloud');
  const sourcePath = path.join(directory, 'Original', 'Film.mkv'), preparedPath = path.join(directory, 'Prepared', 'Film.mp4');
  fs.writeFileSync(sourcePath, 'full quality original'); fs.writeFileSync(preparedPath, 'optimised');
  fs.writeFileSync(path.join(directory, 'Original', 'Film.en.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello');
  const stat = fs.statSync(sourcePath);
  const local = { id, directory, sourcePath, preparedPath, metadata: { title: 'Film' },
    sourceFingerprint: { size: stat.size, mtime: stat.mtimeMs }, status: 'complete', uploadId: 'upload' };
  store.add(local);
  const remote = { id: 'a'.repeat(32), claim: 'claim', source: { type: 'iplayer' },
    destination: { kind: 'film', cloudCopies: copies, saveCloud: true, temporaryWork: true } };
  const cloud = new Map(), calls = [];
  const media = path.join(store.state.settings.iCloudRoot, 'Media');
  const portal = { api: async (route, { body } = {}) => {
    calls.push({ route, body });
    if (route.startsWith('/api/studio/cloud/item?')) return [...cloud.values()].find(item => item.id === remote.source.id);
    if (route === '/api/studio/cloud/replace-original') return { complete: true };
    assert.equal(route, '/api/studio/cloud/confirm');
    if (body.reserve) return { reserved: true };
    if (body.verifyId) {
      const item = [...cloud.values()].find(value => value.id === body.verifyId);
      return { confirmed: Boolean(item && ['bytes', 'modified', 'remoteId'].every(key => item[key] === body[key])) };
    }
    if (body.lookupOnly) {
      const existing = [...cloud.values()].find(item => item.archiveGroup === body.archiveGroup && item.archiveAsset === body.archiveAsset && body.variants.every(role => item.variants.includes(role)));
      return existing ? { confirmed: true, ...existing } : { confirmed: false };
    }
    const file = path.join(media, ...body.path.split('/'));
    assert.equal(fs.statSync(file).size, body.bytes);
    const previous = cloud.get(body.path), identity = previous?.id || crypto.createHash('sha256').update(body.path).digest('hex').slice(0, 24);
    const item = { ...previous, ...body, id: identity, modified: previous?.modified || '2026-11-01T00:00:00Z', remoteId: 'remote-' + identity };
    cloud.set(body.path, item);
    return { confirmed: true, ...item };
  } };
  return { root, store, local, remote, cloud, calls, portal, media, signal: new AbortController().signal };
}
test('Original, Optimised and Both archive exactly the requested video versions, with no subtitles', async t => {
  for (const choice of ['original', 'optimised', 'both']) {
    const f = fixture(t, choice);
    await saveCloud(f.remote, f.local, f.store, f.portal, f.signal);
    const items = [...f.cloud.values()];
    assert.equal(items.length, choice === 'both' ? 2 : 1);
    assert.deepEqual(Object.keys(f.local.savedCloudCopies).sort(), (choice === 'both' ? ['optimised', 'original'] : [choice]).sort());
    assert.ok(items.every(item => !/\.srt$/.test(item.path)));
    assert.deepEqual(items.map(item => fs.readFileSync(path.join(f.media, ...item.path.split('/')), 'utf8')).sort(),
      (choice === 'both' ? ['full quality original', 'optimised'] : [choice === 'original' ? 'full quality original' : 'optimised']).sort());
    await verifyCloudCopies(f.remote, f.local, f.portal, f.signal);
    cleanWorkingCopies(f.remote, f.local, f.store);
    assert.equal(fs.existsSync(f.local.sourcePath), false); assert.equal(fs.existsSync(f.local.preparedPath), false);
    assert.ok(items.every(item => fs.existsSync(path.join(f.media, ...item.path.split('/')))));
  }
});
test('an already TV-ready file uses one cloud asset to satisfy Both', async t => {
  const f = fixture(t); f.local.preparedPath = f.local.sourcePath;
  await saveCloud(f.remote, f.local, f.store, f.portal, f.signal);
  assert.equal(f.cloud.size, 1);
  assert.equal(f.local.savedCloudCopies.original.id, f.local.savedCloudCopies.optimised.id);
  await verifyCloudCopies(f.remote, f.local, f.portal, f.signal);
});
test('a resumed archive keeps its first confirmed role and only copies the unfinished role', async t => {
  const f = fixture(t), originalApi = f.portal.api;
  let fail = true;
  f.portal.api = async (route, options) => {
    if (!options?.body?.lookupOnly && options?.body?.variants?.includes('optimised') && fail) throw new Error('Offline');
    return originalApi(route, options);
  };
  await assert.rejects(saveCloud(f.remote, f.local, f.store, f.portal, f.signal), /Offline/);
  assert.ok(f.local.savedCloudCopies.original); assert.equal(f.local.savedCloudCopies.optimised, undefined);
  const reopened = new Store(f.store.root), restored = reopened.state.jobs.find(item => item.id === f.local.id);
  const existing = [...f.cloud.values()][0], moved = 'Films/Collection/' + path.posix.basename(existing.path);
  fs.mkdirSync(path.dirname(path.join(f.media, moved)), { recursive: true });
  fs.renameSync(path.join(f.media, existing.path), path.join(f.media, moved)); f.cloud.delete(existing.path); existing.path = moved; f.cloud.set(moved, existing);
  fail = false;
  await saveCloud(f.remote, restored, reopened, f.portal, f.signal);
  assert.equal(f.cloud.size, 2);
  assert.equal(f.calls.filter(call => !call.body?.lookupOnly && !call.body?.reserve && call.body?.variants?.includes('original')).length, 1);
  await verifyCloudCopies(f.remote, restored, f.portal, f.signal);
});
test('lost cloud confirmation keeps temporary working files safe', async t => {
  const f = fixture(t, 'original');
  await saveCloud(f.remote, f.local, f.store, f.portal, f.signal); f.cloud.clear();
  await assert.rejects(async () => { await verifyCloudCopies(f.remote, f.local, f.portal, f.signal); cleanWorkingCopies(f.remote, f.local, f.store); }, /kept/);
  assert.ok(fs.existsSync(f.local.sourcePath)); assert.ok(fs.existsSync(f.local.preparedPath));
});
for (const copies of ['original', 'both']) test(`existing cloud originals remain intact with ${copies} retention`, async t => {
  const f = fixture(t, copies), originalPath = 'Films/MCU/01 - Film.mkv';
  const target = path.join(f.media, ...originalPath.split('/')); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(f.local.sourcePath, target);
  const item = { id: 'c'.repeat(24), path: originalPath, bytes: fs.statSync(target).size, modified: '2026-11-01', remoteId: 'original-remote', variants: ['original'] };
  f.cloud.set(originalPath, item); f.remote.source = { type: 'cloud', ...item, archiveGroup: 'd'.repeat(32) };
  await saveCloud(f.remote, f.local, f.store, f.portal, f.signal);
  assert.equal(f.cloud.size, copies === 'original' ? 1 : 2); assert.equal(f.local.savedCloudCopies.original.id, item.id);
  if (copies === 'both') assert.match(f.local.savedCloudCopies.optimised.path, /^Films\/MCU\/01 - Film.*\[Optimised\]\.mp4$/);
  else {
    assert.equal(f.local.savedCloudCopies.optimised, undefined);
    assert.deepEqual(fs.readdirSync(path.dirname(target)), [path.basename(target)]);
    assert.equal(f.calls.some(call => call.body?.reserve), false);
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'full quality original');
  assert.equal(f.calls.filter(call => call.route.endsWith('replace-original')).length, 0);
});
test('original replacement needs the stored consent and sends only its confirmed output and publication', async t => {
  const f = fixture(t, 'optimised'); f.remote.source.type = 'cloud';
  f.local.savedCloudCopies = { optimised: { id: 'e'.repeat(24), confirmed: true } };
  await assert.rejects(replaceCloudOriginal(f.remote, f.local, f.store, f.portal, f.signal), /Confirm/);
  assert.equal(f.calls.length, 0);
  f.remote.destination.replaceCloudOriginal = true;
  await replaceCloudOriginal(f.remote, f.local, f.store, f.portal, f.signal);
  assert.equal(f.local.cloudOriginalRemoved, true);
  assert.deepEqual(f.calls[0].body, { job: f.remote.id, claim: 'claim', output: 'e'.repeat(24), upload: 'upload' });
});
test('cleanup preserves imported originals outside the owned working folders', t => {
  const f = fixture(t), imported = path.join(f.root, 'user-owned.mp4'); fs.writeFileSync(imported, 'private original');
  f.local.sourcePath = imported;
  cleanWorkingCopies(f.remote, f.local, f.store);
  assert.equal(fs.readFileSync(imported, 'utf8'), 'private original'); assert.equal(fs.existsSync(f.local.preparedPath), false);
});
test('a changed original is never silently archived or cleaned', async t => {
  const f = fixture(t, 'original'); fs.appendFileSync(f.local.sourcePath, ' changed');
  await assert.rejects(saveCloud(f.remote, f.local, f.store, f.portal, f.signal), /changed/);
  assert.equal(f.cloud.size, 0); assert.ok(fs.existsSync(f.local.sourcePath));
});
test('canonical archive identity is reused for My TV without a second AI request', async () => {
  const { archiveMatch } = require('../lib/cloud-archive.cjs');
  const calls = [];
  const portal = { current: { device: 'test-device' }, api: async route => {
    calls.push(route); return { metadata: { media_type: 'movie', tmdb_id: 329865, title: 'Arrival', year: '2016' } };
  } };
  const result = await archiveMatch({ destination: { kind: 'film' } }, { savedCloudCopies: { original: { id: 'cloud-id' } } }, portal, new AbortController().signal);
  assert.equal(result.tmdb_id, 329865); assert.equal(result.device, 'test-device');
  assert.deepEqual(calls, ['/api/studio/cloud/item?id=cloud-id']);
});
