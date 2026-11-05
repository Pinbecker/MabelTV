import { $, escape, icon, attempt, toast } from './shared.js';
import { artwork, bytes, wireDialog, confirmAction, loading } from './library-common.js';
import { reviewTitles } from './title-review.js';

export class CloudTools {
  constructor(refresh) {
    this.refresh = refresh; this.revision = 0;
    this.settings = document.createElement('dialog'); this.settings.id = 'cloud-item-settings'; this.settings.className = 'library-settings';
    this.settings.innerHTML = `<div class="section-heading"><h2>iCloud settings</h2><button class="icon-button" data-close aria-label="Close settings">×</button></div><div id="cloud-settings-title"></div><div class="library-setting-actions"><button data-cloud-action="optimise">${icon('cloud')}<span>Optimise iCloud copy</span></button><button data-cloud-action="match">${icon('search')}<span>Change title match</span></button><button data-cloud-action="original" disabled>${icon('download')}<span>Download original</span></button><button data-cloud-action="delete" class="danger-text">${icon('folder')}<span>Delete from iCloud</span></button></div><p id="cloud-original-status"></p>`;
    document.body.append(this.settings); wireDialog(this.settings, () => this.back());
    const error = document.createElement('p'); error.id = 'cloud-settings-error'; error.setAttribute('role','alert'); this.settings.append(error);
    this.settings.querySelectorAll('[data-cloud-action]').forEach(button => button.onclick = async () => {
      error.textContent = ''; button.disabled = true;
      try { await this[button.dataset.cloudAction](); }
      catch (failure) { error.textContent = failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
      finally { button.disabled = false; }
    });
    this.preview = document.createElement('dialog'); this.preview.id = 'cloud-optimise'; this.preview.className = 'library-optimise';
    this.preview.innerHTML = `<div class="section-heading"><div><span class="eyebrow">ICLOUD LIBRARY</span><h2>Optimise iCloud copy</h2></div><button class="icon-button" data-close aria-label="Close optimisation">×</button></div><div id="cloud-optimise-title"></div><label>Video quality<select id="cloud-optimise-profile"></select></label><div id="cloud-optimise-sizes"></div><p>The original is replaced after the smaller upload is verified.</p><p id="cloud-optimise-error" role="alert"></p><div class="library-confirm-actions"><button class="button secondary" id="cloud-optimise-cancel">Cancel</button><button class="button primary" id="cloud-optimise-start" disabled>Optimise and replace</button></div>`;
    document.body.append(this.preview); wireDialog(this.preview, () => this.backToSettings());
    $('#cloud-optimise-cancel').onclick = () => this.backToSettings();
    $('#cloud-optimise-profile').onchange = () => this.loadPreview();
    $('#cloud-optimise-start').onclick = () => attempt(() => this.start());
  }
  async open(send) {
    this.send = send; this.originalInfo = null; const revision = ++this.revision;
    send.dialog.close();
    const item = send.context.item, name = item?.metadata?.title || item?.title || send.context.title;
    $('#cloud-settings-title').textContent = name;
    $('#cloud-settings-error').textContent = '';
    this.settings.querySelector('[data-cloud-action="match"]').disabled = send.context.items.length !== 1;
    const button = this.settings.querySelector('[data-cloud-action="original"]'); button.disabled = true;
    $('#cloud-original-status').textContent = 'Reading original source…'; this.settings.showModal();
    try {
      const info = await window.studio.libraryRead('originals',{ids:send.chosen().map(file => file.id)});
      if (revision !== this.revision) return;
      this.originalInfo = info.available ? info : null; button.disabled = !info.available;
      $('#cloud-original-status').textContent = info.available ? '' : info.reason || 'No recorded original source.';
    } catch { if (revision === this.revision) $('#cloud-original-status').textContent = 'Original source unavailable.'; }
  }
  back() { this.revision++; this.settings.close(); this.send.dialog.showModal(); }
  backToSettings() { this.revision++; this.preview.close(); void this.open(this.send); }
  async optimise() {
    this.settings.close();
    const item = this.send.context.item;
    $('#cloud-optimise-title').innerHTML = `${artwork(item)}<div><h2>${escape(item?.metadata?.title || item?.title || this.send.context.title)}</h2><p>${escape(item?.metadata?.overview || '')}</p></div>`;
    $('#cloud-optimise-profile').innerHTML = this.send.catalogue().compressionProfiles.map(profile => `<option value="${profile.id}" ${profile.id === 'compact' ? 'selected' : ''}>${escape(profile.label)}</option>`).join('');
    this.preview.showModal(); await this.loadPreview();
  }
  async loadPreview() {
    const revision = ++this.revision; this.result = null; $('#cloud-optimise-start').disabled = true;
    $('#cloud-optimise-error').textContent = ''; $('#cloud-optimise-sizes').innerHTML = loading('Calculating size…');
    try {
      const result = await window.studio.libraryRead('preview',{ids:this.send.chosen().map(file => file.id),compression:$('#cloud-optimise-profile').value});
      if (revision !== this.revision) return;
      this.result = result;
      const current = result.files.reduce((sum,file) => sum + file.bytes,0);
      const estimated = result.files.every(file => Number.isFinite(file.estimatedBytes) && file.estimatedBytes <= file.bytes) ? result.files.reduce((sum,file) => sum + file.estimatedBytes,0) : null;
      $('#cloud-optimise-sizes').innerHTML = `<div class="library-size-pair"><div><small>Current copy</small><strong>${bytes(current)}</strong></div><div><small>Estimated copy</small><strong>${estimated === null ? 'Pending' : '≈ ' + bytes(estimated)}</strong></div></div>${estimated === null ? '' : `<div class="library-savings"><span>Estimated saving</span><strong>${bytes(current-estimated)}</strong></div>`}`;
      $('#cloud-optimise-start').disabled = false;
    } catch (error) { if (revision === this.revision) { $('#cloud-optimise-sizes').replaceChildren(); $('#cloud-optimise-error').textContent = error.message; } }
  }
  async start() {
    if (!this.result) return;
    const risky = this.result.files.some(file => file.risky);
    if (risky && !await confirmAction('Compress this copy again?','This copy is already heavily compressed. Further compression may reduce picture quality.','Compress anyway')) return;
    const button = $('#cloud-optimise-start'); button.disabled = true;
    try {
      await window.studio.libraryWrite('optimise',{files:this.result.files,compression:this.result.compression,allowRisk:risky,confirmed:true});
      this.preview.close(); this.revision++; toast('Optimisation started. Progress is in Activity.'); window.showStudioView('queue'); await window.refreshStudio();
    } catch (error) { $('#cloud-optimise-error').textContent = error.message; }
    finally { button.disabled = false; }
  }
  async match() {
    const item = this.send.context.items[0], series = item.kind === 'series';
    this.settings.close();
    try {
      const reviewed = await reviewTitles([{ metadata:{title:item.metadata?.title || item.title || item.name} }], {kind:series ? 'series' : 'film',label:'My TV · ' + (item.title || item.name)});
      if (reviewed?.[0]?.match) { await window.studio.libraryWrite('match',{id:item.id,match:reviewed[0].match}); toast('Title match updated.'); this.refresh(); }
    } finally { this.settings.showModal(); }
  }
  async original() {
    if (!this.originalInfo) return;
    const {item,title} = this.send.context, files = this.originalInfo.items;
    this.settings.close(); this.revision++;
    this.send.open({type:'original',item,title,files});
  }
  async delete() {
    const chosen = this.send.chosen(), files = chosen.flatMap(file => file.versions || [file]);
    if (!await confirmAction('Delete from iCloud?',`${files.length} selected file${files.length === 1 ? '' : 's'} will be deleted from iCloud and synced devices. Separate TV copies are kept.`, 'Delete from iCloud',true)) return;
    await window.studio.libraryWrite('delete',{items:files,confirmed:true});
    this.settings.close(); this.revision++; toast('Deletion queued.'); this.refresh();
  }
}
