'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {webkit,chromium}=require('../../../tests/browser/node_modules/playwright');
async function main() {
 const root=path.resolve(process.argv[2]||'out/studio-frame-rate-proof'),results=[];
 const names=process.argv.length>3?process.argv.slice(3):['mabel-50-compact','mytv-50-compact','mytv-50-compatible','mytv-60'];
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!name){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Generated playback proof</title>');return;}
  if(!names.some(item=>name===item+'.mp4')) {res.writeHead(404);res.end();return;}
  const file=path.join(root,name),size=fs.statSync(file).size,range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),size-1):size-1;
  res.writeHead(range?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
  fs.createReadStream(file,{start,end}).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {for(const [engine,type] of [['webkit',webkit],['chromium',chromium]]) {
  const browser=await type.launch();
  try {const page=await browser.newPage({viewport:{width:393,height:852}});
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   for(const name of names) {
    await page.setContent(`<video id="video" playsinline muted controls src="http://127.0.0.1:${server.address().port}/${name}.mp4"></video><button onclick="video.play()">Play</button>`);
    await page.evaluate(()=>{window.presented=0;const frame=()=>{window.presented++;video.requestVideoFrameCallback(frame);};video.requestVideoFrameCallback?.(frame);});
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(()=>video.currentTime>1&&!video.error,{},{timeout:15000});
    await page.evaluate(()=>{video.currentTime=6;});
    await page.waitForFunction(()=>video.currentTime>7&&!video.error,{},{timeout:15000});
    const result=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;const ctx=canvas.getContext('2d');
     const hashes=new Set();let pixels;
     for(let i=0;i<16;i++){await new Promise(requestAnimationFrame);ctx.drawImage(video,0,0,64,36);pixels=ctx.getImageData(0,0,64,36).data;
      let hash=0;for(const value of pixels)hash=(hash*31+value)|0;hashes.add(hash);}
     return {time:video.currentTime,width:video.videoWidth,height:video.videoHeight,error:video.error?.message||null,presented:window.presented,
      motionSamples:hashes.size,colouredPixels:[...pixels].filter((v,i)=>i%4!==3&&v>30).length,decoded:video.getVideoPlaybackQuality?.().totalVideoFrames||video.webkitDecodedFrameCount||0};});
    console.log(JSON.stringify({engine,name,...result}));
    assert.equal(result.error,null);assert.ok(result.colouredPixels>100);assert.ok(result.motionSamples>=5);
    if(result.decoded)assert.ok(result.decoded>20);
    results.push({engine,name,...result});console.log(engine+' '+name+': moving video rendered and seeked successfully');
   }
  }finally {await browser.close();}
 }}finally {await new Promise(resolve=>server.close(resolve));}
 fs.writeFileSync(path.join(root,'browser-results.json'),JSON.stringify(results,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
