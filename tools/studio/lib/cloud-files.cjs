'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { safeName } = require('./queue.cjs');

function beneath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').some(p => p === '..') || path.isAbsolute(relative)) throw new Error('Invalid cloud media path.');
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid cloud media path.');
  return target;
}
async function copy(source, target, signal, progress = () => {}, receipt = target + '.copy.json') {
  const stat = await fs.promises.stat(source);
  if (!stat.isFile()) throw new Error('This iCloud file is not ready to download yet.');
  // iCloud hydration updates Windows ctime without changing the file's
  // content/version. Size, modification time and file identity stay stable.
  const identity = JSON.stringify([path.resolve(source), stat.size, stat.mtimeMs, stat.ino]);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.mkdir(path.dirname(receipt), { recursive: true });
  let previous;
  try { previous = JSON.parse(await fs.promises.readFile(receipt, 'utf8')); } catch { /* A partial without its source identity is restarted safely. */ }
  if (previous?.source === identity && previous.complete && fs.existsSync(target)) {
    const saved = fs.statSync(target);
    if (saved.size === stat.size && saved.mtimeMs === previous.mtime) return target;
  }
  const partial = target + '.part';
  let offset = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  if (offset > stat.size || previous?.source !== identity) { if (offset) await fs.promises.unlink(partial); offset = 0; }
  const free = fs.statfsSync(path.dirname(target));
  if (free.bavail * free.bsize < stat.size - offset + 256 * 1024 * 1024) throw new Error('Not enough space to download this file. Free some space, then retry.');
  await fs.promises.writeFile(receipt, JSON.stringify({ source: identity, complete: false }), { mode: 0o600 });
  const input = fs.createReadStream(source, { start: offset });
  let bytes = offset;
  input.on('data', chunk => { bytes += chunk.length; progress({ percent: stat.size ? bytes / stat.size * 100 : 100, bytes, total: stat.size }); });
  await pipeline(input, fs.createWriteStream(partial, { flags: offset ? 'a' : 'w' }), { signal });
  const after = await fs.promises.stat(source);
  if (JSON.stringify([path.resolve(source), after.size, after.mtimeMs, after.ino]) !== identity) throw new Error('The original changed while it was being copied. Retry to fetch the current version.');
  if (fs.statSync(partial).size !== stat.size) throw new Error('The cloud download is incomplete. Retry to resume it.');
  await fs.promises.rename(partial, target);
  await fs.promises.writeFile(receipt, JSON.stringify({ source: identity, complete: true, mtime: fs.statSync(target).mtimeMs }), { mode: 0o600 });
  return target;
}
async function fetchCloud(job, store, portal, signal, progress) {
  const root = store.state.settings.iCloudRoot || path.join(process.env.USERPROFILE, 'iCloudDrive');
  const media = path.join(root, 'Media');
  let item, source;
  for (;;) {
    if (signal.aborted) throw new Error('Stopped');
    // Cloud-side filing may reach the catalogue before iCloud for Windows.
    // Re-resolve the stable identity while waiting; never combine old/new bytes.
    item = await portal.api('/api/studio/cloud/item?id=' + encodeURIComponent(job.source.id), { signal });
    if (item.bytes !== job.source.bytes || job.source.modified && item.modified !== job.source.modified || job.source.remoteId && item.remoteId !== job.source.remoteId) throw new Error('The cloud file changed since it was queued. Refresh iCloud and add it again.');
    source = beneath(media, item.path);
    const files = [{ path: item.path, bytes: item.bytes }, ...(item.subtitles || [])];
    const ready = await Promise.all(files.map(async file => {
      try {
        const stat = await fs.promises.stat(beneath(media, file.path));
        return stat.isFile() && (file.bytes === undefined || stat.size === file.bytes);
      } catch (error) {
        if (['ENOENT', 'EBUSY', 'EACCES'].includes(error.code)) return false;
        throw error;
      }
    }));
    if (ready.every(Boolean)) break;
    progress({ percent: 0, message: 'Waiting for iCloud to sync this file' });
    await delay(2000, undefined, { signal });
  }
  const directory = path.join(store.state.settings.workspace, 'Remote', job.id, 'Original');
  const target = path.join(directory, path.basename(source));
  await copy(source, target, signal, progress);
  for (const subtitle of item.subtitles || []) {
    const subtitleSource = beneath(media, subtitle.path);
    await copy(subtitleSource, path.join(directory, path.basename(subtitleSource)), signal);
  }
  return { file: target, metadata: { title: item.series_title || path.basename(source, path.extname(source)),
    episode: item.series_title ? path.basename(source, path.extname(source)) : '', series: item.series, episodeNumber: item.episodeNumber } };
}
async function saveCloud(remote, local, store, portal, signal, progress, tools) {
  if (remote.source.type === 'cloud' && remote.destination.kind !== 'icloud') return '';
  const file = remote.destination.kind === 'icloud' && remote.destination.prepare ? local.preparedPath : local.sourcePath;
  const root = store.state.settings.iCloudRoot || path.join(process.env.USERPROFILE, 'iCloudDrive');
  const metadata = local.metadata || {};
  const kids = remote.destination.kind === 'mabel' || /^(?:cbeebies|cbbc)$/i.test(metadata.channel || '');
  const episode = Number.isInteger(metadata.series) && metadata.series >= 0 && Number.isInteger(metadata.episodeNumber) && metadata.episodeNumber > 0;
  const relative = episode ? [kids ? 'Kids/TV' : 'TV', safeName(metadata.title), 'Season ' + metadata.series,
    `S${String(metadata.series).padStart(2, '0')}E${String(metadata.episodeNumber).padStart(2, '0')} - ${safeName(metadata.episode || metadata.title)} - ${remote.id.slice(0, 8)}${path.extname(file)}`].join('/')
    : [kids ? 'Kids/Films' : 'Films', safeName(local.match?.title || metadata.title || path.basename(file, path.extname(file))) +
        (local.match?.year ? ' (' + local.match.year + ')' : '') + ' - ' + remote.id.slice(0, 8) + path.extname(file)].join('/');
  const files = [{ file, path: relative }];
  for (const [index, item] of files.entries()) await copy(item.file, beneath(path.join(root, 'Media'), item.path), signal, index ? () => {} : progress, path.join(local.directory, 'cloud-copy-' + index + '.json'));
  for (;;) {
    if (signal.aborted) throw new Error('Stopped');
    let confirmed = true;
    for (const item of files) {
      const result = await portal.api('/api/studio/cloud/confirm', { method: 'POST', body: { path: item.path, bytes: fs.statSync(item.file).size }, signal, timeout: 100000 });
      if (!result.confirmed) confirmed = false;
    }
    if (confirmed) return relative;
    progress({ percent: 100, syncing: true });
    await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(new Error('Stopped')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 12000);
      signal.addEventListener('abort', stop, { once: true });
    });
  }
}
module.exports = { beneath, copy, fetchCloud, saveCloud };
