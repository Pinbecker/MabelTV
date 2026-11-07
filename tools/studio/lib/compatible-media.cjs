'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');
const { assertCompatibilitySize } = require('./compatibility-size.cjs');
async function remuxCompatible(file, destination, analysis, tools, target, signal, inspect, progress) {
  if (analysis.reasons.some(reason => !['MP4 container', 'fast-start playback', 'AAC audio', 'stereo audio'].includes(reason))) return null;
  const audioConverted = analysis.reasons.some(reason => ['AAC audio', 'stereo audio'].includes(reason));
  if (path.resolve(file) === path.resolve(destination)) throw new Error('The original and output paths must be different.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const source = fs.statSync(file), partial = destination + '.part.mp4';
  try {
    await run(tools.ffmpeg, ['-nostdin', '-v', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy', ...(audioConverted ? ['-c:a', 'aac', '-b:a', String(Math.min(192000, analysis.audioBitrate || 192000)), '-ac', '2'] : ['-c:a', 'copy']),
      '-map_metadata', '0', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', partial], {
      signal, timeout: 2 * 3600000, onLine: line => {
        const match = line.match(/^out_time_us=(\d+)/);
        if (match && analysis.duration > 0) progress?.(Math.min(99, Number(match[1]) / 1e6 / analysis.duration * 100));
      }
    });
    const now = fs.statSync(file);
    if (source.size !== now.size || source.mtimeMs !== now.mtimeMs || source.ino !== now.ino) throw new Error('The original changed while preparing it. It was kept.');
    const checked = await inspect(partial, target, signal);
    if (!checked.ready || Math.abs(checked.duration - analysis.duration) > 2
        // MKV millisecond timestamps can slightly change the average rate in MP4.
        // A copied stream retains its signalled cadence and exact frame count.
        || Math.abs((checked.nominalFps || checked.fps) - (analysis.nominalFps || analysis.fps)) > .005
        || analysis.frameCount && checked.frameCount && analysis.frameCount !== checked.frameCount
        || checked.width !== analysis.width || checked.height !== analysis.height)
      throw new Error('The Pi-compatible copy failed validation.');
    assertCompatibilitySize(analysis.bytes, checked.bytes);
    fs.renameSync(partial, destination);
    return { file: destination, analysis: checked, converted: true, compression: 'compatible', remuxed: true, videoCopied: true, audioConverted };
  } finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); }
}
module.exports = { remuxCompatible };
