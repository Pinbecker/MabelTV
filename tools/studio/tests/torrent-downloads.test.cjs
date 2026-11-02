'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store.cjs');
const { TorrentDownloads } = require('../lib/torrent-downloads.cjs');
const { cleanWorkingCopies } = require('../lib/working-cleanup.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-torrent-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('studio-torrent-')); fs.rmSync(root, { recursive: true, force: true }); });
  const store = new Store(path.join(root, 'state')), calls = [], hash = 'a'.repeat(40);
  const raw = [{ index: 0, name: 'Show/Show.S00E01.mp4', size: 32, progress: 0 }, { index: 1, name: 'Show/Show.S00E01.en.srt', size: 8, progress: 0 }, { index: 2, name: 'Show/setup.exe', size: 6, progress: 0 }, { index: 3, name: 'Show/Show.S02E01.mp4', size: 32, progress: 0 }];
  let current = null, complete = true, loseDelete = false;
  const wanted = new Set();
  const runtime = { ensure: async () => {}, api: async (route, values = {}) => {
    calls.push({ route, ...values });
    if (route === 'torrents/info') return current ? [structuredClone(current)] : [];
    if (route === 'torrents/add') { current = { hash, tags: values.tags, save_path: values.savepath, state: 'stoppedDL', progress: 0 }; return ''; }
    if (route === 'torrents/files') return raw.map(file => ({ ...file }));
    if (route === 'torrents/stop') { current.state = 'stoppedDL'; return ''; }
    if (route === 'torrents/addTags') { current.tags += ', ' + values.tags; return ''; }
    if (route === 'torrents/removeTags') { current.tags = current.tags.split(',').map(value => value.trim()).filter(value => value !== values.tags).join(','); return ''; }
    if (route === 'torrents/setLocation') { current.save_path = values.location; return ''; }
    if (route === 'torrents/setShareLimits') { assert.equal(values.ratioLimit, 0); assert.equal(values.seedingTimeLimit, 0); assert.equal(values.shareLimitAction, 'Stop'); return ''; }
    if (route === 'torrents/filePrio') { for (const id of values.id.split('|').map(Number)) if (values.priority) wanted.add(id); else wanted.delete(id); return ''; }
    if (route === 'torrents/start') {
      current.state = 'downloading';
      if (complete) for (const index of wanted) { const file = raw.find(file => file.index === index), target = path.join(current.save_path, ...file.name.split('/')); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, Buffer.alloc(file.size, index + 1)); file.progress = 1; }
      return '';
    }
    if (route === 'torrents/delete') { assert.equal(values.deleteFiles, false); current = null; if (loseDelete) { loseDelete = false; throw new Error('Lost response'); } return ''; }
    throw new Error('Unexpected API: ' + route);
  } };
  const source = { type: 'torrent', hash, magnet: 'magnet:?xt=urn:btih:' + hash, title: 'Show', files: [{ index: 0, path: raw[0].name, bytes: raw[0].size }] };
  const remote = { id: 'b'.repeat(32), source };
  const downloader = new TorrentDownloads(store, runtime, { pollMs: 1, inspectAttempts: 3 });
  return { root, store, runtime, downloader, source, remote, calls, raw, wanted,
    setComplete: value => { complete = value; }, loseDelete: () => { loseDelete = true; }, setForeign: () => { current = { hash, tags: 'foreign', save_path: root, state: 'downloading' }; } };
}
test('review stops after metadata and downloads only chosen video plus its subtitles', async t => {
  const f = fixture(t), signal = new AbortController().signal;
  const review = await f.downloader.inspect(f.source, signal);
  assert.equal(review.files.length, 4); assert.equal(f.calls.some(call => call.route === 'torrents/start'), false);
  assert.equal(f.calls.find(call => call.route === 'torrents/add').stopCondition, 'MetadataReceived');
  const result = await f.downloader.download(f.remote, signal, () => {});
  assert.deepEqual([...f.wanted].sort(), [0, 1]);
  assert.equal(result.removed, true); assert.equal(fs.statSync(result.files[0].file).size, 32);
  assert.equal(fs.existsSync(path.join(result.directory, 'Show/setup.exe')), false);
  assert.equal(f.calls.filter(call => call.route === 'torrents/delete').length, 1);
  f.downloader.cleanup(result); assert.equal(fs.existsSync(result.directory), false);
});
test('pause stops the exact torrent and reopening resumes the same durable job', async t => {
  const f = fixture(t), controller = new AbortController();
  await f.downloader.inspect(f.source); f.setComplete(false);
  await assert.rejects(f.downloader.download(f.remote, controller.signal, () => controller.abort()), /abort|Stopped/i);
  assert.equal(f.calls.at(-1).route, 'torrents/stop'); assert.equal(f.calls.at(-1).hashes, f.source.hash);
  const reopened = new TorrentDownloads(f.store, f.runtime, { pollMs: 1 }); f.setComplete(true);
  const result = await reopened.download(f.remote, new AbortController().signal, () => {});
  assert.ok(result.removed); assert.equal(f.calls.filter(call => call.route === 'torrents/add').length, 1);
});
test('a lost torrent-removal acknowledgement recovers completion without redownloading or deleting data', async t => {
  const f = fixture(t); await f.downloader.inspect(f.source); f.loseDelete();
  await assert.rejects(f.downloader.download(f.remote, undefined, () => {}), /Lost response/);
  assert.equal(f.downloader.load(f.remote.id).complete, true);
  const reopened = new TorrentDownloads(f.store, f.runtime);
  const result = await reopened.download(f.remote, undefined, () => {});
  assert.equal(fs.statSync(result.files[0].file).size, 32);
  assert.equal(f.calls.filter(call => call.route === 'torrents/start').length, 1);
  assert.ok(result.removed);
});
test('foreign torrents and paths cannot be stopped, removed or cleaned', async t => {
  const f = fixture(t); f.setForeign();
  await assert.rejects(f.downloader.inspect(f.source), /outside/);
  assert.equal(f.calls.some(call => /stop|delete/.test(call.route)), false);
  assert.throws(() => f.downloader.cleanup({ complete: true, removed: true, id: f.remote.id, directory: f.root }), /confirmed/);
  assert.ok(fs.existsSync(f.root));
});
test('episode cleanup preserves a shared torrent pack until its parent completes', async t => {
  const f = fixture(t), result = await f.downloader.download(f.remote, undefined, () => {});
  const id = 'c'.repeat(32), directory = path.join(f.store.state.settings.workspace, 'Episode - ' + id.slice(0, 8));
  fs.mkdirSync(directory, { recursive: true }); const prepared = path.join(directory, 'prepared.mp4'); fs.writeFileSync(prepared, 'optimised');
  const local = f.store.add({ id, directory, sourcePath: result.files[0].file, preparedPath: prepared });
  cleanWorkingCopies({ id: f.remote.id, source: f.source, destination: { temporaryWork: true } }, local, f.store);
  assert.ok(fs.existsSync(result.files[0].file)); assert.equal(fs.existsSync(prepared), false);
  f.downloader.cleanup(result); assert.equal(fs.existsSync(result.files[0].file), false);
});
