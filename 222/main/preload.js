const { contextBridge, ipcRenderer } = require('electron');

// === Мост между Electron и веб-клиентом ===
function sendToWebClient(channel, data) {
  const frame = document.getElementById('ns-webview');
  if (frame?.contentWindow) {
    frame.contentWindow.postMessage(
      { channel, data, source: 'electron' },
      'https://ns.fiber-gate.ru'
    );
  }
}

function listenFromWebClient(channel, callback) {
  const handler = (event) => {
    if (event.origin !== 'https://ns.fiber-gate.ru') return;
    if (event.data?.channel === channel && event.data?.source === 'webclient') {
      callback(event.data.data);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // === Существующие методы менеджера аддонов ===
  loadAddons: () => ipcRenderer.invoke('load-addons'),
  toggleAddon: (name, install) => ipcRenderer.invoke('toggle-addon', name, install),
  launchGame: () => ipcRenderer.invoke('launch-game'),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  checkGame: () => ipcRenderer.invoke('check-game'),
  changeGamePath: () => ipcRenderer.invoke('change-game-path'),
  goBack: () => ipcRenderer.send('go-back'),
  setPTTHotkey: (hotkey) => ipcRenderer.invoke('set-ptt-hotkey', hotkey),
  getPTTHotkey: () => ipcRenderer.invoke('get-ptt-hotkey'),
  
  // === Существующие слушатели событий ===
  onPTTPressed: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = () => callback();
    ipcRenderer.on('ptt-pressed', handler);
    return () => ipcRenderer.off('ptt-pressed', handler);
  },
  onProgress: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = (event, name, progress) => {
      if (typeof name === 'string' && typeof progress === 'number') {
        callback(name, progress);
      }
    };
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.off('progress', handler);
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
  },
  
  // === НОВЫЕ методы для веб-клиента ===
  sendToWebClient: (channel, data) => sendToWebClient(channel, data),
  onWebClientEvent: (channel, callback) => listenFromWebClient(channel, callback),
  registerPTTHotkey: (hotkey) => ipcRenderer.invoke('register-ptt-hotkey', hotkey),
  onPTTActivated: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = () => {
      sendToWebClient('ptt-activated', { pressed: true });
      if (typeof callback === 'function') callback();
    };
    ipcRenderer.on('ptt-activated', handler);
    return () => ipcRenderer.off('ptt-activated', handler);
  },
  sendMicState: (state) => ipcRenderer.send('webclient-mic-state', state),
});