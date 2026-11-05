import { $, escape, attempt, toast, empty } from './shared.js';
import { artwork, bytes, loading } from './library-common.js';

export class CloudLibrary {
  constructor(send) {
    this.send = send; this.items = []; this.selected = new Set(); this.generation = 0;
    $('#cloud-search-form').onsubmit = event => { event.preventDefault(); this.load(); };
    $('#cloud-clear').onclick = () => { $('#cloud-query').value = ''; this.load(); $('#cloud-query').focus(); };
    $('#cloud-query').oninput = () => { $('#cloud-clear').hidden = !$('#cloud-query').value; if (!$('#cloud-query').value) this.load(); };
    for (const id of ['cloud-category','cloud-sort']) $('#' + id).onchange = () => this.load();
    $('#cloud-reload').onclick = () => this.load();
    $('#cloud-more').onclick = () => this.load(true);
    $('#cloud-select').onclick = () => { this.selecting = !this.selecting; if (!this.selecting) this.selected.clear(); this.render(); };
    $('#cloud-send-selection').onclick = () => attempt(() => this.open(this.items.filter(item => this.selected.has(item.id))));
  }
  enter() { if (!this.loaded || Date.now() - this.loaded > 60000) this.load(); }
  async load(more = false, preserveSelection = false) {
    const generation = ++this.generation;
    this.loading = true;
    $('#cloud-clear').hidden = !$('#cloud-query').value;
    $('#cloud-status').textContent = 'Loading library…'; $('#cloud-grid').setAttribute('aria-busy','true');
    if (!this.items.length) $('#cloud-grid').innerHTML = loading('Loading iCloud library…');
    $('#cloud-more').disabled = true;
    try {
      const data = await window.studio.libraryRead('cloud', { q: $('#cloud-query').value.trim(), category: $('#cloud-category').value, sort: $('#cloud-sort').value, offset: more ? this.items.length : 0 });
      if (generation !== this.generation) return;
      this.items = more ? [...this.items, ...data.items] : data.items;
      this.data = data; this.loaded = Date.now();
      if (!more && !preserveSelection) this.selected.clear();
      this.render();
    } catch (error) {
      if (generation !== this.generation) return;
      $('#cloud-status').textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      if (!this.items.length) $('#cloud-grid').innerHTML = empty('Library unavailable', 'Reconnect in Settings, then reload the library.', 'cloud');
    } finally { if (generation === this.generation) { this.loading = false; $('#cloud-grid').setAttribute('aria-busy','false'); $('#cloud-more').disabled = false; } }
  }
  status(data) {
    if ($('#view-cloud').classList.contains('hidden')) return;
    const latest = [...(data.cloudOperations || [])].sort((a,b) => b.created-a.created)[0];
    if (latest) {
      $('#cloud-operation-status').textContent = latest.status === 'complete' ? 'Deleted from iCloud.' : latest.status === 'failed' ? latest.error : `Deleting from iCloud · ${latest.completed || 0}/${latest.items.length}`;
      const stamp = latest.id + ':' + latest.status;
      if (stamp !== this.operationVersion && latest.status === 'complete') { this.loaded = 0; }
      this.operationVersion = stamp;
    }
    const revision = value => JSON.stringify([value?.checked,value?.metadataRevision,value?.collectionRevision]);
    if (!this.loading && this.data && (!this.loaded || data.cloud?.checked && revision(data.cloud) !== revision(this.data))) void this.load(false,true);
  }
  render() {
    const root = $('#cloud-grid'), rows = new Map([...root.querySelectorAll('[data-cloud-item]')].map(node => [node.dataset.cloudItem,node]));
    root.querySelectorAll('.empty-state,.library-loading').forEach(node => node.remove());
    this.items.forEach((item,index) => {
      let row = rows.get(item.id); const metadata = item.metadata || {}, name = metadata.title || item.title || item.name;
      const version = JSON.stringify([metadata, item.bytes, item.versions]);
      if (!row) { row = document.createElement('button'); row.type = 'button'; row.className = 'library-card'; row.dataset.cloudItem = item.id; }
      if (row.dataset.version !== version) {
        const oldImage = row.querySelector('img');
        row.innerHTML = `${artwork(item)}<span class="library-card-choice" aria-hidden="true"></span><strong>${escape(name)}</strong><small>${escape([metadata.year || item.year, item.kind === 'series' ? `${item.episode_count} episodes` : '', bytes((item.versions || [item]).reduce((sum,file) => sum + file.bytes,0))].filter(Boolean).join(' · '))}</small>`;
        const image = row.querySelector('img'); if (oldImage && image?.getAttribute('src') === oldImage.getAttribute('src')) image.replaceWith(oldImage);
        row.dataset.version = version;
      }
      row.setAttribute('aria-label',name); row.classList.toggle('selecting',Boolean(this.selecting)); row.classList.toggle('selected',this.selected.has(item.id));
      row.setAttribute('aria-pressed',String(this.selected.has(item.id)));
      row.onclick = () => {
        if (this.selecting) { this.selected.has(item.id) ? this.selected.delete(item.id) : this.selected.add(item.id); this.render(); }
        else attempt(async () => { row.disabled = true; row.setAttribute('aria-busy','true'); try { await this.open([item]); } finally { row.disabled = false; row.setAttribute('aria-busy','false'); } });
      };
      if (root.children[index] !== row) root.insertBefore(row,root.children[index] || null);
      rows.delete(item.id);
    });
    rows.forEach(row => row.remove());
    if (!this.items.length) root.innerHTML = empty(this.data?.configured ? 'No matching titles' : 'iCloud is not connected', this.data?.configured ? 'Try another title or library section.' : 'The iCloud catalogue is not available yet.', 'cloud');
    $('#cloud-status').textContent = this.data?.error || `${this.items.length} of ${this.data?.total || 0} titles${this.data?.scanning ? ' · refreshing' : ''}`;
    $('#cloud-more').classList.toggle('hidden',this.items.length >= (this.data?.total || 0));
    $('#cloud-select').textContent = this.selecting ? 'Done' : 'Select';
    $('#cloud-selection').classList.toggle('hidden',!this.selected.size);
    $('#cloud-selection-count').textContent = this.selected.size + ' selected';
  }
  async open(items) {
    if (!items.length) return;
    const groups = await Promise.all(items.map(async item => item.kind === 'series' ? (await window.studio.libraryRead('cloud',{series:item.id})).items : [item]));
    const files = groups.flatMap(group => group); // A grouped film/episode's preferred version is the send source.
    if (files.length > 100) { toast('Choose a season or up to 100 episodes.',true); }
    this.send.open({ type:'cloud', item:items.length === 1 ? items[0] : {title:items.length + ' selected titles'}, items, files, title:items[0].title || items[0].name });
  }
}
