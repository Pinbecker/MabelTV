'use strict';
const { metadata } = require('./torrent-media.cjs');
class CompanionTorrents {
  constructor(downloads, jobs) { Object.assign(this, { downloads, jobs }); }
  async run(remote, state, signal) {
    state.finishing = true;
    const downloaded = await this.downloads.download(remote, signal, progress => { state.progress = progress; });
    let warning = '', result, cloudPath = '';
    for (const [index, file] of downloaded.files.entries()) {
      const details = metadata(file, remote.title);
      const destination = { ...remote.destination };
      if (destination.kind === 'series' && destination.preserveSeasons && Number.isInteger(details.series)) destination.season = details.series;
      const childRemote = { ...remote, destination, localKey: remote.id + ':' + file.index,
        fileInput: { kind: 'file', path: file.file, metadata: details } };
      const child = { progress: {}, local: null, finishing: false };
      const update = () => {
        const value = child.finishing || !child.local ? child.progress : { stage: child.local.status, percent: child.local.percent, message: child.local.message };
        state.progress = { stage: value.stage || 'preparing', percent: (index + (value.percent || 0) / 100) / downloaded.files.length * 100,
          message: `${index + 1} of ${downloaded.files.length} · ${value.message || 'Preparing'}` };
      };
      const timer = setInterval(update, 250);
      try { await this.jobs.run(childRemote, child, signal); update(); }
      finally { clearInterval(timer); }
      if (child.progress.metadataWarning) warning = child.progress.metadataWarning;
      result = child.progress.result; cloudPath = child.progress.savedCloudPath || cloudPath;
    }
    if (!warning) this.downloads.cleanup(downloaded);
    state.progress = { status: 'complete', stage: 'complete', percent: 100, message: 'Saved to iCloud' + (remote.destination.kind !== 'icloud' ? ' and available on TV' : ''),
      result, savedCloudPath: cloudPath, metadataWarning: warning };
  }
}
module.exports = { CompanionTorrents };
