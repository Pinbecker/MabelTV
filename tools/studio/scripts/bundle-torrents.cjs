'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../resources'), cache = path.resolve(__dirname, '../../../out/studio-tool-cache');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function pinned(url, name, sha256) {
  const file = path.join(cache, name);
  if (!fs.existsSync(file) || hash(file) !== sha256) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Tool download failed: ' + name);
    const data = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(data).digest('hex') !== sha256) throw new Error('Tool checksum failed: ' + name);
    fs.writeFileSync(file, data);
  }
  return file;
}
async function bundle() {
  fs.mkdirSync(cache, { recursive: true });
  const unzip = path.join(process.env.ProgramFiles || 'C:/Program Files', '7-Zip/7z.exe');
  if (!fs.existsSync(unzip)) throw new Error('Install 7-Zip to build the Windows tool bundle.');
  const installer = await pinned('https://downloads.sourceforge.net/project/qbittorrent/qbittorrent-win32/qbittorrent-5.3.0/qbittorrent_5.3.0_x64_setup.exe', 'qbittorrent-5.3.0.exe', 'aff5b3bdc00d6e5773d6099ba30f9696dd3dfd1669ab0f64ce5c4e7168486436');
  const qbit = path.join(root, 'qbittorrent'); fs.mkdirSync(qbit, { recursive: true });
  execFileSync(unzip, ['e', installer, '-o' + qbit, '-y', 'qbittorrent.exe', 'qt.conf'], { windowsHide: true, stdio: 'pipe' });
  if (hash(path.join(qbit, 'qbittorrent.exe')) !== '905b33386a45844724d7d9feb8ed12a07958650763dfe311d6d2175c348abe4c') throw new Error('Extracted qBittorrent checksum failed.');
  const python = await pinned('https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip', 'python-3.14.10.zip', '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159');
  const pythonRoot = path.join(root, 'python'); fs.mkdirSync(pythonRoot, { recursive: true });
  execFileSync(unzip, ['x', python, '-o' + pythonRoot, '-y'], { windowsHide: true, stdio: 'pipe' });
  // The search script imports its sibling modules. Normal script-path loading
  // is required; its child environment excludes user Python packages/paths.
  for (const file of fs.readdirSync(pythonRoot).filter(name => name.endsWith('._pth'))) fs.unlinkSync(path.join(pythonRoot, file));
  const plugin = await pinned('https://raw.githubusercontent.com/qbittorrent/search-plugins/d2eb83da56230c76f47b449ae1d99e209cc8e265/nova3/engines/piratebay.py', 'piratebay.py', 'b37f13d21ff5f22ff2154a497cd3ed2d727784024d09d393c1bead88e438dab5');
  fs.copyFileSync(plugin, path.join(qbit, 'piratebay.py'));
  const license = await fetch('https://raw.githubusercontent.com/qbittorrent/qBittorrent/release-5.3.0/COPYING');
  if (!license.ok) throw new Error('qBittorrent license could not be bundled.');
  fs.writeFileSync(path.join(qbit, 'COPYING'), await license.text());
  fs.writeFileSync(path.join(qbit, 'NOTICE.txt'), 'qBittorrent 5.3.0: GPL-2.0-or-later; https://github.com/qbittorrent/qBittorrent/tree/release-5.3.0\n' +
    'Official installer signature was verified during readiness testing. No user profile is bundled.\n' +
    'Pirate Bay search plugin: GPL-2.0-or-later; https://github.com/qbittorrent/search-plugins/tree/d2eb83da56230c76f47b449ae1d99e209cc8e265\n' +
    'Python 3.14.10: PSF license; see ../python/LICENSE.txt and https://www.python.org/downloads/release/python-31410/\n' +
    'qBittorrent includes its upstream Qt, libtorrent and OpenSSL notices in About / Libraries.\n');
  fs.writeFileSync(path.join(qbit, 'bundle.json'), JSON.stringify({ qBittorrent: '5.3.0', python: '3.14.10', pluginCommit: 'd2eb83da56230c76f47b449ae1d99e209cc8e265', executableSHA256: hash(path.join(qbit, 'qbittorrent.exe')) }, null, 2));
  console.log('Bundled verified torrent runtime and notices.');
}
if (require.main === module) bundle().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { bundle };
