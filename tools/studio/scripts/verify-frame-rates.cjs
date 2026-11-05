'use strict';
// Generated motion only. No library, cloud, live player or application state is changed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media}=require('../lib/media.cjs');
const {resolveTools}=require('../lib/tools.cjs');
const {run}=require('../lib/process.cjs');
const {ensureIntel}=require('../lib/compression.cjs');
async function main() {
 const root=path.resolve(process.argv[2]||'out/studio-frame-rate-proof');fs.mkdirSync(root,{recursive:true});
 const tools=resolveTools(path.resolve(__dirname,'../resources')),media=new Media(()=>tools);
 await ensureIntel(tools);
 const results=[],counts=new Map(),resume=process.argv.includes('--resume');
 async function source(name,rate,size='1920x1080',filter='format=yuv420p') {
  const file=path.join(root,name+'.mkv');
  if(resume&&fs.existsSync(file))return file;
  await run(tools.ffmpeg,['-v','error','-y','-f','lavfi','-i',`testsrc2=size=${size}:rate=${rate}`,'-f','lavfi','-i','sine=frequency=440',
   '-t','12','-vf',filter,'-c:v','ffv1','-c:a','pcm_s16le',file]);return file;
 }
 async function check(file,target,profile,name,expectedFps) {
  const destination=path.join(root,name+'.mp4'),before=await media.inspect(file,target);
  const output=resume&&fs.existsSync(destination)?{file:destination,converted:true,analysis:await media.inspect(destination,target)}
   :await media.prepare(file,destination,target,undefined,undefined,undefined,profile,{allowRisk:true});
  assert.equal(output.converted,true);
  assert.equal(output.analysis.ready,true);
  assert.ok(Math.abs(output.analysis.fps-expectedFps)<.005);
  if(!counts.has(file)) {
   const inputProbe=JSON.parse(await run(tools.ffprobe,['-v','error','-select_streams','v:0','-count_frames','-show_streams','-of','json',file]));
   counts.set(file,Number(inputProbe.streams[0].nb_read_frames));
  }
  const expectedFrames=counts.get(file)*(before.interlaced?2:1);
  const probe=JSON.parse(await run(tools.ffprobe,['-v','error','-select_streams','v:0','-count_frames','-show_streams','-of','json',output.file]));
  assert.equal(Number(probe.streams[0].nb_read_frames),expectedFrames);
  await run(tools.ffmpeg,['-v','error','-xerror','-i',output.file,'-f','null','-']);
  assert.equal(fs.statSync(file).size,before.bytes);
  results.push({name,target,profile,file:output.file,sourceBytes:before.bytes,bytes:output.analysis.bytes,fps:output.analysis.fps,
   frames:expectedFrames,width:output.analysis.width,height:output.analysis.height,level:probe.streams[0].level});
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2));
  console.log(name+': '+output.analysis.fps.toFixed(3)+' fps, '+expectedFrames+' frames');
 }
 const fifty=await source('source-50',50);
 for(const target of ['mabel','mytv']) for(const profile of ['balanced','compact','smallest','compatible'])
  await check(fifty,target,profile,`${target}-50-${profile}`,50,600);
 for(const rate of ['24000/1001','24','25','30000/1001','30','60000/1001','60']) {
  const [n,d=1]=rate.split('/').map(Number),fps=n/d,name='mytv-'+rate.replace('/','-');
  const file=await source('source-'+name,rate,'960x540');
  await check(file,'mytv','compact',name,fps,Math.ceil(fps*12));
 }
 const interlaced=await source('source-interlaced',50,'1280x720','tinterlace=mode=interleave_top,setfield=tff');
 await check(interlaced,'mabel','compact','mabel-interlaced-25-to-50',50,600);
 const sixty=await source('source-full-60',60);
 for(const profile of ['compact','compatible'])await check(sixty,'mytv',profile,'mytv-1080p60-'+profile,60);
 console.log('Verified '+results.length+' Intel conversions. Outputs retained in '+root);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
