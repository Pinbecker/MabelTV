'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {copy}=require('../lib/cloud-files.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-lock-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source.mp4'),target=path.join(root,'cloud.mp4');
 fs.writeFileSync(source,Buffer.alloc(1000,42));
 return {source,target};
}
test('a provider lock outlasting the old retry window finishes automatically without recopying',async t=>{
 const {source,target}=fixture(t),rename=fs.promises.rename.bind(fs.promises);
 let attempts=0,waiting=0,copied=0,ticks=0;
 t.mock.method(fs.promises,'rename',async(...args)=>{
  if(++attempts<3) throw Object.assign(new Error('locked'),{code:'EBUSY'});
  return rename(...args);
 });
 const timer=setInterval(()=>ticks++,20);t.after(()=>clearInterval(timer));
 await copy(source,target,new AbortController().signal,progress=>{if(progress.waitingForFile)waiting++;else copied++;});
 assert.equal(attempts,3);assert.equal(waiting,2);assert.equal(copied,1);
 assert.ok(ticks>20,'retry waits must not block Studio heartbeats or other jobs');
 assert.deepEqual(fs.readFileSync(target),fs.readFileSync(source));
 assert.equal(JSON.parse(fs.readFileSync(target+'.copy.json')).complete,true);
 assert.equal(fs.existsSync(target+'.part'),false);
});
test('cancelling a lock wait preserves the complete partial and resumes without recopying',async t=>{
 const {source,target}=fixture(t),controller=new AbortController();
 const rename=t.mock.method(fs.promises,'rename',async()=>{throw Object.assign(new Error('locked'),{code:'EPERM'});});
 await assert.rejects(copy(source,target,controller.signal,progress=>{if(progress.waitingForFile)controller.abort();}),/abort|Stopped/i);
 assert.equal(fs.statSync(target+'.part').size,1000);
 assert.equal(fs.existsSync(source),true);
 assert.equal(JSON.parse(fs.readFileSync(target+'.copy.json')).complete,false);
 rename.mock.restore();
 let recopied=false;
 await copy(source,target,new AbortController().signal,()=>{recopied=true;});
 assert.equal(recopied,false);assert.deepEqual(fs.readFileSync(target),fs.readFileSync(source));
});
test('genuine filesystem errors fail without deleting the retained copy',async t=>{
 const {source,target}=fixture(t);
 t.mock.method(fs.promises,'rename',async()=>{throw Object.assign(new Error('disk failed'),{code:'EIO'});});
 await assert.rejects(copy(source,target,new AbortController().signal),{code:'EIO'});
 assert.equal(fs.statSync(target+'.part').size,1000);assert.equal(fs.existsSync(source),true);
});
test('source changes while waiting cannot publish the stale partial',async t=>{
 const {source,target}=fixture(t);
 t.mock.method(fs.promises,'rename',async()=>{throw Object.assign(new Error('locked'),{code:'EACCES'});});
 await assert.rejects(copy(source,target,new AbortController().signal,progress=>{if(progress.waitingForFile)fs.writeFileSync(source,'replacement');}),/original changed/);
 assert.equal(fs.existsSync(target),false);assert.equal(fs.statSync(target+'.part').size,1000);
});
