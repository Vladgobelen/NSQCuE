const { contextBridge, ipcRenderer } = require('electron');

function log(channel, direction, data) {
  console.log(`[PRELOAD] ${direction} ${channel}:`, data);
}

function sendToWebClient(channel, data) {
  log(channel, '→', data);
  const frame = document.getElementById('ns-webview');
  if (!frame) {
    console.warn(`[PRELOAD] WebView not found for channel: ${channel}`);
    return;
  }
  if (channel === 'toggle-mic') {
    ipcRenderer.invoke('execute-in-webview', {
      code: 'if (window.voiceClient && typeof window.voiceClient.toggleMicrophone === "function") { window.voiceClient.toggleMicrophone(); }'
    }).catch(err => console.error('[PRELOAD] execute-in-webview error:', err));
  } else if (frame.contentWindow) {
    frame.contentWindow.postMessage({ channel, data, source: 'electron' }, '*');
  }
}

function listenFromWebClient(channel, callback) {
  const handler = (event) => {
    if (event.data?.channel === channel && event.data?.source === 'webclient') {
      log(channel, '←', event.data.data);
      callback(event.data.data);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  loadAddons: () => {
    log('load-addons', '→', null);
    return ipcRenderer.invoke('load-addons');
  },
  toggleAddon: (n, i) => {
    log('toggle-addon', '→', { name: n, install: i });
    return ipcRenderer.invoke('toggle-addon', n, i);
  },
  launchGame: () => {
    log('launch-game', '→', null);
    return ipcRenderer.invoke('launch-game');
  },
  openLogsFolder: () => {
    log('open-logs-folder', '→', null);
    ipcRenderer.send('open-logs-folder');
  },
  checkGame: () => {
    log('check-game', '→', null);
    return ipcRenderer.invoke('check-game');
  },
  changeGamePath: () => {
    log('change-game-path', '→', null);
    return ipcRenderer.invoke('change-game-path');
  },
  goBack: () => {
    log('go-back', '→', null);
    ipcRenderer.send('go-back');
  },
  getPlatform: () => {
    log('get-platform', '→', null);
    return ipcRenderer.invoke('get-platform');
  },
  registerPTTHotkey: (h) => {
    log('register-ptt-hotkey', '→', h);
    return ipcRenderer.invoke('register-ptt-hotkey', h);
  },
  sendMicState: (s) => {
    log('webclient-mic-state', '→', s);
    ipcRenderer.send('webclient-mic-state', s);
  },
  clearWebviewCache: () => {
    log('clear-session-cache', '→', 'persist:ns');
    return ipcRenderer.invoke('clear-session-cache', 'persist:ns');
  },
  sendToWebClient: (ch, d) => sendToWebClient(ch, d),
  onWebClientEvent: (ch, cb) => listenFromWebClient(ch, cb),
  setPTTHotkey: (codes) => {
    log('set-ptt-hotkey', '→', codes);
    return ipcRenderer.invoke('set-ptt-hotkey', codes);
  },
  getPTTHotkey: () => {
    log('get-ptt-hotkey', '→', null);
    return ipcRenderer.invoke('get-ptt-hotkey');
  },
  startKeyCapture: () => {
    log('start-key-capture', '→', null);
    return ipcRenderer.invoke('start-key-capture');
  },
  stopKeyCapture: () => {
    log('stop-key-capture', '→', null);
    return ipcRenderer.invoke('stop-key-capture');
  },
  onBlockLaunchGame: (cb) => {
    const h = (e, blocked) => { log('block-launch-game', '←', blocked); cb(blocked); };
    ipcRenderer.on('block-launch-game', h);
    return () => ipcRenderer.off('block-launch-game', h);
  },
  onPTTPressed: (cb) => {
    const h = () => { log('ptt-pressed', '←', null); cb(); };
    ipcRenderer.on('ptt-pressed', h);
    return () => ipcRenderer.off('ptt-pressed', h);
  },
  onPTTReleased: (cb) => {
    const h = () => { log('ptt-released', '←', null); cb(); };
    ipcRenderer.on('ptt-released', h);
    return () => ipcRenderer.off('ptt-released', h);
  },
  onKeyCaptured: (cb) => {
    const h = (e, code) => { log('key-captured', '←', code); cb(code); };
    ipcRenderer.on('key-captured', h);
    return () => ipcRenderer.off('key-captured', h);
  },
  onProgress: (cb) => {
    const h = (e, n, p) => {
      if (typeof n === 'string' && typeof p === 'number') {
        log('progress', '←', { name: n, progress: p });
        cb(n, p);
      }
    };
    ipcRenderer.on('progress', h);
    return () => ipcRenderer.off('progress', h);
  },
  onOperationFinished: (cb) => {
    const h = (e, n, s) => { log('operation-finished', '←', { name: n, success: s }); cb(n, s); };
    ipcRenderer.on('operation-finished', h);
    return () => ipcRenderer.off('operation-finished', h);
  },
  onError: (cb) => {
    const h = (e, err) => { log('operation-error', '←', err); cb(err.message || err); };
    ipcRenderer.on('operation-error', h);
    return () => ipcRenderer.off('operation-error', h);
  },
  onAddonUpdateAvailable: (cb) => {
    const h = (e, n) => { log('addon-update-available', '←', n); cb(n); };
    ipcRenderer.on('addon-update-available', h);
    return () => ipcRenderer.off('addon-update-available', h);
  },
  onPTTActivated: (cb) => {
    const h = () => {
      log('ptt-activated', '←', null);
      sendToWebClient('ptt-activated', { pressed: true });
      if (typeof cb === 'function') cb();
    };
    ipcRenderer.on('ptt-activated', h);
    return () => ipcRenderer.off('ptt-activated', h);
  },
  openExternal: (url) => {
    log('open-external', '→', url);
    return ipcRenderer.invoke('open-external', url);
  }
});