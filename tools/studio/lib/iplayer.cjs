'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');
const { downloadProgress } = require('./download-progress.cjs');

const FIELDS = ['pid', 'name', 'episode', 'channel', 'duration', 'desc', 'thumbnail', 'available', 'seriesnum', 'episodenum'];
function pidFrom(value) {
  const text = String(value || '').trim();
  if (/^[bmp][a-z0-9]{7}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (!['bbc.co.uk', 'www.bbc.co.uk'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return '';
    return url.pathname.match(/\/(?:episode|programmes)\/([bmp][a-z0-9]{7})(?:\/|$)/)?.[1] || '';
  } catch { return ''; }
}
function normalise(data) {
  const title = String(data.name || data.title || 'BBC programme');
  const episode = String(data.episode || '').replace(/^-$|^0\.$/, '');
  let artwork = String(data.thumbnail || '');
  if (!/^https:\/\/(?:ichef\.bbci\.co\.uk|ichef\.bbc\.co\.uk)\//.test(artwork)) artwork = '';
  else artwork = artwork.replace(/\/\d+xn\//, '/640xn/');
  return { pid: String(data.pid), title, episode, channel: String(data.channel || 'BBC iPlayer'),
    synopsis: String(data.desc || data.descmedium || data.descshort || ''), artwork,
    duration: Number(data.duration) || 0, broadcast: String(data.firstbcastdate || data.available || ''),
    series: Number(data.seriesnum) || null, episodeNumber: Number(data.episodenum) || null };
}
function parseSearch(output) {
  const seen = new Set();
  return output.split(/[\r\n]+/).filter(line => line.startsWith('STUDIO\t')).map(line => {
    const values = line.slice(7).split('\t');
    return normalise(Object.fromEntries(FIELDS.map((field, index) => [field, values[index] || ''])));
  }).filter(item => pidFrom(item.pid) && !seen.has(item.pid) && seen.add(item.pid)).slice(0, 800);
}

class IPlayer {
  constructor(root, getTools) {
    this.root = path.join(root, 'iPlayer'); this.profile = path.join(this.root, 'profile');
    this.getTools = getTools;
    fs.mkdirSync(this.profile, { recursive: true });
    const oldCache = path.join(process.env.USERPROFILE || '', '.get_iplayer/tv.cache');
    const newCache = path.join(this.profile, 'tv.cache');
    if (!fs.existsSync(newCache) && fs.existsSync(oldCache)) fs.copyFileSync(oldCache, newCache);
    this.searchCache = new Map();
  }
  async command(args, options = {}) {
    const tools = this.getTools();
    if (!tools.perl || !tools.getPlayer) throw new Error('get_iplayer is unavailable. Check the media tools in Settings.');
    return run(tools.perl, [tools.getPlayer, '--profile-dir', this.profile, '--nocopyright',
      '--encoding-console-out=UTF-8', '--expiry=21600', ...args], { ...options, env: tools.playerEnv });
  }
  async search(query, refresh = false, signal) {
    query = String(query || '').trim();
    if (!query || query.length > 200) throw new Error('Enter a programme name or an iPlayer episode link.');
    const pid = pidFrom(query);
    if (pid) return { items: [await this.metadata(pid, signal)], truncated: false };
    if (/^https?:/i.test(query)) throw new Error('Paste a BBC iPlayer episode link or a BBC programme ID.');
    if (refresh) await this.command(['--type=tv', '--refresh'], { signal, timeout: 240000 });
    if (!refresh && this.searchCache.has(query.toLowerCase())) return this.searchCache.get(query.toLowerCase());
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const output = await this.command(['--type=tv', '--search', literal, '--listformat',
      'STUDIO\t' + FIELDS.map(field => `<${field}>`).join('\t')], { signal, timeout: 240000 });
    const items = parseSearch(output);
    const result = { items, truncated: items.length >= 800, refreshedAt: Date.now() };
    this.searchCache.set(query.toLowerCase(), result);
    return result;
  }
  async metadata(pid, signal) {
    if (!pidFrom(pid)) throw new Error('Invalid BBC programme ID.');
    const directory = path.join(this.root, 'metadata'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, pid + '.json');
    if (!fs.existsSync(file) || Date.now() - fs.statSync(file).mtimeMs > 86400000) {
      await this.command([`--pid=${pid}`, '--metadata-only', '--metadata=json', '--no-subdir',
        `--file-prefix=${pid}`, '--output', directory, '--overwrite'], { signal, timeout: 180000 });
    }
    if (!fs.existsSync(file)) throw new Error('BBC metadata is unavailable for this programme.');
    return normalise(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  async download(item, directory, target, signal, progress) {
    if (!pidFrom(item.pid)) throw new Error('Invalid BBC programme ID.');
    fs.mkdirSync(directory, { recursive: true });
    const expected = path.join(directory, `${item.pid}.mp4`);
    if (!fs.existsSync(expected)) {
      await this.command([`--pid=${item.pid}`, '--force', '--no-subdir', `--file-prefix=${item.pid}`,
        '--output', directory, '--metadata=json', '--thumb', '--log-progress',
        `--tv-quality=${target === 'mabel' ? 'hd,sd,web,mobile' : 'fhd,hd,sd,web,mobile'}`], {
        signal, timeout: 4 * 3600000, onLine: line => {
          const state = downloadProgress(line);
          if (state) progress(state);
        } });
    }
    if (!fs.existsSync(expected)) throw new Error('The download did not produce a complete MP4. Please retry.');
    const metadataFile = path.join(directory, item.pid + '.json');
    let metadata = item;
    if (fs.existsSync(metadataFile)) metadata = { ...item, ...normalise(JSON.parse(fs.readFileSync(metadataFile, 'utf8'))) };
    return { file: expected, metadata };
  }
}
module.exports = { IPlayer, pidFrom, parseSearch, normalise };
