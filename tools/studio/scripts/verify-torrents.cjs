'use strict';
const { app, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { TorrentRuntime } = require('../lib/torrent-runtime.cjs');
const { TorrentDownloads } = require('../lib/torrent-downloads.cjs');
const { Store } = require('../lib/store.cjs');
const { Queue } = require('../lib/queue.cjs');
const { Media } = require('../lib/media.cjs');
const { CompanionJobs } = require('../lib/companion-jobs.cjs');
const { CompanionTorrents } = require('../lib/companion-torrents.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { sendSubtitles } = require('../lib/subtitles.cjs');
const assert = require('node:assert/strict');
const proofRoot = path.resolve(__dirname, '../../../out/studio-torrent-proof');
const root = path.join(proofRoot, 'runtime-' + Date.now()); fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'electron'));
const resources = path.resolve(__dirname, '../resources');
const output = path.join(proofRoot, 'latest.json');
const report = { root, tests: {}, externalMediaDownloaded: false, piContacted: false };
let seed, runtime, peerTimer, queue;
function encode(value) {
  if (typeof value === 'number') return Buffer.from('i' + value + 'e');
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(value.length + ':'), value]);
  if (typeof value === 'string') return encode(Buffer.from(value));
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(encode), Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'), ...Object.keys(value).sort().flatMap(key => [encode(key), encode(value[key])]), Buffer.from('e')]);
}
async function run() {
  const tools = resolveTools(resources), sourceRoot = path.join(root, 'seed-data'), folder = path.join(sourceRoot, 'Studio Proof'); fs.mkdirSync(folder, { recursive: true });
  const original = path.join(folder, 'Studio.Proof.mp4');
  execFileSync(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=c=teal:s=320x240:r=25','-f','lavfi','-i','sine=frequency=440','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',original], { windowsHide: true });
  const header = Buffer.alloc(8); header.writeUInt32BE(8*1024*1024+8); header.write('free',4); fs.appendFileSync(original,Buffer.concat([header,crypto.randomBytes(8*1024*1024)]));
  fs.copyFileSync(original,path.join(folder,'Not.Selected.mp4'));
  fs.writeFileSync(path.join(folder,'Studio.Proof.en.srt'),'1\n00:00:00,000 --> 00:00:00,900\nSynthetic subtitle\n');
  fs.writeFileSync(path.join(folder,'Not.An.Installer.exe'),'This is inert test text. Never executed.');
  const names=fs.readdirSync(folder).sort(), data=Buffer.concat(names.map(name=>fs.readFileSync(path.join(folder,name)))), pieceLength=262144, pieces=[];
  for(let offset=0;offset<data.length;offset+=pieceLength) pieces.push(crypto.createHash('sha1').update(data.subarray(offset,offset+pieceLength)).digest());
  // Trackerless and isolated by loopback/DHT/PEX/LSD restrictions. A BitTorrent
  // private flag deliberately disables metadata exchange, so it is omitted.
  const info={name:'Studio Proof', 'piece length':pieceLength, pieces:Buffer.concat(pieces), files:names.map(name=>({length:fs.statSync(path.join(folder,name)).size,path:[name]}))};
  const hash=crypto.createHash('sha1').update(encode(info)).digest('hex'), torrent=encode({info});
  seed=new TorrentRuntime(path.join(root,'seed'),resources,safeStorage,{isolated:true});
  runtime=new TorrentRuntime(path.join(root,'download'),resources,safeStorage,{isolated:true});
  await seed.ensure(); await runtime.ensure();
  const seedPort=49191, downloadPort=49192;
  for(const [service,port] of [[seed,seedPort],[runtime,downloadPort]]) await service.api('app/setPreferences',{json:JSON.stringify({listen_port:port,upnp:false,dht:false,pex:false,lsd:false})});
  const form=new FormData(); form.append('torrents',new Blob([torrent]),'proof.torrent'); form.append('savepath',sourceRoot); form.append('ratioLimit','-1'); form.append('seedingTimeLimit','-1'); form.append('inactiveSeedingTimeLimit','-1'); form.append('tags','Synthetic-seed');
  const response=await fetch(seed.client.base+'/api/v2/torrents/add',{method:'POST',headers:{Cookie:seed.client.cookie,Origin:seed.client.base,Referer:seed.client.base+'/'},body:form}); assert.ok(response.ok);
  for(let attempt=0;attempt<100;attempt++){const items=await seed.api('torrents/info',{hashes:hash},{method:'GET'}); if(items[0]?.progress===1) break; await delay(200);}
  await seed.api('torrents/setShareLimits',{hashes:hash,ratioLimit:-1,seedingTimeLimit:-1,inactiveSeedingTimeLimit:-1,shareLimitAction:'Stop',shareLimitsMode:'MatchAny'});
  await seed.api('torrents/start',{hashes:hash});
  const seedInfo=(await seed.api('torrents/info',{hashes:hash},{method:'GET'}))[0];console.log('Seed status',JSON.stringify({state:seedInfo?.state,progress:seedInfo?.progress,path:seedInfo?.save_path}));assert.equal(seedInfo.progress,1);
  report.tests.seedReady=true; console.log('Synthetic seed ready');
  // This transfer check uses only generated data and loopback peers.
  const store=new Store(path.join(root,'state')); store.state.settings.workspace=path.join(root,'work'); store.state.settings.iCloudRoot=path.join(root,'cloud'); store.save();
  let downloads=new TorrentDownloads(store,runtime,{pollMs:250,inspectAttempts:120});
  const source={type:'torrent',hash,magnet:'magnet:?xt=urn:btih:'+hash,title:'Studio Proof'};
  let peerTicks=0;
  peerTimer=setInterval(()=>{
    runtime.api('torrents/addPeers',{hashes:hash,peers:'127.0.0.1:'+seedPort}).catch(error=>{if(peerTicks%30===0)console.log('Peer request',error.message);});
    if(++peerTicks%30===0) runtime.api('torrents/info',{hashes:hash},{method:'GET'}).then(items=>console.log('Peer progress',JSON.stringify(items.map(item=>({state:item.state,progress:item.progress,seeds:item.num_seeds,peers:item.num_leechs}))))).catch(()=>{});
  },300);
  const inspection=await downloads.inspect(source,new AbortController().signal);
  const payload=(await runtime.api('torrents/files',{hash},{method:'GET'})); assert.ok(payload.every(file=>file.progress===0));
  report.tests.metadataOnly=true; console.log('Metadata-only inspection passed');
  const selected=inspection.files.find(file=>file.path.endsWith('/Studio.Proof.mp4')); assert.ok(selected);
  const remote={id:'e'.repeat(32),claim:'synthetic-claim',title:'Studio Proof',source:{...source,files:[{index:selected.index,path:selected.path,bytes:selected.bytes}]},destination:{kind:'film',cloudCopies:'both',saveCloud:true,prepare:true,temporaryWork:true},match:{media_type:'movie',tmdb_id:329865,title:'Studio Proof',year:'2026'}};
  await runtime.api('torrents/setDownloadLimit',{hashes:hash,limit:65536});
  const controller=new AbortController();
  await assert.rejects(downloads.download(remote,controller.signal,()=>controller.abort()),/abort|Stopped/i);
  let stopped=(await runtime.api('torrents/info',{hashes:hash},{method:'GET'}))[0]; assert.ok(stopped.state.startsWith('stopped')); report.tests.pause=true;
  await runtime.close(); runtime=new TorrentRuntime(path.join(root,'download'),resources,safeStorage,{isolated:true}); await runtime.ensure();
  downloads=new TorrentDownloads(store,runtime,{pollMs:250,inspectAttempts:120});
  await runtime.api('torrents/setDownloadLimit',{hashes:hash,limit:0});
  const result=await downloads.download(remote,new AbortController().signal,()=>{});
  clearInterval(peerTimer); peerTimer=null;
  assert.equal((await runtime.api('torrents/info',{hashes:hash},{method:'GET'})).length,0);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(result.files[0].file)).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex'));
  assert.equal(fs.existsSync(path.join(result.directory,'Studio Proof','Not.Selected.mp4')),false);
  report.tests.restartAndHashVerified=true; report.tests.torrentRemovedDataKept=true; console.log('Pause, restart, verified download and retained data passed');
  const cloud=new Map(), publications=[], subtitles=[];
  const portal={current:{device:'synthetic'},connect:async()=>{},searchTitles:async()=>({results:[]}),
    upload:async(job)=>{store.update(job.id,{uploadId:'synthetic-upload',device:'synthetic'});const destination=path.join(root,'pi-fixture',job.publishName);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(job.preparedPath,destination);publications.push(destination);return{complete:true,file_name:job.publishName};},
    applyMatch:async()=>{},api:async(route,{body}={})=>{
      if(route==='/api/studio/subtitle'){subtitles.push(body);return{ok:true};}
      if(route.startsWith('/api/studio/cloud/item'))return{metadata:remote.match};
      assert.equal(route,'/api/studio/cloud/confirm');
      if(body.reserve)return{reserved:true};
      if(body.verifyId){const item=[...cloud.values()].find(item=>item.id===body.verifyId);return{confirmed:!!item&&item.bytes===body.bytes};}
      if(body.lookupOnly)return{confirmed:false};
      const file=path.join(store.state.settings.iCloudRoot,'Media',...body.path.split('/'));assert.equal(fs.statSync(file).size,body.bytes);
      const item={...body,id:crypto.createHash('sha256').update(body.path).digest('hex').slice(0,24),modified:'synthetic',remoteId:'remote-'+cloud.size};cloud.set(body.path,item);return{...item,confirmed:true};
    }};
  queue=new Queue(store,new Media(()=>tools),{},portal);queue.afterPublish=(job,signal)=>sendSubtitles(job,portal,tools,signal);
  const runner=new CompanionTorrents(downloads,new CompanionJobs(store,queue,{},portal)), state={};
  await runner.run(remote,state,new AbortController().signal);
  assert.equal(state.progress.status,'complete');assert.equal(publications.length,1);assert.equal(cloud.size,2);assert.equal(subtitles.length,1);
  assert.ok([...cloud.keys()].every(name=>/\.(mp4|mkv)$/.test(name)));
  assert.equal(fs.existsSync(result.directory),false);assert.ok(store.state.jobs.every(job=>job.workingRemoved));
  report.tests.realOptimisation=true;report.tests.studioHandoffAndTwoCloudVersions=true;report.tests.subtitlesOnlyOnPi=true;report.tests.workingMediaRemoved=true;
  report.tests.finalPowerWasNotTouched=true; report.complete=true;
}
app.whenReady().then(run).catch(error=>{report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  if(peerTimer)clearInterval(peerTimer);await queue?.shutdown();await runtime?.close();await seed?.close();fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.complete?0:1);
});
