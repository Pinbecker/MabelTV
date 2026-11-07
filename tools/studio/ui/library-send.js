import { $, escape, icon, attempt, toast } from './shared.js';
import { Destination } from './destination.js';
import { bytes, title, artwork, wireDialog, confirmAction } from './library-common.js';
import { loadPresence } from './library-versions.js';

export class LibrarySend {
  constructor(catalogue, tools) {
    this.catalogue = catalogue; this.tools = tools; this.selected = new Set();
    this.dialog = document.createElement('dialog'); this.dialog.id = 'library-send'; this.dialog.className = 'library-dialog';
    this.dialog.setAttribute('aria-labelledby', 'library-send-title');
    this.dialog.innerHTML = `<header class="library-dialog-header"><div id="library-send-hero"></div><div class="library-header-actions"><button class="icon-button" id="library-item-settings" aria-label="Media settings">${icon('settings')}</button><button class="icon-button" data-close aria-label="Close media">×</button></div></header><div class="library-send-grid"><section class="library-file-panel"><div class="list-heading"><span id="library-file-count"></span><button class="text-button" id="library-select-all">Select all</button></div><label id="library-season-field" class="hidden">Season<select id="library-season"></select></label><div id="library-send-files"></div><label id="library-recovery-field" class="hidden">Existing version<select id="library-recovery-mode"><option value="alongside">Keep alongside</option><option value="replace">Replace existing</option></select></label><p id="library-send-note"></p><p id="library-send-error" role="alert"></p></section><aside class="destination-panel" id="library-destination"></aside></div>`;
    document.body.append(this.dialog); wireDialog(this.dialog, () => this.dialog.close());
    const presence = document.createElement('div'); presence.className = 'library-presence'; this.dialog.querySelector('.library-file-panel').append(presence);
    $('#library-select-all').onclick = () => { const visible = this.visible(); const all = visible.every(file => this.selected.has(file.key)); visible.forEach(file => all ? this.selected.delete(file.key) : this.selected.add(file.key)); this.renderFiles(); };
    $('#library-season').onchange = () => this.renderFiles();
    $('#library-item-settings').onclick = () => this.tools(this);
  }
  open(context) {
    this.context = context;
    this.files = context.files.map((file, index) => ({ ...file, key: String(file.id ?? file.index ?? index) }));
    this.selected = new Set(context.type === 'torrent' && this.files.length > 1 || this.files.length > 100 ? [] : this.files.map(file => file.key));
    const metadata = context.item?.metadata || {}, name = metadata.title || context.item?.title || context.title;
    $('#library-send-hero').innerHTML = `${artwork(context.item)}<div><span class="eyebrow">${context.type === 'cloud' ? 'ICLOUD LIBRARY' : context.type === 'original' ? 'DOWNLOAD ORIGINAL' : 'FIND ANYTHING'}</span><h2 id="library-send-title">${escape(name)}</h2><p>${escape([metadata.year || context.item?.year, bytes(this.files.reduce((sum,file) => sum + file.bytes,0))].filter(Boolean).join(' · '))}</p></div>`;
    const seasons = [...new Set(this.files.map(file => file.series).filter(Number.isInteger))].sort((a,b) => a-b);
    $('#library-season-field').classList.toggle('hidden', seasons.length < 2);
    $('#library-season').innerHTML = '<option value="all">All seasons</option>' + seasons.map(season => `<option value="${season}">${season === 0 ? 'Specials' : 'Season ' + season}</option>`).join('');
    $('#library-recovery-field').classList.toggle('hidden', context.type !== 'original');
    $('#library-recovery-mode').value = 'alongside';
    $('#library-item-settings').classList.toggle('hidden', context.type !== 'cloud');
    $('#library-send-error').textContent = '';
    $('#library-send-note').textContent = context.type === 'original' ? 'TV copies receive the compatibility pass. iCloud keeps the original.' : '';
    this.destination = new Destination('#library-destination', { remote: context.type, catalogue: this.catalogue, submit: async value => {
      try { await this.submit(value); }
      catch (error) {
        const output = $('#library-send-error'); output.textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
        output.parentElement.prepend(output); output.parentElement.scrollTop = 0;
      }
    } });
    Object.assign(this.destination.state, { target: 'mytv', type: context.item?.kind === 'series' || seasons.length ? 'series' : 'film',
      cloudCopies: context.type === 'cloud' || context.type === 'original' ? 'original' : 'optimised', compression: 'compatible' });
    this.destination.suggest({ title: name, series: seasons[0] });
    this.destination.render(); this.renderFiles();
    if (!this.dialog.open) this.dialog.showModal();
    void loadPresence(this);
  }
  visible() { const season = $('#library-season').value; return this.files.filter(file => season === 'all' || String(file.series) === season); }
  chosen() { return this.files.filter(file => this.selected.has(file.key)); }
  renderFiles() {
    const root = $('#library-send-files'); root.innerHTML = this.visible().map(file => `<label class="library-file"><input type="checkbox" data-file="${escape(file.key)}" ${this.selected.has(file.key) ? 'checked' : ''}><span><strong>${escape(file.episodeNumber ? `S${String(file.series || 0).padStart(2,'0')}E${String(file.episodeNumber).padStart(2,'0')} · ${title(file.name || file.path?.split('/').pop() || this.context.title)}` : title(file.name || file.path?.split('/').pop() || this.context.title))}</strong><small>${escape([file.versionLabel || (file.variants || []).join(', '), bytes(file.bytes)].filter(Boolean).join(' · '))}</small></span></label>`).join('');
    root.querySelectorAll('[data-file]').forEach(input => input.onchange = () => { input.checked ? this.selected.add(input.dataset.file) : this.selected.delete(input.dataset.file); this.count(); });
    for (const file of this.visible().filter(file => file.versions?.length > 1)) {
      const select = document.createElement('select'); select.setAttribute('aria-label','iCloud version');
      for (const version of file.versions) select.add(new Option(`${bytes(version.bytes)} · ${version.name || version.path}`,version.id));
      select.value = file.id;
      select.onchange = () => { const version = file.versions.find(value => value.id === select.value); Object.assign(file,{id:version.id,name:version.name,path:version.path,bytes:version.bytes,modified:version.modified,remoteId:version.remoteId}); delete file.existingCopy; this.count(); void loadPresence(this); };
      root.querySelector(`[data-file="${file.key}"]`).closest('label').after(select);
    }
    this.count();
  }
  count() {
    const chosen = this.chosen();
    $('#library-file-count').textContent = `${chosen.length} selected · ${bytes(chosen.reduce((sum,file) => sum + file.bytes,0))}${this.visible().length !== this.files.length ? ` · ${this.visible().length} shown` : ''}`;
    this.destination.sourceBytes = chosen.reduce((sum,file) => sum + file.bytes,0);
    this.destination.setCount(chosen.length);
    const estimate = $('#library-destination .compression-estimate');
    if (estimate && this.destination.state.compression !== 'compatible') {
      const fraction = this.catalogue().compressionProfiles.find(profile => profile.id === this.destination.state.compression)?.sourceFraction || .4;
      estimate.textContent = 'Estimated copy · ' + bytes(this.destination.sourceBytes * fraction * .98);
    }
  }
  async submit(destination) {
    const files = this.chosen(), context = this.context;
    if (!this.presenceReady) throw new Error('Wait for the Pi copy check, or retry it.');
    if (!files.length || files.length > 100 && context.type !== 'torrent') throw new Error('Choose between 1 and 100 files.');
    if (context.type === 'cloud' && files.every(file => file.existingCopy?.mode === 'keep')) { this.dialog.close(); toast('Existing TV copies kept.'); return; }
    destination.preserveSeasons = new Set(files.map(file => file.series).filter(Number.isInteger)).size > 1;
    const replaceCloudOriginal = context.type === 'cloud' && destination.cloudCopies === 'optimised';
    if (replaceCloudOriginal && !await confirmAction('Replace the iCloud copy?', 'The smaller verified copy will replace the selected original in iCloud. Choose Both to keep both versions.', 'Replace after verification')) return;
    if (context.type === 'original') {
      const mode = $('#library-recovery-mode').value;
      if (mode === 'replace' && !await confirmAction('Replace the existing copy?', 'The current copy stays until the new version is verified.', 'Download and replace')) return;
      await window.studio.libraryWrite('recover', { ids: files.map(file => file.deliveryId), destination, mode, confirmed: mode === 'replace' });
    } else {
      if (files.some(file => file.existingCopy?.mode === 'replace') && !await confirmAction('Replace the selected TV copy?','The existing copy stays until the new one is verified.','Replace copy')) return;
      const sources = context.type === 'torrent' ? [{ type: 'torrent', request: context.request, files: files.map(file => file.index) }] : files.map(file => ({ type: 'cloud', id: file.id, bytes: file.bytes, modified: file.modified || '', remoteId: file.remoteId || '',existingCopy:file.existingCopy }));
      await window.studio.libraryWrite('submit', { sources, destination, replaceCloudOriginal });
    }
    this.dialog.close(); toast('Started. Progress is in Activity.');
    window.showStudioView('queue'); await window.refreshStudio();
  }
}
