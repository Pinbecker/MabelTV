'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareCloudCompression } = require('../lib/cloud-compression.cjs');

test('Mabel channel archiving prepares a separate 1080p cloud copy from the original using the selected profile', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cloud-profile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const local = { id: 'job', directory, sourcePath: path.join(directory, 'original.mkv'),
    preparedPath: path.join(directory, 'channel.mp4'), destination: { kind: 'mabel' },
    analysis: { compressionProof: { sourceBytes: 1000000000 } } };
  const remote = { destination: { cloudCopies: 'optimised', compression: 'smallest' } };
  const calls = [], queue = { resources: { conversion: { run: async (_signal, _waiting, run) => run() }, reserve() {} },
    media: { inspect: async () => ({ bytes: 1000000000, duration: 3600, width: 1920, height: 1080 }),
      prepare: async (...args) => { calls.push(args); fs.mkdirSync(path.dirname(args[1]), { recursive: true });
        fs.writeFileSync(args[1], 'cloud copy'); return { file: args[1], analysis: { width: 1920, height: 1080 } }; } } };
  const store = { update: (_id, fields) => Object.assign(local, fields) };
  await prepareCloudCompression(remote, local, queue, store, undefined, () => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], local.sourcePath);
  assert.equal(calls[0][2], 'mytv'); assert.equal(calls[0][6], 'smallest');
  assert.notEqual(local.cloudPreparedPath, local.preparedPath);
  assert.deepEqual(local.cloudPreparedAnalysis, { width: 1920, height: 1080 });
  await prepareCloudCompression(remote, local, queue, store, undefined, () => {});
  assert.equal(calls.length, 1, 'restart must reuse an already prepared cloud copy');
  delete local.cloudPreparedPath;
  queue.media.inspect = async () => ({ bytes: 1000000000, duration: 3600, width: 1280, height: 720 });
  await prepareCloudCompression(remote, local, queue, store, undefined, () => {});
  assert.equal(calls.length, 1, 'an uncapped 720p source uses one prepared copy for both destinations');
});

test('Compatibility only also applies to a separate iCloud copy for a Mabel TV channel', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'studio-cloud-compatible-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const local={id:'job',directory,sourcePath:path.join(directory,'original.mkv'),
    preparedPath:path.join(directory,'channel.mp4'),destination:{kind:'mabel'},preparedCompression:'compatible'};
  const remote={destination:{cloudCopies:'optimised',compression:'compact',preparationIntent:'compatible'}};
  let profile;
  const report={actual:'compatible',method:'picture-copied'};
  const queue={resources:{conversion:{run:async(_signal,_waiting,run)=>run()},reserve(){}},
    media:{inspect:async()=>({bytes:3e9,duration:6000,width:1920,height:1080,reasons:[]}),
      prepare:async(...args)=>{profile=args[6];return {file:args[1],analysis:{width:1920,height:1080},preparationReport:report};}}};
  await prepareCloudCompression(remote,local,queue,{update:(_id,fields)=>Object.assign(local,fields)},undefined,()=>{});
  assert.equal(profile,'compatible','an archive choice must not silently select Compact');
  assert.deepEqual(local.cloudPreparationReport,report);
});
