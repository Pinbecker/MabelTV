'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { StageGate } = require('./stage-resources.cjs');

class PortalError extends Error {
  constructor(message, code = 'API') { super(message); this.code = code; }
}
function endpoint(value) {
  const url = new URL(String(value).trim());
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('Use a portal address without passwords or query parameters.');
  const privateHost = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname) || url.hostname.endsWith('.local');
  if (url.protocol === 'http:' && !privateHost) throw new Error('Remote portal addresses must use HTTPS.');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Use the portal address without a page path.');
  return url.origin;
}
class Portal {
  constructor(store, transport = fetch) { this.store = store; this.transport = transport; this.current = null; this.catalogue = { channels: [], series: [] }; this.cloudConfirmations = new StageGate(4); }
  async at(base, route, { method = 'GET', body, signal, offset, timeout = 30000, headers: suppliedHeaders = {} } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, timeout);
    try {
      const headers = { ...suppliedHeaders };
      if (offset !== undefined) { headers['Upload-Offset'] = String(offset); headers['Content-Type'] = 'application/octet-stream'; }
      else if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await this.transport(base + route, { method, headers, credentials: 'include', redirect: 'manual',
        body: body === undefined ? undefined : offset === undefined ? JSON.stringify(body) : body, signal: controller.signal });
      if (response.status >= 300 && response.status < 400) throw new PortalError('Sign in to remote access in Studio Settings, then resume the queue.', 'AUTH');
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new PortalError('The portal needs a remote-access sign-in. Open Sign in in Settings.', 'AUTH');
      const data = await response.json();
      if (!response.ok) throw new PortalError(data.error || `Portal request failed (${response.status}).`, [401, 403].includes(response.status) ? 'AUTH' : 'API');
      return data;
    } catch (error) {
      if (error instanceof PortalError) throw error;
      if (signal?.aborted) throw new Error('Stopped');
      throw new PortalError('MabelTV could not be reached. Your local files are safe; the queue can resume when connected.', 'OFFLINE');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async connect(mode = this.store.state.settings.connectionMode, signal) {
    const settings = this.store.state.settings;
    const candidates = mode === 'remote' ? [settings.remoteUrl] : mode === 'local' ? [settings.localUrl] : [settings.localUrl, settings.remoteUrl];
    let failure;
    for (const value of candidates.filter(Boolean)) {
      const base = endpoint(value);
      try {
        const setup = await this.at(base, '/api/setup', { signal, timeout: 6000 });
        if (!setup.configured) throw new PortalError('Finish setting up MabelTV in its portal first.');
        const library = await this.at(base, '/api/library', { signal, timeout: 15000 });
        this.current = { base, device: setup.device_name, name: setup.tv_name || 'Mabel TV',
          mode: base === endpoint(settings.localUrl) ? 'local' : 'remote', connected: true };
        this.catalogue = { channels: library.channels.map(channel => ({ number: channel.number, name: channel.name, folder: channel.folder })),
          collections: library.my_tv_folders || [], cloudCollections: [],
          series: (library.my_tv_series || []).map(series => ({ id: series.id, title: series.title, seasons: series.seasons || [] })) };
        this.store.state.catalogue = this.catalogue; this.store.save();
        try { this.catalogue.cloudCollections = (await this.at(base, '/api/studio/collections', { signal, timeout: 6000 })).cloud || []; }
        catch { /* Library connection remains useful when cloud catalogue is unavailable. */ }
        return { ...this.current, catalogue: this.catalogue };
      } catch (error) { failure = error; }
    }
    this.current = null;
    throw failure || new PortalError('Add a portal address in Settings.', 'OFFLINE');
  }
  async api(route, options = {}) {
    if (!this.current) await this.connect(undefined, options.signal);
    const base = this.current.base;
    if (route === '/api/studio/cloud/confirm' && !options.body?.reserve && !options.body?.lookupOnly) {
      // Bound confirmation HTTP requests, never files handed to Apple's uploader.
      return this.cloudConfirmations.run(options.signal, null, () => this.at(base, route, options));
    }
    return this.at(base, route, options);
  }
  async pin(pin, mode) {
    if (!/^\d{4,12}$/.test(String(pin))) throw new Error('Enter your portal PIN.');
    const settings = this.store.state.settings;
    const base = endpoint(mode === 'remote' ? settings.remoteUrl : settings.localUrl);
    await this.at(base, '/api/login', { method: 'POST', body: { pin } });
    return this.connect(mode);
  }
  async libraryPresence(items) {
    const { locationsFor } = require('./library-presence.cjs');
    if (!Array.isArray(items) || items.length > 800) throw new Error('Search up to 800 programmes at a time.');
    if (!this.current) await this.connect();
    const connection = { ...this.current };
    const inventory = await this.at(connection.base, '/api/iplayer/library');
    if (!Array.isArray(inventory.items)) throw new Error('The TV could not report its current media.');
    if (inventory.device !== connection.device) throw new Error('The inventory belongs to a different TV. Reconnect and check again.');
    return { checkedAt: inventory.checkedAt, device: inventory.device,
      items: items.map(item => ({ pid: item.pid, locations: locationsFor(item, inventory.items) })) };
  }
  async createSeries(name, season, identity = '') {
    name = String(name).trim();
    if (!name || name.length > 120) throw new Error('Enter a show name.');
    if (!Number.isInteger(season) || season < 0 || season > 99) throw new Error('Choose a season from 0 to 99.');
    if (identity && !/^[a-f0-9]{32}$/.test(identity)) throw new Error('Choose an existing show.');
    if (!identity) await this.api('/api/manage', { method: 'POST', body: { action: 'create-my-tv-series', name } });
    await this.connect(this.current.mode);
    const series = this.catalogue.series.find(series => identity ? series.id === identity : series.title.toLowerCase() === name.toLowerCase());
    if (!series) throw new Error('The show was created but its destination could not be found. Refresh the connection.');
    if (!series.seasons.includes(season)) await this.api('/api/manage', { method: 'POST', body: { action: 'create-my-tv-season', series: series.id, season } });
    await this.connect(this.current.mode);
    return { id: series.id, season };
  }
  async searchTitles(query, mediaType) {
    query = String(query || '').trim();
    if (query.length < 2 || query.length > 120 || !['movie', 'tv'].includes(mediaType)) throw new Error('Enter a title of between 2 and 120 characters.');
    if (!this.current) await this.connect();
    const connection = { ...this.current };
    const data = await this.at(connection.base, '/api/my-tv/discovery?q=' + encodeURIComponent(query));
    return { device: connection.device, results: (data.results || []).filter(item => item.media_type === mediaType && Number.isSafeInteger(item.tmdb_id) && item.tmdb_id > 0)
      .map(item => ({ tmdb_id: item.tmdb_id, media_type: mediaType, title: item.title, year: item.year,
        overview: item.overview, poster_path: item.poster_path })) };
  }
  async applyMatch(job, signal) {
    if (!job.match || job.matchApplied) return;
    require('./title-match.cjs').titleMatch(job.match, job.destination);
    if (!job.result?.complete) throw new Error('The video has not been published yet.');
    if (!this.current) await this.connect(undefined, signal);
    const connection = { ...this.current };
    if (job.device !== connection.device || job.match.device !== connection.device) throw new Error('This title match belongs to a different TV. Restore the original connection.');
    const film = job.destination.kind === 'film';
    const published = job.result?.file_name;
    const file = film && job.result.folder && published && !published.includes('/') ? job.result.folder + '/' + published : published;
    if (film && (!job.result?.complete || typeof file !== 'string' || !file)) throw new Error('The portal has not confirmed the published filename. The video is safe; check its metadata in the portal.');
    const result = await this.at(connection.base, film ? '/api/tmdb/apply' : '/api/tmdb/my-tv-series/apply', {
      method: 'POST', body: film ? { file, tmdb_id: job.match.tmdb_id,
        ...(job.uploadId && !job.variantLabel && !job.piReturn ? { studio_upload: job.uploadId } : {}) }
        : { series: job.destination.series, tmdb_id: job.match.tmdb_id }, signal, timeout: 120000 });
    if (!result.ok || result.metadata?.tmdb_id !== job.match.tmdb_id) throw new Error('The portal did not confirm the selected title. Retry metadata or check Library settings.');
    return result;
  }
  async upload(job, sourceId, signal, change) {
    if (!this.current) await this.connect(undefined, signal);
    if (job.device && job.device !== this.current.device) throw new PortalError('This queue item belongs to a different MabelTV device. Restore its connection in Settings.');
    if (job.match && job.match.device !== this.current.device) throw new PortalError('The confirmed title belongs to a different TV. Restore its connection before sending.');
    // Keep this attempt on the verified endpoint even if Settings changes while
    // a chunk is in flight. A later attempt can verify and choose a new route.
    const connection = { ...this.current };
    const request = (route, options = {}) => this.at(connection.base, route, options);
    change({ device: this.current.device }, true);
    const file = job.preparedPath;
    const stats = fs.statSync(file);
    if (job.uploadFingerprint && (job.uploadFingerprint.size !== stats.size || job.uploadFingerprint.mtime !== stats.mtimeMs)) throw new Error('The prepared file changed after uploading started. Add it as a new item.');
    change({ uploadFingerprint: { size: stats.size, mtime: stats.mtimeMs } }, true);
    const routes = { mabel: '/api/uploads', film: '/api/my-tv/uploads', series: '/api/my-tv/series/uploads' };
    const destination = job.destination;
    if (destination.kind === 'mabel' && destination.channelFolder) {
      const library = await request('/api/library', { signal });
      const channel = library.channels.find(value => value.folder === destination.channelFolder);
      if (!channel) throw new Error('The selected channel no longer exists.');
      destination.channel = channel.number;
    }
    const body = { file_name: job.publishName || path.basename(file), size: stats.size, source_id: sourceId };
    // Preparation is complete on Windows. Never ask the Pi to encode it again.
    if (destination.kind === 'film' && destination.folder) body.folder = destination.folder;
    if (destination.kind === 'mabel') body.channel = destination.channel;
    if (destination.kind === 'series') { body.series = destination.series; body.season = destination.season; }
    if (!routes[destination.kind]) throw new Error('Choose a library destination.');
    let state;
    if (job.uploadId) state = await request('/api/uploads/' + job.uploadId, { signal });
    else {
      state = job.piReturn ? await request('/api/studio/pi/return', { method: 'POST', body: { ...body, ...job.piReturn }, signal })
        : await request(routes[destination.kind], { method: 'POST', body, signal });
      change({ uploadId: state.id }, true);
    }
    const id = job.uploadId;
    if (state.status === 'paused') {
      await request('/api/uploads/' + id, { method: 'POST', body: { action: 'resume' }, signal });
      state = await request('/api/uploads/' + id, { signal });
    }
    if (state.status === 'error') {
      await request('/api/uploads/' + id, { method: 'POST', body: { action: 'retry' }, signal });
      state = await request('/api/uploads/' + id, { signal });
    }
    const descriptor = fs.openSync(file, 'r');
    try {
      let offset = Number(state.offset) || 0, corrections = 0;
      while (offset < stats.size && !state.complete && !state.processing) {
        if (signal.aborted) throw new Error('Stopped');
        if (state.status === 'error') throw new PortalError(state.error || 'The server could not publish this video.');
        if (state.status === 'paused' || state.transfer_state === 'paused') throw new PortalError('This upload was paused in the portal. Resume it when you are ready.', 'PAUSED');
        if (state.transfer_state === 'waiting') {
          change({ status: 'uploading', message: 'Waiting for the current portal transfer to finish.' });
          await request('/api/uploads/' + id, { method: 'POST', body: { action: 'heartbeat' }, signal });
          await delay(1800, undefined, { signal }); state = await request('/api/uploads/' + id, { signal });
          offset = Number(state.offset) || 0; continue;
        }
        const chunk = Buffer.alloc(Math.min(8 * 1024 * 1024, stats.size - offset));
        const read = fs.readSync(descriptor, chunk, 0, chunk.length, offset);
        if (read !== chunk.length) throw new Error('The prepared file could not be read completely.');
        const next = await request('/api/uploads/' + id, { method: 'PATCH', body: chunk, offset, signal, timeout: 120000 });
        const confirmed = Number(next.offset);
        if (!Number.isSafeInteger(confirmed) || confirmed < 0 || confirmed > stats.size) throw new Error('The server returned an invalid upload offset.');
        if (confirmed <= offset && ++corrections > 4) throw new Error('The upload offset could not be reconciled. Please retry.');
        offset = confirmed;
        change({ status: 'uploading', percent: offset / stats.size * 100, message: 'Sending to ' + (connection.mode === 'local' ? 'MabelTV over your local network' : 'MabelTV remotely') });
        state = await request('/api/uploads/' + id, { signal });
      }
    } finally { fs.closeSync(descriptor); }
    while (true) {
      if (signal.aborted) throw new Error('Stopped');
      // PATCH complete means bytes received. Only this final result means published.
      state = await request('/api/uploads/' + id, { signal });
      if (state.status === 'refresh-error') {
        await request('/api/uploads/' + id, { method: 'POST', body: { action: 'refresh' }, signal });
        continue;
      }
      if (state.status === 'complete' && state.complete) return state;
      if (state.status === 'error') throw new PortalError(state.error || 'The server could not prepare this video.');
      if (state.status === 'paused') throw new PortalError('This upload was paused in the portal.', 'PAUSED');
      change({ status: 'publishing', percent: 100, message: 'Uploaded. MabelTV is validating and adding your video.' });
      await delay(1800, undefined, { signal });
    }
  }
}
module.exports = { Portal, PortalError, endpoint };
