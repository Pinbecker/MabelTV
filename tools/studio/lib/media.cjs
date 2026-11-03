'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');
const { compressionProof, reusableCompression, encodeCompression, policy } = require('./compression.cjs');

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
  const duration = Number(probe.format?.duration) || 0, bytes = fs.statSync(file).size;
  return { ready: reasons.length === 0, reasons, width: video.width, height: video.height,
    fps, duration, bytes, hasAudio: audio.length > 0, colorTransfer: video.color_transfer,
    compressionProof: compressionProof(probe, bytes, duration) };
}
class Media {
  constructor(getTools) { this.getTools = getTools; }
  async inspect(file, target, signal) {
    const tools = this.getTools();
    if (!tools.ffprobe) throw new Error('FFprobe is unavailable. Check Settings.');
    const output = await run(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { signal });
    return analyse(JSON.parse(output), file, target);
  }
  async prepare(file, destination, target, signal, progress, reserve, compression = policy.default) {
    const analysis = await this.inspect(file, target, signal);
    if (reusableCompression(analysis, compression)) return { file, analysis, sourceAnalysis: analysis, converted: false, compression };
    reserve?.(analysis);
    const tools = this.getTools(); if (!tools.ffmpeg) throw new Error('FFmpeg is unavailable. Check Settings.');
    const output = await encodeCompression({ file, destination, target, analysis, tools, signal, progress,
      inspect: this.inspect.bind(this), compression });
    return { ...output, sourceAnalysis: analysis };
  }
}
module.exports = { Media, analyse, fastStart };
