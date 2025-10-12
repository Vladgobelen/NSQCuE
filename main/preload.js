// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Addon management
  loadAddons: () => ipcRenderer.invoke('load-addons'),
  toggleAddon: (name, install) => ipcRenderer.invoke('toggle-addon', name, install),
  launchGame: () => ipcRenderer.invoke('launch-game'),
  checkGame: () => ipcRenderer.invoke('check-game'),
  changeGamePath: () => ipcRenderer.invoke('change-game-path'),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  goBack: () => ipcRenderer.send('go-back'),

  // PTT
  onPTTPressed: (callback) => {
    ipcRenderer.on('ptt-pressed', (event, isDown) => callback(isDown));
  },
  getPTTHotkey: () => ipcRenderer.invoke('get-ptt-hotkey'),
  setPTTHotkey: (codes) => ipcRenderer.invoke('set-ptt-hotkey', codes),

  // === ДОБАВЛЕНО: PTT Capture Mode ===
  startPTTCapture: () => ipcRenderer.invoke('start-ptt-capture'),
  stopPTTCapture: () => ipcRenderer.invoke('stop-ptt-capture'),
  clearPTTCapture: () => ipcRenderer.invoke('clear-ptt-capture'),
  onPTTCaptureUpdate: (callback) => {
    ipcRenderer.on('ptt-capture-update', (event, codes) => callback(codes));
  },
  offPTTCaptureUpdate: (callback) => {
    ipcRenderer.removeListener('ptt-capture-update', callback);
  }
});
