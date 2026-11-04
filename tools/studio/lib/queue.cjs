'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { cleanupDownload } = require('./media-cleanup.cjs');
const { titleMatch } = require('./title-match.cjs');
const { StageResources } = require('./stage-resources.cjs');
const { compressionProfile } = require('./compression.cjs');

function safeName(value) {
  const name = String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 170) || 'Video';
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name) ? 'Video - ' + name : name;
}
function destinationValid(value) {
  if (!value || !['mabel', 'film', 'series', 'local'].includes(value.kind)) throw new Error('Choose where this media should go.');
  if (value.kind === 'mabel' && (!Number.isInteger(value.channel) || value.channel < 1)) throw new Error('Choose a Mabel TV channel.');
  if (value.kind === 'series' && (!/^[a-f0-9]{32}$/.test(value.series) || !Number.isInteger(value.season) || value.season < 0 || value.season > 99)) throw new Error('Choose a My TV show and series number.');
  if (value.kind === 'film' && value.folder !== undefined && (typeof value.folder !== 'string' || value.folder.length > 80 || /[/\\\x00-\x1f]/.test(value.folder) || ['.', '..'].includes(value.folder))) throw new Error('Choose a My TV collection.');
  return { ...(value.kind === 'film' && value.folder ? { folder: value.folder } : {}), kind: value.kind, channel: value.channel, series: value.series, season: value.season,
    compression: compressionProfile(value.compression).id,
    ...(value.channelFolder ? { channelFolder: String(value.channelFolder).slice(0, 180) } : {}),
    label: String(value.label || 'Prepared locally').slice(0, 180), profile: value.profile === 'mabel' ? 'mabel' : 'mytv', downloadOnly: value.kind === 'local' && value.downloadOnly === true };
}
class Queue extends EventEmitter {
  constructor(store, media, iplayer, portal) {
    super(); Object.assign(this, { store, media, iplayer, portal });
    this.actives = new Map(); this.resources = new StageResources(store); this.stopping = false; this.timer = null;
  }
  get active() { return this.actives.values().next().value || null; }
  isActive(id) { return this.actives.has(id); }
  snapshot() { return this.store.snapshot().jobs; }
  async cleanupOriginal(job) {
    if (job.preserveOriginal) return;
    if (job.originalRemoved) {
      if (job.cleanupWarning) this.store.update(job.id, { cleanupWarning: '' });
      return;
    }
    if (await cleanupDownload(job, this.media)) this.store.update(job.id, { originalRemoved: true, cleanupWarning: '' });
  }
  async cleanupCompleted() {
    for (const job of this.store.state.jobs.filter(job => ['complete', 'prepared'].includes(job.status))) {
      try { await this.cleanupOriginal(job); }
      catch (error) { this.store.update(job.id, { cleanupWarning: error.message }); }
    }
  }
  changed() { this.emit('change', this.snapshot()); }
  add(inputs, destination) {
    destination = destinationValid(destination);
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 200) throw new Error('Choose between 1 and 200 videos.');
    // Validate all identities before adding anything from a reviewed batch.
    const matches = inputs.map(input => titleMatch(input.match, destination));
    const result = [];
    for (const [index, input] of inputs.entries()) {
      let fingerprint;
      if (input.kind === 'file') {
        const stats = fs.statSync(input.path);
        if (!stats.isFile() || !/\.(mp4|m4v|mov|mkv|avi|webm|mpg|mpeg|ts)$/i.test(input.path)) throw new Error('Choose a supported video file.');
        fingerprint = { size: stats.size, mtime: stats.mtimeMs };
      } else if (input.kind !== 'iplayer' || !/^[bmp][a-z0-9]{7}$/.test(input.metadata?.pid)) throw new Error('Choose an iPlayer programme.');
      const duplicate = this.store.state.jobs.some(job => !['complete', 'cancelled', 'failed'].includes(job.status) &&
        (input.kind === 'iplayer' ? job.metadata?.pid === input.metadata.pid : job.sourcePath === input.path) &&
        JSON.stringify(job.destination) === JSON.stringify(destination));
      if (duplicate) continue;
      const id = crypto.randomBytes(16).toString('hex');
      const title = input.kind === 'iplayer' ? input.metadata.title : path.basename(input.path, path.extname(input.path));
      const job = { id, source: input.kind, sourcePath: input.path || '', sourceFingerprint: fingerprint,
        remoteId: input.remoteId || '', reservationKey: input.reservationKey || '', preserveOriginal: input.preserveOriginal === true,
        metadata: input.metadata || { title, episode: '', artwork: '' }, match: matches[index], destination, status: 'queued',
        percent: 0, message: 'Waiting to start', createdAt: Date.now(), updatedAt: Date.now(),
        directory: path.join(this.store.state.settings.workspace, safeName([title, input.metadata?.episode].filter(Boolean).join(' - ')).slice(0, 100) + ' - ' + id.slice(0, 8)), uploadId: '', preparedPath: '' };
      this.store.add(job); result.push(job);
    }
    this.changed(); this.kick(); return result;
  }
  kick() {
    if (this.actives.size >= 12 || this.stopping) return;
    const job = this.store.state.jobs.find(job => !this.actives.has(job.id) && (job.status === 'queued' || job.status === 'waiting' && (!job.nextAttempt || job.nextAttempt <= Date.now())));
    if (!job) {
      clearTimeout(this.timer); this.timer = setTimeout(() => this.kick(), 15000); this.timer.unref(); return;
    }
    const controller = new AbortController();
    const active = { job, controller, requested: '' };
    this.actives.set(job.id, active);
    this.execute(job, controller.signal).catch(error => {
      const status = active.requested || (['OFFLINE', 'AUTH'].includes(error.code) ? 'waiting' : error.code === 'PAUSED' ? 'paused' : 'failed');
      this.store.update(job.id, { status, message: active.requested ? (status === 'cancelled' ? 'Cancelled. Local files kept.' : 'Paused. Resume when ready.') : error.message,
        nextAttempt: Date.now() + (error.code === 'AUTH' ? 60000 : 30000), errorCode: error.code || '' });
      if (error.code === 'OFFLINE') this.portal.current = null;
    }).finally(() => { this.actives.delete(job.id); if (!job.reservationKey) this.resources.release(job.id); this.changed(); this.kick(); });
    this.kick();
  }
  async execute(job, signal) {
    let lastSaved = 0;
    const change = (fields, durable = false) => {
      const save = durable || Date.now() - lastSaved > 1500;
      if (save) lastSaved = Date.now();
      this.store.update(job.id, fields, save); this.changed();
    };
    // Publication is durable independently of optional enrichment. A metadata
    // retry must work even after the owner has cleaned up their laptop files.
    if (job.result?.complete) { await this.finishSubtitles(job, signal, change); await this.finishMetadata(job, signal, change); return; }
    const profile = job.destination.kind === 'mabel' || job.destination.profile === 'mabel' ? 'mabel' : 'mytv';
    if (!job.sourcePath) {
      change({ status: 'downloading', percent: 0, message: 'Downloading from BBC iPlayer' }, true);
      const download = await this.resources.downloads.run(signal,
        () => change({ status: 'queued-download', percent: 0, message: 'Waiting for a download slot' }, true), async () => {
          await this.resources.admit(job.reservationKey || job.id, Math.max(1024 ** 3, (job.metadata.duration || 3600) * 6800000 / 8) * 3,
            signal, () => change({ status: 'queued-download', message: 'Waiting for disk space' }));
          change({ status: 'downloading', percent: 0, message: 'Downloading from BBC iPlayer' }, true);
          return this.iplayer.download(job.metadata, path.join(job.directory, 'Original'), profile, signal, fields => change(fields));
        });
      const stats = fs.statSync(download.file);
      change({ sourcePath: download.file, metadata: download.metadata, sourceFingerprint: { size: stats.size, mtime: stats.mtimeMs } }, true);
    }
    if (!job.originalRemoved) {
      const stats = fs.statSync(job.sourcePath);
      if (stats.size !== job.sourceFingerprint?.size || stats.mtimeMs !== job.sourceFingerprint?.mtime) throw new Error('The original file changed. Add it again so Studio can inspect the new version.');
    }
    if (!job.preparedPath) {
      if (job.destination.downloadOnly) {
        change({ preparedPath: job.sourcePath, publishName: safeName([job.metadata.title, job.metadata.episode].filter(Boolean).join(' - ')) + '.mp4',
          status: 'prepared', percent: 100, message: 'Downloaded locally. Studio will check compatibility when you send it.' }, true);
        return;
      }
      change({ status: 'preparing', downloadStage: '', percent: 0, message: 'Checking and preparing for ' + (profile === 'mabel' ? 'Mabel TV · 720p' : 'My TV · up to 1080p') }, true);
      const stem = safeName([job.metadata.title, job.metadata.episode].filter(Boolean).join(' - '));
      const destination = path.join(job.directory, 'Prepared', profile === 'mabel' ? 'Mabel TV' : 'My TV', job.destination.compression || 'compact', stem + '.mp4');
      const output = await this.resources.conversion.run(signal,
        () => change({ status: 'queued-conversion', percent: 0, message: 'Waiting for conversion' }, true), async () => {
          change({ status: 'preparing', percent: 0, message: 'Checking and preparing video' }, true);
          return this.media.prepare(job.sourcePath, destination, profile, signal, percent => change({ percent }), analysis => {
            this.resources.reserve(job.reservationKey || job.id, analysis.bytes * 2);
          }, job.destination.compression);
        });
      let publishName = stem + '.mp4';
      if (job.destination.kind === 'series' && job.metadata.episodeNumber) publishName = `S${String(job.destination.season).padStart(2, '0')}E${String(job.metadata.episodeNumber).padStart(2, '0')} - ${publishName}`;
      // For ready local files, retain the original name and extension.
      if (job.source === 'file' && !output.converted) publishName = path.basename(job.sourcePath);
      if (job.match?.title && job.destination.kind === 'film') publishName = safeName(job.match.title + (job.match.year ? ' (' + job.match.year + ')' : '')) + path.extname(output.file);
      change({ preparedPath: output.file, analysis: output.analysis, sourceAnalysis: output.sourceAnalysis, converted: output.converted,
        preparedCompression: job.destination.compression || 'compact', publishName }, true);
    }
    await this.cleanupOriginal(job);
    if (job.destination.kind === 'local') { change({ status: 'prepared', percent: 100, message: job.originalRemoved ? 'Ready locally. Prepared copy kept; downloaded original removed.' : 'Ready locally. Your original file is unchanged.' }, true); return; }
    change({ status: 'uploading', percent: 0, message: 'Connecting to MabelTV' }, true);
    await this.resources.upload.run(signal,
      () => change({ status: 'queued-upload', percent: 0, message: 'Waiting to send to the Pi' }, true), async () => {
        change({ status: 'uploading', percent: 0, message: 'Connecting to MabelTV' }, true);
        const result = await this.portal.upload(job, this.store.state.sourceId, signal, change);
        change({ result }, true);
        await this.finishSubtitles(job, signal, change);
        await this.finishMetadata(job, signal, change);
      });
  }
  async finishSubtitles(job, signal, change) {
    if (this.afterPublish && !job.subtitlesSent) {
      try { await this.afterPublish(job, signal); change({ subtitlesSent: true, subtitleWarning: '' }, true); }
      catch (error) { if (signal.aborted) throw error; change({ subtitleWarning: error.message }, true); }
    }
  }
  async finishMetadata(job, signal, change) {
    let metadataWarning = '';
    if (job.match && !job.matchApplied) {
      change({ status: 'matching', percent: 100, message: 'Video added. Applying ' + job.match.title + ' metadata and artwork…' }, true);
      try {
        await this.portal.applyMatch(job, signal);
        change({ matchApplied: true, metadataWarning: '' }, true);
      } catch (error) {
        if (signal.aborted) throw error;
        metadataWarning = error.message;
      }
    }
    change({ status: 'complete', percent: 100, completedAt: job.completedAt || Date.now(), metadataWarning,
      message: 'Added to ' + job.destination.label + (metadataWarning ? '. Video is available; metadata needs attention.' : job.matchApplied ? ' · ' + job.match.title + (job.match.year ? ' (' + job.match.year + ')' : '') : '') }, true);
  }
  async action(id, action, destination, match) {
    const job = this.store.job(id);
    if (!['pause', 'resume', 'retry', 'cancel', 'send', 'metadata'].includes(action)) throw new Error('Unknown queue action.');
    if (['pause', 'cancel'].includes(action) && ['complete', 'prepared', 'cancelled'].includes(job.status)) throw new Error('This item has already finished.');
    if (action === 'metadata') {
      if (job.status !== 'complete' || !job.match || job.matchApplied || !job.result?.complete) throw new Error('This item does not need a metadata retry.');
      this.store.update(id, { status: 'queued', message: 'Waiting to retry metadata' });
    } else if (action === 'send') {
      if (job.status !== 'prepared') throw new Error('Only prepared local items can be sent.');
      const chosen = destinationValid(destination);
      const confirmed = titleMatch(match, chosen);
      const oldProfile = job.destination.profile, needsInspection = job.destination.downloadOnly;
      job.destination = chosen;
      job.match = confirmed;
      if (needsInspection || chosen.compression !== job.preparedCompression || chosen.kind === 'mabel' && oldProfile !== 'mabel') {
        if (job.originalRemoved) { job.sourcePath = job.preparedPath; job.sourceFingerprint = { size: fs.statSync(job.sourcePath).size, mtime: fs.statSync(job.sourcePath).mtimeMs }; job.originalRemoved = false; }
        job.preparedPath = '';
      }
      this.store.update(id, { status: 'queued', percent: 0 });
    } else if (action === 'resume' || action === 'retry') {
      if (!['paused', 'failed', 'waiting'].includes(job.status)) throw new Error('This item is not waiting to resume.');
      this.store.update(id, { status: 'queued', message: 'Waiting to resume', errorCode: '' });
    } else {
      if (job.uploadId) {
        try { await this.portal.api('/api/uploads/' + job.uploadId, { method: 'POST', body: { action } }); }
        catch (error) { if (action !== 'pause' || !['OFFLINE', 'AUTH'].includes(error.code)) throw error; }
      }
      const active = this.actives.get(id);
      if (active) {
        active.requested = action === 'cancel' ? 'cancelled' : 'paused'; active.controller.abort();
      } else this.store.update(id, { status: action === 'cancel' ? 'cancelled' : 'paused', message: action === 'cancel' ? 'Cancelled. Local files kept.' : 'Paused. Resume when ready.' });
    }
    this.changed(); this.kick(); return this.snapshot();
  }
  async shutdown() {
    this.stopping = true; clearTimeout(this.timer);
    for (const active of this.actives.values()) { active.requested = 'paused'; active.controller.abort(); }
    while (this.actives.size) await new Promise(resolve => setTimeout(resolve, 50));
    this.store.save();
  }
}
module.exports = { Queue, safeName, destinationValid };
