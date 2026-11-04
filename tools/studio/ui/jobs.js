import { $, escape, art, empty, attempt, toast } from './shared.js';

const labels = { queued: 'Queued', 'queued-download': 'Waiting to download', 'queued-conversion': 'Waiting to convert', 'queued-upload': 'Waiting to send', 'saving-cloud': 'Uploading to iCloud', 'waiting-for-cloud': 'Uploading to iCloud', 'freeing-space': 'Freeing local cache', downloading: 'Downloading', assembling: 'Assembling download', preparing: 'Preparing video', uploading: 'Sending', publishing: 'Adding to library', matching: 'Adding metadata', waiting: 'Waiting for connection', paused: 'Paused', failed: 'Needs attention', complete: 'Complete', prepared: 'Ready locally', cancelled: 'Cancelled' };
export function renderJobs(jobs) {
  const completed = jobs.filter(job => ['complete', 'prepared'].includes(job.status)).sort((a, b) => b.updatedAt - a.updatedAt);
  const pending = jobs.filter(job => !['complete', 'prepared', 'cancelled'].includes(job.status));
  $('#queue-count').textContent = pending.length;
  $('#queue-summary').textContent = `${pending.length} item${pending.length === 1 ? '' : 's'} · prepared copies kept safely`;
  $('#queue-list').innerHTML = pending.length ? pending.map(card).join('') : empty('No pending jobs.', 'Add files or choose a download.', 'check');
  $('#completed-list').innerHTML = completed.length ? completed.map(card).join('') : empty('No completed jobs.', 'Finished jobs appear here.', 'check');
  const recent = jobs.filter(job => job.status !== 'cancelled').slice(-2).reverse();
  $('#recent-preview').innerHTML = recent.length ? '<div class="list-heading"><span>Latest activity</span><button class="text-button recent-queue">View queue ↗</button></div>' + recent.map(card).join('') : '';
  const recentButton = $('.recent-queue'); if (recentButton) recentButton.onclick = () => window.showStudioView('queue');
  document.querySelectorAll('[data-job-action]').forEach(button => button.onclick = () => attempt(async () => {
    button.disabled = true;
    const { id, jobAction } = button.dataset;
    if (jobAction === 'reveal') await window.studio.reveal(id);
    else if (jobAction === 'send') window.openSendDialog(id);
    else if (jobAction === 'compress-anyway') {
      if (window.confirm('This copy is already heavily compressed. Further compression may reduce picture quality. Compress anyway?')) await window.studio.action(id, 'compress-anyway');
    }
    else { await window.studio.action(id, jobAction); if (jobAction === 'cancel') toast('Cancelled. Your local files have been kept.'); }
    button.disabled = false;
  }));
}
function button(job, action, text) { return `<button class="button secondary" data-id="${job.id}" data-job-action="${action}">${text}</button>`; }
function card(job) {
  const finished = ['complete', 'prepared', 'cancelled'].includes(job.status);
  let actions = '';
  if (['paused', 'waiting'].includes(job.status)) actions += button(job, 'resume', 'Resume');
  if (job.status === 'failed') actions += job.errorCode === 'QUALITY_REVIEW' ? button(job, 'compress-anyway', 'Compress anyway') : button(job, 'retry', 'Retry');
  if (['queued', 'downloading', 'assembling', 'preparing', 'uploading'].includes(job.status)) actions += button(job, 'pause', 'Pause');
  if (!finished && !['publishing', 'matching', 'saving-cloud', 'waiting-for-cloud', 'freeing-space'].includes(job.status)) actions += button(job, 'cancel', 'Cancel');
  if (job.preparedPath || job.sourcePath) actions += button(job, 'reveal', 'Show file');
  if (job.status === 'prepared') actions += button(job, 'send', 'Send to MabelTV');
  if (job.status === 'complete' && job.metadataWarning && !job.matchApplied) actions += button(job, 'metadata', 'Retry metadata');
  const title = [job.metadata.title, job.metadata.episode].filter(Boolean).join(' · ');
  const label = job.status === 'downloading' && ['audio', 'video'].includes(job.downloadStage) ? 'Downloading ' + job.downloadStage : labels[job.status] || job.status;
  const message = job.status === 'prepared' && job.originalRemoved ? 'Ready locally. Your prepared copy is kept in the media folder.' : job.message;
  const progress = ['downloading', 'assembling', 'preparing', 'uploading'].includes(job.status) ? `<span class="job-percent">${job.percent == null ? '' : Math.round(job.percent) + '%'}</span><progress max="100" ${job.percent === null ? '' : `value="${Math.max(0, Math.min(100, job.percent || 0))}"`} aria-label="${escape(label)} progress"></progress>` : '';
  return `<article class="job-card" data-job="${job.id}">${art(job.metadata)}<div class="job-copy"><div class="job-title"><strong title="${escape(title)}">${escape(title)}</strong><span class="job-status ${escape(job.status)}">${escape(label)}</span></div><div class="job-destination">${job.source === 'iplayer' ? 'BBC iPlayer' : 'Your computer'} <span>→</span> ${escape(job.destination.label)}</div>${progress}<div class="job-message">${escape(message)}</div>${job.match ? `<div class="job-match">${job.matchApplied ? 'Matched' : 'Confirmed match'}: ${escape(job.match.title)}${job.match.year ? ' · ' + escape(job.match.year) : ''}</div>` : ''}${job.metadataWarning ? `<div class="job-metadata-warning">${escape(job.metadataWarning)}</div>` : ''}<div class="job-actions">${actions}</div></div></article>`;
}
