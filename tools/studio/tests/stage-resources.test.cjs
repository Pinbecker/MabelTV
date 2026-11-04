'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StageGate, StageResources } = require('../lib/stage-resources.cjs');
const { Store } = require('../lib/store.cjs');
const { Queue } = require('../lib/queue.cjs');
const { Companion } = require('../lib/companion.cjs');
const { CompanionTorrents } = require('../lib/companion-torrents.cjs');
const { Portal } = require('../lib/portal.cjs');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Concurrent stage did not start'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
function held(signal, promise) {
  return Promise.race([promise, new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }))]);
}

test('five downloads, one conversion and one Pi transfer run together, with excess work queued', async () => {
  const resources = new StageResources({ state: { settings: {} } });
  const signal = new AbortController().signal, release = deferred();
  const downloading = []; let conversions = 0, uploads = 0;
  const work = Array.from({ length: 7 }, (_, i) => resources.downloads.run(signal, null, async () => { downloading.push(i); await release.promise; }));
  const processing = [resources.conversion.run(signal, null, async () => { conversions++; await release.promise; }),
    resources.upload.run(signal, null, async () => { uploads++; await release.promise; })];
  await until(() => downloading.length === 5 && conversions === 1 && uploads === 1);
  assert.equal(resources.downloads.active, 5); assert.equal(resources.downloads.waiters.length, 2);
  release.resolve(); await Promise.all([...work, ...processing]);
  assert.equal(downloading.length, 7); assert.equal(resources.downloads.active, 0);
});

test('cancelling a queued stage does not consume or cancel another stage slot', async () => {
  const gate = new StageGate(1), release = deferred(), controller = new AbortController();
  const first = gate.run(null, null, () => release.promise);
  let started = false;
  const cancelled = gate.run(controller.signal, null, async () => { started = true; });
  controller.abort(); await assert.rejects(cancelled); assert.equal(started, false);
  assert.equal(gate.active, 1); release.resolve(); await first; assert.equal(gate.active, 0);
});

test('disk admission accounts for other jobs and preserves the free-space reserve', async () => {
  const resources = new StageResources({}, { freeBytes: () => 100, minimumFree: 20, spacePollMs: 5 });
  resources.reserve('one', 30); resources.reserve('one', 30); resources.reserve('two', 30);
  assert.throws(() => resources.reserve('three', 30), /disk space/);
  const controller = new AbortController(); let waiting = false;
  const attempt = resources.admit('three', 30, controller.signal, () => { waiting = true; });
  await until(() => waiting); controller.abort(); await assert.rejects(attempt);
  assert.equal(resources.reservations.has('three'), false);
  resources.release('one'); resources.reserve('three', 30); assert.equal(resources.reservations.size, 2);
});

test('torrent runners release download slots before processing their completed films', async () => {
  const resources = new StageResources({}, { freeBytes: () => 1000000, minimumFree: 0 });
  const downloaded = deferred(), processed = deferred(), signal = new AbortController().signal;
  let active = 0, peak = 0, started = 0, processing = 0, cleaned = 0;
  const downloads = { download: async () => {
    started++; active++; peak = Math.max(peak, active);
    try { await downloaded.promise; return { files: [{ index: 0, path: 'Film.mp4', file: 'Film.mp4', bytes: 1 }] }; }
    finally { active--; }
  }, cleanup: () => { cleaned++; } };
  const jobs = { run: async (remote, state) => { processing++; await processed.promise; state.progress = { result: { complete: true } }; } };
  const runner = new CompanionTorrents(downloads, jobs, resources);
  const operations = Array.from({ length: 6 }, (_, i) => runner.run({ id: String(i), title: 'Film',
    source: { files: [{ bytes: 1 }] }, destination: { kind: 'film' } }, {}, signal));
  await until(() => started === 5); assert.equal(peak, 5);
  downloaded.resolve(); await until(() => started === 6 && processing === 6);
  assert.equal(resources.downloads.active, 0); assert.equal(cleaned, 0);
  processed.resolve(); await Promise.all(operations); assert.equal(cleaned, 6);
});

test('the real local queue converts the next film while a previous film transfers to the Pi', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pipeline-'));
  const store = new Store(root), conversionTwo = deferred(), uploadOne = deferred();
  let conversions = 0, uploads = 0, convertPeak = 0, uploadPeak = 0;
  const prepared = [], sent = [];
  const media = { prepare: async (file, output, profile, signal) => {
    conversions++; convertPeak = Math.max(convertPeak, conversions); prepared.push(path.basename(file));
    try { if (path.basename(file) === 'two.mp4') await held(signal, conversionTwo.promise); return { file, converted: false, analysis: { ready: true } }; }
    finally { conversions--; }
  } };
  const portal = { upload: async (job, worker, signal) => {
    uploads++; uploadPeak = Math.max(uploadPeak, uploads); sent.push(path.basename(job.sourcePath));
    try { if (path.basename(job.sourcePath) === 'one.mp4') await held(signal, uploadOne.promise); return { complete: true }; }
    finally { uploads--; }
  } };
  const queue = new Queue(store, media, {}, portal);
  t.after(async () => { await queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const inputs = ['one', 'two', 'three'].map(name => { const file = path.join(root, name + '.mp4'); fs.writeFileSync(file, 'video'); return { kind: 'file', path: file, preserveOriginal: true }; });
  queue.add(inputs, { kind: 'film', label: 'My TV films' });
  await until(() => prepared.includes('two.mp4') && sent.includes('one.mp4'));
  assert.equal(conversions, 1); assert.equal(uploads, 1); assert.equal(prepared.includes('three.mp4'), false);
  conversionTwo.resolve(); await until(() => prepared.includes('three.mp4'));
  assert.deepEqual(sent, ['one.mp4']);
  uploadOne.resolve(); await until(() => store.state.jobs.every(job => job.status === 'complete'));
  assert.equal(convertPeak, 1); assert.equal(uploadPeak, 1); assert.equal(sent.length, 3);
});

test('companion heartbeats every job and cancels only the commanded job', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-claims-')), store = new Store(root), actions = [], requests = [];
  const jobs = [1, 2, 3].map(i => ({ id: String(i), claim: 'claim-' + i, source: { type: 'cloud' } }));
  const queue = { action: async (...args) => actions.push(args), resources: { release() {} } };
  const portal = { api: async (route, { body } = {}) => { if (route !== '/api/studio/worker') return { available: false }; requests.push(body); return requests.length === 1 ? { jobs, acknowledgedJobs: [], requests: [] }
    : { jobs: [], acknowledgedJobs: jobs.map(job => ({ id: job.id, command: job.id === '2' ? 'cancel' : '' })), requests: [] }; } };
  const companion = new Companion(store, queue, {}, portal);
  t.after(async () => { await companion.close(); fs.rmSync(root, { recursive: true, force: true }); });
  companion.runner.run = async (remote, state, signal) => { state.local = { id: 'local-' + remote.id, status: 'uploading', percent: 10 }; await held(signal, deferred().promise); };
  await companion.tick(); assert.equal(companion.actives.size, 3);
  await companion.tick(); assert.equal(requests[1].activeJobs.length, 3);
  assert.deepEqual(actions, [['local-2', 'cancel']]);
  assert.equal(companion.actives.size, 2); assert.equal(companion.actives.has('2'), false);
  assert.ok([...companion.actives.values()].every(state => !state.controller.signal.aborted));
});

test('background files have no tracking-count cap while progress requests remain bounded', async () => {
  const bodies = [];
  const portal = { api: async (route, { body }) => { bodies.push(body); return { jobs: [], requests: [],
    acknowledgedJobs: body.activeJobs.map(item => ({ id: item.id, command: '' })) }; } };
  const companion = new Companion({ state: { sourceId: 'a'.repeat(32) } }, {}, {}, portal);
  for (let i = 0; i < 1000; i++) {
    const state = { remote: { id: String(i), claim: 'claim-' + i }, finishing: true,
      progress: { stage: 'saving-cloud', percent: 100, message: 'Waiting for iCloud confirmation' }, controller: new AbortController() };
    state.ackVersion = JSON.stringify(companion.progress(state)); state.ackStage = 'saving-cloud';
    companion.actives.set(state.remote.id, state);
  }
  await companion.tick(); await companion.tick();
  assert.equal(companion.actives.size, 1000);
  assert.equal(bodies[0].activeJobs.length, 64); assert.equal(bodies[1].activeJobs.length, 64);
  assert.equal(new Set([...bodies[0].activeJobs, ...bodies[1].activeJobs].map(item => item.id)).size, 128);
  assert.ok([...companion.actives.values()].every(state => !state.controller.signal.aborted));
  await companion.close();
});

test('confirmation-query concurrency cannot block worker polling or Apple upload admission', async () => {
  const portal = new Portal({ state: { settings: {} } }), release = deferred();
  portal.current = { base: 'http://127.0.0.1:8080' };
  let confirmations = 0, workerRequests = 0;
  portal.at = async (base, route) => {
    if (route === '/api/studio/worker') { workerRequests++; return {}; }
    confirmations++; await release.promise; return { confirmed: true };
  };
  const requests = Array.from({ length: 20 }, () => portal.api('/api/studio/cloud/confirm', { method: 'POST', body: { path: 'already-copied.mp4' } }));
  try { await until(() => confirmations === 4); await portal.api('/api/studio/worker', { method: 'POST', body: {} }); assert.equal(workerRequests, 1); }
  finally { release.resolve(); }
  await Promise.all(requests); assert.equal(confirmations, 20);
});
test('a staged Pi upload still returns a reusable prepared file; existing-film optimisation may keep it in place', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pi-return-'));
  const store = new Store(root), source = path.join(root, 'prepared.mp4'); fs.writeFileSync(source, 'prepared test bytes');
  let uploads = 0, unchanged = 0;
  const portal = { upload: async () => { uploads++; return { complete: true }; },
    api: async route => { assert.equal(route, '/api/studio/pi/unchanged'); unchanged++; return { complete: true, unchanged: true }; } };
  const queue = new Queue(store, { prepare: async file => ({ file, converted: false, analysis: { ready: true } }) }, {}, portal);
  t.after(async () => { await queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  queue.add([{ kind: 'file', path: source, preserveOriginal: true, piReturn: { job: 'staged', claim: 'c', replacePi: false } }], { kind: 'film' });
  await until(() => store.state.jobs[0].status === 'complete');
  queue.add([{ kind: 'file', path: source, preserveOriginal: true, piReturn: { job: 'existing', claim: 'c', replacePi: true } }], { kind: 'film' });
  await until(() => store.state.jobs[1].status === 'complete');
  assert.equal(uploads, 1); assert.equal(unchanged, 1); assert.ok(fs.existsSync(source));
});
