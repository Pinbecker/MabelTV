'use strict';
const os = require('node:os');
const crypto = require('node:crypto');
const { CompanionJobs } = require('./companion-jobs.cjs');
const { TorrentDownloads } = require('./torrent-downloads.cjs');
const { CompanionTorrents } = require('./companion-torrents.cjs');

const backgroundStages = new Set(['saving-cloud', 'waiting-for-cloud', 'freeing-space']);
function progressBatch(states, progress, cursor = 0) {
  const values = [...states].map(state => { const value = progress(state); return { state, value, version: JSON.stringify(value) }; });
  const foreground = values.filter(item => !item.state.done && !backgroundStages.has(item.value.stage));
  const changes = values.filter(item => (item.state.done || backgroundStages.has(item.value.stage)) && item.version !== item.state.ackVersion)
    .sort((a, b) => Number(backgroundStages.has(b.value.stage) && !backgroundStages.has(b.state.ackStage))
      - Number(backgroundStages.has(a.value.stage) && !backgroundStages.has(a.state.ackStage)));
  const reports = [...foreground, ...changes].slice(0, 64);
  const stable = values.filter(item => !item.state.done && backgroundStages.has(item.value.stage) && item.version === item.state.ackVersion);
  const count = Math.min(64 - reports.length, stable.length);
  for (let i = 0; i < count; i++) reports.push(stable[(cursor + i) % stable.length]);
  return { reports, cursor: stable.length ? (cursor + count) % stable.length : 0 };
}

class Companion {
  constructor(store, queue, iplayer, portal, torrents = null) {
    Object.assign(this, { store, queue, iplayer, portal });
    this.runner = new CompanionJobs(store, queue, iplayer, portal);
    this.torrents = torrents;
    if (torrents) { this.downloads = new TorrentDownloads(store, torrents); this.torrentRunner = new CompanionTorrents(this.downloads, this.runner, queue.resources); }
    this.actives = new Map(); this.running = new Set(); this.responses = []; this.request = null; this.closed = false; this.busy = false;
    this.workerSession = crypto.randomBytes(16).toString('hex'); this.progressCursor = 0;
    this.status = { connected: false, message: 'Connecting to your portal' };
  }
  start() { this.timer = setInterval(() => this.tick(), 3000); this.timer.unref(); this.tick(); }
  get active() { return this.actives.values().next().value || null; }
  progress(state = this.active) {
    if (!state) return null;
    const local = state.local;
    const progress = state.finishing || !local ? state.progress || {} : {
      stage: local.status, percent: local.percent || 0, message: local.message || '',
    };
    return { id: state.remote.id, claim: state.remote.claim, ...progress };
  }
  async tick() {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      const responses = this.responses.slice();
      const batch = progressBatch(this.actives.values(), state => this.progress(state), this.progressCursor);
      this.progressCursor = batch.cursor;
      const reply = await this.portal.api('/api/studio/worker', { method: 'POST', body: {
        id: this.store.state.sourceId, session: this.workerSession, name: os.hostname(), activeJobs: batch.reports.map(item => item.value), responses,
        capabilities: ['parallel-stages', 'cloud-optimise', 'compression-presets', ...(this.torrents ? ['torrent'] : [])], requestActive: this.request ? { id: this.request.id, claim: this.request.claim } : null,
      } });
      if (this.closed) return;
      this.responses.splice(0, responses.length);
      this.status = { connected: true, message: this.actives.size ? 'Working for your portal' : 'Ready for portal requests' };
      await Promise.all(batch.reports.map(async ({ state, value, version }) => {
        const acknowledged = (reply.acknowledgedJobs || []).find(value => value.id === state.remote.id);
        if (!acknowledged || acknowledged.command) {
          state.controller.abort();
          const local = state.local || state.child?.local;
          if (local && !['complete', 'prepared', 'paused', 'cancelled'].includes(local.status)) {
            await this.queue.action(local.id, acknowledged?.command === 'cancel' ? 'cancel' : 'pause');
          }
          this.actives.delete(state.remote.id);
        } else if (state.done) this.actives.delete(state.remote.id);
        else { state.ackVersion = version; state.ackStage = value.stage; }
      }));
      for (const job of reply.jobs || []) {
        if (this.actives.has(job.id)) continue;
        const state = { remote: job, controller: new AbortController(), progress: {} };
        this.actives.set(job.id, state);
        const runner = job.source.type === 'torrent' ? this.torrentRunner : this.runner;
        state.promise = runner.run(job, state, state.controller.signal).catch(error => {
          state.progress = { status: state.controller.signal.aborted ? 'paused' : 'failed', stage: 'failed', error: error.message, message: error.message };
          state.finishing = true;
        }).finally(() => { this.queue.resources?.release(job.id); state.done = true; this.running.delete(state.promise); });
        this.running.add(state.promise);
      }
      for (const request of reply.requests || []) {
        if (this.request) {
          this.responses.push({ id: request.id, claim: request.claim, error: 'Another search is finishing. Try again in a moment.' });
          continue;
        }
        this.request = request;
        const operation = request.kind === 'torrent-search' ? this.torrents.search(request.query)
          : request.kind === 'torrent-inspect' ? this.downloads.inspect(request.source)
          : request.kind === 'metadata' ? this.iplayer.metadata(request.query) : this.iplayer.search(request.query, request.refresh);
        operation.then(result => this.responses.push({ id: request.id, claim: request.claim, result }))
          .catch(error => this.responses.push({ id: request.id, claim: request.claim, error: error.message }))
          .finally(() => { this.request = null; });
      }
    } catch (error) {
      this.status = { connected: false, message: error.code === 'AUTH' ? 'Sign in to your portal in Studio Settings' : 'Waiting for portal connection' };
      // Work can finish locally while offline; its journal and result remain durable.
    } finally { this.busy = false; }
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    const active = [...this.actives.values()];
    for (const state of active) state.controller.abort();
    await Promise.allSettled([...this.running]);
    await this.torrents?.close();
  }
}
module.exports = { Companion, progressBatch };
