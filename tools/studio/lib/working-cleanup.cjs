'use strict';
const fs = require('node:fs');
const path = require('node:path');

function inside(root, file) { return file !== root && file.startsWith(root + path.sep); }
function cleanWorkingCopies(remote, local, store) {
  if (!remote.destination.temporaryWork || local.workingRemoved || local.subtitleWarning) return false;
  const workspace = fs.realpathSync(store.state.settings.workspace);
  const directory = fs.existsSync(local.directory) ? fs.realpathSync(local.directory) : path.resolve(local.directory);
  if (!/^[a-f0-9]{32}$/.test(local.id) || !inside(workspace, directory) || !path.basename(directory).endsWith(local.id.slice(0, 8))) throw new Error('Working files were kept because their ownership could not be confirmed.');
  const roots = [directory];
  if (/^[a-f0-9]{32}$/.test(remote.id)) {
    // Torrent packs keep their shared sources until every selected episode
    // has confirmed delivery. Their parent owner then removes the pack.
    for (const name of ['Remote']) {
      const candidate = path.join(workspace, name, remote.id);
      if (fs.existsSync(candidate)) {
        const resolved = fs.realpathSync(candidate);
        if (inside(workspace, resolved) && resolved === candidate) roots.push(resolved);
      }
    }
  }
  const candidates = new Set();
  for (const file of [local.sourcePath, local.preparedPath, local.cloudPreparedPath]) {
    if (!file || !fs.existsSync(file)) continue;
    const resolved = fs.realpathSync(file);
    if (!roots.some(root => inside(root, resolved))) continue; // Imported originals and iCloud sync files stay untouched.
    candidates.add(resolved);
    const folder = path.dirname(resolved), stem = path.basename(resolved, path.extname(resolved));
    for (const name of fs.readdirSync(folder)) {
      if (name.startsWith(stem + '.') && /\.(srt|vtt|ass|ssa)$/i.test(name)) {
        const subtitle = path.join(folder, name);
        if (!fs.lstatSync(subtitle).isSymbolicLink()) candidates.add(subtitle);
      }
    }
  }
  if (candidates.has(path.resolve(local.sourcePath)) && local.sourceFingerprint) {
    const stat = fs.statSync(local.sourcePath);
    if (stat.size !== local.sourceFingerprint.size || stat.mtimeMs !== local.sourceFingerprint.mtime) throw new Error('A working original changed and was kept.');
  }
  for (const file of candidates) fs.unlinkSync(file);
  function emptyDirectories(root) {
    for (const name of fs.readdirSync(root)) {
      const target = path.join(root, name), stat = fs.lstatSync(target);
      if (stat.isDirectory() && !stat.isSymbolicLink()) emptyDirectories(target);
    }
    if (!fs.readdirSync(root).length) fs.rmdirSync(root);
  }
  for (const root of roots) if (fs.existsSync(root)) emptyDirectories(root);
  store.update(local.id, { workingRemoved: true, originalRemoved: !fs.existsSync(local.sourcePath), optimisedRemoved: !fs.existsSync(local.preparedPath || local.sourcePath) });
  return true;
}
module.exports = { cleanWorkingCopies };
