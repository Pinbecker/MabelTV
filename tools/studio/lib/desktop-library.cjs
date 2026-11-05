'use strict';
const { destinationValid } = require('./queue.cjs');
const { compressionProfile } = require('./compression.cjs');

function text(value, max = 200) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error('Choose a valid library item.');
  return value;
}
function id(value, series = false, length = 24) {
  if (typeof value !== 'string' || !(series ? /^(?:series:)?[a-f0-9]{24}$/ : new RegExp(`^[a-f0-9]{${length}}$`)).test(value)) throw new Error('Choose a current library item.');
  return value;
}
function list(values, max = 100) {
  if (!Array.isArray(values) || !values.length || values.length > max) throw new Error(`Choose between 1 and ${max} items.`);
  return values;
}
function frozen(value) {
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1) throw new Error('The file size is unavailable. Refresh the library.');
  return { id: id(value.id), bytes: value.bytes, modified: text(value.modified || ''), remoteId: text(value.remoteId || '', 500) };
}
class DesktopLibrary {
  constructor(portal) { this.portal = portal; }
  async read(action, value = {}) {
    const post = (route, body) => this.portal.api(route, { method: 'POST', body });
    if (action === 'cloud') {
      const query = new URLSearchParams();
      if (value.series) query.set('series', id(value.series, true));
      else {
        query.set('q', text(value.q || '', 160));
        if (!['films', 'tv', 'kids'].includes(value.category)) throw new Error('Choose Films, TV or Kids.');
        if (!['name-asc', 'name-desc', 'size-asc', 'size-desc', 'date-asc', 'date-desc'].includes(value.sort)) throw new Error('Choose a library sort order.');
        if (!Number.isInteger(value.offset) || value.offset < 0 || value.offset > 100000) throw new Error('Refresh this library page.');
        for (const key of ['category', 'sort', 'offset']) query.set(key, value[key]);
      }
      return this.portal.api('/api/studio/cloud?' + query);
    }
    if (action === 'request') return this.portal.api('/api/studio/request?id=' + id(value.id, false, 32));
    if (action === 'status') return this.portal.api('/api/studio/status');
    if (action === 'originals') return post('/api/studio/originals', { ids: list(value.ids).map(value => id(value)) });
    if (action === 'preview') return post('/api/studio/cloud/optimise-preview', { ids: list(value.ids).map(value => id(value)), compression: compressionProfile(value.compression).id });
    throw new Error('That Studio library action is unavailable.');
  }
  async destination(value) {
    if (!value || !['mabel', 'film', 'series', 'icloud'].includes(value.kind)) throw new Error('Choose a TV or iCloud destination.');
    if (value.kind !== 'icloud') destinationValid(value);
    if (!['original', 'optimised', 'both'].includes(value.cloudCopies)) throw new Error('Choose which iCloud copies to keep.');
    const destination = { kind: value.kind, cloudCopies: value.cloudCopies, saveCloud: true,
      compression: compressionProfile(value.compression).id, preparationIntent: value.preparationIntent === 'compatible' || (!value.preparationIntent && !value.compression && !value.spaceOnly) ? 'compatible' : 'compress' };
    if (value.kind === 'mabel') {
      const library = await this.portal.api('/api/library');
      const channel = library.channels.find(channel => channel.number === value.channel);
      if (!channel) throw new Error('Choose a current Mabel TV channel.');
      destination.folder = channel.folder;
    }
    if (['film','series'].includes(value.kind)) destination.collection = text(value.folder || value.collection || '', 80);
    if (value.kind === 'series') Object.assign(destination, { series: value.series, season: value.season, preserveSeasons: value.preserveSeasons === true });
    return destination;
  }
  async write(action, value = {}) {
    const post = (route, body) => this.portal.api(route, { method: 'POST', body });
    if (action === 'search') {
      const query = text(value.query, 160).trim();
      if (query.length < 2) throw new Error('Enter a film or TV title.');
      return post('/api/studio/torrents/search', { query });
    }
    if (action === 'inspect') return post('/api/studio/torrents/inspect', { request: id(value.request, false, 32), hash: id(value.hash, false, 40) });
    if (action === 'submit') {
      const sources = list(value.sources).map(source => {
        if (source.type === 'cloud') return { type: 'cloud', ...frozen(source) };
        if (source.type !== 'torrent') throw new Error('Choose an iCloud file or download result.');
        const files = list(source.files, 200);
        if (files.some(index => !Number.isInteger(index) || index < 0 || index > 5000) || new Set(files).size !== files.length) throw new Error('Choose valid video files.');
        return { type: 'torrent', request: id(source.request, false, 32), files };
      });
      return post('/api/studio/jobs', { sources, destination: await this.destination(value.destination), replaceCloudOriginal: value.replaceCloudOriginal === true });
    }
    if (action === 'optimise') {
      if (value.confirmed !== true) throw new Error('Confirm the iCloud replacement first.');
      return post('/api/studio/jobs', { sources: list(value.files).map(file => ({ type: 'cloud', ...frozen(file) })),
        destination: { kind: 'icloud', optimiseCloud: true, saveCloud: true, cloudCopies: 'optimised',
          compression: compressionProfile(value.compression).id, allowRisk: value.allowRisk === true }, replaceCloudOriginal: true });
    }
    if (action === 'delete') {
      if (value.confirmed !== true) throw new Error('Confirm which files to delete first.');
      return post('/api/studio/cloud/operation', { action: 'delete', confirmed: true, items: list(value.items, 500).map(frozen) });
    }
    if (action === 'match') {
      const match = value.match;
      if (!match || !Number.isInteger(match.tmdb_id) || match.tmdb_id < 1 || !['movie', 'tv'].includes(match.media_type)) throw new Error('Choose a title match.');
      return post('/api/studio/cloud/match', { id: id(value.id, true), match: { tmdb_id: match.tmdb_id, media_type: match.media_type, title: text(match.title), year: text(match.year || '', 4) } });
    }
    if (action === 'recover') {
      if (!['replace', 'alongside'].includes(value.mode)) throw new Error('Choose whether to keep or replace the existing copy.');
      if (value.mode === 'replace' && value.confirmed !== true) throw new Error('Confirm replacement first.');
      return post('/api/studio/download-originals', { ids: list(value.ids).map(value => id(value, false, 32)),
        destination: await this.destination(value.destination), mode: value.mode, confirmReplace: value.confirmed === true });
    }
    throw new Error('That Studio library action is unavailable.');
  }
}
module.exports = { DesktopLibrary };
