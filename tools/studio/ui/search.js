import { $, escape, art, empty, duration, attempt, toast } from './shared.js';
import { reviewTitles } from './title-review.js';

export class Search {
  constructor(destination) {
    this.destination = destination; this.items = []; this.selected = new Set(); this.generation = 0;
    this.presence = new Map(); this.presenceGeneration = 0;
    $('#check-library').onclick = () => this.checkPresence();
    window.addEventListener('focus', () => { if (!$('#view-iplayer').classList.contains('hidden')) this.checkPresence(); });
    setInterval(() => { if (!$('#view-iplayer').classList.contains('hidden')) this.checkPresence(); }, 30000);
    $('#search-form').onsubmit = event => { event.preventDefault(); this.run(); };
    $('#refresh-search').onclick = () => this.run(true);
    $('#search-results').addEventListener('error', event => {
      if (event.target.tagName === 'IMG') event.target.replaceWith(Object.assign(document.createElement('span'), { className: 'artwork artwork-placeholder', textContent: 'BBC' }));
    }, true);
    this.initial();
  }
  initial() {
    $('#search-results').innerHTML = empty('Something worth searching for.', 'Find a favourite programme, choose the episodes you want, and let Studio take care of the rest.', 'search') +
      '<div class="suggestions"><button>Bluey</button><button>Ludwig</button><button>Postman Pat</button><button>David Attenborough</button></div>';
    $('#search-results').querySelectorAll('.suggestions button').forEach(button => button.onclick = () => { $('#search-input').value = button.textContent; this.run(); });
  }
  async run(refresh = false) {
    const query = $('#search-input').value.trim();
    if (!query) { $('#search-input').focus(); return; }
    const generation = ++this.generation;
    $('#search-button').disabled = true; $('#refresh-search').disabled = true;
    $('#search-summary').textContent = refresh ? 'Refreshing the BBC catalogue and searching…' : 'Searching BBC iPlayer…';
    const result = await attempt(() => window.studio.search(query, refresh));
    if (generation !== this.generation) return;
    $('#search-button').disabled = false; $('#refresh-search').disabled = false;
    if (!result) { $('#search-summary').textContent = 'Search could not finish. Your queue is unaffected.'; return; }
    this.items = result.items; this.presence.clear(); this.selected.clear(); this.destination.setCount(0);
    this.render(result.truncated);
    await this.checkPresence();
  }
  async checkPresence() {
    if (!this.items.length) return;
    const generation = ++this.presenceGeneration, searchGeneration = this.generation;
    this.presence.clear(); this.render();
    $('#library-check-status').textContent = 'Checking files currently on MabelTV…';
    try {
      const result = await window.studio.libraryPresence(this.items);
      if (generation !== this.presenceGeneration || searchGeneration !== this.generation) return;
      this.presence = new Map(result.items.map(item => [item.pid, item.locations])); this.render();
      $('#library-check-status').textContent = 'Checked the current TV library · ' + new Date(result.checkedAt * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch {
      if (generation !== this.presenceGeneration || searchGeneration !== this.generation) return;
      this.presence.clear(); this.render(); $('#library-check-status').textContent = 'TV library could not be checked. Presence is unknown; reconnect and check again.';
    }
  }
  libraryChanged(jobs) {
    const completed = jobs.filter(job => job.status === 'complete').map(job => job.id).join(',');
    if (this.completed !== completed) { this.completed = completed; if (!$('#view-iplayer').classList.contains('hidden')) this.checkPresence(); }
  }
  render(truncated = false) {
    $('#search-summary').innerHTML = `<span>${this.items.length} episode${this.items.length === 1 ? '' : 's'} found${truncated ? ' · refine your search for more' : ''}</span><span>${this.selected.size} selected</span>`;
    if (!this.items.length) { $('#search-results').innerHTML = empty('No recent broadcasts found.', 'Try another programme name, refresh the catalogue, or paste a BBC iPlayer episode link.', 'search'); return; }
    const groups = new Map();
    for (const item of this.items) { if (!groups.has(item.title)) groups.set(item.title, []); groups.get(item.title).push(item); }
    $('#search-results').innerHTML = Array.from(groups.entries()).map(([title, items]) => `<div class="show-group"><div class="show-heading"><h2>${escape(title)}<small>${items.length} episode${items.length === 1 ? '' : 's'}</small></h2><button class="text-button select-group" data-group="${escape(title)}">${items.every(item => this.selected.has(item.pid)) ? 'Deselect' : 'Select all'}</button></div>${items.map(item => this.card(item)).join('')}</div>`).join('');
    $('#search-results').querySelectorAll('[data-pid]').forEach(input => input.onchange = () => {
      if (input.checked) this.selected.add(input.dataset.pid); else this.selected.delete(input.dataset.pid);
      input.closest('.episode-card').classList.toggle('selected', input.checked);
      $('#search-summary').lastElementChild.textContent = this.selected.size + ' selected';
      this.destination.suggest(this.items.find(item => item.pid === input.dataset.pid));
      this.destination.setCount(this.selected.size);
    });
    $('#search-results').querySelectorAll('.select-group').forEach(button => button.onclick = () => {
      const items = groups.get(button.dataset.group), all = items.every(item => this.selected.has(item.pid));
      items.forEach(item => all ? this.selected.delete(item.pid) : this.selected.add(item.pid));
      this.destination.suggest(items[0]); this.destination.setCount(this.selected.size); this.render();
    });
    $('#search-results').querySelectorAll('.details-button').forEach(button => button.onclick = () => attempt(async () => {
      button.disabled = true; button.textContent = 'Loading…';
      try {
        const metadata = await window.studio.metadata(button.dataset.details);
        const index = this.items.findIndex(item => item.pid === metadata.pid);
        this.items[index] = { ...this.items[index], ...metadata }; this.render(); await this.checkPresence();
        toast('Programme details updated.');
      } finally { button.disabled = false; }
    }));
  }
  card(item) {
    let date = '';
    if (item.broadcast && Number.isFinite(Date.parse(item.broadcast))) date = new Date(item.broadcast).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const locations = this.presence.get(item.pid), label = locations?.length ? 'Already on MabelTV' : locations ? 'Not on MabelTV' : 'TV presence not checked';
    const detail = locations?.length ? locations.map(location => location.label + ' · ' + location.matchedBy).join('; ') : '';
    return `<div class="episode-card ${this.selected.has(item.pid) ? 'selected' : ''}"><input type="checkbox" data-pid="${escape(item.pid)}" aria-label="Select ${escape(item.title + ' ' + item.episode)}" ${this.selected.has(item.pid) ? 'checked' : ''}>${art(item)}<div class="episode-copy"><strong>${escape(item.episode || item.title)}</strong><div class="episode-meta">${[item.channel, duration(item.duration), date].filter(Boolean).map(value => `<span>${escape(value)}</span>`).join('')}</div><p>${escape(item.synopsis)}</p><span class="presence-badge ${locations?.length ? 'present' : ''}" title="${escape(detail)}">${label}</span>${locations?.length ? `<span class="presence-location">${escape([...new Set(locations.map(location => location.label))].join(', '))}</span>` : ''}</div><button class="details-button" data-details="${escape(item.pid)}" title="Fetch full BBC programme metadata">Details</button></div>`;
  }
  async submit(destination) {
    const selected = this.items.filter(item => this.selected.has(item.pid));
    const inputs = await reviewTitles(selected.map(metadata => ({ kind: 'iplayer', metadata })), destination);
    if (!inputs) return;
    const result = await window.studio.add(inputs, destination);
    this.selected.clear(); this.destination.setCount(0); this.render();
    toast(result.length ? `${result.length} episode${result.length === 1 ? '' : 's'} added to your queue.` : 'These episodes are already in your queue for this destination.');
    window.showStudioView('queue');
  }
}
