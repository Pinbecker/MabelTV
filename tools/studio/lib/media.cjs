'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');

function frameRate(value) { const parts = String(value).split('/').map(Number); return parts.length === 2 ? parts[0] / parts[1] : parts[0]; }
function fastStart(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size; let offset = 0;
    while (offset + 8 <= size) {
      const header = Buffer.alloc(16); const count = fs.readSync(fd, header, 0, 16, offset);
      if (count < 8) return false;
      let length = header.readUInt32BE(0); const type = header.toString('ascii', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (length === 1) { if (count < 16) return false; length = Number(header.readBigUInt64BE(8)); }
      if (!Number.isSafeInteger(length) || length < 8) return false;
      offset += length;
    }
    return false;
  } finally { fs.closeSync(fd); }
}
function analyse(probe, file, target) {
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('This file has no video track.');
  const audio = probe.streams?.filter(stream => stream.codec_type === 'audio') || [];
  const myTv = target !== 'mabel'; const reasons = [];
  if (!['.mp4', '.m4v'].includes(path.extname(file).toLowerCase())) reasons.push('MP4 container');
  if (video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p') reasons.push('compatible H.264 video');
  if (audio.some(stream => stream.codec_name !== 'aac')) reasons.push('AAC audio');
  if (video.width > (myTv ? 1920 : 1280) || video.height > (myTv ? 1080 : 720)) reasons.push(myTv ? '1080p maximum' : '720p maximum');
  const fps = frameRate(video.avg_frame_rate || video.r_frame_rate);
  if (!Number.isFinite(fps) || fps > 30.1) reasons.push('30 fps maximum');
  if (Number(probe.format?.bit_rate) > (myTv ? 7000000 : 2800000)) reasons.push('playback bitrate');
  if (!fastStart(file)) reasons.push('fast-start playback');
  return { ready: reasons.length === 0, reasons, width: video.width, height: video.height,
    fps, duration: Number(probe.format?.duration) || 0, bytes: fs.statSync(file).size };
}
class Media {
  constructor(getTools) { this.getTools = getTools; }
  async inspect(file, target, signal) {
    const tools = this.getTools();
    if (!tools.ffprobe) throw new Error('FFprobe is unavailable. Check Settings.');
    const output = await run(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { signal });
    return analyse(JSON.parse(output), file, target);
  }
  async prepare(file, destination, target, signal, progress) {
    const analysis = await this.inspect(file, target, signal);
    if (analysis.ready) return { file, analysis, converted: false };
    const tools = this.getTools(); if (!tools.ffmpeg) throw new Error('FFmpeg is unavailable. Check Settings.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const free = fs.statfsSync(path.dirname(destination));
    const estimate = Math.max(analysis.bytes, analysis.duration * (target === 'mabel' ? 2700000 : 6800000) / 8);
    if (free.bavail * free.bsize < estimate + 256 * 1024 * 1024) throw new Error('Not enough free space for safe preparation. Choose another working folder.');
    const partial = destination + '.part.mp4';
    const width = target === 'mabel' ? 1280 : 1920, height = target === 'mabel' ? 720 : 1080;
    const fps = Math.min(30, Math.max(1, analysis.fps || 25));
    await run(tools.ffmpeg, ['-hide_banner', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-maxrate', target === 'mabel' ? '2500k' : '6500k', '-bufsize', target === 'mabel' ? '5000k' : '13000k',
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-r', String(fps), '-c:a', 'aac', '-b:a', target === 'mabel' ? '160k' : '192k', '-ac', '2',
      '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', partial], {
      signal, timeout: 24 * 3600000, onLine: line => {
        const match = line.match(/^out_time_us=(\d+)/);
        if (match && analysis.duration) progress(Math.min(99, Number(match[1]) / 1000000 / analysis.duration * 100));
      } });
    const validated = await this.inspect(partial, target, signal);
    if (!validated.ready) throw new Error(`Prepared video failed validation: ${validated.reasons.join(', ')}.`);
    fs.renameSync(partial, destination);
    return { file: destination, analysis: validated, converted: true };
  }
}
module.exports = { Media, analyse, fastStart };
