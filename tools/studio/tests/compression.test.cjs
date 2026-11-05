'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Media } = require('../lib/media.cjs');
const { policy, compressionPlan, compressionProfile, ensureIntel } = require('../lib/compression.cjs');
const { resolveTools } = require('../lib/tools.cjs');
const { run } = require('../lib/process.cjs');

test('all three profiles encode a playable source smaller, preserve it and retain the original size basis', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-size-profiles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tools = resolveTools(''), media = new Media(() => tools), source = path.join(root, 'source.mp4');
  try { await ensureIntel(tools); }
  catch (error) { if (process.env.MABEL_STUDIO_REQUIRE_INTEL === '1') throw error; t.skip('Intel hardware unavailable on this test host'); return; }
  await run(tools.ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc2=size=1920x1080:rate=24',
    '-f','lavfi','-i','sine=frequency=440','-t','6','-c:v','libx264','-preset','veryfast',
    '-b:v','4000k','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-metadata','episode_id=m0000001','-metadata','show=Test BBC programme','-movflags','+faststart',source]);
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
    const probe = JSON.parse(await run(tools.ffprobe, ['-v', 'error', '-show_format', '-of', 'json', destination]));
    assert.equal(probe.format.tags.episode_id, 'm0000001', 'BBC identity must survive preparation for library presence checks');
    assert.deepEqual([result.analysis.width,result.analysis.height], [1920,1080]);
    assert.ok(result.analysis.bytes < initial.bytes, 'space-saving output must be smaller; profile bands are estimates');
    assert.ok(progress.every((p,i) => i===0 || p>=progress[i-1]), 'single-pass progress must not go backwards');
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

test('destination caps, high frame rates, HDR and anamorphic interlace use the same Intel route', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-intel-formats-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tools = resolveTools(path.resolve(__dirname, '../resources')), media = new Media(() => tools);
  try { await ensureIntel(tools); }
  catch (error) { if (process.env.MABEL_STUDIO_REQUIRE_INTEL === '1') throw error; t.skip('Intel hardware unavailable on this test host'); return; }
  const cases = [
    { name: 'high-fps', size: '960x540', rate: '60', filters: 'format=yuv420p', tags: [], target: 'mabel', width: 960 },
    { name: 'hdr', size: '640x360', rate: '24', filters: 'format=yuv420p10le',
      tags: ['-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc'], target: 'mytv', width: 640 },
    { name: 'interlace-sar', size: '720x576', rate: '25', filters: 'setsar=16/15,setfield=tff', tags: [], target: 'mytv', width: 768 },
  ];
  for (const item of cases) {
    const file = path.join(root, item.name + '.mkv'), destination = path.join(root, item.name + '.mp4');
    await run(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${item.size}:rate=${item.rate}`,
      '-t', '3', '-vf', item.filters, '-c:v', 'ffv1', ...item.tags, file]);
    const prepared = await media.prepare(file, destination, item.target, undefined, () => {}, undefined, 'compact');
    assert.equal(prepared.analysis.ready, true); assert.equal(prepared.analysis.width, item.width);
    assert.ok(prepared.analysis.height <= (item.target === 'mabel' ? 720 : 1080));
    assert.ok(Math.abs(prepared.analysis.fps - Number(item.rate) * (item.name === 'interlace-sar' ? 2 : 1)) < .005);
    assert.equal(prepared.analysis.sar, 1); assert.equal(prepared.analysis.colorTransfer, 'bt709');
    assert.ok(prepared.analysis.bytes < fs.statSync(file).size); assert.ok(fs.existsSync(file));
    await run(tools.ffmpeg, ['-v', 'error', '-xerror', '-i', prepared.file, '-f', 'null', '-']);
  }
});

test('unavailable Intel encoding reports a specific failure without a CPU fallback', async () => {
  await assert.rejects(ensureIntel({ ffmpeg: path.join(os.tmpdir(), 'missing-studio-intel-tool.exe') }), error => error.code === 'ENCODER' && /Intel/.test(error.message));
});

test('invalid and unviable size targets fail with originals intact', async () => {
  assert.throws(()=>compressionProfile('unknown'),/Choose Balanced/);
  assert.throws(()=>compressionPlan({bytes:1000,duration:0},'compact'),/duration/);
  assert.equal(compressionPlan({bytes:1000000,duration:100,hasAudio:false},'compact').audioBitrate,0);
});
