'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

class StageGate {
  constructor(limit) { this.limit = limit; this.active = 0; this.waiters = []; }
  async run(signal, waiting, operation) {
    signal?.throwIfAborted();
    if (this.active >= this.limit) {
      waiting?.();
      await new Promise((resolve, reject) => {
        const item = { resolve: () => { signal?.removeEventListener('abort', abort); resolve(); } };
        const abort = () => { this.waiters = this.waiters.filter(value => value !== item); reject(signal.reason || new Error('Stopped')); };
        signal?.addEventListener('abort', abort, { once: true });
        this.waiters.push(item);
      });
    } else this.active++;
    try { signal?.throwIfAborted(); return await operation(); }
    finally {
      const next = this.waiters.shift();
      if (next) next.resolve(); else this.active--;
    }
  }
}

class StageResources {
  constructor(store, options = {}) {
    this.store = store; this.options = options; this.reservations = new Map();
    this.downloads = new StageGate(5); this.conversion = new StageGate(1); this.upload = new StageGate(1);
  }
  freeBytes() {
    if (this.options.freeBytes) return this.options.freeBytes();
    let directory = this.store.state.settings.workspace;
    while (!fs.existsSync(directory)) directory = path.dirname(directory);
    const stats = fs.statfsSync(directory); return Number(stats.bavail) * Number(stats.bsize);
  }
  reserve(key, bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error('The working-space estimate is invalid.');
    const needed = Math.max(bytes, this.reservations.get(key) || 0);
    const other = [...this.reservations].reduce((sum, [id, size]) => sum + (id === key ? 0 : size), 0);
    if (this.freeBytes() < needed + other + (this.options.minimumFree ?? 20 * 1024 ** 3)) {
      const error = new Error('Waiting for disk space. Existing files and transfer records are retained.');
      error.code = 'SPACE'; throw error;
    }
    this.reservations.set(key, needed);
  }
  async admit(key, bytes, signal, waiting) {
    for (;;) {
      signal?.throwIfAborted();
      try { this.reserve(key, bytes); return; }
      catch (error) { if (error.code !== 'SPACE') throw error; waiting?.(); }
      await delay(this.options.spacePollMs || 1000, undefined, { signal });
    }
  }
  release(key) { this.reservations.delete(key); }
}
module.exports = { StageGate, StageResources };
