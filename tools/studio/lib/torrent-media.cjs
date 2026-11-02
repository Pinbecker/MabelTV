'use strict';
const fs = require('node:fs');
const path = require('node:path');
const VIDEO = /\.(mp4|m4v|mov|mkv|avi|webm|mpg|mpeg|ts)$/i;
function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 700 || /[\\:<>"|?*\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('This download contains an unsupported file path.');
  return value;
}
function fileList(files) {
  if (!Array.isArray(files) || files.length > 5000) throw new Error('This download contains too many files.');
  const paths = new Set();
  return files.map(item => {
    const name = safeRelative(item.name ?? item.path);
    if (paths.has(name.toLowerCase()) || !Number.isInteger(item.index) || item.index < 0 || !Number.isSafeInteger(item.size ?? item.bytes) || (item.size ?? item.bytes) < 0) throw new Error('The download file list could not be verified.');
    paths.add(name.toLowerCase());
    const episode = /\bS(\d{1,2})E(\d{1,3})(?!\d)/i.exec(name) || /\b(\d{1,2})x(\d{1,3})(?!\d)/i.exec(name);
    return { index: item.index, path: name, bytes: item.size ?? item.bytes, video: VIDEO.test(name),
      ...(episode ? { series: Number(episode[1]), episodeNumber: Number(episode[2]) } : {}) };
  });
}
function metadata(file, title) {
  const stem = path.posix.basename(file.path, path.posix.extname(file.path));
  const episode = /\bS(\d{1,2})E(\d{1,3})(?!\d)/i.exec(stem) || /\b(\d{1,2})x(\d{1,3})(?!\d)/i.exec(stem);
  const name = (episode ? stem.slice(0, episode.index) : stem).replace(/[._]/g, ' ').replace(/\b(?:720p|1080p|2160p|x26[45]|h264|hevc|webrip|web-dl|bluray)\b.*$/i, '').trim().replace(/[- ]+$/, '');
  return { title: name || title, episode: episode ? stem.replace(/[._]/g, ' ') : '',
    ...(episode ? { series: Number(episode[1]), episodeNumber: Number(episode[2]) } : {}) };
}
function ownedFile(directory, relative) {
  safeRelative(relative);
  const base = path.resolve(directory), file = path.resolve(base, ...relative.split('/'));
  if (!file.startsWith(base + path.sep)) throw new Error('The download file is outside its working area.');
  let current = base;
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new Error('The download working area changed.');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Download links cannot be imported.');
  }
  return file;
}
module.exports = { VIDEO, safeRelative, fileList, metadata, ownedFile };
