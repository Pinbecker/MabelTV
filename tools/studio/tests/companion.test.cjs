'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { copy, beneath, fetchCloud } = require('../lib/cloud-files.cjs');
const { saveCloud } = require('../lib/cloud-archive.cjs');
const { removeOptimised, sendSubtitles } = require('../lib/subtitles.cjs');
const { Companion } = require('../lib/companion.cjs');
const { CompanionJobs } = require('../lib/companion-jobs.cjs');
const { Store } = require('../lib/store.cjs');
const { Queue } = require('../lib/queue.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-companion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('cloud paths cannot escape and an interrupted copy resumes without changing source', async t => {
  const root = fixture(t), source = path.join(root, 'source'), target = path.join(root, 'download');
  const bytes = Buffer.alloc(600000, 42); fs.writeFileSync(source, bytes);
  const interrupted = new AbortController();
  await assert.rejects(copy(source, target, interrupted.signal, () => interrupted.abort()), /abort/i);
  const retained = fs.statSync(target + '.part').size;
  const seen = [];
  await copy(source, target, new AbortController().signal, value => seen.push(value.bytes));
  assert.deepEqual(fs.readFileSync(source), bytes); assert.deepEqual(fs.readFileSync(target), bytes);
  assert.equal(seen.at(-1), bytes.length); assert.equal(fs.existsSync(target + '.part'), false);
  assert.ok(seen[0] > retained);
  for (const relative of ['../secrets', '/absolute', 'folder/../../secret', 'folder\\secret']) assert.throws(() => beneath(root, relative));
});
test('copies detect an equal-sized replacement and never combine different source versions', async t => {
  const root = fixture(t), source = path.join(root, 'source'), target = path.join(root, 'target');
  const first = Buffer.alloc(300000, 1), second = Buffer.alloc(300000, 2);
  fs.writeFileSync(source, first);
  const interrupted = new AbortController();
  await assert.rejects(copy(source, target, interrupted.signal, () => interrupted.abort()));
  fs.writeFileSync(source, second);
  await copy(source, target, new AbortController().signal);
  assert.deepEqual(fs.readFileSync(target), second);
  fs.writeFileSync(source, first);
  await copy(source, target, new AbortController().signal);
  assert.deepEqual(fs.readFileSync(target), first);
});
test('cloud hydration copies a selected original and its subtitle into an isolated job', async t => {
  const root = fixture(t), store = new Store(path.join(root, 'state'));
  store.state.settings.iCloudRoot = path.join(root, 'iCloud');
  const directory = path.join(store.state.settings.iCloudRoot, 'Media', 'Films'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'Film.mp4'), 'video'); fs.writeFileSync(path.join(directory, 'Film.en.srt'), 'subtitles');
  const portal = { api: async () => ({ path: 'Films/Film.mp4', bytes: 5, subtitles: [{ path: 'Films/Film.en.srt' }] }) };
  const result = await fetchCloud({ id: 'a'.repeat(32), source: { id: 'file', bytes: 5 } }, store, portal, new AbortController().signal, () => {});
  assert.equal(fs.readFileSync(result.file, 'utf8'), 'video');
  assert.equal(fs.readFileSync(path.join(path.dirname(result.file), 'Film.en.srt'), 'utf8'), 'subtitles');
  assert.equal(fs.readFileSync(path.join(directory, 'Film.mp4'), 'utf8'), 'video');
});
test('retention removes only the separate app-owned optimised output', t => {
  const root = fixture(t), work = path.join(root, 'work'), directory = path.join(work, 'job'); fs.mkdirSync(directory, { recursive: true });
  const source = path.join(root, 'imported.mp4'), prepared = path.join(directory, 'prepared.mp4');
  fs.writeFileSync(source, 'original'); fs.writeFileSync(prepared, 'prepared');
  assert.equal(removeOptimised({ converted: false, sourcePath: source, preparedPath: source, directory }, work), false);
  assert.equal(removeOptimised({ converted: true, sourcePath: source, preparedPath: prepared, directory }, work), true);
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  const outside = path.join(root, 'unowned.mp4'); fs.writeFileSync(outside, 'keep');
  assert.throws(() => removeOptimised({ converted: true, sourcePath: source, preparedPath: outside, directory }, work));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
});

test('cloud jobs wait for a relocated placeholder and remain cancellable', async t => {
  const root = fixture(t), store = new Store(path.join(root, 'state'));
  store.state.settings.iCloudRoot = path.join(root, 'iCloud');
  let checks = 0, waits = 0;
  const target = path.join(store.state.settings.iCloudRoot, 'Media', 'Films', 'New name.mp4');
  const portal = {api: async () => {
    checks++;
    if (checks === 2) { fs.mkdirSync(path.dirname(target), {recursive:true}); fs.writeFileSync(target, 'video'); }
    return {path:'Films/New name.mp4',bytes:5,remoteId:'stable',modified:'same'};
  }};
  const job = {id:'sync-wait',source:{id:'file',bytes:5,remoteId:'stable',modified:'same'}};
  const result = await fetchCloud(job, store, portal, new AbortController().signal, value => { if (value.message === 'Waiting for iCloud to sync this file') waits++; });
  assert.equal(fs.readFileSync(result.file,'utf8'),'video');
  assert.equal(waits,1); assert.equal(checks,2);
  const stop = new AbortController();
  await assert.rejects(fetchCloud({...job,id:'cancel-wait'},store,{api:async()=>({path:'Films/Missing.mp4',bytes:5,remoteId:'stable',modified:'same'})},stop.signal,()=>stop.abort()),/abort|Stopped/i);
});
test('cloud saving sends video only and keeps subtitles for Pi delivery', async t => {
  const root = fixture(t), store = new Store(root), directory = path.join(root, 'job');
  fs.mkdirSync(directory); store.state.settings.iCloudRoot = path.join(root, 'iCloud');
  const source = path.join(directory, 'Original.mkv'), prepared = path.join(directory, 'Prepared.mp4');
  fs.writeFileSync(source, 'original'); fs.writeFileSync(prepared, 'optimised');
  fs.writeFileSync(path.join(directory, 'Original.en.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello');
  const local = { id: 'b'.repeat(32), directory, sourcePath: source, preparedPath: prepared, metadata: { title: 'Example show', series: 2, episodeNumber: 3, episode: 'An episode' } }; store.add(local);
  const confirmed = [];
  const relative = await saveCloud({ id: 'a'.repeat(32), source: { type: 'iplayer' }, destination: { kind: 'icloud', prepare: true } }, local, store,
    { api: async (_route, { body }) => { if (body.lookupOnly) return { confirmed: false }; confirmed.push(body.path); return { confirmed: true }; } }, new AbortController().signal, () => {}, {});
  const cloudFolder = path.join(store.state.settings.iCloudRoot, 'Media', path.dirname(relative));
  assert.equal(path.basename(cloudFolder), 'Season 2');
  assert.equal(path.basename(path.dirname(cloudFolder)), 'Example show');
  assert.deepEqual(fs.readdirSync(cloudFolder), ['S02E03 - An episode - bbbbbbbb [Optimised].mp4']);
  assert.equal(confirmed.length, 1); assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  assert.ok(fs.existsSync(path.join(directory, 'Original.en.srt')));
  assert.ok(relative.startsWith('TV/'));
});
test('subtitle delivery binds the server-confirmed upload and keeps the original sidecar', async t => {
  const root = fixture(t), source = path.join(root, 'Film.mkv'); fs.writeFileSync(source, 'video');
  const subtitle = '1\n00:00:00,000 --> 00:00:01,000\nHello'; fs.writeFileSync(path.join(root, 'Film.en.srt'), subtitle);
  const requests = [];
  await sendSubtitles({ sourcePath: source, result: { complete: true }, uploadId: 'upload', directory: root },
    { api: async (route, options) => requests.push({ route, ...options }) }, {}, new AbortController().signal);
  assert.equal(requests[0].route, '/api/studio/subtitle'); assert.equal(requests[0].body.upload, 'upload');
  assert.equal(Buffer.from(requests[0].body.data, 'base64').toString(), subtitle);
  assert.equal(fs.readFileSync(path.join(root, 'Film.en.srt'), 'utf8'), subtitle);
});
test('download-only companion jobs finish on the laptop without conversion or upload', async t => {
  const root = fixture(t), store = new Store(root); fs.mkdirSync(store.state.settings.workspace, { recursive: true });
  const original = path.join(root, 'download.mp4'); fs.writeFileSync(original, 'download');
  let uploads = 0, prepares = 0;
  const queue = new Queue(store, { prepare: async () => { prepares++; } },
    { download: async () => ({ file: original, metadata: { title: 'Episode' } }) }, { upload: async () => { uploads++; } });

  const runner = new CompanionJobs(store, queue, { metadata: async pid => ({ pid, title: 'Episode' }) }, {});
  const state = {};
  await runner.run({ id: 'a'.repeat(32), source: { type: 'iplayer', pid: 'm0000001' }, destination: { kind: 'local', prepare: false, keepOptimised: true, label: 'Laptop' } }, state, new AbortController().signal);
  assert.equal(uploads, 0); assert.equal(prepares, 0); assert.equal(state.progress.status, 'complete');
  assert.equal(fs.readFileSync(original, 'utf8'), 'download');
  assert.equal(store.state.jobs[0].remoteId, 'a'.repeat(32));
  await queue.shutdown();
});
test('portal cancellation aborts local work and stale claims stop reporting progress', async t => {
  const root = fixture(t), store = new Store(root), actions = [];
  const local = { id: 'local', status: 'uploading', percent: 20 };
  const companion = new Companion(store, { action: async (...args) => actions.push(args) }, {}, {
    api: async () => ({ acknowledged: { id: 'remote', command: 'cancel' }, requests: [] }),
  });
  const controller = new AbortController(); companion.active = { remote: { id: 'remote', claim: 'claim' }, controller, local };
  await companion.tick(); assert.equal(controller.signal.aborted, true); assert.equal(companion.active, null);
  assert.deepEqual(actions, [['local', 'cancel']]); await companion.close();
});
test('a published job can retry metadata after a restart without uploading or needing media again', async t => {
  const root = fixture(t), store = new Store(root);
  const match = { media_type: 'movie', tmdb_id: 120, title: 'Confirmed film' };
  store.add({ id: 'b'.repeat(32), remoteId: 'a'.repeat(32), status: 'complete', result: { complete: true },
    destination: { kind: 'film', label: 'My TV films' }, metadata: { title: 'Film' }, matchApplied: true, match });
  let applied = 0;
  const portal = { current: { device: 'device' }, connect: async () => {}, upload: async () => { throw new Error('Must not upload again'); },
    applyMatch: async job => { applied++; assert.equal(job.match.device, 'device'); } };
  const queue = new Queue(store, {}, {}, portal), state = {};
  const runner = new CompanionJobs(store, queue, {}, portal);
  await runner.run({ id: 'a'.repeat(32), metadata_only: true, match, destination: { kind: 'film', keepOptimised: true } }, state, new AbortController().signal);
  assert.equal(applied, 1); assert.equal(state.progress.status, 'complete'); assert.equal(state.progress.matchedTitle.tmdb_id, 120);
  await queue.shutdown();
});
