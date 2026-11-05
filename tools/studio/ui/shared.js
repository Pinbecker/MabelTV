export const $ = selector => document.querySelector(selector);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths = {
  add:'M12 5v14M5 12h14', search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  queue:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', check:'M5 12l4 4L19 6',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3l-1 3-3 1-2 3 2 2v3l3 2 1 4h6l1-4 3-2v-3l2-2-2-3-3-1-1-3z',
  upload:'M12 16V3M7 8l5-5 5 5M4 15v5h16v-5', shield:'M12 3L3 7v5c0 5 9 10 9 10s9-5 9-10V7zM8 12l3 3 5-5',
  external:'M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7', refresh:'M20 7V3l-4 4M4 17v4l4-4M20 7a9 9 0 0 0-15-3M4 17a9 9 0 0 0 15 3',
  info:'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', connection:'M8 8l8 8M7 14l-3 3a3 3 0 0 0 4 4l3-3M13 6l3-3a3 3 0 0 1 4 4l-3 3',
  tv:'M3 5h18v14H3zM8 22h8M12 19v3', film:'M3 3h18v18H3zM7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4',
  folder:'M3 6h7l2 3h9v11H3z', cloud:'M6 18a4 4 0 0 1-1-8 7 7 0 0 1 13-1 5 5 0 0 1 0 10H6', download:'M12 3v13M7 11l5 5 5-5M4 17v4h16v-4'
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.film}"/></svg>`;
export function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(node => node.innerHTML = icon(node.dataset.icon)); }
export function art(metadata, extra = '') {
  const source = metadata?.artwork || '';
  if (/^\/[A-Za-z0-9_-]+\.(jpg|png)$/.test(metadata?.poster_path || '')) return `<img class="artwork ${extra}" src="https://image.tmdb.org/t/p/w185${escape(metadata.poster_path)}" alt="" loading="lazy">`;
  return /^https:\/\/ichef\.(?:bbci|bbc)\.co\.uk\//.test(source)
    ? `<img class="artwork ${extra}" src="${escape(source)}" alt="" loading="lazy">`
    : `<span class="artwork artwork-placeholder ${extra}">${icon('film')}</span>`;
}
export function empty(title, description, symbol = 'film') { return `<div class="empty-state"><span>${icon(symbol)}</span><h2>${escape(title)}</h2><p>${escape(description)}</p></div>`; }
let toastTimer;
export function toast(message, error = false) {
  clearTimeout(toastTimer); const node = $('#toast'); node.textContent = message;
  node.className = 'toast' + (error ? ' error' : ''); toastTimer = setTimeout(() => node.classList.add('hidden'), error ? 10000 : 4500);
}
export async function attempt(callback) { try { return await callback(); } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), true); return null; } }
export function duration(seconds) { return seconds ? `${Math.round(seconds / 60)} min` : ''; }
