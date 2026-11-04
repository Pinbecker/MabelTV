'use strict';
const path = require('node:path');
async function recordProvenance(remote, local, portal, signal) {
  if (remote.metadata_only || remote.destination.kind === 'local' && !remote.destination.saveCloud) return;
  const analysis = local.sourceAnalysis || local.analysis || {};
  const source = { name: path.basename(local.sourcePath || ''), bytes: local.sourceFingerprint?.size || analysis.bytes,
    duration: analysis.duration, width: analysis.width, height: analysis.height, fps: analysis.fps, sar: analysis.sar,
    codec: analysis.codec, fingerprint: local.sourceFingerprint };
  const provenance = { source, cloudCopies: local.savedCloudCopies || {}, pi: local.result || null,
    encoding: local.analysis?.compressionProof || null, cloudEncoding: local.cloudPreparedAnalysis?.compressionProof || null,
    policyVersion: 2, profile: local.destination.compression, fileIndex: remote.selectedFile,
    retained: remote.destination.cloudCopies, originalRecovery: remote.originalRecovery === true };
  await portal.api('/api/studio/provenance', { method: 'POST', body: { job: remote.id, claim: remote.claim,
    ...(Number.isInteger(remote.selectedFile) ? { fileIndex: remote.selectedFile } : {}), provenance }, signal });
}
module.exports = { recordProvenance };
