'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeJson } = require('./atomic-json.cjs');

class Store {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.file = path.join(root, 'transfers.json');
    this.warning = '';
    this.state = this.read();
    for (const job of this.state.jobs) {
      if (!['complete', 'prepared', 'cancelled', 'failed', 'paused'].includes(job.status)) {
        job.status = 'paused';
        job.message = 'Restored after closing Studio. Resume when you are ready.';
      }
    }
    this.save();
  }
  read() {
    const defaults = { version: 1, sourceId: crypto.randomBytes(16).toString('hex'),
      settings: { localUrl: 'http://mabeltv-512.local:8080', remoteUrl: 'https://mabeltv.dancoakes.uk',
        connectionMode: 'auto', workspace: path.join(this.root, 'Media'), toolFolder: '' }, jobs: [] };
    if (!fs.existsSync(this.file)) return defaults;
    for (const candidate of [this.file, this.file + '.bak']) {
      try {
        const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (data.version !== 1 || !Array.isArray(data.jobs) || !data.settings ||
            !/^[a-f0-9]{32}$/.test(data.sourceId)) throw new Error('Unsupported transfer journal');
        if (candidate !== this.file) this.warning = 'Recovered your queue from its backup.';
        return { ...defaults, ...data, settings: { ...defaults.settings, ...data.settings } };
      } catch { /* Try the last durable backup, never silently discard the queue. */ }
    }
    throw new Error('The transfer journal and its backup could not be read. Your media files are safe.');
  }
  save() {
    writeJson(this.file, this.state, { backup: !this.warning });
  }
  snapshot() { return structuredClone(this.state); }
  add(job) { this.state.jobs.push(job); this.save(); return job; }
  job(id) {
    const job = this.state.jobs.find(value => value.id === id);
    if (!job) throw new Error('That queue item could not be found.');
    return job;
  }
  update(id, fields, persist = true) {
    Object.assign(this.job(id), fields, { updatedAt: Date.now() });
    if (persist) this.save();
    return this.job(id);
  }
}
module.exports = { Store };
