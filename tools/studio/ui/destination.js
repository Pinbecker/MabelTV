import { $, escape, icon, toast, attempt } from './shared.js';

export class Destination {
  constructor(container, { search = false, submit, catalogue = () => ({ channels: [], series: [] }) }) {
    this.node = $(container); this.search = search; this.submit = submit; this.catalogue = catalogue;
    this.state = { target: 'mabel', channel: '', type: 'film', series: '', season: '', mode: 'send', create: false };
    this.count = 0; this.busy = false; this.render();
  }
  setCount(count) { this.count = count; this.updateButton(); }
  updateButton() {
    const button = this.node.querySelector('.submit-destination');
    button.disabled = !this.count || this.busy;
    const verb = this.search ? (this.state.mode === 'download' ? 'Download' : this.state.mode === 'local' ? 'Download and prepare' : 'Download, prepare and send')
      : this.state.mode === 'local' ? 'Prepare locally' : 'Prepare and send';
    button.textContent = this.busy ? 'Adding to queue…' : verb + (this.count ? ` · ${this.count}` : '');
  }
  value() {
    const state = this.state, catalogue = this.catalogue();
    let value = { kind: state.target === 'mabel' ? 'mabel' : state.type,
      profile: state.target === 'mabel' ? 'mabel' : 'mytv' };
    if (state.mode !== 'send') return { ...value, kind: 'local', downloadOnly: state.mode === 'download', label: 'Kept on this computer' };
    if (value.kind === 'mabel') {
      const channel = catalogue.channels.find(item => item.number === Number(state.channel));
      if (!channel) throw new Error('Choose a channel for Mabel TV. Connect in Settings to load your channels.');
      value = { ...value, channel: channel.number, label: `Mabel TV · ${channel.name}` };
    } else if (value.kind === 'series') {
      const series = catalogue.series.find(item => item.id === state.series);
      if (!series || !series.seasons.includes(Number(state.season))) throw new Error('Choose an existing show and series, or create a destination below.');
      value = { ...value, series: series.id, season: Number(state.season), label: `My TV · ${series.title} · Series ${state.season}` };
    } else value.label = 'My TV · Films';
    return value;
  }
  suggest(metadata) {
    if (!metadata || this.state.series) return;
    const base = metadata.title.replace(/:\s*Series\s*\d+.*$/i, '').trim().toLowerCase();
    const series = this.catalogue().series.find(item => item.title.toLowerCase() === base);
    if (series) { this.state.series = series.id; if (series.seasons.includes(metadata.series)) this.state.season = String(metadata.series); }
  }
  render() {
    const state = this.state, catalogue = this.catalogue();
    const series = catalogue.series.find(item => item.id === state.series);
    this.node.innerHTML = `<h2>Where is it going?</h2><p>One destination for your selection.</p>
      <div class="target-options"><button class="target-option ${state.target === 'mabel' ? 'selected' : ''}" data-target="mabel" aria-pressed="${state.target === 'mabel'}">${icon('tv')}Mabel TV</button><button class="target-option ${state.target === 'mytv' ? 'selected' : ''}" data-target="mytv" aria-pressed="${state.target === 'mytv'}">${icon('film')}My TV</button></div>
      <label>${this.search ? 'After downloading' : 'When ready'}<select data-field="mode"><option value="send" ${state.mode === 'send' ? 'selected' : ''}>Prepare and send to MabelTV</option><option value="local" ${state.mode === 'local' ? 'selected' : ''}>Prepare and keep locally</option>${this.search ? `<option value="download" ${state.mode === 'download' ? 'selected' : ''}>Download only</option>` : ''}</select></label>
      ${state.mode === 'send' ? state.target === 'mabel' ? `<label>Mabel TV channel<select data-field="channel"><option value="">Choose a channel</option>${catalogue.channels.map(channel => `<option value="${channel.number}" ${String(channel.number) === state.channel ? 'selected' : ''}>${channel.number} · ${escape(channel.name)}</option>`).join('')}</select></label>` : `<label>Library section<select data-field="type"><option value="film" ${state.type === 'film' ? 'selected' : ''}>Films</option><option value="series" ${state.type === 'series' ? 'selected' : ''}>TV series</option></select></label>${state.type === 'series' ? `<div class="series-fields"><label>Show<select data-field="series"><option value="">Choose a show</option>${catalogue.series.map(series => `<option value="${escape(series.id)}" ${series.id === state.series ? 'selected' : ''}>${escape(series.title)}</option>`).join('')}</select></label><label>Series number<select data-field="season"><option value="">Choose a series</option>${(series?.seasons || []).map(season => `<option value="${season}" ${String(season) === state.season ? 'selected' : ''}>Series ${season}</option>`).join('')}</select></label><button class="text-button create-toggle">${state.create ? 'Close destination creation' : '+ Create a show or series destination'}</button>${state.create ? `<div class="create-show"><label>Show name<input class="create-name" maxlength="120" placeholder="e.g. Ludwig" value="${escape(series?.title || '')}"></label><label>Series number<input class="create-season" type="number" min="1" max="99" value="1"></label><button class="button secondary create-button">Create destination</button></div>` : ''}</div>` : ''}` : ''}
      <div class="destination-hint">${state.mode === 'download' ? 'Keep the BBC download unchanged. You can prepare and send it later.' : state.target === 'mabel' ? 'Prepared for smooth 720p playback on Mabel TV.' : 'Keep up to 1080p where available, with compatible video and audio.'}</div>
      <button class="button primary submit-destination"></button><div class="destination-summary">${this.search ? 'Your prepared copy stays in the media folder.' : 'Your original files are never changed.'}</div>`;
    this.node.querySelectorAll('[data-target]').forEach(button => button.onclick = () => { state.target = button.dataset.target; this.render(); });
    this.node.querySelectorAll('[data-field]').forEach(input => input.onchange = () => {
      state[input.dataset.field] = input.value;
      if (input.dataset.field === 'series') state.season = '';
      this.render();
    });
    const createToggle = this.node.querySelector('.create-toggle');
    if (createToggle) createToggle.onclick = () => { state.create = !state.create; this.render(); };
    const createButton = this.node.querySelector('.create-button');
    if (createButton) createButton.onclick = () => attempt(async () => {
      createButton.disabled = true;
      try {
        const name = this.node.querySelector('.create-name').value;
        const season = Number(this.node.querySelector('.create-season').value);
        const result = await window.studio.createSeries(name, season);
        await window.refreshStudio(); state.series = result.id; state.season = String(result.season); state.create = false;
        this.render(); toast('Destination created. It is now ready for your episodes.');
      } finally { createButton.disabled = false; }
    });
    this.node.querySelector('.submit-destination').onclick = () => attempt(async () => {
      const destination = this.value(); this.busy = true; this.updateButton();
      try { await this.submit(destination); } finally { this.busy = false; this.updateButton(); }
    });
    this.updateButton();
  }
}
