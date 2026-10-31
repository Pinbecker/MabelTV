'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store.cjs');
const { Queue } = require('../lib/queue.cjs');
const { Media } = require('../lib/media.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { run } = require('../lib/process.cjs');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pipeline-'));
  return { root, store: new Store(root) };
}
async function waitFor(queue, predicate) {
  const deadline = Date.now() + 60000;
  while (!predicate(queue.snapshot())) {
    if (Date.now() > deadline) throw new Error('Pipeline timed out: ' + JSON.stringify(queue.snapshot()));
    await new Promise(resolve => setTimeout(resolve, 40));
  }
}
test('real conversion preserves source bytes, produces compatible fast-start media and supports send later', async t => {
  const { root, store } = setup(t), tools = resolveTools('');
  assert.ok(tools.ffmpeg && tools.ffprobe, 'FFmpeg tools are required for the desktop core gate');
  const file = path.join(root, 'Original film.mkv');
  await run(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','mpeg4','-c:a','mp3',file]);
  const original = fs.readFileSync(file); let uploaded = false;
  const portal = { upload: async () => { uploaded = true; return { status: 'complete', complete: true }; } };
  const queue = new Queue(store, new Media(() => tools), {}, portal); t.after(async () => { await queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const [job] = queue.add([{ kind: 'file', path: file }], { kind: 'local', profile: 'mabel', label: 'Local' });
  await waitFor(queue, jobs => jobs[0].status === 'prepared' || jobs[0].status === 'failed');
  assert.equal(job.status, 'prepared', job.message); assert.ok(job.analysis.ready); assert.ok(job.converted);
  assert.deepEqual(fs.readFileSync(file), original); assert.equal(uploaded, false);
  await queue.action(job.id, 'send', { kind: 'film', label: 'My TV · Films' });
  await waitFor(queue, jobs => jobs[0].status === 'complete'); assert.equal(uploaded, true);
});
test('offline delivery keeps prepared files and transfer IDs for retry without reconversion', async t => {
  const { root, store } = setup(t), file = path.join(root, 'Original.mp4'); fs.writeFileSync(file, 'fixture');
  let prepared = 0;
  const queue = new Queue(store, { prepare: async () => { prepared++; return { file, analysis: { ready: true }, converted: false }; } }, {}, {
    upload: async (job, _source, _signal, change) => { change({ uploadId: 'retained' }, true); const error = new Error('Offline'); error.code = 'OFFLINE'; throw error; }
  }); t.after(async () => { await queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const [job] = queue.add([{ kind: 'file', path: file }], { kind: 'film', label: 'My TV' });
  await waitFor(queue, jobs => jobs[0].status === 'waiting');
  assert.equal(job.uploadId, 'retained'); assert.equal(job.preparedPath, file); assert.equal(prepared, 1);
  await queue.action(job.id, 'resume'); await waitFor(queue, jobs => jobs[0].status === 'waiting');
  assert.equal(prepared, 1);
});
test('a changed original cannot silently replace the media in a resumed job', async t => {
  const { root, store } = setup(t), file = path.join(root, 'video.mp4'); fs.writeFileSync(file, 'before');
  const queue = new Queue(store, { prepare: async () => { throw new Error('Unexpected preparation'); } }, {}, {});
  queue.stopping = true; t.after(async () => { await queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  queue.add([{ kind: 'file', path: file }], { kind: 'local', label: 'Local' }); fs.writeFileSync(file, 'different bytes');
  queue.stopping = false; queue.kick(); await waitFor(queue, jobs => jobs[0].status === 'failed');
  assert.match(queue.snapshot()[0].message, /original file changed/);
});
