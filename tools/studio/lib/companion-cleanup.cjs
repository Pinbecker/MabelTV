'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const { verifyCloudCopies } = require('./cloud-archive.cjs');
const { cleanWorkingCopies } = require('./working-cleanup.cjs');

async function finishTemporaryWork(remote, local, store, portal, queue, signal, progress, wait = delay) {
  if (!remote.destination.temporaryWork) return;
  for (;;) {
    signal.throwIfAborted();
    progress({ stage: 'freeing-space', percent: 100, message: 'Freeing local space' });
    try {
      if (!local.workingRemoved) {
        if (remote.destination.kind !== 'icloud' && !local.result?.complete)
          throw new Error('Wait for verified TV publication before removing working copies.');
        if (remote.destination.saveCloud || remote.destination.kind === 'icloud')
          await verifyCloudCopies(remote, local, portal, signal);
        if (local.subtitleWarning && !local.savedCloudCopies?.original?.confirmed &&
            !(remote.source.type === 'cloud' && !local.cloudOriginalRemoved))
          throw new Error('The original contains subtitles that have not been saved. Working files were kept.');
        // Persist before removal so a restart never fetches or converts again.
        store.update(local.id, { cleanupVerified: true });
        cleanWorkingCopies(remote, local, store);
      }
      // Payload writes are finished. Remaining cache allocation is already
      // counted by the filesystem's free-space measurement.
      queue.resources?.release(local.reservationKey || remote.resourceKey || remote.id);
      if (queue.releaseCloudCaches) await queue.releaseCloudCaches(remote, local, signal);
      store.update(local.id, { cleanupWarning: '' });
      return;
    } catch (error) {
      if (signal.aborted || !['CLOUD_CACHE_PENDING', 'OFFLINE', 'AUTH', 'EBUSY', 'EPERM', 'EACCES', 'ENOENT'].includes(error.code)) throw error;
      store.update(local.id, { cleanupWarning: error.message });
      progress({ stage: 'freeing-space', percent: 100, message: 'Waiting to free local space' });
      await wait(30000, undefined, { signal });
    }
  }
}
module.exports = { finishTemporaryWork };
