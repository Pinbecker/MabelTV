import { renderJobs } from './jobs.js';

// Cloud hydration and torrent downloads start before a local conversion journal
// exists. Keep those server-owned jobs visible in the same desktop Activity.
export class Activity {
  constructor() { this.local = []; this.remote = []; this.checked = 0; this.busy = false; }
  setLocal(jobs) { this.local = jobs; this.render(); }
  async refresh(force = false) {
    if (this.busy || !force && Date.now() - this.checked < 2500) return;
    this.busy = true;
    try { const status = await window.studio.libraryRead('status'); this.remote = status.jobs || []; this.checked = Date.now(); this.onStatus?.(status); this.render(); }
    catch { /* Keep the last local/remote progress when disconnected. */ }
    finally { this.busy = false; }
  }
  render() {
    const represented = new Set(this.local.map(job => job.remoteId?.split(':')[0]).filter(Boolean));
    const remote = this.remote.filter(job => !job.cloudOperation && !represented.has(job.id)).map(job => ({
      ...job, id:'remote:' + job.id, source:job.source?.type || '',
      metadata:{...(job.matchedTitle || job.match || {}),title:job.matchedTitle?.title || job.match?.title || job.title},
      destination:{...job.destination,label:job.destination.label || (job.destination.kind === 'icloud' ? 'iCloud' : 'My TV')},
      status:job.status === 'active' ? job.stage || 'downloading' : job.status,
      message:job.error || job.message || '', updatedAt:(job.updated || job.created || 0)*1000,
    }));
    renderJobs([...this.local,...remote]);
  }
}
