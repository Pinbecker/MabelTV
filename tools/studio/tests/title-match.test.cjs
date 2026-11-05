'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store.cjs');
const { Queue } = require('../lib/queue.cjs');
const { Portal } = require('../lib/portal.cjs');
const { titleMatch } = require('../lib/title-match.cjs');
const match = { media_type: 'movie', tmdb_id: 808, title: 'Shrek', year: '2001', poster_path: '/poster.jpg', device: 'pi' };

async function settled(queue, job) {
  const deadline = Date.now() + 5000;
  while (queue.active || !['complete', 'failed', 'paused'].includes(job.status)) {
    if (Date.now() > deadline) throw new Error('Queue did not settle: ' + job.message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
test('confirmed identities are typed, bounded and cannot use arbitrary artwork URLs', () => {
  assert.equal(titleMatch(undefined, { kind: 'film' }), null);
  assert.deepEqual(titleMatch(match, { kind: 'film' }), match);
  assert.throws(() => titleMatch(match, { kind: 'series' }), /Review/);
  assert.throws(() => titleMatch({ ...match, tmdb_id: 0 }, { kind: 'film' }), /Review/);
  assert.throws(() => titleMatch({ ...match, device: '' }, { kind: 'film' }), /Review/);
  assert.equal(titleMatch({ ...match, poster_path: 'https://evil.example/p.jpg' }, { kind: 'film' }).poster_path, '');
});
test('search uses the Pi without provider credentials and excludes people and unmatched local placeholders', async () => {
  const portal = new Portal({}); portal.current = { base: 'http://pi.local', device: 'pi' };
  portal.at = async (base, route) => {
    assert.equal(base, 'http://pi.local'); assert.equal(route, '/api/my-tv/discovery?q=Shrek%20%26%20friends');
    return { results: [match, { ...match, tmdb_id: 0 }, { ...match, media_type: 'person' }, { ...match, media_type: 'tv' }] };
  };
  const result = await portal.searchTitles('Shrek & friends', 'movie');
  assert.equal(result.device, 'pi'); assert.equal(result.results.length, 1); assert.equal(result.results[0].tmdb_id, 808);
  await assert.rejects(portal.searchTitles('x', 'movie'), /between/);
});
test('application uses the published filename and pinned device; a missing or incorrect confirmation cannot pass', async () => {
  const portal = new Portal({}); portal.current = { base: 'http://pi.local', device: 'pi' };
  const calls = [];
  portal.at = async (base, route, options) => {
    calls.push({ base, route, ...options }); return { ok: true, metadata: { tmdb_id: 808 } };
  };
  const job = { device: 'pi', match, destination: { kind: 'film' }, result: { complete: true, file_name: 'Actual published name.mp4' } };
  await portal.applyMatch(job, new AbortController().signal);
  assert.equal(calls[0].route, '/api/tmdb/apply'); assert.deepEqual(calls[0].body, { file: 'Actual published name.mp4', tmdb_id: 808 });
  portal.current.device = 'other'; await assert.rejects(portal.applyMatch(job), /different TV/);
  assert.equal(calls.length, 1);
  portal.current.device = 'pi'; await assert.rejects(portal.applyMatch({ ...job, result: { complete: true } }), /filename/);
  portal.at = async () => ({ ok: true, metadata: { tmdb_id: 809 } });
  await assert.rejects(portal.applyMatch(job), /did not confirm/);
});
test('TV show matching uses a series identity rather than applying a movie to an episode', async () => {
  const portal = new Portal({}); portal.current = { base: 'http://pi.local', device: 'pi' };
  portal.at = async (_base, route, options) => {
    assert.equal(route, '/api/tmdb/my-tv-series/apply');
    assert.deepEqual(options.body, { series: 'a'.repeat(32), tmdb_id: 123 });
    return { ok: true, metadata: { tmdb_id: 123 } };
  };
  await portal.applyMatch({ device: 'pi', match: { ...match, media_type: 'tv', tmdb_id: 123 },
    destination: { kind: 'series', series: 'a'.repeat(32) }, result: { complete: true } });
});
test('metadata failure retains publication; retry after restart and local cleanup does not upload or prepare again', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-match-'));
  const file = path.join(root, 'Shrek.mp4'); fs.writeFileSync(file, 'fixture');
  const store = new Store(root); let uploads = 0, preparations = 0, applies = 0;
  const portal = {
    upload: async (_job, _source, _signal, change) => { uploads++; change({ device: 'pi' }, true); return { complete: true, status: 'complete', file_name: 'Shrek.mp4' }; },
    applyMatch: async job => { applies++; assert.equal(job.result.complete, true); if (applies === 1) throw new Error('Metadata is temporarily offline');
      return { publication: { ...job.result, file_name: 'Shrek (2001).mp4' } }; }
  };
  let queue = new Queue(store, { prepare: async () => { preparations++; return { file, converted: false }; } }, {}, portal);
  t.after(async () => { await queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const [job] = queue.add([{ kind: 'file', path: file, match }], { kind: 'film', label: 'My TV · Films' });
  await settled(queue, job);
  assert.equal(job.status, 'complete'); assert.equal(job.result.complete, true); assert.match(job.metadataWarning, /offline/);
  await queue.shutdown(); fs.unlinkSync(file);
  const restored = new Store(root), recovered = restored.job(job.id);
  assert.deepEqual(recovered.match, match);
  queue = new Queue(restored, { prepare: async () => { throw new Error('Must not reconvert'); } }, {}, portal);
  await queue.action(job.id, 'metadata'); await settled(queue, recovered);
  assert.equal(uploads, 1); assert.equal(preparations, 1); assert.equal(applies, 2);
  assert.equal(recovered.status, 'complete'); assert.equal(recovered.matchApplied, true); assert.equal(recovered.metadataWarning, '');
  assert.equal(recovered.result.file_name, 'Shrek (2001).mp4');
  assert.equal(new Store(root).job(job.id).result.file_name, 'Shrek (2001).mp4');
  await assert.rejects(queue.action(job.id, 'metadata'), /does not need/);
});
test('interruption after publication resumes only enrichment', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-match-resume-'));
  let store = new Store(root);
  store.add({ id: 'b'.repeat(32), status: 'matching', device: 'pi', match, metadata: { title: 'Shrek' }, destination: { kind: 'film', label: 'My TV · Films' }, result: { complete: true, file_name: 'Shrek.mp4' } });
  store = new Store(root); const job = store.state.jobs[0]; assert.equal(job.status, 'paused');
  const queue = new Queue(store, {}, {}, { applyMatch: async () => {} });
  t.after(async () => { await queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  await queue.action(job.id, 'resume'); await settled(queue, job);
  assert.equal(job.matchApplied, true); assert.equal(job.status, 'complete');
});
