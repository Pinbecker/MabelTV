'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
async function fetchPi(remote, store, portal, signal, progress = () => {}) {
  if (!portal.current) await portal.connect(undefined, signal);
  const directory = path.join(store.state.settings.workspace, 'Remote', remote.id, 'Original');
  fs.mkdirSync(directory, { recursive: true });
  const name = path.basename(remote.source.name || remote.title).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ');
  const file = path.join(directory, name), partial = file + '.part';
  if (fs.existsSync(file) && fs.statSync(file).size === remote.source.bytes) return { file, metadata: { title: remote.title } };
  let offset = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  if (offset > remote.source.bytes) { fs.unlinkSync(partial); offset = 0; }
  const response = await portal.transport(portal.current.base + '/api/studio/pi/file?job=' + encodeURIComponent(remote.id), {
    credentials: 'include', redirect: 'manual', headers: offset ? { Range: 'bytes=' + offset + '-' } : {}, signal });
  if (![200, 206].includes(response.status)) throw new Error('The Pi source could not be downloaded. Reconnect and retry.');
  if (response.status === 200) offset = 0;
  if (response.status === 206 && !String(response.headers.get('content-range')).startsWith('bytes ' + offset + '-')) throw new Error('The Pi returned a different download offset.');
  let bytes = offset;
  const stream = fs.createWriteStream(partial, { flags: offset ? 'a' : 'w' });
  const { Transform } = require('node:stream');
  const meter = new Transform({ transform(chunk, encoding, next) {
    bytes += chunk.length;
    if (bytes > remote.source.bytes) return next(new Error('The Pi source size changed.'));
    progress({ percent: bytes / remote.source.bytes * 100, bytes, total: remote.source.bytes }); next(null, chunk);
  } });
  await pipeline(response.body, meter, stream, { signal });
  if (fs.statSync(partial).size !== remote.source.bytes) throw new Error('The Pi download is incomplete. Retry to resume.');
  fs.renameSync(partial, file);
  return { file, metadata: { title: remote.title } };
}
module.exports = { fetchPi };
