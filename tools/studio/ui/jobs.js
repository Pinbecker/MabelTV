import { $, escape, art, empty, attempt, toast } from './shared.js';
import { openSubtitles } from './subtitles.js';

const labels = { queued: 'Queued', 'queued-download': 'Waiting to download', 'queued-conversion': 'Waiting to convert', 'queued-upload': 'Waiting to send', 'saving-cloud': 'Uploading to iCloud', 'waiting-for-cloud': 'Uploading to iCloud', 'freeing-space': 'Freeing local cache', downloading: 'Downloading', assembling: 'Assembling download', preparing: 'Preparing video', uploading: 'Sending', publishing: 'Adding to library', matching: 'Adding metadata', waiting: 'Waiting for connection', paused: 'Paused', failed: 'Needs attention', complete: 'Complete', prepared: 'Ready locally', cancelled: 'Cancelled' };
export function renderJobs(jobs) {
  const completed = jobs.filter(job => ['complete', 'prepared'].includes(job.status)).sort((a, b) => b.updatedAt - a.updatedAt);
  const pending = jobs.filter(job => !['complete', 'prepared', 'cancelled'].includes(job.status));
  $('#queue-count').textContent = pending.length;
  $('#queue-summary').textContent = `${pending.length} item${pending.length === 1 ? '' : 's'} · prepared copies kept safely`;
  renderList($('#queue-list'), pending, empty('No pending jobs.', 'Add files or choose a download.', 'check'));
  renderList($('#completed-list'), completed, empty('No completed jobs.', 'Finished jobs appear here.', 'check'));
  const recent = jobs.filter(job => job.status !== 'cancelled').slice(-2).reverse();
  const preview = $('#recent-preview');
  if (!recent.length) preview.replaceChildren();
  else {
    if (!preview.querySelector('.recent-jobs')) preview.innerHTML = '<div class="list-heading"><span>Latest activity</span><button class="text-button recent-queue">View queue ↗</button></div><div class="recent-jobs"></div>';
    renderList(preview.querySelector('.recent-jobs'),recent,'');
  }
  const recentButton = $('.recent-queue'); if (recentButton) recentButton.onclick = () => window.showStudioView('queue');
  document.querySelectorAll('[data-job-action]').forEach(button => button.onclick = () => attempt(async () => {
    button.disabled = true;
    const { id, jobAction } = button.dataset;
    if (jobAction === 'reveal') await window.studio.reveal(id);
    else if (jobAction === 'subtitles') {
      const job = jobs.find(job => job.id === id), result = job.result;
      const source = {kind:result.kind,file:result.kind === 'my_tv' ? [result.folder,result.file_name].filter(Boolean).join('/') : result.kind === 'my-tv-series' ? `Season ${result.season}/${result.file_name}` : result.file_name};
      if (result.kind === 'my-tv-series') source.series = result.series_id;
      if (result.kind === 'channel') source.channel = result.channel;
      await openSubtitles(source,job.metadata.title || 'Subtitles');
    }
    else if (jobAction === 'send') window.openSendDialog(id);
    else if (jobAction === 'compress-anyway') {
      if (window.confirm('This copy is already heavily compressed. Further compression may reduce picture quality. Compress anyway?')) await window.studio.action(id, 'compress-anyway');
    }
    else { await window.studio.action(id, jobAction); if (jobAction === 'cancel') toast('Cancelled. Your local files have been kept.'); }
    button.disabled = false;
  }));
}
function renderList(root, jobs, fallback) {
  if (!jobs.length) { if (!root.querySelector('.empty-state')) root.innerHTML = fallback; return; }
  root.querySelectorAll('.empty-state').forEach(node => node.remove());
  const existing = new Map([...root.querySelectorAll('[data-job]')].map(node => [node.dataset.job,node]));
  jobs.forEach((job,index) => {
    const html = card(job); let row = existing.get(job.id);
    if (!row || row._jobHtml !== html) {
      const template = document.createElement('template'); template.innerHTML = html;
      const next = template.content.firstElementChild, image = row?.querySelector('img'), newImage = next.querySelector('img');
      if (image && image.getAttribute('src') === newImage?.getAttribute('src')) newImage.replaceWith(image);
      if (row) row.replaceWith(next); row = next; row._jobHtml = html;
    }
    if (root.children[index] !== row) root.insertBefore(row,root.children[index] || null);
    existing.delete(job.id);
  });
  existing.forEach(node => node.remove());
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
  if (job.result?.complete && ['my_tv','my-tv-series','channel'].includes(job.result.kind)) actions += button(job,'subtitles','Subtitles');
  if (job.status === 'complete' && job.metadataWarning && !job.matchApplied) actions += button(job, 'metadata', 'Retry metadata');
  const title = [job.metadata.title, job.metadata.episode].filter(Boolean).join(' · ');
  const label = job.status === 'downloading' && ['audio', 'video'].includes(job.downloadStage) ? 'Downloading ' + job.downloadStage : labels[job.status] || job.status;
  const message = job.status === 'prepared' && job.originalRemoved ? 'Ready locally. Your prepared copy is kept in the media folder.' : job.message;
  const progress = ['downloading', 'assembling', 'preparing', 'uploading'].includes(job.status) ? `<span class="job-percent">${job.percent == null ? '' : Math.round(job.percent) + '%'}</span><progress max="100" ${job.percent === null ? '' : `value="${Math.max(0, Math.min(100, job.percent || 0))}"`} aria-label="${escape(label)} progress"></progress>` : '';
  return `<article class="job-card" data-job="${job.id}">${art(job.match?.poster_path ? job.match : job.metadata)}<div class="job-copy"><div class="job-title"><strong title="${escape(title)}">${escape(title)}</strong><span class="job-status ${escape(job.status)}">${escape(label)}</span></div><div class="job-destination">${{iplayer:'BBC iPlayer',cloud:'iCloud',torrent:'Download'}[job.source] || 'Your computer'} <span>→</span> ${escape(job.destination.label)}</div>${progress}<div class="job-message">${escape(message)}</div>${job.match ? `<div class="job-match">${job.matchApplied ? 'Matched' : 'Confirmed match'}: ${escape(job.match.title)}${job.match.year ? ' · ' + escape(job.match.year) : ''}</div>` : ''}${job.metadataWarning ? `<div class="job-metadata-warning">${escape(job.metadataWarning)}</div>` : ''}<div class="job-actions">${actions}</div></div></article>`;
}
