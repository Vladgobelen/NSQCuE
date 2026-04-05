const { contextBridge, ipcRenderer } = require('electron');

function sendToWebClient(channel, data) {
  const frame = document.getElementById('ns-webview');
  if (!frame) return;
  if (channel === 'toggle-mic') {
    ipcRenderer.invoke('execute-in-webview', {
      code: 'if (window.voiceClient && typeof window.voiceClient.toggleMicrophone === "function") { window.voiceClient.toggleMicrophone(); }'
    }).catch(() => {});
  } else if (frame.contentWindow) {
    frame.contentWindow.postMessage({ channel, data, source: 'electron' }, '*');
  }
}

function listenFromWebClient(channel, callback) {
  const handler = (event) => {
    if (event.data?.channel === channel && event.data?.source === 'webclient') {
      callback(event.data.data);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  loadAddons: () => ipcRenderer.invoke('load-addons'),
  toggleAddon: (n, i) => ipcRenderer.invoke('toggle-addon', n, i),
  launchGame: () => ipcRenderer.invoke('launch-game'),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  checkGame: () => ipcRenderer.invoke('check-game'),
  changeGamePath: () => ipcRenderer.invoke('change-game-path'),
  goBack: () => ipcRenderer.send('go-back'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  registerPTTHotkey: (h) => ipcRenderer.invoke('register-ptt-hotkey', h),
  sendMicState: (s) => ipcRenderer.send('webclient-mic-state', s),
  clearWebviewCache: () => ipcRenderer.invoke('clear-session-cache', 'persist:ns'),
  sendToWebClient: (ch, d) => sendToWebClient(ch, d),
  onWebClientEvent: (ch, cb) => listenFromWebClient(ch, cb),
  setPTTHotkey: (codes) => ipcRenderer.invoke('set-ptt-hotkey', codes),
  getPTTHotkey: () => ipcRenderer.invoke('get-ptt-hotkey'),
  startKeyCapture: () => ipcRenderer.invoke('start-key-capture'),
  stopKeyCapture: () => ipcRenderer.invoke('stop-key-capture'),
  onBlockLaunchGame: (cb) => {
    const h = (e, blocked) => cb(blocked);
    ipcRenderer.on('block-launch-game', h);
    return () => ipcRenderer.off('block-launch-game', h);
  },
  onPTTPressed: (cb) => {
    const h = () => cb();
    ipcRenderer.on('ptt-pressed', h);
    return () => ipcRenderer.off('ptt-pressed', h);
  },
  onPTTReleased: (cb) => {
    const h = () => cb();
    ipcRenderer.on('ptt-released', h);
    return () => ipcRenderer.off('ptt-released', h);
  },
  onKeyCaptured: (cb) => {
    const h = (e, code) => cb(code);
    ipcRenderer.on('key-captured', h);
    return () => ipcRenderer.off('key-captured', h);
  },
  onProgress: (cb) => {
    const h = (e, n, p) => typeof n === 'string' && typeof p === 'number' ? cb(n, p) : null;
    ipcRenderer.on('progress', h);
    return () => ipcRenderer.off('progress', h);
  },
  onOperationFinished: (cb) => {
    const h = (e, n, s) => cb(n, s);
    ipcRenderer.on('operation-finished', h);
    return () => ipcRenderer.off('operation-finished', h);
  },
  onError: (cb) => {
    const h = (e, err) => cb(err.message || err);
    ipcRenderer.on('operation-error', h);
    return () => ipcRenderer.off('operation-error', h);
  },
  onAddonUpdateAvailable: (cb) => {
    const h = (e, n) => cb(n);
    ipcRenderer.on('addon-update-available', h);
    return () => ipcRenderer.off('addon-update-available', h);
  },
  onPTTActivated: (cb) => {
    const h = () => {
      sendToWebClient('ptt-activated', { pressed: true });
      if (typeof cb === 'function') cb();
    };
    ipcRenderer.on('ptt-activated', h);
    return () => ipcRenderer.off('ptt-activated', h);
  }
});