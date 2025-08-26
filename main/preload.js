const { contextBridge, ipcRenderer } = require('electron');

function loadExternalScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

ipcRenderer.on('progress', (event, ...args) => {
});

contextBridge.exposeInMainWorld('electronAPI', {
  loadAddons: () => ipcRenderer.invoke('load-addons'),
  toggleAddon: (name, install) => ipcRenderer.invoke('toggle-addon', name, install),
  launchGame: () => ipcRenderer.invoke('launch-game'),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  checkGame: () => ipcRenderer.invoke('check-game'),
  changeGamePath: () => ipcRenderer.invoke('change-game-path'),
  goBack: () => {
    const voiceChat = document.getElementById('voice-chat-overlay');
    if (voiceChat) {
      document.body.removeChild(voiceChat);
    }
  },
  onProgress: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = (event, name, progress) => {
      if (typeof name === 'string' && typeof progress === 'number') {
        callback(name, progress);
      }
    };
    ipcRenderer.on('progress', handler);
    return () => {
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