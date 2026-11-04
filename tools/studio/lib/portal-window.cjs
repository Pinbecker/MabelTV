'use strict';
function openPortalWindow({ BrowserWindow, parent, session, base, tab = 'cloud' }) {
  if (!['cloud', 'torrents', 'activity'].includes(tab)) throw new Error('Choose a Studio section.');
  const origin = new URL(base).origin;
  const child = new BrowserWindow({ parent, width: 1180, height: 900, minWidth: 700, minHeight: 600,
    title: 'MabelTV Studio · ' + (tab === 'torrents' ? 'Find anything' : tab === 'activity' ? 'Activity' : 'iCloud library'),
    autoHideMenuBar: true, webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  child.setMenu(null);
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  child.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  child.loadURL(origin + '/#my-tv-studio/' + tab);
  return child;
}
module.exports = { openPortalWindow };
