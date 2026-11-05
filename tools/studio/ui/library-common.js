import { escape, icon } from './shared.js';

export function bytes(value) {
  if (!value) return '0 B';
  const unit = Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1024))));
  return `${(value / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${['B','KB','MB','GB','TB'][unit]}`;
}
export function title(value = '') {
  return value.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ').replace(/\s+(?:2160p|1080p|720p|480p|BluRay|BRRip|WEBRip|WEB-DL|HDTV)\b.*$/i, '').replace(/[\s-]+$/, '').trim();
}
export function artwork(item, className = '') {
  const metadata = item?.metadata || item || {}, poster = metadata.poster_path;
  const url = /^\/[A-Za-z0-9_-]+\.(?:jpg|png)$/.test(poster || '') ? 'https://image.tmdb.org/t/p/w342' + poster : '';
  return `<span class="library-art ${className}">${url ? `<img src="${escape(url)}" alt="" loading="lazy">` : icon(metadata.media_type === 'tv' ? 'tv' : 'film')}</span>`;
}
export function loading(message) { return `<div class="library-loading" role="status"><span class="studio-spinner"></span><span>${escape(message)}</span></div>`; }
export function wireDialog(dialog, close) {
  dialog.querySelector('[data-close]').onclick = close;
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } });
  dialog.oncancel = event => { event.preventDefault(); close(); };
}
export async function confirmAction(heading, message, label, danger = false) {
  const dialog = document.createElement('dialog'); dialog.className = 'library-confirm';
  dialog.innerHTML = `<h2>${escape(heading)}</h2><p>${escape(message)}</p><div class="library-confirm-actions"><button class="button secondary" data-cancel>Cancel</button><button class="button ${danger ? 'danger' : 'primary'}" data-confirm>${escape(label)}</button></div>`;
  document.body.append(dialog);
  return new Promise(resolve => {
    const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.querySelector('[data-cancel]').onclick = () => finish(false);
    dialog.querySelector('[data-confirm]').onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.showModal(); dialog.querySelector('[data-cancel]').focus();
  });
}

// Source-bound requests can finish after clearing a search or closing its sheet.
export async function requestResult(request, current) {
  while (['queued', 'active'].includes(request.status)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!current()) return null;
    request = await window.studio.libraryRead('request', { id: request.id });
  }
  if (!current()) return null;
  if (request.status !== 'complete') throw new Error(request.error || 'This request could not finish. Try again.');
  return request;
}
