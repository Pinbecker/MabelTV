'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { resolveTools } = require('../lib/tools.cjs');
const tools = resolveTools('');
if (!tools.ready) throw new Error('Install FFmpeg/FFprobe and the official Windows get_iplayer runtime before bundling.');
const root = path.resolve(__dirname, '../resources'); fs.mkdirSync(root, { recursive: true });
const playerRoot = path.dirname(tools.getPlayer), target = path.join(root, 'get_iplayer');
fs.mkdirSync(target, { recursive: true });
for (const file of ['get_iplayer.pl', 'LICENSE.txt', 'credits.txt', 'licenses', 'perl', 'utils']) {
  const source = path.join(playerRoot, file);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(target, file), { recursive: true });
}
for (const name of ['ffmpeg', 'ffprobe']) fs.copyFileSync(tools[name], path.join(root, name + '.exe'));
const ffmpegRoot = path.dirname(path.dirname(tools.ffmpeg));
for (const name of ['LICENSE', 'LICENSE.txt', 'README.txt']) {
  const source = path.join(ffmpegRoot, name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(root, 'FFmpeg-' + name));
}
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'),
  'MabelTV Studio media tool bundle\n\n' +
  'get_iplayer: https://github.com/get-iplayer/get_iplayer\nGPL v3 or later. Its Perl source and accompanying licenses are included.\n\n' +
  'FFmpeg / FFprobe: https://ffmpeg.org/\nWindows build: https://www.gyan.dev/ffmpeg/builds/\nSee the included FFmpeg license and build README, and get_iplayer/licenses for runtime notices.\n\n' +
  'No personal preferences, browser cookies, download history or recordings are included.\n');
console.log('Bundled media tools and license notices in ' + root);
