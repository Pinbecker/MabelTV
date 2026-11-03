'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Media } = require('../lib/media.cjs');
const { policy, compressionPlan, compressionProfile } = require('../lib/compression.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { run } = require('../lib/process.cjs');

test('all three profiles encode a playable source smaller, preserve it and retain the original size basis', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-size-profiles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tools = resolveTools(''), media = new Media(() => tools), source = path.join(root, 'source.mp4');
  await run(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=size=1920x1080:rate=24',
    '-f','lavfi','-i','sine=frequency=440','-t','6','-c:v','libx264','-preset','veryfast',
    '-b:v','4000k','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',source]);
  const original = fs.readFileSync(source), initial = await media.inspect(source, 'mytv');
  assert.equal(initial.ready, true);
  const outputs = {};
  for (const profile of policy.profiles) {
    const progress = [], destination = path.join(root, profile.id+'.mp4');
    const result = await media.prepare(source, destination, 'mytv', undefined, p => progress.push(p), undefined, profile.id);
    assert.equal(result.converted, true, 'compatible input must still receive the selected size target');
    assert.equal(result.analysis.compressionProof.profile, profile.id);
    assert.equal(result.analysis.compressionProof.sourceBytes, initial.bytes);
    assert.equal(result.analysis.ready, true);
    assert.deepEqual([result.analysis.width,result.analysis.height], [1920,1080]);
    assert.ok(result.analysis.bytes <= initial.bytes * profile.sourceFraction);
    assert.ok(progress.every((p,i) => i===0 || p>=progress[i-1]), 'two-pass progress must not go backwards');
    assert.ok(progress.some(p => p>=50));
    await run(tools.ffmpeg,['-v','error','-xerror','-i',destination,'-f','null','-']);
    outputs[profile.id] = result;
  }
  assert.deepEqual(fs.readFileSync(source),original);
  assert.ok(outputs.balanced.analysis.bytes > outputs.compact.analysis.bytes);
  assert.ok(outputs.compact.analysis.bytes > outputs.smallest.analysis.bytes);
  const reused = await media.prepare(outputs.compact.file,path.join(root,'duplicate.mp4'),'mytv',undefined,()=>{},undefined,'compact');
  assert.equal(reused.converted,false); assert.equal(reused.file,outputs.compact.file);
  const smaller = await media.prepare(outputs.compact.file,path.join(root,'smaller.mp4'),'mytv',undefined,()=>{},undefined,'smallest');
  assert.equal(smaller.analysis.compressionProof.sourceBytes,initial.bytes);
  assert.ok(smaller.analysis.bytes > initial.bytes*.18, 'a smaller choice must not multiply reductions repeatedly');
  const larger = await media.prepare(outputs.smallest.file,path.join(root,'larger.mp4'),'mytv',undefined,()=>{},undefined,'balanced');
  assert.equal(larger.converted,false,'do not inflate or recompress a prepared file already below the selected size');
});

test('invalid and unviable size targets fail with originals intact', async () => {
  assert.throws(()=>compressionProfile('unknown'),/Choose Balanced/);
  assert.throws(()=>compressionPlan({bytes:1000,duration:0},'compact'),/duration/);
  assert.equal(compressionPlan({bytes:1000000,duration:100,hasAudio:false},'compact').audioBitrate,0);
});
