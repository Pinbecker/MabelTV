'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DesktopLibrary } = require('../lib/desktop-library.cjs');
const cloudId = 'a'.repeat(24), requestId = 'b'.repeat(32);
const file = { id:cloudId,bytes:123456,modified:'same-version',remoteId:'cloud-record' };
const destination = {kind:'film',folder:'MCU',cloudCopies:'original',compression:'compact',preparationIntent:'compatible'};
function fixture() {
  const calls = [], owner = new DesktopLibrary({api:async (route,options) => { calls.push({route,...options}); return {channels:[{number:2,folder:'BBC'}]}; }});
  return {owner,calls};
}
test('desktop library reads only bounded cloud filters, episode IDs and request identities',async () => {
  const {owner,calls} = fixture();
  await owner.read('cloud',{q:'A & B',category:'films',sort:'size-desc',offset:100});
  assert.equal(calls[0].route,'/api/studio/cloud?q=A+%26+B&category=films&sort=size-desc&offset=100');
  await owner.read('cloud',{series:'series:'+cloudId});
  await owner.read('request',{id:requestId});
  for (const [action,value] of [['cloud',{series:'../../etc/passwd'}],['request',{id:'https://elsewhere.test'}],['cloud',{category:'all',sort:'invalid',offset:-1}],['/api/manage',{}]]) await assert.rejects(owner.read(action,value));
  assert.equal(calls.length,3);
});
test('cloud sends retain frozen identity and compatibility intent without exposing file paths',async () => {
  const {owner,calls} = fixture();
  await owner.write('submit',{sources:[{type:'cloud',...file,path:'ignored'}],destination,replaceCloudOriginal:false});
  assert.deepEqual(calls[0].body.sources,[{type:'cloud',...file}]);
  assert.equal(calls[0].body.destination.preparationIntent,'compatible');
  assert.equal(calls[0].body.destination.collection,'MCU');
  assert.equal(calls[0].body.destination.cloudCopies,'original');
  assert.equal(calls[0].body.replaceCloudOriginal,false);
});
test('torrent actions accept server search identities and selected indexes, never renderer magnets',async () => {
  const {owner,calls} = fixture();
  await owner.write('inspect',{request:requestId,hash:'c'.repeat(40),magnet:'ignored'});
  await owner.write('submit',{sources:[{type:'torrent',request:requestId,files:[2,5],magnet:'ignored'}],destination});
  assert.deepEqual(calls[1].body.sources,[{type:'torrent',request:requestId,files:[2,5]}]);
  await assert.rejects(owner.write('submit',{sources:[{type:'torrent',request:requestId,files:[2,2]}],destination}));
  await assert.rejects(owner.write('submit',{sources:[{type:'file',path:'C:/private/file.mp4'}],destination}));
  assert.equal(calls.length,2);
});
test('optimisation and deletion require confirmation and retain server-checked file versions',async () => {
  const {owner,calls} = fixture();
  await assert.rejects(owner.write('delete',{items:[file]}),/Confirm/);
  await assert.rejects(owner.write('optimise',{files:[file],compression:'compact'}),/Confirm/);
  assert.equal(calls.length,0);
  await owner.write('optimise',{files:[file],compression:'balanced',confirmed:true,allowRisk:false});
  assert.equal(calls[0].body.destination.compression,'balanced');
  assert.equal(calls[0].body.destination.optimiseCloud,true);
  assert.deepEqual(calls[0].body.sources,[{type:'cloud',...file}]);
  await owner.write('delete',{items:[file],confirmed:true});
  assert.deepEqual(calls[1].body,{action:'delete',confirmed:true,items:[file]});
});
test('original recovery supports both alongside and confirmed replacement through the existing API',async () => {
  const {owner,calls} = fixture();
  await owner.write('recover',{ids:[requestId],destination,mode:'alongside'});
  assert.equal(calls[0].body.mode,'alongside');
  await assert.rejects(owner.write('recover',{ids:[requestId],destination,mode:'replace'}),/Confirm/);
  await owner.write('recover',{ids:[requestId],destination,mode:'replace',confirmed:true});
  assert.equal(calls[1].body.confirmReplace,true);
});
test('Mabel TV channel numbers are resolved on the connected Pi and never trust a supplied folder',async () => {
  const {owner,calls} = fixture();
  await owner.write('submit',{sources:[{type:'cloud',...file}],destination:{...destination,kind:'mabel',channel:2,folder:'forged'}});
  assert.equal(calls[1].body.destination.folder,'BBC');
});
