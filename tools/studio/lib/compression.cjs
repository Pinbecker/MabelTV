'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');
const mediaPolicy = require('./media-policy.cjs');
const { policy, compressionPlan, outputGeometry, outputFrameRate, outputLevel } = mediaPolicy;
const availability = new Map();
async function ensureIntel(tools, signal) {
  if (!tools.ffmpeg) throw new Error('FFmpeg is unavailable. Check Settings.');
  let check = availability.get(tools.ffmpeg);
  if (!check) {
    check = run(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=128x128:r=24', '-frames:v', '1',
      '-c:v', 'h264_qsv', '-b:v', '500000', '-preset', policy.preset, '-look_ahead', '1', '-f', 'null', '-'], { signal, timeout: 15000 })
      .catch(error => { availability.delete(tools.ffmpeg); const failure = new Error('Intel Quick Sync is unavailable. Check the Intel graphics driver and retry.');
        failure.code = 'ENCODER'; failure.cause = error; throw failure; });
    availability.set(tools.ffmpeg, check);
  }
  await check;
}
function videoFilters(analysis, target, preparation) {
  const { width, height } = outputGeometry(analysis, target);
  const canvasHeight = Math.max(height, Math.min(target === 'mabel' ? 720 : 1080, Math.ceil(width * 9 / 32) * 2));
  const hdr = ['smpte2084', 'arib-std-b67'].includes(analysis.colorTransfer);
  const toneMap = hdr ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,' : '';
  const deinterlace = analysis.interlaced ? 'bwdif=mode=send_field:parity=auto:deint=all,' : '';
  const cadence = outputFrameRate(analysis, true, preparation) !== outputFrameRate(analysis, true) ? 'fps=25,' : '';
  return deinterlace + cadence + toneMap + `scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${width}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
}
async function encodeCompression({ file, destination, target, analysis, tools, signal, progress, inspect, compression, allowRisk = false }) {
  const compatible = compression === 'compatible';
  const expectedFps = outputFrameRate(analysis, true, compression);
  const plan = compatible ? null : compressionPlan(analysis, compression, target);
  if (plan?.risky && !allowRisk) { const error = new Error(plan.warning + ' Confirm compression or keep the existing copy.'); error.code = 'QUALITY_REVIEW'; throw error; }
  if (path.resolve(file) === path.resolve(destination)) throw new Error('The original and output paths must be different.');
  await ensureIntel(tools, signal);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stats = fs.statSync(file), free = fs.statfsSync(path.dirname(destination));
  const partial = destination + '.part.mp4', maximumRate = target === 'mabel' ? 2500000 : policy.maximumVideoBitrate;
  const expectedBytes = plan?.targetBytes || Math.ceil((maximumRate + 192000) * analysis.duration / 8);
  if (Number(free.bavail) * Number(free.bsize) < expectedBytes + 256 * 1024 ** 2) throw new Error('Not enough free space for safe preparation.');
  // LA_ICQ ignores VBV limits. Use the destination ceiling for compatibility,
  // independent of source size, so the output passes the same playback checks.
  const rate = ['-b:v', String(compatible ? maximumRate : plan.videoBitrate)];
  const proof = { version: policy.version, profile: plan?.profile.id || 'compatible', encoder: policy.encoder,
    preset: policy.preset, lookAhead: true, sourceBytes: plan?.sourceBytes || analysis.bytes, duration: analysis.duration,
    sourceFps: analysis.fps, outputFps: expectedFps };
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'warning', '-y', '-i', file, '-map', '0:v:0',
    '-vf', videoFilters(analysis, target, compression), '-c:v', policy.encoder, '-preset', policy.preset, '-look_ahead', '1', ...rate,
    '-maxrate', String(maximumRate), '-bufsize', String(target === 'mabel' ? 5000000 : policy.bufferSize),
    '-profile:v', 'high', '-level:v', outputLevel(analysis, target, compression), '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
    '-map', '0:a:0?', ...(compatible && !analysis.reasons.some(reason => ['AAC audio', 'stereo audio'].includes(reason))
      ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', String(plan?.audioBitrate || 192000), '-ac', '2']),
    '-map_metadata', '0', '-map_chapters', '-1', '-metadata', 'comment=' + JSON.stringify({ mabeltv: proof }),
    '-movflags', '+faststart+write_colr', '-progress', 'pipe:1', '-nostats', partial];
  try {
    await run(tools.ffmpeg, args, { signal, timeout: 24 * 3600000, onLine: line => {
      const match = line.match(/^out_time_us=(\d+)/);
      if (match) progress?.(Math.min(99, Number(match[1]) / 1e6 / analysis.duration * 100));
    } });
    const now = fs.statSync(file);
    if (now.size !== stats.size || now.mtimeMs !== stats.mtimeMs || now.ino !== stats.ino) throw new Error('The original changed during conversion. It was kept.');
    const validated = await inspect(partial, target, signal);
    const expectedFrames = analysis.frameCount && Math.round(analysis.frameCount * expectedFps / analysis.fps);
    if (Math.abs(validated.fps - expectedFps) > .005
        || expectedFrames && validated.frameCount && Math.abs(expectedFrames - validated.frameCount) > (expectedFps !== outputFrameRate(analysis, true) ? 1 : 0))
      throw new Error('The prepared video did not match the requested frame rate. The original was kept.');
    if (!validated.ready || Math.abs(validated.duration - analysis.duration) > 2 || validated.hasAudio !== analysis.hasAudio)
      throw new Error('The prepared video failed validation. The original was kept.');
    if (!compatible && validated.bytes >= analysis.bytes)
      throw Object.assign(new Error('The conversion would not save space. The original was kept.'), { code: 'NOT_SMALLER' });
    fs.renameSync(partial, destination);
    return { file: destination, analysis: validated, converted: true, compression: proof.profile, encoding: proof };
  } finally {
    for (const name of [partial, destination + '.size-pass-0.log', destination + '.size-pass-0.log.mbtree']) {
      try { fs.unlinkSync(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
module.exports = { ...mediaPolicy, encodeCompression, ensureIntel, videoFilters };
