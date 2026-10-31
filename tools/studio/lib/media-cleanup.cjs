'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function cleanupDownload(job, media) {
  if (job.source !== 'iplayer' || !job.converted || !job.preparedPath || job.preparedPath === job.sourcePath) return false;
  const expected = path.join(job.directory, 'Original', job.metadata.pid + '.mp4');
  if (path.resolve(job.sourcePath) !== path.resolve(expected)) return false;
  const root = fs.realpathSync(job.directory), prepared = fs.realpathSync(job.preparedPath);
  if (!prepared.startsWith(root + path.sep)) return false;
  if (fs.existsSync(expected) && !fs.realpathSync(expected).startsWith(root + path.sep)) return false;
  const profile = job.destination.kind === 'mabel' || job.destination.profile === 'mabel' ? 'mabel' : 'mytv';
  const verified = await media.inspect(prepared, profile, new AbortController().signal);
  if (!verified.ready) throw new Error('The prepared copy needs attention. Downloaded original retained.');
  if (fs.existsSync(expected)) fs.unlinkSync(expected);
  return true;
}
module.exports = { cleanupDownload };
