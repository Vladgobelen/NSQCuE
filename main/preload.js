// main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

console.log('✅ preload.js: LOADED');

// Логируем всё, что приходит
ipcRenderer.on('progress', (event, ...args) => {
  console.log('🔴 [preload] EVENT RECEIVED: progress', args);
});

contextBridge.exposeInMainWorld('electronAPI', {
  loadAddons: () => ipcRenderer.invoke('load-addons'),
  toggleAddon: (name, install) => ipcRenderer.invoke('toggle-addon', name, install),
  launchGame: () => ipcRenderer.invoke('launch-game'),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  checkGame: () => ipcRenderer.invoke('check-game'),

  onProgress: (callback) => {
    console.log('✅ onProgress: Подписка');
    if (typeof callback !== 'function') return;

    const handler = (event, name, progress) => {
      if (typeof name === 'string' && typeof progress === 'number') {
        console.log('🟢 [onProgress] Вызов callback:', name, progress);
        callback(name, progress);
      }
    };

    ipcRenderer.on('progress', handler);

    return () => {
      console.log('✅ onProgress: Отписка');
      ipcRenderer.off('progress', handler);
    };
  },

  onOperationFinished: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = (event, name, success) => callback(name, success);
    ipcRenderer.on('operation-finished', handler);
    return () => ipcRenderer.off('operation-finished', handler);
  },

  onError: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = (event, error) => callback(error);
    ipcRenderer.on('operation-error', handler);
    return () => ipcRenderer.off('operation-error', handler);
  },

  onAddonUpdateAvailable: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = (event, name) => callback(name);
    ipcRenderer.on('addon-update-available', handler);
    return () => ipcRenderer.off('addon-update-available', handler);
  }
});