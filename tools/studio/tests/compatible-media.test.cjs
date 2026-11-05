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
