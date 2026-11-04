'use strict';
const fs = require('node:fs');
const { fetchCloud } = require('./cloud-files.cjs');
const { saveCloud, cloudCopiesComplete, replaceCloudOriginal, verifyCloudCopies, archiveMatch } = require('./cloud-archive.cjs');
const { cleanWorkingCopies } = require('./working-cleanup.cjs');
const { removeOptimised } = require('./subtitles.cjs');
const { prepareCloudCompression } = require('./cloud-compression.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class CompanionJobs {
  constructor(store, queue, iplayer, portal) { Object.assign(this, { store, queue, iplayer, portal }); }
  async destination(remote) {
    const chosen = remote.destination;
    if (chosen.kind === 'mabel') {
      // Resolve the stable folder again immediately before queuing the upload.
      const library = await this.portal.api('/api/library');
      const channel = library.channels.find(c => c.folder === chosen.folder);
      if (!channel) throw new Error('The chosen channel no longer exists. Choose another destination.');
      return { kind: 'mabel', channel: channel.number, channelFolder: chosen.folder, label: chosen.label, compression: chosen.compression };
    }
    if (chosen.kind === 'series') {
      const series = await this.portal.createSeries(chosen.name, chosen.season, chosen.series);
      if (chosen.collection !== undefined) await this.portal.api('/api/manage', { method: 'POST', body: { action: 'move-my-tv-series-collection', series: series.id, folder: chosen.collection } });
      return { kind: 'series', series: series.id, season: series.season, label: chosen.label, compression: chosen.compression };
    }
    return { kind: chosen.kind === 'film' ? 'film' : 'local', profile: 'mytv', label: chosen.label,
      compression: chosen.compression, ...(chosen.kind === 'film' && chosen.collection ? { folder: chosen.collection } : {}), downloadOnly: !chosen.prepare };
  }
  async match(remote, metadata, destination) {
    const type = destination.kind === 'film' ? 'movie' : destination.kind === 'series' ? 'tv' : '';
    if (!type) return null;
    await this.portal.connect();
    if (remote.match) return { ...remote.match, device: this.portal.current.device };
    const query = String(metadata.title || remote.title).replace(/[._]/g, ' ').replace(/\b(19|20)\d{2}\b.*$/, '').replace(/\bS\d{1,2}E\d{1,3}\b.*$/i, '').trim();
    try {
      const result = await this.portal.searchTitles(query, type);
      const normal = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const exact = result.results.filter(i => normal(i.title) === normal(query));
      return exact.length === 1 ? { ...exact[0], device: this.portal.current.device } : null;
    } catch { return null; }
  }
  async run(remote, state, signal) {
    let local = this.store.state.jobs.find(j => j.remoteId === (remote.localKey || remote.id));
    if (!local) {
      state.progress = { stage: 'downloading', message: remote.source.type === 'cloud' ? 'Downloading from iCloud' : 'Reading BBC programme details', percent: 0 };
      let input;
      if (remote.source.type === 'torrent' && remote.fileInput) input = remote.fileInput;
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
      input.match = await this.match(remote, input.metadata, destination);
      signal.throwIfAborted();
      input.remoteId = remote.localKey || remote.id; input.reservationKey = remote.resourceKey || remote.id; input.preserveOriginal = true;
      [local] = this.queue.add([input], destination);
      if (!local) throw new Error('This item is already queued.');
    } else if (remote.metadata_only) {
      await this.portal.connect();
      if (remote.match) local.match = { ...remote.match, device: this.portal.current.device };
      local.matchApplied = false;
      await this.queue.action(local.id, 'metadata');
    } else if (['paused', 'failed', 'waiting'].includes(local.status)) await this.queue.action(local.id, 'resume');
    state.local = local;
    while (!['complete', 'prepared', 'failed', 'cancelled', 'paused'].includes(local.status)) {
      if (signal.aborted) {
        if (!['complete', 'prepared', 'paused', 'cancelled'].includes(local.status)) await this.queue.action(local.id, 'pause');
        throw new Error('Stopped');
      }
      await delay(200);
    }
    if (local.status === 'failed') throw new Error(local.message);
    if (local.status === 'paused' || local.status === 'cancelled') throw new Error('Stopped');
    state.finishing = true;
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
      if (this.queue.releaseCloudCaches) await this.queue.releaseCloudCaches(remote, local, signal);
      cleanWorkingCopies(remote, local, this.store);
      state.progress = { status: 'complete', stage: 'complete', percent: 100, message: local.analysis?.compressionProof && !local.converted
        ? 'Existing copy kept: it already meets the selected size target' : 'Original kept: conversion would not save space',
        result: { complete: true, unchanged: true }, savedCloudPath: item.path };
      return;
    }
    let cloudPath = local.savedCloudPath || '';
    if ((remote.destination.saveCloud || remote.destination.kind === 'icloud') && !cloudCopiesComplete(remote, local)) {
      state.progress = { stage: 'saving-cloud', percent: 0, message: 'Saving to iCloud' };
      cloudPath = await saveCloud(remote, local, this.store, this.portal, signal, progress => {
        state.progress = { stage: 'saving-cloud', ...progress, message: progress.syncing ? 'Waiting for iCloud to confirm the file' : 'Saving to iCloud' };
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
    await replaceCloudOriginal(remote, local, this.store, this.portal, signal);
    if (this.queue.releaseCloudCaches && remote.destination.temporaryWork) {
      state.progress = { stage: 'freeing-space', percent: 100, message: 'Freeing the local iCloud cache' };
      await this.queue.releaseCloudCaches(remote, local, signal);
    }
    if (remote.destination.temporaryWork && !local.workingRemoved) { await verifyCloudCopies(remote, local, this.portal, signal); cleanWorkingCopies(remote, local, this.store); }
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
