import { escape } from './shared.js';

const dialog = document.createElement('dialog');
dialog.id = 'title-review';
dialog.setAttribute('aria-labelledby', 'title-review-heading');
document.body.append(dialog);
let reviewing = false;

function suggestion(input) {
  const title = input.metadata?.title || (input.path || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  const year = title.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || '';
  return { query: title.replace(/:\s*Series\s*\d+.*$/i, '').replace(/[._]/g, ' ')
    .replace(/\b(?:1080p|720p|2160p|bluray|web[- ]?dl|x26[45]|hevc)\b.*$/i, '')
    .replace(year || /$^/, '').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120), year };
}

// Return null on cancellation, or a copy of the entire batch with confirmed
// identities. Nothing is queued until all reviews have finished.
export async function reviewTitles(inputs, destination) {
  if (!['film', 'series'].includes(destination.kind)) return inputs;
  if (reviewing) throw new Error('Finish the current title review first.');
  reviewing = true;
  const series = destination.kind === 'series', type = series ? 'tv' : 'movie';
  const items = series ? [{ metadata: { title: destination.label.replace(/^My TV · /, '').replace(/ · Series \d+$/, '') } }] : inputs;
  const reviewed = [];
  try {
    for (let index = 0; index < items.length; index++) {
      const item = items[index], initial = suggestion(item);
      const match = await new Promise(resolve => {
        let generation = 0, device = '', selected = null, results = [];
        dialog.innerHTML = `<div class="section-heading"><div><span class="eyebrow">${series ? 'TV SHOW' : `FILM ${index + 1} OF ${items.length}`}</span><h2 id="title-review-heading">Check the title before sending</h2></div><button class="icon-button review-close" aria-label="Cancel title review">×</button></div>
          <p>Confirm the correct ${series ? 'show once for these episodes' : 'film'}. This joins your local video with its artwork, streaming services and viewing history in My TV.</p>
          <div class="review-source">${escape(item.metadata?.title || (item.path || '').split(/[\\/]/).pop())}${series ? `<span>${inputs.length} episode${inputs.length === 1 ? '' : 's'} · ${escape(destination.label)}</span>` : ''}</div>
          <form class="review-search"><label>Title<input class="review-query" maxlength="120" value="${escape(initial.query)}" required minlength="2"></label><label>Year (optional)<input class="review-year" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" value="${initial.year}"></label><button class="button secondary" type="submit">Find matches</button></form>
          <div class="review-status" role="status"></div><div class="review-results"></div>
          <div class="review-footer"><small>Metadata from TMDB. You can skip and still upload and play the video.</small><div><button class="button secondary review-skip">Skip matching</button><button class="button primary review-confirm" disabled>Confirm match</button></div></div>`;
        const query = dialog.querySelector('.review-query'), year = dialog.querySelector('.review-year');
        const status = dialog.querySelector('.review-status'), list = dialog.querySelector('.review-results');
        const confirm = dialog.querySelector('.review-confirm');
        const finish = value => { generation++; dialog.close(); resolve(value); };
        dialog.oncancel = event => { event.preventDefault(); finish(undefined); };
        dialog.querySelector('.review-close').onclick = () => finish(undefined);
        dialog.querySelector('.review-skip').onclick = () => finish(null);
        confirm.onclick = () => { if (selected) finish({ ...selected, device }); };
        async function search() {
          const current = ++generation;
          selected = null; confirm.disabled = true; confirm.textContent = 'Confirm match'; list.replaceChildren(); status.textContent = 'Finding title matches on your TV…';
          try {
            const response = await window.studio.searchTitles(query.value.trim(), type);
            if (current !== generation) return;
            device = response.device;
            results = response.results.filter(item => !year.value || item.year === year.value);
            status.textContent = results.length ? 'Choose the correct title, then confirm.' : 'No matches found. Try a different title or clear the year, or skip for now.';
            list.innerHTML = results.map((result, i) => `<button type="button" class="review-result" data-match="${i}" aria-pressed="false">${/^\/[A-Za-z0-9_-]+\.(jpg|png)$/.test(result.poster_path) ? `<img src="https://image.tmdb.org/t/p/w185${escape(result.poster_path)}" alt="">` : '<span class="review-no-art">No artwork</span>'}<span><strong>${escape(result.title)}</strong><small>${escape(result.year || 'Year unavailable')} · ${series ? 'TV show' : 'Film'}</small><span class="review-overview">${escape(result.overview || 'No description available.')}</span></span><span class="review-choice">Choose</span></button>`).join('');
            list.querySelectorAll('[data-match]').forEach(button => button.onclick = () => {
              selected = results[Number(button.dataset.match)];
              list.querySelectorAll('[data-match]').forEach(node => {
                const chosen = node === button;
                node.setAttribute('aria-pressed', String(chosen)); node.classList.toggle('selected', chosen);
                node.querySelector('.review-choice').textContent = chosen ? 'Selected' : 'Choose';
              });
              confirm.disabled = false; confirm.textContent = 'Confirm ' + selected.title;
            });
          } catch (error) {
            if (current === generation) status.textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') + ' You can retry or skip matching.';
          }
        }
        dialog.querySelector('form').onsubmit = event => { event.preventDefault(); search(); };
        dialog.showModal(); query.focus(); search();
      });
      if (match === undefined) return null;
      reviewed.push(match);
    }
    return inputs.map((input, index) => ({ ...input, match: reviewed[series ? 0 : index] }));
  } finally { reviewing = false; }
}
