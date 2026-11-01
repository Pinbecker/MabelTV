'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');

async function subtitleFiles(job, tools, signal) {
  const source = job.sourcePath, directory = path.dirname(source);
  const stem = path.basename(source, path.extname(source));
  const sidecars = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.startsWith(stem + '.') && /\.(srt|vtt|ass)$/i.test(name)) : [];
  const subtitles = sidecars.slice(0, 8).map(name => ({ path: path.join(directory, name), language: name.slice(stem.length + 1, -4).match(/^[a-z]{2,3}$/)?.[0] || 'en' }));
  if (!subtitles.length && fs.existsSync(source)) {
    const info = JSON.parse(await run(tools.ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', source], { signal }));
    const text = info.streams?.find(s => s.codec_type === 'subtitle' && ['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'].includes(s.codec_name));
    if (text) {
      const target = path.join(job.directory, 'Prepared', 'Subtitles.srt');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await run(tools.ffmpeg, ['-v', 'error', '-y', '-i', source, '-map', '0:' + text.index, '-c:s', 'srt', target], { signal });
      subtitles.push({ path: target, language: /^[a-z]{2,3}$/.test(text.tags?.language) ? text.tags.language : 'en' });
    }
    else if (info.streams?.some(s => s.codec_type === 'subtitle')) throw new Error('This video has image-based subtitles. The original is kept; text subtitles are needed for the portal.');
  }
  for (const subtitle of subtitles) {
    if (!/\.srt$/i.test(subtitle.path)) {
      const target = path.join(job.directory, 'Prepared', 'Subtitles-' + subtitle.language + '.srt');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await run(tools.ffmpeg, ['-v', 'error', '-y', '-i', subtitle.path, '-c:s', 'srt', target], { signal });
      subtitle.path = target;
    }
    const size = fs.statSync(subtitle.path).size;
    if (size > 1024 * 1024) throw new Error('A subtitle is larger than the supported 1 MB; the original is kept.');
  }
  return subtitles;
}
async function sendSubtitles(job, portal, tools, signal) {
  if (!job.result?.complete || job.subtitlesSent) return;
  for (const subtitle of await subtitleFiles(job, tools, signal)) {
    await portal.api('/api/studio/subtitle', { method: 'POST', body: { upload: job.uploadId, language: subtitle.language, data: fs.readFileSync(subtitle.path).toString('base64') }, signal });
  }
  return true;
}
function removeOptimised(job, workspace) {
  if (!job.converted || !job.preparedPath || path.resolve(job.preparedPath) === path.resolve(job.sourcePath)) return false;
  const root = fs.realpathSync(workspace), directory = fs.realpathSync(job.directory);
  const prepared = fs.realpathSync(job.preparedPath);
  if (!directory.startsWith(root + path.sep) || !prepared.startsWith(directory + path.sep)) throw new Error('This copy is outside Studio’s media folder and was kept.');
  fs.unlinkSync(prepared);
  return true;
}
module.exports = { sendSubtitles, subtitleFiles, removeOptimised };
