const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadAddons: () => ipcRenderer.invoke('load-addons'),
  toggleAddon: (name, install) => ipcRenderer.invoke('toggle-addon', name, install),
  launchGame: () => ipcRenderer.invoke('launch-game'),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  checkGame: () => ipcRenderer.invoke('check-game'),
  changeGamePath: () => ipcRenderer.invoke('change-game-path'),
  goBack: () => ipcRenderer.send('go-back'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  registerPTTHotkey: (hotkey) => ipcRenderer.invoke('register-ptt-hotkey', hotkey),
  sendMicState: (state) => ipcRenderer.send('webclient-mic-state', state),
  clearWebviewCache: () => ipcRenderer.invoke('clear-session-cache', 'persist:ns'),
  sendToWebClient: (channel, data) => {
    const frame = document.getElementById('ns-webview');
    if (!frame) return;
    if (channel === 'toggle-mic') {
      ipcRenderer.invoke('execute-in-webview', {
        code: 'if (window.voiceClient && typeof window.voiceClient.toggleMicrophone === "function") { window.voiceClient.toggleMicrophone(); }'
      }).catch(() => {});
    } else if (frame.contentWindow) {
      frame.contentWindow.postMessage({ channel, data, source: 'electron' }, '*');
    }
  },
  onWebClientEvent: (channel, callback) => {
    const handler = (event) => {
      if (event.data?.channel === channel && event.data?.source === 'webclient') {
        callback(event.data.data);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  },
  setPTTHotkey: (codes) => ipcRenderer.invoke('set-ptt-hotkey', codes),
  getPTTHotkey: () => ipcRenderer.invoke('get-ptt-hotkey'),
  startKeyCapture: () => ipcRenderer.invoke('start-key-capture'),
  stopKeyCapture: () => ipcRenderer.invoke('stop-key-capture'),
  onBlockLaunchGame: (callback) => {
    const handler = (event, blocked) => callback(blocked);
    ipcRenderer.on('block-launch-game', handler);
    return () => ipcRenderer.off('block-launch-game', handler);
  },
  onPTTPressed: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ptt-pressed', handler);
    return () => ipcRenderer.off('ptt-pressed', handler);
  },
  onPTTReleased: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ptt-released', handler);
    return () => ipcRenderer.off('ptt-released', handler);
  },
  onKeyCaptured: (callback) => {
    const handler = (event, code) => callback(code);
    ipcRenderer.on('key-captured', handler);
    return () => ipcRenderer.off('key-captured', handler);
  },
  onProgress: (callback) => {
    const handler = (event, name, progress) => {
      if (typeof name === 'string' && typeof progress === 'number') {
        callback(name, progress);
      }
    };
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.off('progress', handler);
  },
  onOperationFinished: (callback) => {
    const handler = (event, name, success) => callback(name, success);
    ipcRenderer.on('operation-finished', handler);
    return () => ipcRenderer.off('operation-finished', handler);
  },
  onError: (callback) => {
    const handler = (event, err) => callback(err.message || err);
    ipcRenderer.on('operation-error', handler);
    return () => ipcRenderer.off('operation-error', handler);
  },
  onAddonUpdateAvailable: (callback) => {
    const handler = (event, name) => callback(name);
    ipcRenderer.on('addon-update-available', handler);
    return () => ipcRenderer.off('addon-update-available', handler);
  },
  onPTTActivated: (callback) => {
    const handler = () => {
      const frame = document.getElementById('ns-webview');
      if (frame?.contentWindow) {
        frame.contentWindow.postMessage({ channel: 'ptt-activated', data: { pressed: true }, source: 'electron' }, '*');
      }
      if (typeof callback === 'function') callback();
    };
    ipcRenderer.on('ptt-activated', handler);
    return () => ipcRenderer.off('ptt-activated', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  playSound: (soundType) => ipcRenderer.invoke('play-sound', soundType),
  selectSoundsFolder: () => ipcRenderer.invoke('select-sounds-folder'),
  importSounds: (sourceFolder) => ipcRenderer.invoke('import-sounds', sourceFolder),
  getSoundsStatus: () => ipcRenderer.invoke('get-sounds-status'),
  openSoundsFolder: () => ipcRenderer.send('open-sounds-folder'),
  fetchSoundsConfig: () => ipcRenderer.invoke('fetch-sounds-config'),
  downloadSoundsSection: (sectionName) => ipcRenderer.invoke('download-sounds-section', sectionName),
  isSoundsDirEmpty: () => ipcRenderer.invoke('is-sounds-dir-empty'),
  onSoundsDownloadProgress: (callback) => {
    const handler = (event, progress) => callback(progress);
    ipcRenderer.on('sounds-download-progress', handler);
    return () => ipcRenderer.off('sounds-download-progress', handler);
  },
  
  // API для оверлея
  sendTestToOverlay: () => ipcRenderer.invoke('send-test-to-overlay'),
  sendMessageToOverlay: (text) => ipcRenderer.invoke('send-message-to-overlay', text),
  onOverlayInput: (callback) => {
    const handler = (event, text) => callback(text);
    ipcRenderer.on('overlay-input-received', handler);
    return () => ipcRenderer.off('overlay-input-received', handler);
  }
});