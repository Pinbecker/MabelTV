import { escape } from './shared.js';
import { bytes, wireDialog } from './library-common.js';

export async function chooseDeleteFiles(files) {
  files = [...new Map(files.map(file => [file.id, file])).values()];
  const dialog = document.createElement('dialog'); dialog.className = 'library-settings';
  dialog.innerHTML = `<div class="section-heading"><h2>Delete from iCloud</h2><button data-close class="icon-button" aria-label="Close">×</button></div><p>Choose the files to delete. Other versions and TV copies stay.</p><div class="version-files">${files.map(file => `<label class="library-file"><input type="checkbox" value="${escape(file.id)}" ${files.length === 1 ? 'checked' : ''}><span><strong>${escape(file.name || file.path)}</strong><small>${bytes(file.bytes)}</small></span></label>`).join('')}</div><div class="library-confirm-actions"><button class="button secondary" data-cancel>Cancel</button><button class="button danger" data-confirm ${files.length === 1 ? '' : 'disabled'}>Delete selected</button></div>`;
  document.body.append(dialog);
  return new Promise(resolve => {
    const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
    wireDialog(dialog, () => finish([])); dialog.querySelector('[data-cancel]').onclick = () => finish([]);
    dialog.onchange = () => { dialog.querySelector('[data-confirm]').disabled = !dialog.querySelector('input:checked'); };
    dialog.querySelector('[data-confirm]').onclick = () => { const ids = new Set([...dialog.querySelectorAll('input:checked')].map(input => input.value)); finish(files.filter(file => ids.has(file.id))); };
    dialog.showModal();
  });
}

export async function loadPresence(send) {
  const revision = send.presenceRevision = (send.presenceRevision || 0) + 1;
  send.presenceReady = send.context.type !== 'cloud';
  const root = send.dialog.querySelector('.library-presence'); root.replaceChildren();
  if (send.presenceReady) return;
  const context = send.context;
  root.textContent = 'Checking copies on your Pi…';
  try {
    const response = await window.studio.libraryRead('presence', { ids: send.files.map(file => file.id) });
    if (send.context !== context || send.presenceRevision !== revision) return;
    root.replaceChildren();
    for (const file of send.files) delete file.existingCopy;
    for (const item of response.items) {
      if (!item.copies.length) continue;
      const file = send.files.find(file => file.id === item.id), section = document.createElement('div');
      section.className = 'library-version';
      section.innerHTML = `<strong>Already on your Pi · ${escape(file.name || file.path)}</strong><label>Existing copy<select data-copy>${item.copies.map(copy => `<option value="${escape(copy.key)}">${escape(copy.location)} · ${bytes(copy.bytes)} · ${escape(copy.name)}</option>`).join('')}</select></label><label>Action<select data-mode><option value="keep">Keep existing — no transfer</option><option value="replace">Replace this copy</option><option value="alongside">Keep both copies</option></select></label>`;
      const sync = () => { const copy = item.copies.find(copy => copy.key === section.querySelector('[data-copy]').value); file.existingCopy = {key:copy.key,fingerprint:copy.fingerprint,mode:section.querySelector('[data-mode]').value}; };
      section.onchange = sync; sync(); root.append(section);
    }
    send.presenceReady = true;
  } catch (error) {
    if (send.context !== context || send.presenceRevision !== revision) return;
    root.textContent = 'Could not check Pi copies. ';
    const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.onclick = () => loadPresence(send); root.append(retry);
  }
}
