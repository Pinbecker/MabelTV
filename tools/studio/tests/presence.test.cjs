'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { locationsFor } = require('../lib/library-presence.cjs');
const { downloadProgress } = require('../lib/download-progress.cjs');
const programme = { pid: 'b09g3jlh', title: 'Yakka Dee!: Series 1', episode: '01. Banana', series: 1, episodeNumber: 1 };
const current = { pid: 'b09g3jlh', title: 'Yakka Dee!: Series 1', episode: 'Banana', series: 1, episodeNumber: 1,
  file: 'Renamed.mp4', location: { kind: 'mabel', channel: 12, label: 'Mabel TV · Yakka Dee' } };
test('current embedded BBC identity wins even after renaming; removed files are absent', () => {
  assert.equal(locationsFor(programme, [current])[0].matchedBy, 'BBC episode ID');
  assert.deepEqual(locationsFor(programme, []), []);
});
test('changed BBC IDs and legacy files need matching show, series and precise episode', () => {
  assert.equal(locationsFor({ ...programme, pid: 'm002yqvk' }, [current])[0].matchedBy, 'Show and episode');
  const legacy = { file: 'Yakka Dee! Series 1 - 01. Banana.mp4', show: 'Yakka Dee', location: current.location };
  assert.equal(locationsFor(programme, [legacy]).length, 1);
  assert.equal(locationsFor({ ...programme, series: 2 }, [legacy]).length, 0);
  assert.equal(locationsFor({ ...programme, episode: '01. Dog' }, [legacy]).length, 0);
  assert.equal(locationsFor({ ...programme, title: 'Other Show' }, [legacy]).length, 0);
});
test('download stream reset is labelled audio/video, then assembly is indeterminate', () => {
  assert.equal(downloadProgress('99.9% of ~70 MB @12 Mb/s ETA: 0 (dashhd/bi) [audio]').downloadStage, 'audio');
  const video = downloadProgress('1.0% of ~700 MB @12 Mb/s ETA: 0 (dashhd/bi) [video]');
  assert.equal(video.percent, 1); assert.match(video.message, /Downloading video/);
  assert.equal(downloadProgress('INFO: Converting to MP4').status, 'assembling');
  assert.equal(downloadProgress('INFO: Tagging MP4').percent, null);
});
