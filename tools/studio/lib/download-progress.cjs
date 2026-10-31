'use strict';

function downloadProgress(line) {
  const percent = line.match(/(\d+(?:\.\d+)?)%/);
  const stream = line.match(/\[(audio\+video|audio|video)\]\s*$/i)?.[1];
  if (percent) return { percent: Math.min(99, Number(percent[1])),
    downloadStage: stream || 'download', status: 'downloading',
    message: stream === 'audio' ? 'Downloading audio from BBC iPlayer' : stream === 'video' ? 'Downloading video from BBC iPlayer' : 'Downloading from BBC iPlayer' };
  if (/INFO: (?:Converting to|Remuxing|Merging)/i.test(line)) return { status: 'assembling', percent: null, downloadStage: 'assembly', message: 'Assembling the downloaded audio and video into an MP4' };
  if (/INFO: (?:Tagging|Writing metadata)/i.test(line)) return { status: 'assembling', percent: null, downloadStage: 'metadata', message: 'Finishing the BBC download and adding programme metadata' };
  return null;
}
module.exports = { downloadProgress };
