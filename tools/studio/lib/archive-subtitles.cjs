'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { subtitleFiles } = require('./subtitles.cjs');
const { run } = require('./process.cjs');
const { copy, beneath } = require('./cloud-files.cjs');

async function archiveSubtitles(remote, local, store, portal, tools, signal) {
  if (remote.source.type === 'cloud' && local.result?.complete && local.result.kind && !local.piSubtitlesForwarded) {
    const result = local.result, target = {kind:result.kind,file:result.kind === 'my_tv' ? [result.folder,result.file_name].filter(Boolean).join('/') : result.kind === 'my-tv-series' ? `Season ${result.season}/${result.file_name}` : result.file_name};
    if (result.kind === 'my-tv-series') target.series = result.series_id;
    if (result.kind === 'channel') target.channel = result.channel;
    await portal.api('/api/studio/subtitles/forward',{method:'POST',body:{job:remote.id,claim:remote.claim,target},signal,timeout:180000});
    store.update(local.id,{piSubtitlesForwarded:true});
  }
  if (local.subtitlesArchived || !(remote.destination.saveCloud || remote.destination.kind === 'icloud')) return;
  let tracks;
  try { tracks = await subtitleFiles(local, tools, signal); }
  catch (error) { if (!/image-based subtitles/.test(error.message)) throw error; tracks = []; }
  const copies = [...new Map(Object.values(local.savedCloudCopies || {}).filter(copy => copy.confirmed && copy.id).map(copy => [copy.id,copy])).values()];
  if (!copies.length) throw new Error('Wait for the iCloud video before preserving its subtitles.');
  for (const receipt of copies) {
    for (const [index, track] of tracks.entries()) {
      await portal.api('/api/studio/subtitles/receive', { method:'POST', body:{ source:{kind:'cloud',id:receipt.id},
        label:'Included with download · ' + (track.label || path.basename(track.path)), data:fs.readFileSync(track.path).toString('base64'), activate:index === 0 }, signal, timeout:180000 });
    }
    if (remote.source.type === 'cloud') await portal.api('/api/studio/subtitles/forward', {method:'POST', body:{job:remote.id,claim:remote.claim,target:{kind:'cloud',id:receipt.id}}, signal,timeout:180000});
  }
  const originalRetained = local.savedCloudCopies?.original?.confirmed || remote.source.type === 'cloud' && remote.destination.cloudCopies !== 'optimised';
  if (!originalRetained) {
    const streams = local.sourceAnalysis?.subtitleStreams || JSON.parse(await run(tools.ffprobe,
      ['-v','error','-select_streams','s','-show_streams','-of','json',local.sourcePath],{signal,timeout:15000})).streams || [];
    if (streams.length) {
      const retained = path.join(local.directory,'Prepared','Original-subtitles.mks');
      fs.mkdirSync(path.dirname(retained),{recursive:true});
      if (!fs.existsSync(retained)) await run(tools.ffmpeg,['-v','error','-y','-i',local.sourcePath,'-map','0:s','-c','copy',retained],{signal});
      for (const receipt of copies) {
        const item = await portal.api('/api/studio/cloud/item?id=' + encodeURIComponent(receipt.id),{signal});
        const relative = item.path + '.original-subtitles.mks';
        const root = store.state.settings.iCloudRoot || path.join(process.env.USERPROFILE,'iCloudDrive');
        await copy(retained,beneath(path.join(root,'Media'),relative),signal,()=>{},path.join(local.directory,'subtitle-copy-' + receipt.id + '.json'));
        for (;;) {
          const result = await portal.api('/api/studio/subtitles/archive-verify',{method:'POST',body:{source:{kind:'cloud',id:receipt.id},bytes:fs.statSync(retained).size},signal,timeout:180000});
          if (result.confirmed) break;
          await delay(12000,undefined,{signal});
        }
      }
    }
  }
  store.update(local.id,{subtitlesArchived:true,subtitleWarning:'',subtitlePreservation:{cloudCopies:copies.map(copy=>copy.id),tracks:tracks.length,embeddedPreserved:true}});
}
module.exports = { archiveSubtitles };
