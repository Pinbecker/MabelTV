'use strict';
// Explicit opt-in development check. Publishes only a generated test clip, then
// moves it to the server's recoverable recycle bin through supported APIs.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Store } = require('../lib/store.cjs');
const { Portal } = require('../lib/portal.cjs');
const { Media } = require('../lib/media.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { run } = require('../lib/process.cjs');

async function main() {
  if (!process.argv.includes('--run')) throw new Error('Use --run to explicitly run the live upload check.');
  const root = path.resolve(__dirname, '../../../out/studio-live-smoke');
  fs.mkdirSync(root, { recursive: true });
  const store = new Store(root), portal = new Portal(store);
  const connected = await portal.connect('local');
  const library = await portal.api('/api/library');
  if (library.uploads.some(job => !['complete', 'error', 'refresh-error'].includes(job.status))) throw new Error('A live upload is already in progress. Retry the smoke after it finishes.');
  const tools = resolveTools(''), media = new Media(() => tools);
  const original = path.join(root, 'original.mkv');
  await run(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=c=0x224c3d:s=320x180:r=25','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-c:v','mpeg4','-c:a','mp3',original]);
  const output = await media.prepare(original, path.join(root, 'prepared.mp4'), 'mabel', new AbortController().signal, () => {});
  const channel = connected.catalogue.channels.find(channel => channel.number === 11);
  const series = connected.catalogue.series.find(series => series.title === 'Ludwig' && series.seasons.includes(2));
  if (!channel || !series) throw new Error('The expected development smoke destinations are unavailable.');
  const suffix = crypto.randomBytes(4).toString('hex');
  const destinations = [{ kind: 'film', label: 'My TV' }, { kind: 'mabel', channel: channel.number, label: channel.name },
    { kind: 'series', series: series.id, season: 2, label: 'Ludwig series 2' }];
  const evidence = [];
  for (const destination of destinations) {
    const publishName = `Studio connection check ${destination.kind} ${suffix}.mp4`;
    const job = { preparedPath: output.file, publishName, destination, uploadId: '' };
    const result = await portal.upload(job, store.state.sourceId, new AbortController().signal, fields => Object.assign(job, fields));
    const after = await portal.api('/api/library');
    const found = destination.kind === 'film' ? after.my_tv_library.some(item => item.file === publishName || item.file_name === publishName || item.path === publishName)
      : destination.kind === 'mabel' ? after.channels.find(channel => channel.number === destination.channel).programmes.some(item => item.name === publishName)
      : after.my_tv_series.find(series => series.id === destination.series).episodes.some(item => item.path === 'Season 2/' + publishName);
    const cleanup = destination.kind === 'film' ? { action: 'trash-my-tv', file: publishName }
      : destination.kind === 'mabel' ? { action: 'trash', channel: destination.channel, file: publishName }
      : { action: 'trash-my-tv-series', scope: 'episode', series: destination.series, file: 'Season 2/' + publishName };
    await portal.api('/api/manage', { method: 'POST', body: cleanup });
    // Clean up even if the independent catalogue assertion fails.
    if (!found) throw new Error('Server completion was reported but the clip was not found in the live catalogue: ' + publishName);
    evidence.push({ kind: destination.kind, publication: result.status, cleanup: 'recoverable recycle bin', uploadId: job.uploadId });
    console.log(destination.kind + ': published, independently found, and moved to the recycle bin');
  }
  fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), device: connected.device, evidence }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
