'use strict';
function preparationReport(output, requested, target, started) {
  const source = output.sourceAnalysis, result = output.analysis;
  return { version: 1, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    requested, actual: output.compression, target,
    method: !output.converted ? 'unchanged' : output.videoCopied ? 'picture-copied' : 'video-encoded',
    source: { bytes: source.bytes, codec: source.codec, width: source.width, height: source.height, fps: source.fps },
    output: { bytes: result.bytes, codec: result.codec, width: result.width, height: result.height, fps: result.fps },
    sizeChangeBytes: result.bytes - source.bytes, sizeChangePercent: (result.bytes / source.bytes - 1) * 100,
    encoding: output.encoding || null };
}
module.exports = { preparationReport };
