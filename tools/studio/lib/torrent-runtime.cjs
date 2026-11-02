'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { TorrentClient } = require('./torrent-client.cjs');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
class TorrentRuntime {
  constructor(root, resources, encryption, options = {}) {
    Object.assign(this, { root: path.join(root, 'torrent-runtime'), resources, encryption, options, starting: null, client: null, process: null });
  }
  async connection() {
    const file = path.join(this.root, 'connection.json'); fs.mkdirSync(this.root, { recursive: true });
    if (!this.encryption.isEncryptionAvailable()) throw new Error('Windows private storage is unavailable for the download connection.');
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Number.isInteger(saved.port) || saved.port < 1024 || saved.port > 65535) throw new Error('The private download connection needs repair.');
      return { ...saved, password: this.encryption.decryptString(Buffer.from(saved.secret, 'base64')) };
    }
    const password = crypto.randomBytes(32).toString('base64url'), salt = crypto.randomBytes(16);
    const port = await freePort();
    const encoded = salt.toString('base64') + ':' + crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('base64');
    const config = path.join(this.root, 'qBittorrent/config/qBittorrent.ini'); fs.mkdirSync(path.dirname(config), { recursive: true });
    const ini = '[LegalNotice]\nAccepted=true\n[Preferences]\n' +
      'WebUI\\Enabled=true\nWebUI\\Address=127.0.0.1\nWebUI\\Port=' + port + '\nWebUI\\Username=MabelTV\n' +
      'WebUI\\LocalHostAuth=true\nWebUI\\AuthSubnetWhitelistEnabled=false\nWebUI\\UseUPnP=false\n' +
      'WebUI\\CSRFProtection=true\nWebUI\\HostHeaderValidation=true\nWebUI\\Password_PBKDF2="@ByteArray(' + encoded + ')"\n' +
      'Search\\pythonExecutablePath=' + path.join(this.resources, 'python/python.exe').replaceAll('\\', '/') + '\n' +
      '[BitTorrent]\nSession\\GlobalMaxRatio=0\nSession\\GlobalMaxSeedingMinutes=0\nSession\\ShareLimitAction=Stop\n' +
      'Session\\UPnP=false\nSession\\DefaultSavePath=' + path.join(this.root, 'metadata').replaceAll('\\', '/') + '\n' +
      (this.options.isolated ? 'Session\\DHTEnabled=false\nSession\\LSDEnabled=false\nSession\\PeXEnabled=false\nSession\\InterfaceAddress=127.0.0.1\n' : '') +
      '[GUI]\nStartUpWindowState=Hidden\n';
    fs.writeFileSync(config, ini, { mode: 0o600 });
    const saved = { port, secret: this.encryption.encryptString(password).toString('base64') };
    fs.writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
    return { ...saved, password };
  }
  async ensure() {
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; }); return this.starting;
  }
  async start() {
    const connection = await this.connection();
    this.client = new TorrentClient('http://127.0.0.1:' + connection.port, connection.password);
    try { await this.client.login(); return this.client; } catch { /* Start only this private profile. */ }
    const executable = path.join(this.resources, 'qbittorrent/qbittorrent.exe');
    if (!fs.existsSync(executable)) throw new Error('The download tools are missing. Reinstall the current Studio build.');
    this.process = spawn(executable, ['--profile=' + this.root, '--webui-port=' + connection.port, '--no-splash', '--confirm-legal-notice'], {
      windowsHide: true, stdio: 'ignore', env: { ...process.env, PATH: path.join(this.resources, 'python') + path.delimiter + process.env.PATH,
        PYTHONHOME: path.join(this.resources, 'python'), PYTHONPATH: '', PYTHONNOUSERSITE: '1' },
    });
    let failed = false; this.process.once('error', () => { failed = true; }); this.process.once('exit', () => { failed = true; });
    for (let attempt = 0; attempt < 80 && !failed; attempt++) {
      await delay(250); try { await this.client.login(); return this.client; } catch { /* Bounded startup. */ }
    }
    throw new Error('Download service could not start. Retry in a moment.');
  }
  async api(route, values, options) {
    if (!this.client) await this.ensure();
    return this.client.request(route, values, options);
  }
  async search(query, signal) {
    await this.ensure();
    const plugins = await this.api('search/plugins', undefined, { signal });
    if (!plugins.some(plugin => plugin.name === 'piratebay')) {
      await this.api('search/installPlugin', { sources: path.join(this.resources, 'qbittorrent/piratebay.py') }, { signal });
      for (let attempt = 0; attempt < 40; attempt++) {
        if ((await this.api('search/plugins', undefined, { signal })).some(plugin => plugin.name === 'piratebay')) break;
        await delay(250, undefined, { signal });
      }
    }
    await this.api('search/enablePlugin', { names: 'piratebay', enable: true }, { signal });
    const started = await this.api('search/start', { pattern: query, plugins: 'piratebay', category: 'movies' }, { signal });
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        const status = await this.api('search/status', { id: started.id }, { method: 'GET', signal });
        if (status[0]?.status === 'Stopped') break;
        await delay(750, undefined, { signal });
      }
      const results = await this.api('search/results', { id: started.id, limit: 100, offset: 0 }, { method: 'GET', signal });
      const items = (results.results || []).filter(item => /^magnet:/i.test(item.fileUrl || '')).map(item => {
        const parameters = new URL(item.fileUrl).searchParams, hash = (parameters.get('xt') || '').replace(/^urn:btih:/i, '').toLowerCase();
        return { hash, title: item.fileName, bytes: item.fileSize, seeders: item.nbSeeders, leechers: item.nbLeechers, magnet: item.fileUrl };
      });
      return { items };
    } finally {
      await this.api('search/stop', { id: started.id }).catch(() => {});
      await this.api('search/delete', { id: started.id }).catch(() => {});
    }
  }
  async close() {
    if (!this.client) return;
    const owned = this.process;
    await this.api('app/shutdown', {}).catch(() => {});
    // The HTTP acknowledgement precedes native resume-data flushing. A new
    // process must not attach to the old API just before it disappears.
    if (owned) {
      for (let attempt = 0; attempt < 100 && owned.exitCode === null && owned.signalCode === null; attempt++) await delay(100);
      if (owned.exitCode === null && owned.signalCode === null) throw new Error('Download service is still closing. Retry after its journal finishes saving.');
    }
    this.process = null; this.client = null;
  }
}
module.exports = { TorrentRuntime };
