'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {outputFrameRate,outputLevel,compressionPlan,compressionProof,videoFilters}=require('../lib/compression.cjs');
const {analyse}=require('../lib/media.cjs');
const facts={width:1920,height:1080,bytes:3.5e9,duration:7200,hasAudio:true,ready:false,sar:1};
test('source cadence is preserved and H264 level matches the encoded frame size and rate',()=>{
 for(const fps of [24000/1001,24,25,30000/1001,30,50,60000/1001,60]) {
  assert.equal(outputFrameRate({...facts,fps},true),fps);
  assert.equal(outputLevel({...facts,fps},'mytv'),fps>30?'4.2':'4.1');
  assert.equal(outputLevel({...facts,fps},'mabel'),'4.1');
 }
 assert.equal(outputFrameRate({...facts,fps:25,interlaced:true},true),50);
 assert.match(videoFilters({...facts,fps:25,interlaced:true},'mytv'),/bwdif=mode=send_field/);
 assert.throws(()=>outputFrameRate({...facts,fps:120},true),e=>e.code==='FRAME_RATE');
 assert.throws(()=>outputFrameRate({...facts,fps:NaN},true),e=>e.code==='FRAME_RATE');
});
test('50fps estimates and risk checks budget for every source frame',()=>{
 const plan=fps=>compressionPlan({...facts,fps},'compact');
 assert.ok(plan(50).targetBytes>plan(30).targetBytes);
 assert.equal(plan(30).risky,false);assert.equal(plan(50).risky,true);
 assert.equal(compressionPlan({...facts,fps:25,interlaced:true},'compact').targetBytes,plan(50).targetBytes);
});
test('existing v1/v2 compressed copies remain recognised after the policy update',()=>{
 for(const version of [1,2,3]) assert.equal(compressionProof({format:{tags:{comment:JSON.stringify({mabeltv:{version,profile:'compact',sourceBytes:2000,duration:10}})}}},1000,10).version,version);
});
test('compatible 1080p50 and 720p60 are accepted without a conversion loop',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-fps-check-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'ready.mp4');fs.writeFileSync(file,Buffer.from([0,0,0,8,...Buffer.from('moov')]));
 const probe=(width,height,fps,level)=>({streams:[{codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width,height,avg_frame_rate:fps+'/1',level,field_order:'progressive'}],format:{duration:'10'}});
 assert.equal(analyse(probe(1920,1080,50,42),file,'mytv').ready,true);
 assert.equal(analyse(probe(1280,720,60,41),file,'mabel').ready,true);
 assert.equal(analyse(probe(1920,1080,120,51),file,'mytv').ready,false);
 assert.equal(analyse(probe(1920,1080,50,42),file,'mabel').ready,false);
});
