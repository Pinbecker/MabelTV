import { escape } from './shared.js';
import { wireDialog, loading } from './library-common.js';

export async function openSubtitles(source, title) {
  const dialog = document.createElement('dialog'); dialog.className = 'library-settings subtitle-dialog';
  dialog.innerHTML = `<div class="section-heading"><h2>Subtitles</h2><button data-close class="icon-button" aria-label="Close subtitles">×</button></div><h3>${escape(title)}</h3><div data-tracks></div><p data-message role="status">Loading…</p><form><label>Find subtitles<input type="search" value="${escape(title)}" placeholder="Title or release"></label><button class="button secondary" type="submit">Find subtitles</button></form><div data-results></div>`;
  document.body.append(dialog); wireDialog(dialog, () => { dialog.close(); dialog.remove(); }); dialog.showModal();
  const call = (action, value = {}) => window.studio.libraryWrite('subtitles', {action, source, ...value});
  const message = text => { dialog.querySelector('[data-message]').textContent = text; };
  const render = response => {
    const root = dialog.querySelector('[data-tracks]');
    root.innerHTML = [{id:'off',label:'Off'},...response.tracks].map(track => `<label class="library-file"><input type="radio" name="subtitle-choice" value="${escape(track.id)}" ${response.selected === track.id ? 'checked' : ''}><span>${escape(track.label)}</span></label>`).join('');
    root.querySelectorAll('input').forEach(input => input.onchange = async () => {
      root.querySelectorAll('input').forEach(item => {item.disabled=true;});
      try { await call('select', {track:input.value,fingerprint:response.fingerprint}); response.selected=input.value; message('Saved. Applies when this copy is next opened.'); }
      catch (error) { message(error.message); render(response); }
      finally { root.querySelectorAll('input').forEach(item => {item.disabled=false;}); }
    });
  };
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const root = dialog.querySelector('[data-results]'); root.innerHTML = loading('Finding subtitles…');
    try {
      const response = await call('search', {query:dialog.querySelector('[type=search]').value}); root.replaceChildren();
      if (!response.results.length) root.textContent = 'No matching subtitles found.';
      for (const item of response.results) {
        const button = document.createElement('button'); button.className = 'subtitle-result';
        button.innerHTML = `<strong>${escape(item.label)}</strong><small>${escape([item.fps ? item.fps + ' fps' : '',item.hearingImpaired ? 'Includes sound descriptions' : '', 'Download and use'].filter(Boolean).join(' · '))}</small>`;
        button.onclick = async () => { button.disabled = true; try { render(await call('download',{id:item.id})); message('Saved. Reopen this copy to try these subtitles.'); } catch(error){ message(error.message); } finally { button.disabled=false; } };
        root.append(button);
      }
    } catch(error) { root.replaceChildren(); message(error.message); }
  };
  try { const response = await call('tracks'); render(response); message('Changes apply the next time this copy is opened.'); dialog.querySelector('form button').disabled = !response.configured; }
  catch(error) { message(error.message); }
}
