'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function findOnPath(name) {
  try { return execFileSync('where.exe', [name], { windowsHide: true, encoding: 'utf8' }).trim().split(/\r?\n/)[0]; }
  catch { return ''; }
}
function resolveTools(resources, folder = '') {
  const roots = [folder, resources].filter(Boolean);
  const find = (relative, fallback) => roots.map(root => path.join(root, relative)).find(file => fs.existsSync(file)) || fallback;
  const installed = path.join(process.env.ProgramFiles || 'C:/Program Files', 'get_iplayer');
  const getPlayer = find('get_iplayer/get_iplayer.pl', fs.existsSync(path.join(installed, 'get_iplayer.pl'))
    ? path.join(installed, 'get_iplayer.pl') : '');
  const playerRoot = getPlayer && path.dirname(getPlayer);
  const perl = playerRoot ? path.join(playerRoot, 'perl/bin/perl.exe') : '';
  const ffmpeg = find('ffmpeg.exe', findOnPath('ffmpeg.exe'));
  const ffprobe = find('ffprobe.exe', findOnPath('ffprobe.exe'));
  return { ffmpeg, ffprobe, getPlayer, perl: fs.existsSync(perl) ? perl : '',
    playerEnv: { PATH: [playerRoot && path.join(playerRoot, 'perl/bin'), playerRoot && path.join(playerRoot, 'utils/bin'), process.env.PATH].filter(Boolean).join(path.delimiter), PERL5LIB: '' },
    ready: Boolean(ffmpeg && ffprobe && getPlayer && fs.existsSync(perl)) };
}
module.exports = { resolveTools };
