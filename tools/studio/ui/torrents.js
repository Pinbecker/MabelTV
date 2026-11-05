import { $, escape, empty, attempt, icon } from './shared.js';
import { bytes, title, loading, requestResult } from './library-common.js';

export class Torrents {
  constructor(send) {
    this.send = send; this.generation = 0;
    $('#torrent-form').onsubmit = event => { event.preventDefault(); attempt(() => this.search()); };
    $('#torrent-query').oninput = () => { $('#torrent-clear').hidden = !$('#torrent-query').value; if (!$('#torrent-query').value) this.clear(); };
    $('#torrent-clear').onclick = () => { $('#torrent-query').value = ''; this.clear(); $('#torrent-query').focus(); };
    this.clear();
  }
  clear() {
    this.generation++; this.request = null; $('#torrent-clear').hidden = true;
    $('#torrent-status').textContent = '';
    $('#torrent-results').removeAttribute('aria-busy');
    $('#torrent-results').innerHTML = empty('Find a film or series','Search by title, then choose your files.','search');
  }
  async search() {
    const query = $('#torrent-query').value.trim(); if (query.length < 2) return;
    const generation = ++this.generation;
    $('#torrent-clear').hidden = false; $('#torrent-status').textContent = '';
    $('#torrent-results').setAttribute('aria-busy','true'); $('#torrent-results').innerHTML = loading('Finding results…');
    try {
      const pending = await window.studio.libraryWrite('search',{query});
      const request = await requestResult(pending,() => generation === this.generation);
      if (!request) return;
      this.request = request;
      const items = request.result?.items || [];
      $('#torrent-status').textContent = items.length ? `${items.length} result${items.length === 1 ? '' : 's'}` : '';
      $('#torrent-results').innerHTML = items.length ? items.map((item,index) => `<button class="torrent-result" data-torrent="${index}"><span class="torrent-result-icon">${icon('film')}</span><span class="torrent-result-copy"><strong>${escape(title(item.title))}</strong><span>${escape(item.title)}</span></span><span class="torrent-result-facts"><strong>${bytes(item.bytes)}</strong><small>${Number(item.seeders)||0} seeders</small></span><span class="torrent-result-tail">›</span></button>`).join('') : empty('No results found','Try another title.','search');
      $('#torrent-results').querySelectorAll('[data-torrent]').forEach(button => button.onclick = () => attempt(() => this.inspect(items[Number(button.dataset.torrent)],button)));
    } catch (error) {
      if (generation === this.generation) { $('#torrent-results').innerHTML = empty('Search unavailable','Try again or check your connection in Settings.','search'); $('#torrent-status').textContent = error.message; }
    } finally { if (generation === this.generation) $('#torrent-results').setAttribute('aria-busy','false'); }
  }
  async inspect(item, button) {
    const generation = ++this.generation, request = this.request;
    const buttons = [...$('#torrent-results').querySelectorAll('[data-torrent]')]; buttons.forEach(node => node.disabled = true);
    button.setAttribute('aria-busy','true'); button.querySelector('.torrent-result-tail').innerHTML = '<span class="studio-spinner" aria-label="Loading file details"></span>';
    $('#torrent-status').textContent = 'Loading file details…';
    try {
      const pending = await window.studio.libraryWrite('inspect',{request:request.id,hash:item.hash});
      const inspection = await requestResult(pending,() => generation === this.generation);
      if (!inspection) return;
      const files = (inspection.result?.files || []).filter(file => /\.(mp4|mkv|m4v|mov|avi|webm|mpg|mpeg|ts)$/i.test(file.path));
      if (!files.length) throw new Error('No supported video files in this result. Choose another result.');
      const name = title(inspection.result.title || item.title);
      this.send.open({type:'torrent',request:inspection.id,title:name,item:{title:name},files});
      $('#torrent-status').textContent = `${request.result.items.length} result${request.result.items.length === 1 ? '' : 's'}`;
    } catch (error) { if (generation === this.generation) $('#torrent-status').textContent = error.message; }
    finally {
      buttons.forEach(node => node.disabled = false); button.setAttribute('aria-busy','false');
      button.querySelector('.torrent-result-tail').textContent = '›';
    }
  }
}
