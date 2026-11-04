'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CompanionJobs } = require('../lib/companion-jobs.cjs');
const { destinationValid } = require('../lib/queue.cjs');
const { Portal } = require('../lib/portal.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('reviewed collections reach film uploads and series assignment with their existing identity', async () => {
  const calls = [], portal = {
    createSeries: async () => ({ id: 'a'.repeat(32), season: 2 }),
    api: async (...args) => { calls.push(args); },
  };
  const companion = new CompanionJobs({}, {}, {}, portal);
  const film = await companion.destination({ destination: { kind: 'film', collection: 'Weekend', compression: 'compact' } });
  assert.equal(destinationValid(film).folder, 'Weekend');
  const series = await companion.destination({ destination: { kind: 'series', name: 'Example', season: 2, collection: 'Shows' } });
  assert.equal(series.series, 'a'.repeat(32));
  assert.deepEqual(calls[0], ['/api/manage', { method: 'POST', body: { action: 'move-my-tv-series-collection', series: 'a'.repeat(32), folder: 'Shows' } }]);
  for (const folder of ['../private', 'a/b', 'a\\b', '.', '..', 'a\0b']) assert.throws(() => destinationValid({ kind: 'film', folder }));
  assert.equal(destinationValid({ kind: 'film', folder: 'Science fiction' }).folder, 'Science fiction');
});

test('a collection reaches the actual resumable film upload admission', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-collection-upload-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'Example.mp4'); fs.writeFileSync(file, 'media');
  const portal = new Portal({}); portal.current = { device: 'pi', mode: 'local', base: 'http://mabeltv-512.local:8080' };
  let admission;
  portal.at = async (_base, route, options = {}) => {
    if (route === '/api/my-tv/uploads') admission = options.body;
    return { id: 'upload', complete: true, status: 'complete', file_name: 'Weekend/Example.mp4' };
  };
  const job = { preparedPath: file, destination: { kind: 'film', folder: 'Weekend' } };
  const result = await portal.upload(job, 'source', new AbortController().signal, value => Object.assign(job, value));
  assert.equal(admission.folder, 'Weekend');
  assert.equal(result.file_name, 'Weekend/Example.mp4');
});
test('metadata uses the server receipt collection as well as its published basename', async () => {
  const portal = new Portal({}), requests = [];
  portal.current = { device: 'pi', base: 'http://mabeltv-512.local:8080' };
  portal.at = async (_base, route, options) => { requests.push([route, options.body]); return { ok: true, metadata: { tmdb_id: 42 } }; };
  const match = { tmdb_id: 42, media_type: 'movie', title: 'Example', year: '2026', device: 'pi' };
  await portal.applyMatch({ device: 'pi', match, destination: { kind: 'film' }, result: { complete: true, folder: 'Weekend', file_name: 'Example.mp4' } });
  assert.deepEqual(requests, [['/api/tmdb/apply', { file: 'Weekend/Example.mp4', tmdb_id: 42 }]]);
  requests.length = 0;
  await portal.applyMatch({ device: 'pi', match, destination: { kind: 'film' }, result: { complete: true, folder: 'Weekend', file_name: 'Weekend/Example.mp4' } });
  assert.equal(requests[0][1].file, 'Weekend/Example.mp4');
});
