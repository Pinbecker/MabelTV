'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { beneath, copy } = require('./cloud-files.cjs');
const { safeName } = require('./queue.cjs');

function archiveFiles(remote, local) {
  const chosen = remote.destination.cloudCopies || (remote.destination.kind === 'icloud' && remote.destination.prepare ? 'optimised' : 'original');
  if (!['original', 'optimised', 'both'].includes(chosen)) throw new Error('Choose Original, Optimised or Both for iCloud.');
  const original = local.sourcePath, optimised = local.cloudPreparedPath || local.preparedPath;
  const wanted = chosen === 'both' ? ['original', 'optimised'] : [chosen];
  if (wanted.includes('original') && local.sourceFingerprint) {
    const current = fs.statSync(original);
    if (current.size !== local.sourceFingerprint.size || current.mtimeMs !== local.sourceFingerprint.mtime) throw new Error('The original file changed. Add its current version before archiving it.');
  }
  if (wanted.includes('optimised') && (!optimised || !fs.existsSync(optimised))) throw new Error('The optimised copy is no longer available. Prepare this item again before saving it.');
  if (chosen === 'both' && path.resolve(original) === path.resolve(optimised)) return [{ file: original, variants: ['original', 'optimised'] }];
  return wanted.map(variant => ({ file: variant === 'original' ? original : optimised, variants: [variant] }));
}
function archivePath(remote, local, item) {
  const metadata = local.metadata || {}, match = local.match || remote.match || {};
  const kids = remote.destination.kind === 'mabel' || /^(?:cbeebies|cbbc)$/i.test(metadata.channel || '');
  const episode = Number.isInteger(metadata.series) && metadata.series >= 0 && Number.isInteger(metadata.episodeNumber) && metadata.episodeNumber > 0;
  const marker = item.variants.length === 1 && item.variants[0] === 'optimised' ? ' [Optimised]' : '';
  const suffix = ' - ' + local.id.slice(0, 8) + marker + path.extname(item.file);
  if (remote.source.type === 'cloud') {
    const source = remote.source.currentPath || remote.source.path;
    const stem = path.posix.basename(source, path.posix.extname(source)).replace(/\s*\[Optimised\]$/i, '').replace(/\s+-\s+[a-f0-9]{8}$/i, '');
    return path.posix.join(path.posix.dirname(source), stem + suffix);
  }
  return episode ? [kids ? 'Kids/TV' : 'TV', safeName(match.title || metadata.title), 'Season ' + metadata.series,
    `S${String(metadata.series).padStart(2, '0')}E${String(metadata.episodeNumber).padStart(2, '0')} - ${safeName(metadata.episode || metadata.title)}${suffix}`].join('/')
    : [kids ? 'Kids/Films' : 'Films', safeName(match.title || metadata.title || path.basename(item.file, path.extname(item.file))) +
      (match.year ? ' (' + match.year + ')' : '') + suffix].join('/');
}
async function saveCloud(remote, local, store, portal, signal, progress = () => {}) {
  let cloudOriginal;
  if (remote.source.type === 'cloud') {
    cloudOriginal = await portal.api('/api/studio/cloud/item?id=' + encodeURIComponent(remote.source.id), { signal });
    if (cloudOriginal.bytes !== remote.source.bytes || cloudOriginal.modified !== remote.source.modified || cloudOriginal.remoteId !== remote.source.remoteId) throw new Error('The iCloud original changed. Refresh and confirm its version again.');
    remote = { ...remote, source: { ...remote.source, currentPath: cloudOriginal.path } };
    const adopted = await portal.api('/api/studio/cloud/confirm', { method: 'POST', body: {
      path: cloudOriginal.path, bytes: cloudOriginal.bytes, archiveGroup: remote.source.archiveGroup,
      variants: remote.source.variants?.length ? remote.source.variants : ['original'],
      publicationJob: remote.id, title: local.metadata?.title || remote.title || '', match: local.match || remote.match || null,
      ...(local.sourceAnalysis?.compressionProof ? { encodingProfile: local.sourceAnalysis.compressionProof.profile,
        encodingSourceBytes: local.sourceAnalysis.compressionProof.sourceBytes } : {}),
    }, signal });
    if (!adopted.confirmed) throw new Error('iCloud has not confirmed the original. It was kept.');
  }
  const root = store.state.settings.iCloudRoot || path.join(process.env.USERPROFILE, 'iCloudDrive');
  const assets = archiveFiles(remote, local);
  const saved = { ...(local.savedCloudCopies || {}) };
  // A previously confirmed legacy original need not be uploaded again after
  // the organiser moves it. New copies use independent per-variant receipts.
  if (local.savedCloudPath && !Object.keys(saved).length) {
    const legacyRole = remote.destination.kind === 'icloud' && remote.destination.prepare ? 'optimised' : 'original';
    saved[legacyRole] = { path: local.savedCloudPath, confirmed: true, legacy: true };
  }
  for (const [index, asset] of assets.entries()) {
    if (asset.variants.every(variant => saved[variant])) continue;
    if (signal.aborted) throw new Error('Stopped');
    const relative = archivePath(remote, local, asset);
    const variant = asset.variants[0];
    const existingSource = cloudOriginal && path.resolve(asset.file) === path.resolve(local.sourcePath);
    const proof = (asset.file === local.cloudPreparedPath ? local.cloudPreparedAnalysis : asset.file === local.preparedPath ? local.analysis : null)?.compressionProof;
    const confirmation = { path: existingSource ? cloudOriginal.path : relative, bytes: fs.statSync(asset.file).size, variants: asset.variants,
      ...(proof ? { encodingProfile: proof.profile, encodingSourceBytes: proof.sourceBytes } : {}),
      archiveGroup: remote.source.archiveGroup || local.id, publicationJob: remote.id,
      archiveAsset: local.id + ':' + asset.variants.join('+'),
      title: local.metadata?.title || remote.title || '', match: local.match || remote.match || null };
    if (existingSource) {
      const adopted = await portal.api('/api/studio/cloud/confirm', { method: 'POST', body: confirmation, signal });
      if (!adopted.confirmed) throw new Error('iCloud has not confirmed the existing original. It was kept.');
      for (const role of asset.variants) saved[role] = { path: adopted.path || cloudOriginal.path, id: adopted.id || cloudOriginal.id, bytes: confirmation.bytes, modified: adopted.modified || cloudOriginal.modified, remoteId: adopted.remoteId || cloudOriginal.remoteId, asset: confirmation.archiveAsset, confirmed: true };
      store.update(local.id, { savedCloudCopies: { ...saved }, savedCloudPath: Object.values(saved)[0].path });
      continue;
    }
    const reserved = await portal.api('/api/studio/cloud/confirm', { method: 'POST', body: { ...confirmation, reserve: true, claim: remote.claim }, signal });
    if (!reserved.reserved) throw new Error('iCloud could not reserve this archive copy. Retry after reconnecting Studio.');
    const existing = await portal.api('/api/studio/cloud/confirm', { method: 'POST', body: { ...confirmation, lookupOnly: true }, signal });
    if (existing.confirmed) {
      await portal.api('/api/studio/cloud/confirm', { method: 'POST', body: { ...confirmation, path: existing.path || relative }, signal });
      for (const role of asset.variants) saved[role] = { path: existing.path || relative, id: existing.id || '', bytes: confirmation.bytes, modified: existing.modified || '', remoteId: existing.remoteId || '', asset: confirmation.archiveAsset, confirmed: true };
      store.update(local.id, { savedCloudCopies: { ...saved }, savedCloudPath: Object.values(saved)[0].path });
      continue;
    }
    const update = detail => progress({ ...detail, percent: (index + (detail.percent || 0) / 100) / assets.length * 100 });
    await copy(asset.file, beneath(path.join(root, 'Media'), relative), signal, update,
      path.join(local.directory, 'cloud-copy-' + variant + '.json'));
    let result, reconnects = 0;
    progress({ percent: (index + 1) / assets.length * 100, syncing: true });
    for (;;) {
      if (signal.aborted) throw new Error('Stopped');
      try {
        result = await portal.api('/api/studio/cloud/confirm', { method: 'POST', body: confirmation, signal, timeout: 180000 });
      } catch (error) {
        if (error.code !== 'OFFLINE' || ++reconnects > 2 || signal.aborted) throw error;
        portal.current = null;
        progress({ percent: (index + 1) / assets.length * 100, syncing: true });
        await delay(12000, undefined, { signal });
        continue;
      }
      if (result.confirmed) break;
      progress({ percent: (index + 1) / assets.length * 100, syncing: true });
      await delay(12000, undefined, { signal });
    }
    const receipt = { path: result.path || relative, id: result.id || '', bytes: confirmation.bytes, modified: result.modified || '', remoteId: result.remoteId || '', asset: confirmation.archiveAsset, confirmed: true };
    for (const role of asset.variants) saved[role] = receipt;
    store.update(local.id, { savedCloudCopies: { ...saved }, savedCloudPath: Object.values(saved)[0].path });
  }
  return Object.values(saved)[0]?.path || '';
}
function cloudCopiesComplete(remote, local) {
  if (!remote.destination.cloudCopies) return Boolean(local.savedCloudPath);
  const roles = remote.destination.cloudCopies === 'both' ? ['original', 'optimised'] : [remote.destination.cloudCopies];
  return roles.every(role => local.savedCloudCopies?.[role]?.confirmed);
}
async function replaceCloudOriginal(remote, local, store, portal, signal) {
  if (remote.source?.type !== 'cloud' || remote.destination.cloudCopies !== 'optimised' || local.cloudOriginalRemoved) return;
  const output = local.savedCloudCopies?.optimised;
  if (!remote.destination.replaceCloudOriginal || !output?.id) throw new Error('Confirm the original replacement before continuing. Choose Both to keep it.');
  let result = await portal.api('/api/studio/cloud/replace-original', { method: 'POST', body: {
    job: remote.id, claim: remote.claim, output: output.id, upload: local.uploadId,
  }, signal });
  for (;;) {
    if (result.complete || result.status === 'complete') break;
    if (result.status === 'failed') throw new Error(result.error || 'The original was kept. Refresh iCloud and retry the replacement.');
    await delay(3000, undefined, { signal });
    const status = await portal.api('/api/studio/status', { signal });
    const operation = status.cloudOperations.find(value => value.id === result.id);
    if (!operation) throw new Error('The cloud replacement receipt could not be found. The saved copies were kept.');
    result = operation;
  }
  store.update(local.id, { cloudOriginalRemoved: true });
}
async function verifyCloudCopies(remote, local, portal, signal) {
  const roles = remote.destination.cloudCopies === 'both' ? ['original', 'optimised'] : [remote.destination.cloudCopies || 'original'];
  const unique = new Map();
  for (const role of roles) {
    const receipt = local.savedCloudCopies?.[role];
    if (!receipt?.confirmed || !receipt.bytes) throw new Error('The cloud copy needs confirmation before working files can be removed.');
    if (!unique.has(receipt.id || receipt.path)) unique.set(receipt.id || receipt.path, { receipt, roles: [] });
    unique.get(receipt.id || receipt.path).roles.push(role);
  }
  for (const { receipt } of unique.values()) {
    const result = await portal.api('/api/studio/cloud/confirm', { method: 'POST', body: {
      verifyId: receipt.id, path: receipt.path, bytes: receipt.bytes, modified: receipt.modified,
      remoteId: receipt.remoteId, lookupOnly: true,
    }, signal });
    if (!result.confirmed) throw new Error('iCloud could not confirm a retained copy. Working files were kept.');
  }
}
async function archiveMatch(remote, local, portal, signal) {
  if (local.match || !['film', 'series'].includes(remote.destination.kind)) return local.match;
  const receipt = Object.values(local.savedCloudCopies || {}).find(value => value.id);
  if (!receipt) return null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const item = await portal.api('/api/studio/cloud/item?id=' + encodeURIComponent(receipt.id), { signal });
    const match = item.metadata;
    if (match?.media_type === (remote.destination.kind === 'film' ? 'movie' : 'tv') && match.tmdb_id) {
      if (!portal.current) await portal.connect();
      return { ...match, device: portal.current.device };
    }
    if (['unmatched', 'unavailable'].includes(item.match_status)) break;
    await delay(5000, undefined, { signal });
  }
  return null;
}
module.exports = { archiveFiles, archivePath, saveCloud, cloudCopiesComplete, replaceCloudOriginal, verifyCloudCopies, archiveMatch };
