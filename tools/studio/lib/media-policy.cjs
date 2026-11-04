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
function compressionProof(probe, bytes, duration) {
  try {
    const value = JSON.parse(probe.format?.tags?.comment || '{}').mabeltv;
    if (![1, policy.version].includes(value?.version) || !policy.profiles.some(p => p.id === value.profile)
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
  const geometry = outputGeometry(analysis, target), fps = Math.min(30, analysis.fps || 24);
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
module.exports = { policy, qualityWarning, compressionProfile, compressionProof, compressionPlan, reusableCompression, outputGeometry };
