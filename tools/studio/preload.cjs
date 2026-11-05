'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const methods = ['snapshot', 'sourceSize', 'settings', 'connect', 'pin', 'signIn', 'search', 'metadata', 'libraryPresence', 'searchTitles', 'pickFiles', 'pickFolder', 'add', 'action', 'createSeries', 'createCollection', 'reveal', 'openWorkspace', 'openPortal', 'libraryRead', 'libraryWrite'];
const api = Object.fromEntries(methods.map(method => [method, (...args) => ipcRenderer.invoke('studio:' + method, ...args)]));
api.droppedFiles = files => Array.from(files).map(file => webUtils.getPathForFile(file)).filter(Boolean);
api.onQueue = callback => { const listener = (_event, jobs) => callback(jobs); ipcRenderer.on('studio:queue', listener); return () => ipcRenderer.removeListener('studio:queue', listener); };
api.onConnection = callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('studio:connection', listener); return () => ipcRenderer.removeListener('studio:connection', listener); };
api.onConnectionState = callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('studio:connectionState', listener); return () => ipcRenderer.removeListener('studio:connectionState', listener); };
contextBridge.exposeInMainWorld('studio', api);
