'use strict';
const fs = require('node:fs');
const { fetchCloud } = require('./cloud-files.cjs');
const { fetchPi } = require('./pi-files.cjs');
const { recordProvenance } = require('./provenance.cjs');
const { saveCloud, cloudCopiesComplete, replaceCloudOriginal, archiveMatch } = require('./cloud-archive.cjs');
const { finishTemporaryWork } = require('./companion-cleanup.cjs');
const { removeOptimised } = require('./subtitles.cjs');
const { archiveSubtitles } = require('./archive-subtitles.cjs');
const { prepareCloudCompression } = require('./cloud-compression.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class CompanionJobs {
  constructor(store, queue, iplayer, portal) { Object.assign(this, { store, queue, iplayer, portal }); }
  async destination(remote) {
    const chosen = remote.destination;
    const processing = { preparationIntent: chosen.preparationIntent, allowRisk: chosen.allowRisk, spaceOnly: chosen.optimiseCloud === true };
    if (chosen.kind === 'mabel') {
      // Resolve the stable folder again immediately before queuing the upload.
      const library = await this.portal.api('/api/library');
      const channel = library.channels.find(c => c.folder === chosen.folder);
      if (!channel) throw new Error('The chosen channel no longer exists. Choose another destination.');
      return { ...processing, kind: 'mabel', channel: channel.number, channelFolder: chosen.folder, label: chosen.label, compression: chosen.compression };
    }
    if (chosen.kind === 'series') {
      const series = await this.portal.createSeries(chosen.name, chosen.season, chosen.series);
      if (chosen.collection !== undefined) await this.portal.api('/api/manage', { method: 'POST', body: { action: 'move-my-tv-series-collection', series: series.id, folder: chosen.collection } });
      return { ...processing, kind: 'series', series: series.id, season: series.season, label: chosen.label, compression: chosen.compression };
    }
    return { ...processing, kind: chosen.kind === 'film' ? 'film' : 'local', profile: 'mytv', label: chosen.label,
      compression: chosen.compression, ...(chosen.kind === 'film' && chosen.collection ? { folder: chosen.collection } : {}), downloadOnly: !chosen.prepare };
  }
  async match(remote, metadata, destination) {
    const type = destination.kind === 'film' ? 'movie' : destination.kind === 'series' ? 'tv' : '';
    if (!type) return null;
    await this.portal.connect();
    if (remote.match) return { ...remote.match, device: this.portal.current.device };
    const title = String(metadata.title || remote.title).replace(/[._]/g, ' ');
    const stamp = [...title.matchAll(/\b(?:19|20)\d{2}\b/g)].filter(value => value.index > 0).at(-1);
    const year = String(metadata.year || stamp?.[0] || '');
    const query = (stamp ? title.slice(0, stamp.index) : title).replace(/\bS\d{1,2}E\d{1,3}\b.*$/i, '').replace(/[([\s-]+$/, '').trim();
    try {
      const result = await this.portal.searchTitles(query, type);
      const normal = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const exact = result.results.filter(i => normal(i.title) === normal(query) && (!year || String(i.year) === year));
      return exact.length === 1 ? { ...exact[0], device: this.portal.current.device } : null;
    } catch { return null; }
  }
  async run(remote, state, signal) {
    let local = this.store.state.jobs.find(j => j.remoteId === (remote.localKey || remote.id));
    if (local && !local.result?.complete && !local.cleanupVerified && local.source === 'file' && (!local.sourcePath || !fs.existsSync(local.sourcePath))) {
      this.store.update(local.id, { remoteId: '', status: 'cancelled', message: 'Missing working copy. Recovering from the recorded source.' });
      local = null;
    }
    if (!local) {
      state.progress = { stage: 'downloading', message: remote.source.type === 'cloud' ? 'Downloading from iCloud' : 'Reading BBC programme details', percent: 0 };
      let input;
      if (remote.source.type === 'torrent' && remote.fileInput) input = remote.fileInput;
      else if (remote.source.type === 'import') {
        if (remote.source.worker !== this.store.state.sourceId) throw new Error('This import belongs to another laptop.');
        const stat = fs.statSync(remote.source.path);
        if (stat.size !== remote.source.bytes || stat.mtimeMs !== remote.source.mtime) throw new Error('The imported source changed. Add its current version.');
        input = { kind: 'file', path: remote.source.path, metadata: { title: remote.title } };
      }
      else if (remote.source.type === 'pi') {
        const downloaded = await this.queue.resources.downloads.run(signal, null, async () => {
          await this.queue.resources.admit(remote.id, remote.source.bytes * 3, signal);
          return fetchPi(remote, this.store, this.portal, signal, progress => { state.progress = { stage: 'downloading', message: 'Downloading from Pi', ...progress }; });
        });
        input = { kind: 'file', ...downloaded, path: downloaded.file, piReturn: { job: remote.id, claim: remote.claim, replacePi: remote.destination.replacePi === true } };
      }
      else if (remote.source.type === 'cloud') {
        const fetch = () => fetchCloud(remote, this.store, this.portal, signal, progress => { state.progress = { stage: 'downloading', message: 'Downloading from iCloud', ...progress }; });
        const resources = this.queue.resources;
        const cloud = resources ? await resources.downloads.run(signal,
          () => { state.progress = { stage: 'queued-download', percent: 0, message: 'Waiting for a download slot' }; }, async () => {
            await resources.admit(remote.id, remote.source.bytes * 3, signal,
              () => { state.progress = { stage: 'queued-download', percent: 0, message: 'Waiting for disk space' }; });
            return fetch();
          }) : await fetch();
        input = { kind: 'file', path: cloud.file, metadata: cloud.metadata };
        if (!/\.(mp4|m4v|mov|mkv|avi|webm|mpg|mpeg|ts)$/i.test(cloud.file)) {
          if (remote.destination.kind !== 'local') throw new Error('This file can be downloaded. Choose a video to prepare for TV.');
          state.progress = { status: 'complete', stage: 'complete', message: 'Download complete', percent: 100, result: { complete: true, local: true } };
          return;
        }
      } else input = { kind: 'iplayer', metadata: await this.iplayer.metadata(remote.source.pid, signal) };
      const destination = await this.destination(remote);
      input.match = remote.destination.piReturn && remote.destination.replacePi ? null : await this.match(remote, input.metadata, destination);
      signal.throwIfAborted();
      input.remoteId = remote.localKey || remote.id; input.reservationKey = remote.resourceKey || remote.id; input.preserveOriginal = true;
      if (remote.originalRecovery) input.variantLabel = remote.destination.kind === 'icloud' ? 'Original' : 'Pi compatible';
      [local] = this.queue.add([input], destination);
      if (!local) throw new Error('This item is already queued.');
    } else if (remote.metadata_only) {
      await this.portal.connect();
      if (remote.match) local.match = { ...remote.match, device: this.portal.current.device };
      local.matchApplied = false;
      await this.queue.action(local.id, 'metadata');
    } else if (['paused', 'failed', 'waiting'].includes(local.status)) {
      this.store.update(local.id, { destination: { ...local.destination, allowRisk: remote.destination.allowRisk === true },
        ...(local.piReturn ? { piReturn: { ...local.piReturn, job: remote.id, claim: remote.claim } } : {}) });
      await this.queue.action(local.id, 'resume');
    }
    state.local = local;
    while (!['complete', 'prepared', 'failed', 'cancelled', 'paused'].includes(local.status)) {
      if (signal.aborted) {
        if (!['complete', 'prepared', 'paused', 'cancelled'].includes(local.status)) await this.queue.action(local.id, 'pause');
        throw new Error('Stopped');
      }
      await delay(200);
    }
    if (local.status === 'failed') throw Object.assign(new Error(local.message), { code: local.errorCode });
    if (local.status === 'paused' || local.status === 'cancelled') throw new Error('Stopped');
    state.finishing = true;
    if (remote.metadata_only) {
      state.progress = { status: 'complete', stage: 'complete', percent: 100, message: 'Title details updated',
        result: local.result, matchedTitle: local.match || null, savedCloudPath: local.savedCloudPath || '',
        metadataWarning: local.metadataWarning || local.subtitleWarning || '' };
      return;
    }
    if (remote.destination.piReturn) {
      await recordProvenance(remote, local, this.portal, signal);
      await finishTemporaryWork(remote, local, this.store, this.portal, this.queue, signal, progress => { state.progress = progress; });
      state.progress = { status: 'complete', stage: 'complete', percent: 100, message: 'Available on TV', result: local.result };
      return;
    }
    await prepareCloudCompression(remote, local, this.queue, this.store, signal,
      progress => { state.progress = progress; });
    if (remote.destination.optimiseCloud && !local.savedCloudCopies?.optimised &&
        (local.cloudOptimisationUnchanged || fs.statSync(local.preparedPath).size >= remote.source.bytes)) {
      const item = await this.portal.api('/api/studio/cloud/item?id=' + encodeURIComponent(remote.source.id), { signal });
      if (['bytes', 'modified', 'remoteId'].some(key => item[key] !== remote.source[key])) throw new Error('The cloud original changed. It was kept.');
      const verified = await this.portal.api('/api/studio/cloud/confirm', { method: 'POST', body: {
        verifyId: item.id, path: item.path, bytes: item.bytes, modified: item.modified, remoteId: item.remoteId, lookupOnly: true }, signal });
      if (!verified.confirmed) throw new Error('The existing iCloud original could not be confirmed. Working files were kept.');
      this.store.update(local.id, { savedCloudPath: item.path, savedCloudCopies: { original: { ...item, confirmed: true } }, cloudOptimisationUnchanged: true });
      await recordProvenance(remote, local, this.portal, signal);
      await finishTemporaryWork(remote, local, this.store, this.portal, this.queue, signal, progress => { state.progress = progress; });
      state.progress = { status: 'complete', stage: 'complete', percent: 100, message: local.analysis?.compressionProof && !local.converted
        ? 'Existing copy kept: it already meets the selected size target' : 'Original kept: conversion would not save space',
        result: { complete: true, unchanged: true }, savedCloudPath: item.path };
      return;
    }
    let cloudPath = local.savedCloudPath || '';
    if ((remote.destination.saveCloud || remote.destination.kind === 'icloud') && !cloudCopiesComplete(remote, local)) {
      state.progress = { stage: 'saving-cloud', percent: 0, message: 'Saving to iCloud' };
      cloudPath = await saveCloud(remote, local, this.store, this.portal, signal, progress => {
        state.progress = { stage: 'saving-cloud', ...progress, message: progress.waitingForFile ? progress.message : progress.syncing ? 'Waiting for iCloud to confirm the file' : 'Saving to iCloud' };
      }, this.queue.media.getTools?.());
      this.store.update(local.id, { savedCloudPath: cloudPath });
    }
    if (!local.match && local.result?.complete && remote.destination.saveCloud) {
      state.progress = { stage: 'matching', percent: 100, message: 'Adding artwork and title details' };
      const match = await archiveMatch(remote, local, this.portal, signal);
      if (match) {
        this.store.update(local.id, { match, matchApplied: false });
        await this.queue.action(local.id, 'metadata');
        while (!['complete', 'failed', 'paused', 'cancelled'].includes(local.status)) {
          if (signal.aborted) throw new Error('Stopped');
          await delay(200);
        }
      }
    }
    await archiveSubtitles(remote, local, this.store, this.portal, this.queue.media.getTools?.(), signal);
    await recordProvenance(remote, local, this.portal, signal);
    if (remote.originalRecovery && remote.destination.recoveryMode === 'replace') {
      const receipt = await this.portal.api('/api/studio/recovery/finish', { method: 'POST', body: { job: remote.id, claim: remote.claim, upload: local.uploadId }, signal });
      if (receipt.published) {
        this.store.update(local.id, { result: receipt.published });
        await recordProvenance(remote, local, this.portal, signal);
      }
      if (receipt.operation) {
        for (;;) {
          const status = await this.portal.api('/api/studio/status', { signal });
          const operation = status.cloudOperations.find(value => value.id === receipt.operation);
          if (operation?.status === 'complete') break;
          if (!operation || operation.status === 'failed') throw new Error(operation?.error || 'The previous version was kept. Check the recovery operation.');
          await delay(3000);
        }
      }
    }
    await replaceCloudOriginal(remote, local, this.store, this.portal, signal);
    await finishTemporaryWork(remote, local, this.store, this.portal, this.queue, signal, progress => { state.progress = progress; });
    if (!remote.destination.temporaryWork && !remote.destination.keepOptimised && !local.optimisedRemoved &&
        (local.result?.complete || cloudPath)) {
      if (removeOptimised(local, this.store.state.settings.workspace)) this.store.update(local.id, { optimisedRemoved: true });
    }
    const needsMatch = ['film', 'series'].includes(remote.destination.kind) && !local.match;
    state.progress = { status: 'complete', stage: 'complete', percent: 100,
      message: remote.destination.kind === 'local' ? 'Download complete' : cloudPath ? 'Saved to iCloud' : 'Available on TV',
      result: local.result || { complete: true, local: true }, savedCloudPath: cloudPath,
      matchedTitle: local.match || null, metadataWarning: local.metadataWarning || local.subtitleWarning || (needsMatch ? 'Choose a title match to add artwork and metadata.' : '') };
  }
}
module.exports = { CompanionJobs };
