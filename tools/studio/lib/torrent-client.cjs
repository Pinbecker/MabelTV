'use strict';
class TorrentClient {
  constructor(base, password, transport = fetch) {
    const url = new URL(base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Download control requires its private local connection.');
    Object.assign(this, { base: url.origin, password, transport, cookie: '' });
  }
  async request(route, values, { signal, method = values ? 'POST' : 'GET', retry = true } = {}) {
    if (!/^[a-z]+\/[a-zA-Z]+$/.test(route)) throw new Error('Invalid download operation.');
    const headers = { Origin: this.base, Referer: this.base + '/' };
    if (this.cookie) headers.Cookie = this.cookie;
    const form = values && new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
    if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const timeout = AbortSignal.timeout(20000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try { response = await this.transport(this.base + '/api/v2/' + route + (method === 'GET' && form ? '?' + form : ''), { method, headers, body: method === 'POST' ? form || '' : undefined, signal: combined, redirect: 'error' }); }
    catch { if (signal?.aborted) throw new Error('Stopped'); throw new Error('Download service is reconnecting. Retry to continue.'); }
    if (response.status === 403 && route !== 'auth/login' && retry) { await this.login(signal); return this.request(route, values, { signal, method, retry: false }); }
    if (!response.ok) throw new Error('Download service could not complete this operation (' + response.status + ').');
    const body = await response.text();
    if (body.length > 4 * 1024 * 1024) throw new Error('Download service returned too many details.');
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    if (!body) return '';
    try { return JSON.parse(body); } catch { return body; }
  }
  async login(signal) {
    this.cookie = '';
    const result = await this.request('auth/login', { username: 'MabelTV', password: this.password }, { signal, retry: false });
    // qBittorrent 5.3 returns 204; older compatible builds return 200/Ok.
    if (!['', 'Ok.'].includes(result) || !this.cookie) throw new Error('Download service could not authenticate.');
    return this.request('app/version', undefined, { signal, retry: false });
  }
}
module.exports = { TorrentClient };
