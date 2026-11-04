'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { copy, beneath } = require('./cloud-files.cjs');
const { freeCloudCache } = require('./cloud-cache.cjs');
const settingKeys = ['localUrl', 'remoteUrl', 'connectionMode', 'workspace', 'iCloudRoot', 'toolFolder'];
function profileSnapshot(store) {
  const { version, sourceId, settings, jobs } = store.snapshot();
  return { version, sourceId, settings: Object.fromEntries(settingKeys.filter(key => key in settings).map(key => [key, settings[key]])), jobs };
}
function reconcileSnapshot(snapshot, exists = fs.existsSync) {
  if (snapshot?.version !== 1 || !/^[a-f0-9]{32}$/.test(snapshot.sourceId) || !Array.isArray(snapshot.jobs) || !snapshot.settings)
    throw new Error('Invalid Studio recovery snapshot.');
  const restored = structuredClone(snapshot);
  for (const job of restored.jobs) {
    if (['complete', 'cancelled'].includes(job.status)) continue;
    if (job.preparedPath && !exists(job.preparedPath)) { job.preparedPath = ''; job.uploadFingerprint = undefined; }
    if (job.sourcePath && !exists(job.sourcePath)) {
      if (job.source === 'iplayer') { job.sourcePath = ''; job.sourceFingerprint = undefined; }
      else { job.status = 'paused'; job.message = job.remoteId ? 'Waiting for the portal to recover this source.' : 'Original file missing. Reattach it before resuming.'; continue; }
    }
    job.status = 'paused'; job.percent = 0; job.message = 'Restored. Resume to reconcile the recorded delivery.';
  }
  return restored;
}
async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
class BackupBridge {
  constructor(store, portal) { Object.assign(this, { store, portal }); this.busy = false; this.next = 0; this.controller = new AbortController(); }
  async tick() {
    if (this.busy || Date.now() < this.next) return;
    this.busy = true; this.next = Date.now() + 5 * 60000;
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10 * 60000)]);
    try {
      await this.portal.api('/api/studio/backup/profile', { method: 'POST', body: { worker: this.store.state.sourceId, snapshot: profileSnapshot(this.store) }, signal });
      const info = await this.portal.api('/api/studio/backup', { signal });
      if (!info.available || info.verified?.some(value => value.id === info.name && value.sha256 === info.sha256)) return;
      const directory = path.join(this.store.root, 'Backups'); fs.mkdirSync(directory, { recursive: true });
      if (!/^MabelTV-Backup-\d{4}-\d{2}-\d{2}T\d{6}Z\.tar\.gz$/.test(info.name) || !/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error('Invalid Pi backup manifest.');
      const free = fs.statfsSync(directory);
      if (Number(free.bavail) * Number(free.bsize) < 20 * 1024 ** 3 + info.bytes * 2) throw new Error('Waiting for disk space for backup delivery.');
      const local = path.join(directory, info.name), partial = local + '.part';
      if (!fs.existsSync(local) || await hash(local) !== info.sha256) {
        const response = await this.portal.transport(this.portal.current.base + '/api/studio/backup/file?name=' + encodeURIComponent(info.name),
          { credentials: 'include', redirect: 'manual', signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('gzip')) throw new Error('The Pi backup could not be downloaded.');
        await pipeline(response.body, fs.createWriteStream(partial, { mode: 0o600 }), { signal });
        if (fs.statSync(partial).size !== info.bytes || await hash(partial) !== info.sha256) throw new Error('The downloaded backup checksum does not match.');
        fs.renameSync(partial, local);
      }
      const root = this.store.state.settings.iCloudRoot || path.join(process.env.USERPROFILE, 'iCloudDrive');
      const expected = 'Backups/MabelTV/snapshots/' + info.name.slice(15, 19) + '/' + info.name.slice(20, 22) + '/' + info.name;
      if (info.path !== expected) throw new Error('Unexpected backup destination.');
      const target = beneath(root, expected);
      await copy(local, target, signal, () => {}, path.join(directory, info.name + '.copy.json'));
      const confirmed = await this.portal.api('/api/studio/backup/confirm', { method: 'POST', body: { name: info.name }, signal, timeout: 210000 });
      this.store.state.backupStatus = { name: info.name, verified: confirmed.confirmed ? Date.now() : this.store.state.backupStatus?.verified || 0,
        message: confirmed.confirmed ? 'iCloud backup verified' : 'Waiting for iCloud backup upload' }; this.store.save();
      if (confirmed.confirmed) { await freeCloudCache(target, info.bytes, signal); fs.unlinkSync(local); }
    } catch (error) {
      if (!signal.aborted) { this.store.state.backupStatus = { ...this.store.state.backupStatus, message: error.message }; this.store.save(); }
    } finally { this.busy = false; }
  }
  close() { this.controller.abort(); }
}
module.exports = { BackupBridge, profileSnapshot, reconcileSnapshot, hash };
