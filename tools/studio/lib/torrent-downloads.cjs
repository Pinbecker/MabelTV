'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { fileList, ownedFile } = require('./torrent-media.cjs');
class TorrentDownloads {
  constructor(store, runtime, options = {}) { Object.assign(this, { store, runtime, options }); this.activeHashes = new Set(); this.root = path.join(store.root, 'torrent-journals'); fs.mkdirSync(this.root, { recursive: true }); }
  journal(id) {
    if (!/^(?:[a-f0-9]{32}|inspect-[a-f0-9]{40})$/.test(id)) throw new Error('Choose a valid download job.');
    return path.join(this.root, id + '.json');
  }
  load(id) {
    const file = this.journal(id);
    if (!fs.existsSync(file)) return null;
    for (const candidate of [file, file + '.bak']) {
      try { const value = JSON.parse(fs.readFileSync(candidate, 'utf8')); if (value.id === id && /^[a-f0-9]{40}$/.test(value.hash)) return value; } catch { /* Keep the recovery journal. */ }
    }
    throw new Error('The download journal needs recovery. Its data was kept.');
  }
  save(record) {
    const file = this.journal(record.id), temporary = file + '.tmp';
    const descriptor = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify(record)); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); fs.renameSync(temporary, file); return record;
  }
  info(hash, signal) { return this.runtime.api('torrents/info', { hashes: hash }, { method: 'GET', signal }).then(items => items.find(item => item.hash === hash)); }
  async owned(record, signal) {
    const info = await this.info(record.hash, signal);
    if (info && (!String(info.tags).split(',').map(value => value.trim()).includes(record.tag) || path.resolve(info.save_path) !== path.resolve(record.directory))) throw new Error('This torrent belongs to another transfer. Its files were left alone.');
    return info;
  }
  async inspect(source, signal) {
    await this.runtime.ensure();
    const id = 'inspect-' + source.hash;
    let record = this.load(id);
    if (record?.files?.length) return { hash: source.hash, title: source.title, files: record.files, bytes: record.files.reduce((sum, file) => sum + file.bytes, 0) };
    const existing = await this.info(source.hash, signal);
    if (existing && (!record || !String(existing.tags).split(',').map(value => value.trim()).includes(record.tag))) {
      // A managed active job may already know this hash. Read, never stop it.
      const parent = this.findHash(source.hash);
      if (!parent) throw new Error('This download is already open outside this request.');
      const files = fileList(await this.runtime.api('torrents/files', { hash: source.hash }, { method: 'GET', signal }));
      return { hash: source.hash, title: source.title, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    }
    if (!record) {
      record = this.save({ id, hash: source.hash, directory: path.join(this.store.state.settings.workspace, 'TorrentMetadata', source.hash), tag: 'MabelTV-' + id, created: Date.now() });
    }
    fs.mkdirSync(record.directory, { recursive: true });
    if (!existing) await this.runtime.api('torrents/add', { urls: source.magnet, savepath: record.directory, tags: record.tag, autoTMM: false, contentLayout: 'Original', stopCondition: 'MetadataReceived',
      ratioLimit: 0, seedingTimeLimit: 0, inactiveSeedingTimeLimit: -1, shareLimitAction: 'Stop', shareLimitsMode: 'MatchAny', stopped: false }, { signal });
    try {
      for (let attempt = 0; attempt < (this.options.inspectAttempts || 180); attempt++) {
        if (signal?.aborted) throw new Error('Stopped');
        const info = await this.owned(record, signal);
        if (info && !/metaDL|stoppedMetaDL|checkingResumeData/i.test(info.state)) {
          const files = fileList(await this.runtime.api('torrents/files', { hash: source.hash }, { method: 'GET', signal }));
          if (files.length) {
            await this.runtime.api('torrents/stop', { hashes: source.hash }, { signal });
            this.save({ ...record, files, metadataComplete: true });
            return { hash: source.hash, title: source.title, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
          }
        }
        await delay(this.options.pollMs || 2000, undefined, { signal });
      }
      throw new Error('No peers supplied the file details. Try another result or retry later.');
    } finally {
      if (await this.owned(record).catch(() => null)) await this.runtime.api('torrents/stop', { hashes: source.hash }).catch(() => {});
    }
  }
  findHash(hash) {
    return fs.readdirSync(this.root).filter(name => /^[a-f0-9]{32}\.json$/.test(name)).map(name => this.load(name.slice(0, -5))).find(record => record.hash === hash && !record.removed);
  }
  async download(remote, signal, progress) {
    const hash = remote.source.hash;
    if (this.activeHashes.has(hash)) throw new Error('This download is already running. Retry after it finishes.');
    this.activeHashes.add(hash);
    try { return await this.downloadOwned(remote, signal, progress); }
    finally { this.activeHashes.delete(hash); }
  }
  async downloadOwned(remote, signal, progress) {
    await this.runtime.ensure();
    const source = remote.source, selected = source.files;
    let record = this.load(remote.id);
    if (!record) {
      const previous = this.findHash(source.hash);
      if (previous) {
        // Only an explicitly cancelled portal job can release a saved owner.
        // Paused, failed, offline or unknown jobs still own their recovery data.
        if (!await this.options.isCancelled?.(previous.id)) throw new Error('Another queued transfer is using this download. Finish it before retrying.');
        const info = await this.owned(previous, signal);
        if (info) {
          await this.runtime.api('torrents/stop', { hashes: previous.hash }, { signal });
          await this.runtime.api('torrents/delete', { hashes: previous.hash, deleteFiles: false }, { signal });
          if (await this.info(previous.hash, signal)) throw new Error('The cancelled download is still closing. Retry in a moment.');
        }
        this.save({ ...previous, removed: true, cancelled: true });
      }
      const inspection = this.load('inspect-' + source.hash);
      const directory = path.join(this.store.state.settings.workspace, 'Torrents', remote.id);
      fs.mkdirSync(directory, { recursive: true });
      const needed = selected.reduce((sum, item) => sum + item.bytes, 0), free = Number(fs.statfsSync(directory).bavail) * Number(fs.statfsSync(directory).bsize);
      if (free < needed * 2 + 1024 ** 3) throw new Error('There is not enough space for this selection and its prepared copies. Choose fewer episodes.');
      record = this.save({ id: remote.id, hash: source.hash, directory, tag: 'MabelTV-' + remote.id, selected, created: Date.now(), inspection });
    }
    if (record.hash !== source.hash || JSON.stringify(record.selected) !== JSON.stringify(selected)) throw new Error('The saved download selection changed. Its files were kept.');
    if (record.complete) return this.finish(record, signal);
    let info = await this.info(source.hash, signal);
    if (info && (!String(info.tags).split(',').map(value => value.trim()).includes(record.tag) || path.resolve(info.save_path) !== path.resolve(record.directory))) {
      const tags = String(info.tags).split(',').map(value => value.trim());
      if (!record.inspection || !tags.some(tag => [record.tag, record.inspection.tag].includes(tag)) ||
          ![record.directory, record.inspection.directory].some(directory => path.resolve(directory) === path.resolve(info.save_path))) throw new Error('This torrent belongs to another transfer.');
      await this.runtime.api('torrents/stop', { hashes: source.hash }, { signal });
      await this.runtime.api('torrents/addTags', { hashes: source.hash, tags: record.tag }, { signal });
      await this.runtime.api('torrents/setLocation', { hashes: source.hash, location: record.directory }, { signal });
      for (let attempt = 0; attempt < 120; attempt++) {
        const moved = await this.info(source.hash, signal);
        if (moved && path.resolve(moved.save_path) === path.resolve(record.directory)) break;
        await delay(250, undefined, { signal });
      }
      await this.owned(record, signal);
      await this.runtime.api('torrents/removeTags', { hashes: source.hash, tags: record.inspection.tag }, { signal });
    } else if (!info) {
      await this.runtime.api('torrents/add', { urls: source.magnet, savepath: record.directory, tags: record.tag, stopped: false, autoTMM: false, stopCondition: 'MetadataReceived',
        ratioLimit: 0, seedingTimeLimit: 0, inactiveSeedingTimeLimit: -1, shareLimitAction: 'Stop', shareLimitsMode: 'MatchAny' }, { signal });
    }
    try {
      let files;
      for (let attempt = 0; attempt < (this.options.inspectAttempts || 180); attempt++) {
        info = await this.owned(record, signal);
        if (info) {
          const raw = await this.runtime.api('torrents/files', { hash: source.hash }, { method: 'GET', signal });
          if (raw.length) { files = fileList(raw); break; }
        }
        progress({ stage: 'details', percent: 0, message: 'Getting download details' });
        await delay(this.options.pollMs || 2000, undefined, { signal });
      }
      if (!files) throw new Error('The file list is not available yet. Retry when peers are available.');
      for (const file of selected) if (!files.some(actual => actual.index === file.index && actual.path === file.path && actual.bytes === file.bytes && actual.video)) throw new Error('The selected download files changed. Choose them again.');
      const sidecars = files.filter(file => /\.(srt|vtt|ass)$/i.test(file.path) && selected.some(video => file.path.toLowerCase().startsWith(video.path.slice(0, -path.posix.extname(video.path).length).toLowerCase() + '.')));
      const wanted = [...selected, ...sidecars], ids = new Set(wanted.map(file => file.index));
      await this.runtime.api('torrents/stop', { hashes: source.hash }, { signal });
      await this.runtime.api('torrents/filePrio', { hash: source.hash, id: files.map(file => file.index).join('|'), priority: 0 }, { signal });
      await this.runtime.api('torrents/filePrio', { hash: source.hash, id: [...ids].join('|'), priority: 1 }, { signal });
      await this.runtime.api('torrents/setShareLimits', { hashes: source.hash, ratioLimit: 0, seedingTimeLimit: 0, inactiveSeedingTimeLimit: -1, shareLimitAction: 'Stop', shareLimitsMode: 'MatchAny' }, { signal });
      // MetadataReceived is consumed and cleared by qBittorrent when its
      // metadata arrives. Priorities are set while it remains stopped.
      await this.runtime.api('torrents/start', { hashes: source.hash }, { signal });
      for (;;) {
        if (signal?.aborted) throw new Error('Stopped');
        info = await this.owned(record, signal);
        if (!info) throw new Error('The active torrent was removed. Retry to restore its download.');
        const raw = await this.runtime.api('torrents/files', { hash: source.hash }, { method: 'GET', signal });
        if (wanted.every(file => raw.find(item => item.index === file.index)?.progress >= 1)) {
          for (const file of wanted) if (fs.statSync(ownedFile(record.directory, file.path)).size !== file.bytes) throw new Error('A completed download file could not be verified. Its data was kept.');
          record = this.save({ ...record, complete: true, files: wanted, completed: Date.now() });
          return this.finish(record, signal);
        }
        if (/^(error|missingFiles|unknown)$/.test(info.state)) throw new Error('This download needs attention. Check available space and retry.');
        progress({ stage: 'downloading', percent: Math.round((info.progress || 0) * 100), message: 'Downloading · ' + Math.round((info.dlspeed || 0) / 1024) + ' KB/s' });
        await delay(this.options.pollMs || 2000, undefined, { signal });
      }
    } finally {
      if (await this.owned(record).catch(() => null)) await this.runtime.api('torrents/stop', { hashes: source.hash }).catch(() => {});
    }
  }
  async finish(record, signal) {
    if (!record.removed) {
      const info = await this.owned(record, signal);
      if (info) {
        await this.runtime.api('torrents/stop', { hashes: record.hash }, { signal });
        await this.runtime.api('torrents/delete', { hashes: record.hash, deleteFiles: false }, { signal });
        if (await this.info(record.hash, signal)) throw new Error('The completed torrent has not confirmed removal. Retry to continue.');
      }
      record = this.save({ ...record, removed: true });
    }
    for (const file of record.selected) if (!record.cleaned && fs.statSync(ownedFile(record.directory, file.path)).size !== file.bytes) throw new Error('A retained download changed. It was kept for recovery.');
    return { ...record, files: record.selected.map(file => ({ ...file, file: ownedFile(record.directory, file.path) })) };
  }
  cleanup(record) {
    const base = path.resolve(this.store.state.settings.workspace, 'Torrents'), expected = path.join(base, record.id);
    if (!record.complete || !record.removed || !/^[a-f0-9]{32}$/.test(record.id) || path.resolve(record.directory) !== expected || !expected.startsWith(base + path.sep)) throw new Error('The download working area could not be confirmed.');
    if (fs.existsSync(expected)) {
      if (fs.realpathSync(expected) !== expected || fs.lstatSync(expected).isSymbolicLink()) throw new Error('The download working area changed.');
      fs.rmSync(expected, { recursive: true, force: true });
    }
    this.save({ ...this.load(record.id), cleaned: true });
  }
}
module.exports = { TorrentDownloads };
