'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressionPlan, policy } = require('./compression.cjs');
const { compatibilityPlan } = require('./compatibility-size.cjs');

async function prepareCloudCompression(remote, local, queue, store, signal, progress) {
  if (!['optimised', 'both'].includes(remote.destination.cloudCopies)
      || local.savedCloudCopies?.optimised || local.destination.kind !== 'mabel') return;
  if (local.cloudPreparedPath && fs.existsSync(local.cloudPreparedPath)) return;
  const source = await queue.media.inspect(local.sourcePath, 'mytv', signal);
  const compatible = remote.destination.preparationIntent === 'compatible';
  const plan = compatible ? { ...compatibilityPlan(source, policy.maximumVideoBitrate),
    profile: { id: 'compatible', label: 'compatible' } } : compressionPlan(source, remote.destination.compression);
  // A 720p source with an uncapped size target uses the same output for both destinations.
  if (source.width <= 1280 && source.height <= 720 && plan.videoBitrate <= 2500000
      && (compatible ? local.preparedCompression === 'compatible' : local.analysis?.compressionProof)) return;
  const destination = path.join(local.directory, 'Prepared', 'iCloud', plan.profile.id, path.basename(local.preparedPath));
  const output = await queue.resources.conversion.run(signal,
    () => progress({ stage: 'queued-conversion', percent: 0, message: 'Waiting for iCloud copy conversion' }), async () => {
      progress({ stage: 'preparing', percent: 0, message: 'Preparing the ' + plan.profile.label + ' iCloud copy' });
      return queue.media.prepare(local.sourcePath, destination, 'mytv', signal,
        percent => progress({ stage: 'preparing', percent, message: 'Preparing the ' + plan.profile.label + ' iCloud copy' }),
        analysis => queue.resources.reserve(local.reservationKey || local.id, analysis.bytes * 2), plan.profile.id,
        { allowRisk: remote.destination.allowRisk === true });
    });
  store.update(local.id, { cloudPreparedPath: output.file, cloudPreparedAnalysis: output.analysis,
    cloudPreparationReport: output.preparationReport });
}
module.exports = { prepareCloudCompression };
