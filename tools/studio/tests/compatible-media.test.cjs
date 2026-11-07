'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Media } = require('../lib/media.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { run } = require('../lib/process.cjs');

test('every TV profile converts 50 fps to 25 fps, validates the full copy, and leaves the source intact', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-25fps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tools = resolveTools(''), media = new Media(() => tools);
  const source = path.join(root, 'original.mp4');
  await run(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=size=1920x1080:rate=50',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8',
    '-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',source]);
  const original = fs.readFileSync(source);
  const audioHash = file => run(tools.ffmpeg,['-v','error','-i',file,'-map','0:a:0','-c:a','copy','-f','hash','-hash','sha256','-']);
  for(const target of ['mytv','mabel']) for(const profile of ['compatible','balanced','compact','smallest']) {
    await t.test(target+' '+profile, async()=>{
      const destination=path.join(root,target+'-'+profile+'.mp4');
      const result = await media.prepare(source,destination,target,undefined,undefined,undefined,profile,{allowRisk:true});
      assert.equal(result.converted,true); assert.equal(result.encoding.profile,profile);
      assert.equal(result.analysis.ready,true); assert.equal(result.analysis.fps,25);
      assert.equal(result.analysis.frameCount,200);
      assert.deepEqual([result.analysis.width,result.analysis.height],target==='mytv'?[1920,1080]:[1280,720]);
      assert.deepEqual(fs.readFileSync(source),original);
      if(profile==='compatible') assert.equal(await audioHash(source),await audioHash(destination));
      else assert.ok(result.analysis.bytes<original.length);
      const again = await media.prepare(destination,path.join(root,'again.mp4'),target,undefined,undefined,undefined,profile);
      assert.equal(again.converted,false,'a prepared 25 fps copy must not be encoded again');
      await run(tools.ffmpeg,['-v','error','-xerror','-i',destination,'-f','null','-']);
    });
  }
});

test('compatibility delivery preserves H264 picture bytes while correcting DTS surround and MKV', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-audio-only-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tools = resolveTools(''), media = new Media(() => tools);
  const source = path.join(root, 'original.mkv'), destination = path.join(root, 'compatible.mp4');
  await run(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=25',
    '-f','lavfi','-i','anullsrc=channel_layout=5.1:sample_rate=48000','-t','2',
    '-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','dca','-strict','-2','-b:a','768k',source]);
  const original = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const initial = await media.inspect(source, 'mytv');
  assert.ok(initial.reasons.includes('AAC audio')); assert.ok(initial.reasons.includes('stereo audio'));
  const progress = [];
  const result = await media.prepare(source,destination,'mytv',undefined,p=>progress.push(p),undefined,'compatible');
  assert.equal(result.videoCopied,true); assert.equal(result.audioConverted,true);
  assert.equal(result.preparationReport.method,'picture-copied');
  assert.ok(result.preparationReport.sizeChangePercent < 3);
  assert.equal(result.compression,'compatible'); assert.equal(result.analysis.ready,true);
  assert.equal(result.analysis.fps,25); assert.deepEqual([result.analysis.width,result.analysis.height],[640,360]);
  const pictureHash = file => run(tools.ffmpeg,['-v','error','-i',file,'-map','0:v:0','-c:v','copy',
    '-bsf:v','h264_mp4toannexb','-f','hash','-hash','sha256','-']);
  assert.equal(await pictureHash(source),await pictureHash(destination),'the original compressed picture stream must be byte-for-byte identical');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),original);
  const probe = JSON.parse(await run(tools.ffprobe,['-v','error','-show_streams','-of','json',destination]));
  const audio = probe.streams.find(stream=>stream.codec_type==='audio');
  assert.equal(audio.codec_name,'aac'); assert.equal(audio.channels,2); assert.ok(progress.some(p=>p>0));
  await run(tools.ffmpeg,['-v','error','-xerror','-i',destination,'-f','null','-']);
});

test('low-bitrate legacy AVI conversion does not expand to the playback ceiling', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-avi-budget-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const tools=resolveTools(''),media=new Media(()=>tools);
  const source=path.join(root,'legacy.avi'),destination=path.join(root,'compatible.mp4');
  await run(tools.ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=size=720x304:rate=24000/1001',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','20','-c:v','mpeg4','-b:v','900k',
    '-c:a','ac3','-b:a','384k','-ac','6',source]);
  const before=fs.readFileSync(source);
  const result=await media.prepare(source,destination,'mytv',undefined,undefined,undefined,'compatible');
  assert.ok(result.analysis.ready); assert.ok(result.analysis.bytes <= before.length*1.03);
  assert.ok(result.encoding.videoBitrate < 1500000);
  assert.equal(result.preparationReport.method,'video-encoded');
  assert.equal(result.preparationReport.encoding.sizePolicyVersion,1);
  assert.deepEqual(fs.readFileSync(source),before);
  await run(tools.ffmpeg,['-v','error','-xerror','-i',destination,'-f','null','-']);
});
