'use strict';
const os = require('node:os');
const { CompanionJobs } = require('./companion-jobs.cjs');
const { TorrentDownloads } = require('./torrent-downloads.cjs');
const { CompanionTorrents } = require('./companion-torrents.cjs');

class Companion {
  constructor(store, queue, iplayer, portal, torrents = null) {
    Object.assign(this, { store, queue, iplayer, portal });
    this.runner = new CompanionJobs(store, queue, iplayer, portal);
    this.torrents = torrents;
    if (torrents) { this.downloads = new TorrentDownloads(store, torrents); this.torrentRunner = new CompanionTorrents(this.downloads, this.runner); }
    this.active = null; this.responses = []; this.request = null; this.closed = false; this.busy = false;
    this.status = { connected: false, message: 'Connecting to your portal' };
  }
  start() { this.timer = setInterval(() => this.tick(), 3000); this.timer.unref(); this.tick(); }
  progress() {
    const state = this.active;
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
      const reply = await this.portal.api('/api/studio/worker', { method: 'POST', body: {
        id: this.store.state.sourceId, name: os.hostname(), active: this.progress(), responses,
        capabilities: this.torrents ? ['torrent'] : [], requestActive: this.request ? { id: this.request.id, claim: this.request.claim } : null,
      } });
      this.responses.splice(0, responses.length);
      this.status = { connected: true, message: this.active ? 'Working for your portal' : 'Ready for portal requests' };
      if (this.active) {
        const state = this.active;
        if (!reply.acknowledged || reply.acknowledged.command) {
          state.controller.abort();
          if (state.local && !['complete', 'prepared', 'paused', 'cancelled'].includes(state.local.status)) {
            await this.queue.action(state.local.id, reply.acknowledged?.command === 'cancel' ? 'cancel' : 'pause');
          }
          this.active = null;
        } else if (state.done) this.active = null;
      }
      if (reply.job && !this.active) {
        const state = { remote: reply.job, controller: new AbortController(), progress: {} };
        this.active = state;
        const runner = reply.job.source.type === 'torrent' ? this.torrentRunner : this.runner;
        runner.run(reply.job, state, state.controller.signal).catch(error => {
          state.progress = { status: state.controller.signal.aborted ? 'paused' : 'failed', stage: 'failed', error: error.message, message: error.message };
          state.finishing = true;
        }).finally(() => { state.done = true; });
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
  async close() { this.closed = true; clearInterval(this.timer); this.active?.controller.abort(); await this.torrents?.close(); }
}
module.exports = { Companion };
