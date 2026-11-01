'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, net, Tray, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('./lib/store.cjs');
const { resolveTools } = require('./lib/tools.cjs');
const { IPlayer } = require('./lib/iplayer.cjs');
const { Media } = require('./lib/media.cjs');
const { Portal, endpoint } = require('./lib/portal.cjs');
const { Queue } = require('./lib/queue.cjs');
const { Companion } = require('./lib/companion.cjs');
const { sendSubtitles } = require('./lib/subtitles.cjs');
const { migrateWorkspace } = require('./lib/workspace.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('MabelTV Studio');
if (process.env.STUDIO_TEST_DATA) app.setPath('userData', path.resolve(process.env.STUDIO_TEST_DATA));
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let window, store, queue, portal, iplayer, portalSession, searchController;
let closing = false, tray, companion;
const resources = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, 'resources');
const getTools = () => resolveTools(resources, store.state.settings.toolFolder);

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
      !event.senderFrame.url.startsWith('studio://app/')) throw new Error('This request did not come from Studio.');
}
function handler(name, callback) {
  ipcMain.handle('studio:' + name, async (event, ...args) => { trusted(event); return callback(...args); });
}
function settingsUpdate(changes) {
  const old = store.state.settings, result = { ...old };
  for (const key of ['localUrl', 'remoteUrl']) if (key in changes) result[key] = changes[key] ? endpoint(changes[key]) : '';
  if (!result.localUrl) throw new Error('Keep a local portal address configured.');
  if ('connectionMode' in changes) {
    if (!['auto', 'local', 'remote'].includes(changes.connectionMode)) throw new Error('Choose automatic, local or remote connection.');
    result.connectionMode = changes.connectionMode;
  }
  if ('workspace' in changes) {
    if (!path.isAbsolute(changes.workspace)) throw new Error('Choose an absolute working folder.');
    fs.mkdirSync(changes.workspace, { recursive: true }); result.workspace = changes.workspace;
  }
  if ('toolFolder' in changes) result.toolFolder = String(changes.toolFolder);
  store.state.settings = result; store.save(); portal.current = null; return result;
}
async function remoteSignIn() {
  const base = endpoint(store.state.settings.remoteUrl);
  if (!base.startsWith('https://')) throw new Error('Remote sign-in requires an HTTPS address.');
  const login = new BrowserWindow({ width: 900, height: 760, parent: window, title: 'MabelTV remote sign-in',
    autoHideMenuBar: true, webPreferences: { session: portalSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  login.setMenu(null);
  login.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // This window contains no Studio preload or privileged IPC. Identity-provider redirects stay HTTPS.
  login.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('https://')) event.preventDefault(); });
  login.webContents.on('did-navigate', async (_event, url) => {
    if (new URL(url).origin !== base) return;
    try { const connected = await portal.connect('remote'); window?.webContents.send('studio:connection', connected); login.close(); }
    catch { /* The portal may still need its normal PIN. */ }
  });
  await login.loadURL(base);
  return { opened: true };
}

async function start() {
  store = new Store(app.getPath('userData'));
  if (!process.env.STUDIO_TEST_DATA) migrateWorkspace(store, path.join(app.getPath('home'), 'Videos', 'MabelTV Studio'));
  portalSession = session.fromPartition('persist:mabeltv-portal');
  for (const ownedSession of [session.defaultSession, portalSession]) {
    ownedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ownedSession.setPermissionCheckHandler(() => false);
  }
  protocol.handle('studio', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const file = path.resolve(__dirname, 'ui', '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(path.resolve(__dirname, 'ui') + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  portal = new Portal(store, (url, options) => portalSession.fetch(url, options));
  iplayer = new IPlayer(app.getPath('userData'), getTools);
  queue = new Queue(store, new Media(getTools), iplayer, portal);
  queue.afterPublish = (job, signal) => sendSubtitles(job, portal, getTools(), signal);
  companion = new Companion(store, queue, iplayer, portal);
  if (!process.env.STUDIO_TEST_DATA) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--background'] });
    tray = new Tray(path.join(__dirname, 'ui/studio.ico'));
    tray.setToolTip('MabelTV Studio - ready for portal requests');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open MabelTV Studio', click: () => { window?.show(); window?.focus(); } },
      { label: 'Open portal', click: () => shell.openExternal(endpoint(store.state.settings.remoteUrl)) },
      { type: 'separator' },
      { label: 'Quit Studio and pause work', click: () => { closing = true; companion.close().then(() => queue.shutdown()).finally(() => app.quit()); } },
    ]));
    tray.on('double-click', () => { window?.show(); window?.focus(); });
    companion.start();
  } else if (process.env.STUDIO_TEST_COMPANION === '1') companion.start();
  handler('snapshot', () => ({ ...store.snapshot(), connection: portal.current, companion: companion.status,
    catalogue: portal.current ? portal.catalogue : store.state.catalogue || { channels: [], series: [] }, tools: getTools(), warning: store.warning, version: app.getVersion() }));
  handler('settings', settingsUpdate);
  handler('connect', mode => portal.connect(mode));
  handler('pin', (pin, mode) => portal.pin(pin, mode));
  handler('signIn', remoteSignIn);
  handler('search', (query, refresh) => {
    searchController?.abort(); searchController = new AbortController();
    return iplayer.search(query, Boolean(refresh), searchController.signal);
  });
  handler('metadata', pid => iplayer.metadata(pid));
  handler('libraryPresence', items => portal.libraryPresence(items));
  handler('searchTitles', (query, type) => portal.searchTitles(query, type));
  handler('pickFiles', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video files', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'avi', 'webm', 'mpg', 'mpeg', 'ts'] }] });
    return result.canceled ? [] : result.filePaths;
  });
  handler('pickFolder', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? '' : result.filePaths[0];
  });
  handler('add', (inputs, destination) => queue.add(inputs, destination));
  handler('action', (id, action, destination, match) => queue.action(id, action, destination, match));
  handler('createSeries', (name, season) => portal.createSeries(name, season));
  handler('reveal', id => {
    const job = store.job(id), file = job.preparedPath || job.sourcePath;
    if (!file || !fs.existsSync(file)) throw new Error('This file is not available locally yet.');
    shell.showItemInFolder(file); return true;
  });
  handler('openWorkspace', () => shell.openPath(store.state.settings.workspace));
  handler('openPortal', () => shell.openExternal(endpoint(portal.current?.base || store.state.settings.remoteUrl)));
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 1040, minHeight: 720,
    show: false, title: 'MabelTV Studio', backgroundColor: '#f5f6f2', icon: path.join(__dirname, 'ui/studio.ico'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#f5f6f2', symbolColor: '#273a39', height: 38 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('studio://app/')) event.preventDefault(); });
  window.once('ready-to-show', () => { if (!process.argv.includes('--background')) window.show(); });
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (!process.env.STUDIO_TEST_DATA) { window.hide(); return; }
    closing = true;
    searchController?.abort(); queue.shutdown().finally(() => app.quit());
  });
  queue.on('change', jobs => {
    if (!window.isDestroyed()) {
      window.webContents.send('studio:queue', jobs);
      window.webContents.send('studio:connectionState', portal.current);
    }
  });
  await window.loadURL('studio://app/index.html');
  await queue.cleanupCompleted();
  queue.kick();
}
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
if (single) app.whenReady().then(start).catch(error => { dialog.showErrorBox('MabelTV Studio could not start', error.message); app.quit(); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
