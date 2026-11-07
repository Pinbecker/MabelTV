'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./process.cjs');

async function subtitleFiles(job, tools, signal) {
  const source = job.sourcePath, directory = path.dirname(source);
  const stem = path.basename(source, path.extname(source));
  const filename = path.basename(source);
  const sidecars = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.startsWith(stem + '.') && /\.(srt|vtt|ass)$/i.test(name) &&
    (name.startsWith(filename + '.') || !/^(mp4|mkv|avi|mov|m4v|webm|ts|m2ts)\./i.test(name.slice(stem.length + 1)))).sort((a,b) => Number(b === filename + '.en.srt') - Number(a === filename + '.en.srt') || a.localeCompare(b)) : [];
  const subtitles = sidecars.slice(0, 8).map(name => ({ path: path.join(directory, name), label:name, language: name.split('.').at(-2)?.match(/^[a-z]{2,3}$/)?.[0] || 'en' }));
  if (fs.existsSync(source) && (!subtitles.length || job.sourceAnalysis?.subtitleStreams || tools?.ffprobe)) {
    const info = Array.isArray(job.sourceAnalysis?.subtitleStreams) ? { streams: job.sourceAnalysis.subtitleStreams }
      : JSON.parse(await run(tools.ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', source], { signal, timeout: 15000 }));
    const texts = (info.streams || []).filter(s => (s.codec_type === 'subtitle' || !s.codec_type) && ['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'].includes(s.codec_name));
    texts.sort((a,b) => Number(['en','eng'].includes(b.tags?.language)) - Number(['en','eng'].includes(a.tags?.language)) || Number(b.disposition?.default || 0) - Number(a.disposition?.default || 0));
    for (const text of texts.slice(0, 12 - subtitles.length)) {
      const target = path.join(job.directory, 'Prepared', 'Subtitles-' + text.index + '.srt');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await run(tools.ffmpeg, ['-v', 'error', '-y', '-i', source, '-map', '0:' + text.index, '-c:s', 'srt', target], { signal });
      subtitles.push({ path: target, label:text.tags?.title || `Included track ${text.index} · ${text.tags?.language || 'English'}`, language: /^[a-z]{2,3}$/.test(text.tags?.language) ? text.tags.language : 'en' });
    }
    if (!subtitles.length && info.streams?.some(s => s.codec_type === 'subtitle')) throw new Error('This video has image-based subtitles. The original is kept; text subtitles are needed for the portal.');
  }
  for (const [index, subtitle] of subtitles.entries()) {
    if (!/\.srt$/i.test(subtitle.path)) {
      const target = path.join(job.directory, 'Prepared', 'Sidecar-' + index + '.srt');
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
  for (const [index, subtitle] of (await subtitleFiles(job, tools, signal)).entries()) {
    await portal.api('/api/studio/subtitle', { method: 'POST', body: { upload: job.uploadId, language: subtitle.language, label:'Included with download · ' + (subtitle.label || path.basename(subtitle.path)), activate:index === 0, data: fs.readFileSync(subtitle.path).toString('base64') }, signal });
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
