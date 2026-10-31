'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pidFrom, parseSearch, normalise } = require('../lib/iplayer.cjs');
const { run } = require('../lib/process.cjs');
test('BBC IDs and episode links are accepted; unrelated and malformed URLs are rejected', () => {
  assert.equal(pidFrom('https://www.bbc.co.uk/iplayer/episode/m0012w40/superworm'), 'm0012w40');
  assert.equal(pidFrom('b00pk64x'), 'b00pk64x'); assert.equal(pidFrom('https://bbc.co.uk.attacker.test/iplayer/episode/b00pk64x'), '');
  assert.equal(pidFrom('javascript:alert(1)'), ''); assert.equal(pidFrom('1234'), '');
});
test('rich results keep BBC metadata, remove duplicate IDs and reject unexpected artwork hosts', () => {
  const row = 'STUDIO\tm0012w40\tSuperworm\tChristmas special\tBBC One\t1800\tA story\thttps://ichef.bbci.co.uk/images/ic/192xn/test.jpg\t2026-09-20\t1\t2';
  const result = parseSearch(row + '\nnoise\n' + row);
  assert.equal(result.length, 1); assert.equal(result[0].synopsis, 'A story'); assert.equal(result[0].duration, 1800);
  assert.match(result[0].artwork, /640xn/); assert.equal(result[0].episodeNumber, 2);
  assert.equal(normalise({ pid: 'm0012w40', thumbnail: 'https://attacker.test/image.jpg' }).artwork, '');
});
test('subprocess arguments remain literal, including shell metacharacters', async () => {
  const value = 'a & echo bad | $(Get-Content secret) "quoted"';
  const output = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value]);
  assert.equal(output, value);
});
test('a cancelled subprocess stops rather than leaving a worker running', async () => {
  const controller = new AbortController();
  const operation = run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 150);
  await assert.rejects(operation, /Stopped/);
});
