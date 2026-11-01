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
test('BBC series suffixes produce one show identity while retaining season numbers and specials', () => {
  const first = normalise({ pid: 'm0012w40', name: 'Teletubbies: Series 1', seriesnum: '1' });
  const second = normalise({ pid: 'm0012w41', name: 'Teletubbies: Series 2', seriesnum: '2' });
  assert.equal(first.title, second.title); assert.equal(first.title, 'Teletubbies');
  assert.deepEqual([first.series, second.series], [1, 2]);
  assert.equal(normalise({ name: 'Example', seriesnum: '0' }).series, 0);
});
test('a cancelled subprocess stops rather than leaving a worker running', async () => {
  const controller = new AbortController();
  const operation = run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 150);
  await assert.rejects(operation, /Stopped/);
});

test('a media tool failure retains its cause ahead of trailing generic warnings', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'console.log("ERROR: No media streams found"); for(let n=0;n<4;n++)console.log("WARNING: generic advice");process.exit(1)']),
    error => /No media streams found/.test(error.message) && !/generic advice/.test(error.message));
});

test('BBC metadata without any streams fails clearly before a transfer can be queued', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { IPlayer } = require('../lib/iplayer.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bbc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const player = new IPlayer(root, () => ({}));
  fs.mkdirSync(path.join(player.root, 'metadata'));
  fs.writeFileSync(path.join(player.root, 'metadata/b00gd1rn.json'), JSON.stringify({pid:'b00gd1rn', name:'A film', modes:''}));
  await assert.rejects(player.metadata('b00gd1rn'), /BBC is not providing a downloadable stream/);
});
