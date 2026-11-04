'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');
async function remuxCompatible(file, destination, analysis, tools, target, signal, inspect) {
  if (analysis.reasons.some(reason => !['MP4 container', 'fast-start playback'].includes(reason))) return null;
  if (path.resolve(file) === path.resolve(destination)) throw new Error('The original and output paths must be different.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const source = fs.statSync(file), partial = destination + '.part.mp4';
  try {
    await run(tools.ffmpeg, ['-nostdin', '-v', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?',
      '-c', 'copy', '-map_metadata', '0', '-movflags', '+faststart', partial], { signal, timeout: 2 * 3600000 });
    const now = fs.statSync(file);
    if (source.size !== now.size || source.mtimeMs !== now.mtimeMs || source.ino !== now.ino) throw new Error('The original changed while preparing it. It was kept.');
    const checked = await inspect(partial, target, signal);
    if (!checked.ready || Math.abs(checked.duration - analysis.duration) > 2) throw new Error('The Pi-compatible copy failed validation.');
    fs.renameSync(partial, destination);
    return { file: destination, analysis: checked, converted: true, compression: 'compatible', remuxed: true };
  } finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); }
}
module.exports = { remuxCompatible };
