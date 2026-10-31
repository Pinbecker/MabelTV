'use strict';
const fs = require('node:fs');
const path = require('node:path');

function migrateWorkspace(store, destination) {
  const legacy = path.join(store.root, 'Media');
  let plan = store.state.workspaceMigration;
  if (!plan && path.resolve(store.state.settings.workspace) !== path.resolve(legacy)) return;
  if (!plan) { plan = { from: legacy, to: destination }; store.state.workspaceMigration = plan; store.save(); }
  if (path.resolve(plan.from) !== path.resolve(legacy) || path.resolve(plan.to) !== path.resolve(destination)) throw new Error('The media-folder migration needs review. Your files are unchanged.');
  if (fs.existsSync(legacy) && fs.lstatSync(legacy).isSymbolicLink()) throw new Error('The old media folder is a link. Choose a media folder in Settings.');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.existsSync(legacy) ? fs.readdirSync(legacy) : []) {
    const from = path.join(legacy, name), to = path.join(destination, name);
    if (fs.existsSync(to)) throw new Error('A media-folder item already exists at the new location: ' + name);
    fs.renameSync(from, to);
  }
  for (const job of store.state.jobs) for (const key of ['directory', 'sourcePath', 'preparedPath']) {
    const value = job[key];
    if (value && path.resolve(value).startsWith(path.resolve(legacy) + path.sep)) job[key] = path.join(destination, path.relative(legacy, value));
  }
  store.state.settings.workspace = destination;
  delete store.state.workspaceMigration; store.save();
}
module.exports = { migrateWorkspace };
