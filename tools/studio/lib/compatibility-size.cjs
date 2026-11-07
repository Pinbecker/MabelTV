'use strict';
const version = 1;
function compatibilityLimit(bytes) {
  if (!(Number.isSafeInteger(bytes) && bytes > 0)) throw new Error('The original file size could not be verified.');
  return bytes + Math.min(100 * 1024 ** 2, Math.max(65536, Math.floor(bytes * .03)));
}
function assertCompatibilitySize(sourceBytes, outputBytes) {
  if (outputBytes > compatibilityLimit(sourceBytes))
    throw Object.assign(new Error('The compatible copy would be too large. It was not sent; the original is safe.'),
      { code: 'COMPATIBILITY_SIZE', sourceBytes, outputBytes });
}
function compatibilityPlan(analysis, maximumVideoBitrate, scale = 1) {
  if (!(analysis.duration > 0)) throw new Error('The video duration could not be verified.');
  const audioCopied = analysis.hasAudio !== false && !analysis.reasons.some(reason => ['AAC audio', 'stereo audio'].includes(reason));
  const audioBitrate = analysis.hasAudio === false ? 0 : audioCopied
    ? (analysis.audioBitrate || 192000) : Math.min(192000, analysis.audioBitrate || 192000);
  const videoBitrate = Math.floor(Math.min(maximumVideoBitrate,
    (analysis.bytes * .98 * 8 / analysis.duration - audioBitrate) * scale));
  if (videoBitrate < 1000) throw Object.assign(new Error('A compatible copy cannot fit the original size budget. The original is safe.'), { code: 'COMPATIBILITY_SIZE' });
  return { sourceBytes: analysis.bytes, maximumBytes: compatibilityLimit(analysis.bytes), audioCopied,
    audioBitrate, videoBitrate, targetBytes: Math.ceil((videoBitrate + audioBitrate) * analysis.duration / 8), sizePolicyVersion: version };
}
module.exports = { compatibilityLimit, assertCompatibilitySize, compatibilityPlan };
