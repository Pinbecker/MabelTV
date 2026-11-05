'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Media } = require('../lib/media.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { run } = require('../lib/process.cjs');
const compressed = {ready:true, bytes:2e9, duration:8200, width:1920, height:800, fps:24, hasAudio:true, sar:1};

test('a compressed but compatible download continues unchanged without invoking the encoder', async () => {
 const media = new Media(() => { throw Error('No encoder needed'); });
 media.inspect = async () => compressed;
 const result = await media.prepare('existing.mp4','output.mp4','mytv',undefined,undefined,undefined,'compact');
 assert.equal(result.file,'existing.mp4'); assert.equal(result.converted,false);
 assert.equal(result.compression,'compatible'); assert.equal(result.analysis.ready,true);
});

test('explicit iCloud space optimisation still requires consent to recompress a risky file', async () => {
 const media = new Media(() => ({ffmpeg:'unused'})); media.inspect=async()=>compressed;
 await assert.rejects(media.prepare('existing.mp4','output.mp4','mytv',undefined,undefined,undefined,'compact',{spaceOnly:true}),e=>e.code==='QUALITY_REVIEW');
});

test('a small compressed download in the wrong container is remuxed and validated before delivery', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-delivery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const tools=resolveTools(path.resolve(__dirname,'../resources')), media=new Media(()=>tools);
 const source=path.join(root,'source.mkv'),dest=path.join(root,'ready.mp4');
 await run(tools.ffmpeg,['-v','error','-y','-f','lavfi','-i','color=size=1920x1080:rate=24','-t','2','-c:v','libx264','-pix_fmt','yuv420p',source]);
 const original=fs.readFileSync(source), before=await media.inspect(source,'mytv');
 assert.equal(before.ready,false);
 const result=await media.prepare(source,dest,'mytv',undefined,undefined,undefined,'compact');
 assert.equal(result.remuxed,true);assert.equal(result.analysis.ready,true);
 assert.equal(result.compression,'compatible');assert.equal(result.analysis.width,1920);
 assert.deepEqual(fs.readFileSync(source),original);
 await run(tools.ffmpeg,['-v','error','-xerror','-i',dest,'-f','null','-']);
});

test('compressed HEVC is converted to validated H264 instead of bypassing Pi format checks', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-codec-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const tools=resolveTools(path.resolve(__dirname,'../resources')), media=new Media(()=>tools);
 const {ensureIntel}=require('../lib/compression.cjs');
 try {await ensureIntel(tools);} catch(error) {if(process.env.MABEL_STUDIO_REQUIRE_INTEL==='1')throw error;t.skip('Intel hardware unavailable');return;}
 const source=path.join(root,'source.mp4'),dest=path.join(root,'ready.mp4');
 await run(tools.ffmpeg,['-v','error','-y','-f','lavfi','-i','color=size=960x540:rate=24','-t','2','-c:v','libx265','-x265-params','log-level=error','-pix_fmt','yuv420p','-movflags','+faststart',source]);
 const original=fs.readFileSync(source);
 assert.equal((await media.inspect(source,'mytv')).ready,false);
 const result=await media.prepare(source,dest,'mytv',undefined,undefined,undefined,'compact');
 assert.equal(result.converted,true);assert.equal(result.analysis.ready,true);
 assert.equal(result.analysis.codec,'h264');assert.equal(result.compression,'compatible');
 assert.deepEqual(fs.readFileSync(source),original);
 await run(tools.ffmpeg,['-v','error','-xerror','-i',dest,'-f','null','-']);
});
