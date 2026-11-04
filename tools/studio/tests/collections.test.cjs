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
