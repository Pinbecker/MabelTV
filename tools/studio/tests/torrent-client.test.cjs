'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TorrentClient } = require('../lib/torrent-client.cjs');
const { fileList, metadata, safeRelative } = require('../lib/torrent-media.cjs');

test('download client accepts 204 cookie login and never sends credentials outside loopback', async () => {
  const calls = [];
  const client = new TorrentClient('http://127.0.0.1:48086', 'synthetic-password', async (url, options) => {
    calls.push({ url, ...options });
    return url.endsWith('/auth/login') ? new Response(null, { status: 204, headers: { 'set-cookie': 'SID=synthetic; HttpOnly' } }) : new Response('v5.3.0');
  });
  assert.equal(await client.login(), 'v5.3.0');
  assert.equal(calls[1].headers.Cookie, 'SID=synthetic');
  assert.equal(calls[0].body.get('password'), 'synthetic-password');
  assert.equal(calls[0].headers.Origin, 'http://127.0.0.1:48086');
  for (const base of ['http://example.com', 'https://127.0.0.1', 'http://127.0.0.1/other', 'http://user:password@127.0.0.1']) assert.throws(() => new TorrentClient(base, 'unused'));
});
test('expired qBittorrent session is authenticated once before replaying a scoped operation', async () => {
  let logins = 0, operations = 0;
  const client = new TorrentClient('http://127.0.0.1:48086', 'synthetic', async (url, options) => {
    if (url.endsWith('/auth/login')) { logins++; return new Response('Ok.', { headers: { 'set-cookie': 'SID=test' } }); }
    if (url.endsWith('/app/version')) return new Response('v5.3.0');
    assert.equal(options.body.get('hashes'), 'a'.repeat(40));
    return ++operations === 1 ? new Response('', { status: 403 }) : new Response(null, { status: 204 });
  });
  await client.request('torrents/stop', { hashes: 'a'.repeat(40) });
  assert.equal(logins, 1); assert.equal(operations, 2);
});
test('torrent filenames cannot escape or collide on Windows and specials retain season zero', () => {
  for (const name of ['../movie.mp4', '/movie.mp4', 'C:/movie.mp4', 'folder/CON.mp4', 'a\\movie.mp4', 'a/movie?.mp4', 'a./movie.mp4']) assert.throws(() => safeRelative(name));
  assert.throws(() => fileList([{ index: 0, name: 'Film.mp4', size: 2 }, { index: 1, name: 'film.mp4', size: 2 }]));
  const file = fileList([{ index: 4, name: 'Show/Show.S00E01.1080p.mkv', size: 200 }])[0];
  assert.equal(file.series, 0); assert.equal(file.episodeNumber, 1);
  assert.equal(metadata(file, 'Release').title, 'Show');
  assert.equal(metadata(file, 'Release').series, 0);
});
