'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');
const packaged = path.join(__dirname, 'compression-profiles.json');
const policy = JSON.parse(fs.readFileSync(fs.existsSync(packaged) ? packaged
  : path.resolve(__dirname, '../../../scripts/pi/mabeltv_backend/compression-profiles.json'), 'utf8'));
function compressionProfile(value = policy.default) {
  const profile = policy.profiles.find(item => item.id === value);
  if (!profile) throw new Error('Choose Balanced, Compact or Smallest.');
  return profile;
}
function compressionProof(probe, bytes, duration) {
  try {
    const value = JSON.parse(probe.format?.tags?.comment || '{}').mabeltv;
    if (value?.version !== policy.version || !policy.profiles.some(p => p.id === value.profile)
        || !Number.isSafeInteger(value.sourceBytes) || value.sourceBytes < bytes || !Number.isFinite(value.duration)
        || Math.abs(value.duration - duration) > 2) return null;
    return value;
  } catch { return null; }
}
function compressionPlan(analysis, value) {
  const profile = compressionProfile(value);
  if (!(analysis.duration > 0)) throw new Error('The video duration could not be read. The original was kept.');
  const sourceBytes = analysis.compressionProof?.sourceBytes || analysis.bytes;
  const targetBytes = Math.floor(sourceBytes * profile.sourceFraction * policy.muxMargin);
  const audioBitrate = analysis.hasAudio === false ? 0 : profile.audioBitrate;
  const videoBitrate = Math.floor(targetBytes * 8 / analysis.duration - audioBitrate);
  return { profile, sourceBytes, targetBytes, audioBitrate, videoBitrate,
    maximumBytes: Math.floor(sourceBytes * profile.sourceFraction) };
}
function reusableCompression(analysis, value) {
  return Boolean(analysis.ready && analysis.compressionProof
    && analysis.bytes <= compressionPlan(analysis, value).maximumBytes);
}
async function encodeCompression({ file, destination, target, analysis, tools, signal, progress, inspect, compression }) {
  const plan = compressionPlan(analysis, compression);
  if (plan.videoBitrate < policy.minimumVideoBitrate) throw new Error(
    'This file is too small for the selected compression target at its current duration. Choose a larger profile. The original was kept.');
  if (path.resolve(file) === path.resolve(destination)) throw new Error('The original and output paths must be different.');
  if (!tools.ffmpeg) throw new Error('FFmpeg is unavailable. Check Settings.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stats = fs.statSync(file), free = fs.statfsSync(path.dirname(destination));
  if (Number(free.bavail) * Number(free.bsize) < plan.targetBytes + 256 * 1024 ** 2) throw new Error('Not enough free space for safe preparation.');
  const partial = destination + '.part.mp4', passlog = destination + '.size-pass';
  const width = Math.min(target === 'mabel' ? 1280 : 1920, Math.ceil(analysis.width / 2) * 2);
  const height = Math.min(target === 'mabel' ? 720 : 1080, Math.max(Math.ceil(analysis.height / 2) * 2, Math.ceil(width * 9 / 32) * 2));
  const hdr = ['smpte2084', 'arib-std-b67'].includes(analysis.colorTransfer);
  const toneMap = hdr ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,' : '';
  const filters = `scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,` + toneMap + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
  const maximumRate = target === 'mabel' ? 2500000 : policy.maximumVideoBitrate;
  const common = ['-nostdin', '-hide_banner', '-loglevel', 'warning', '-y', '-i', file, '-map', '0:v:0',
    '-vf', filters, '-c:v', 'libx264', '-preset', policy.preset, '-threads', String(policy.threads),
    '-b:v', String(Math.min(plan.videoBitrate, maximumRate)), '-maxrate', String(maximumRate), '-bufsize', String(target === 'mabel' ? 5000000 : policy.bufferSize),
    '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-fpsmax', '30',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-passlogfile', passlog, '-progress', 'pipe:1', '-nostats'];
  const options = pass => ({ signal, timeout: 24 * 3600000, onLine: line => {
    const match = line.match(/^out_time_us=(\d+)/);
    if (match) progress?.(Math.min(99, (pass - 1) * 50 + Number(match[1]) / 1e6 / analysis.duration * 50));
  } });
  try {
    await run(tools.ffmpeg, [...common, '-pass', '1', '-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'], options(1));
    const proof = JSON.stringify({ mabeltv: { version: policy.version, profile: plan.profile.id,
      sourceBytes: plan.sourceBytes, duration: analysis.duration } });
    await run(tools.ffmpeg, [...common, '-pass', '2', '-map', '0:a:0?', '-c:a', 'aac',
      '-b:a', String(plan.profile.audioBitrate), '-ac', '2', '-map_metadata', '-1', '-map_chapters', '-1',
      '-metadata', 'comment=' + proof, '-movflags', '+faststart', partial], options(2));
    const now = fs.statSync(file);
    if (now.size !== stats.size || now.mtimeMs !== stats.mtimeMs || now.ino !== stats.ino) throw new Error('The original changed during conversion. It was kept.');
    const validated = await inspect(partial, target, signal);
    if (!validated.ready || !validated.compressionProof || Math.abs(validated.duration - analysis.duration) > 2)
      throw new Error('The compressed video failed validation. The original was kept.');
    if (validated.bytes >= analysis.bytes || validated.bytes > plan.maximumBytes)
      throw new Error('The conversion did not meet the selected size target. The original was kept.');
    fs.renameSync(partial, destination);
    return { file: destination, analysis: validated, converted: true, compression: plan.profile.id };
  } finally {
    for (const name of [partial, passlog + '-0.log', passlog + '-0.log.mbtree']) {
      try { fs.unlinkSync(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
module.exports = { policy, compressionProfile, compressionProof, compressionPlan, reusableCompression, encodeCompression };
