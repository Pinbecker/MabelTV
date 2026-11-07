'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const runner = require('../lib/process.cjs');
const srt = '1\n00:00:01,000 --> 00:00:02,000\nDialogue\n';
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'studio-subtitle-proof-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const local = {id:'local',sourcePath:path.join(root,'Film.mkv'),directory:root,sourceAnalysis:{subtitleStreams:[]}};
  fs.writeFileSync(local.sourcePath,'video');
  const commands = [];
  t.mock.method(runner,'run', async (_tool,args) => {
    commands.push(args);
    const target = args.at(-1);
    fs.writeFileSync(target,target.endsWith('.mks') ? 'lossless subtitle archive' : srt.replace('Dialogue','Track ' + args[args.indexOf('-map')+1]));
    return '';
  });
  for(const name of ['subtitles','archive-subtitles']) delete require.cache[require.resolve('../lib/' + name + '.cjs')];
  return {root,local,commands,...require('../lib/subtitles.cjs'),...require('../lib/archive-subtitles.cjs')};
}
test('all included text tracks survive and sidecars never cross container versions',async t => {
  const f=setup(t);
  fs.writeFileSync(path.join(f.root,'Film.mkv.en.srt'),srt);
  fs.writeFileSync(path.join(f.root,'Film.mp4.en.srt'),srt.replace('Dialogue','Wrong version'));
  f.local.sourceAnalysis.subtitleStreams=[{index:2,codec_type:'subtitle',codec_name:'subrip',tags:{language:'eng',title:'Full dialogue'}},{index:3,codec_type:'subtitle',codec_name:'ass',tags:{language:'eng',title:'Signs only'}}];
  const tracks=await f.subtitleFiles(f.local,{ffmpeg:'fake'},new AbortController().signal);
  assert.equal(tracks.length,3);
  assert.ok(tracks.every(track=>!fs.readFileSync(track.path,'utf8').includes('Wrong version')));
  assert.deepEqual(f.commands.map(args=>args[args.indexOf('-map')+1]),['0:2','0:3']);
  assert.ok(tracks.some(track=>track.label==='Signs only'));
});
test('cloud archive keeps alternative text tracks and marks preservation only after the writes succeed',async t => {
  const f=setup(t), calls=[], updates=[];
  fs.writeFileSync(path.join(f.root,'Film.en.srt'),srt);
  fs.writeFileSync(path.join(f.root,'Film.release.en.srt'),srt.replace('Dialogue','Other release'));
  f.local.savedCloudCopies={optimised:{id:'cloud-output',confirmed:true}};
  await f.archiveSubtitles({destination:{saveCloud:true},source:{type:'torrent'}},f.local,
    {update:(_id,value)=>updates.push(value)}, {api:async(route,options)=>{calls.push({route,...options.body});return{};}}, {},new AbortController().signal);
  assert.equal(calls.length,2);assert.deepEqual(calls.map(call=>call.activate),[true,false]);
  assert.equal(updates.at(-1).subtitlesArchived,true);
  assert.equal(updates.at(-1).subtitlePreservation.tracks,2);
});
test('image subtitles are losslessly archived and verified before an original can be discarded',async t => {
  const f=setup(t),calls=[],updates=[];
  f.local.savedCloudCopies={optimised:{id:'cloud-output',confirmed:true}};
  f.local.sourceAnalysis.subtitleStreams=[{codec_type:'subtitle',codec_name:'hdmv_pgs_subtitle',index:2}];
  const iCloudRoot=path.join(f.root,'iCloud');fs.mkdirSync(path.join(iCloudRoot,'Media'),{recursive:true});
  await f.archiveSubtitles({destination:{saveCloud:true},source:{type:'torrent'}},f.local,
    {state:{settings:{iCloudRoot}},update:(_id,value)=>updates.push(value)},
    {api:async(route,options)=>{calls.push(route);return route.includes('/item?')?{path:'Films/Film.mp4'}:{confirmed:true};}},
    {ffmpeg:'fake'},new AbortController().signal);
  assert.equal(fs.readFileSync(path.join(iCloudRoot,'Media','Films','Film.mp4.original-subtitles.mks'),'utf8'),'lossless subtitle archive');
  assert.ok(f.commands[0].join(' ').includes('-map 0:s -c copy'));
  assert.ok(calls.includes('/api/studio/subtitles/archive-verify'));
  assert.equal(updates.at(-1).subtitlesArchived,true);
});

test('sending a cloud copy to the Pi forwards its subtitle choices without replacing iCloud',async t => {
  const f=setup(t),calls=[];
  f.local.result={complete:true,kind:'my_tv',folder:'Films',file_name:'Film.mp4'};
  const remote={id:'remote',claim:'claim',destination:{saveCloud:false,cloudCopies:'original'},source:{type:'cloud'}};
  const store={update:(_id,value)=>Object.assign(f.local,value)};
  const portal={api:async(route,options)=>{calls.push({route,...options.body});return{};}};
  await f.archiveSubtitles(remote,f.local,store,portal,{},new AbortController().signal);
  assert.deepEqual(calls,[{route:'/api/studio/subtitles/forward',job:'remote',claim:'claim',target:{kind:'my_tv',file:'Films/Film.mp4'}}]);
  assert.equal(f.local.piSubtitlesForwarded,true);
  assert.equal(f.local.subtitlesArchived,undefined);
  await f.archiveSubtitles(remote,f.local,store,portal,{},new AbortController().signal);
  assert.equal(calls.length,1);
});

test('a failed subtitle forward remains retryable even after cloud preservation completed',async t => {
  const f=setup(t);
  f.local.subtitlesArchived=true;
  f.local.result={complete:true,kind:'my-tv-series',series_id:'series-id',season:2,file_name:'Episode 3.mp4'};
  const remote={id:'remote',claim:'claim',destination:{saveCloud:true},source:{type:'cloud'}};
  const store={update:(_id,value)=>Object.assign(f.local,value)};
  await assert.rejects(f.archiveSubtitles(remote,f.local,store,{api:async()=>{throw new Error('Offline');}},{},new AbortController().signal),/Offline/);
  assert.equal(f.local.piSubtitlesForwarded,undefined);
  let target;
  await f.archiveSubtitles(remote,f.local,store,{api:async(_route,options)=>{target=options.body.target;}},{},new AbortController().signal);
  assert.deepEqual(target,{kind:'my-tv-series',series:'series-id',file:'Season 2/Episode 3.mp4'});
  assert.equal(f.local.piSubtitlesForwarded,true);
});
