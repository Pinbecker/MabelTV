'use strict';
const fs = require('node:fs');
const path = require('node:path');
const packaged = path.join(__dirname, 'compression-profiles.json');
const policy = JSON.parse(fs.readFileSync(fs.existsSync(packaged) ? packaged
  : path.resolve(__dirname, '../../../scripts/pi/mabeltv_backend/compression-profiles.json'), 'utf8'));
const qualityWarning = 'This copy is already heavily compressed. Further compression may reduce picture quality.';
function compressionProfile(value = policy.default) {
  const profile = policy.profiles.find(item => item.id === value);
  if (!profile) throw new Error('Choose Balanced, Compact or Smallest.');
  return profile;
}
function outputGeometry(analysis, target = 'mytv') {
  const maxWidth = target === 'mabel' ? 1280 : 1920, maxHeight = target === 'mabel' ? 720 : 1080;
  const displayWidth = analysis.width * (analysis.sar || 1);
  const ratio = Math.min(1, maxWidth / displayWidth, maxHeight / analysis.height);
  return { width: Math.max(2, Math.floor(displayWidth * ratio / 2) * 2),
    height: Math.max(2, Math.floor(analysis.height * ratio / 2) * 2) };
}
function outputFrameRate(analysis, required = false, preparation = 'compress') {
  const source = analysis.fps;
  if (required && !(Number.isFinite(source) && source > 0))
    throw Object.assign(new Error('The source frame rate could not be read. The original was kept.'), { code: 'FRAME_RATE' });
  const fps = (source > 0 ? source : 24) * (analysis.interlaced ? 2 : 1);
  if (fps > policy.maximumFrameRate + .001)
    throw Object.assign(new Error(`This video needs ${fps.toFixed(2)} fps. Studio supports up to ${policy.maximumFrameRate} fps without reducing motion. The original was kept.`), { code: 'FRAME_RATE' });
  return preparation === 'compatible' && Math.abs(fps - 50) < .005 ? 25 : fps;
}
function outputLevel(analysis, target, preparation) {
  const { width, height } = outputGeometry(analysis, target);
  const canvas = Math.max(height, Math.min(target === 'mabel' ? 720 : 1080, Math.ceil(width * 9 / 32) * 2));
  return Math.ceil(width / 16) * Math.ceil(canvas / 16) * outputFrameRate(analysis, true, preparation) > 245760 ? '4.2' : '4.1';
}
function compressionProof(probe, bytes, duration) {
  try {
    const value = JSON.parse(probe.format?.tags?.comment || '{}').mabeltv;
    if (![1, 2, policy.version].includes(value?.version) || !policy.profiles.some(p => p.id === value.profile)
        || !Number.isSafeInteger(value.sourceBytes) || value.sourceBytes < bytes || !Number.isFinite(value.duration)
        || Math.abs(value.duration - duration) > 2) return null;
    return value;
  } catch { return null; }
}
function compressionPlan(analysis, value, target = 'mytv') {
  const profile = compressionProfile(value);
  if (!(analysis.duration > 0)) throw new Error('The video duration could not be read. The original was kept.');
  const sourceBytes = analysis.compressionProof?.sourceBytes || analysis.bytes;
  const audioBitrate = analysis.hasAudio === false ? 0 : profile.audioBitrate;
  const geometry = outputGeometry(analysis, target), fps = outputFrameRate(analysis);
  const pixelsPerSecond = Number.isFinite(geometry.width * geometry.height) ? geometry.width * geometry.height * fps : 0;
  const sourceRate = Math.max(0, analysis.bytes * 8 / analysis.duration - audioBitrate);
  const desired = Math.floor(sourceBytes * profile.sourceFraction * policy.muxMargin * 8 / analysis.duration - audioBitrate);
  const minimum = Math.max(policy.minimumVideoBitrate, Math.floor(pixelsPerSecond * profile.minimumBitsPerPixel));
  const videoBitrate = Math.min(Math.max(desired, minimum), target === 'mabel' ? 2500000 : policy.maximumVideoBitrate);
  const targetBytes = Math.floor((videoBitrate + audioBitrate) * analysis.duration / 8);
  const risky = !analysis.compressionProof && pixelsPerSecond > 0 && sourceRate / pixelsPerSecond < policy.riskBitsPerPixel;
  const priorProfile = analysis.compressionProof && compressionProfile(analysis.compressionProof.profile);
  const keepExisting = Boolean(analysis.ready && (priorProfile && priorProfile.sourceFraction <= profile.sourceFraction
    || targetBytes >= analysis.bytes * .95));
  return { profile, sourceBytes, targetBytes: keepExisting ? analysis.bytes : targetBytes, audioBitrate, videoBitrate,
    maximumBytes: Math.max(Math.floor(sourceBytes * profile.sourceFraction * 1.06), Math.ceil(targetBytes * 1.06)),
    risky, warning: risky ? qualityWarning : '', recommended: risky ? 'balanced' : policy.default, keepExisting, geometry };
}
function reusableCompression(analysis, value, target) {
  return compressionPlan(analysis, value, target).keepExisting;
}
module.exports = { policy, qualityWarning, compressionProfile, compressionProof, compressionPlan, reusableCompression, outputGeometry, outputFrameRate, outputLevel };
