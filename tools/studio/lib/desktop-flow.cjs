'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { destinationValid } = require('./queue.cjs');
async function addDesktop(inputs, chosen, store, queue, portal) {
  if (chosen.kind === 'local') return queue.add(inputs, chosen);
  const destination = { ...chosen, cloudCopies: chosen.cloudCopies || 'optimised' };
  if (chosen.kind !== 'icloud') destinationValid(chosen);
  const library = await portal.api('/api/library');
  if (chosen.kind === 'mabel') {
    const channel = library.channels.find(value => value.number === chosen.channel);
    if (!channel) throw new Error('Choose a current TV channel.');
    destination.folder = channel.folder;
  }
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) throw new Error('Choose up to 100 sources.');
  const sources = inputs.map(input => {
    if (input.kind === 'iplayer') return input;
    if (input.kind !== 'file' || !path.isAbsolute(input.path) || !/\.(mp4|m4v|mov|mkv|avi|webm|mpg|mpeg|ts)$/i.test(input.path)) throw new Error('Choose a video file.');
    const stat = fs.statSync(input.path);
    if (!stat.isFile()) throw new Error('Choose a video file.');
    return { ...input, bytes: stat.size, mtime: stat.mtimeMs, title: path.basename(input.path, path.extname(input.path)) };
  });
  const result = await portal.api('/api/studio/desktop', { method: 'POST', body: { inputs: sources, destination, worker: store.state.sourceId } });
  return result.jobs;
}
module.exports = { addDesktop };
