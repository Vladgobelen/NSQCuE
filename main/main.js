const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process');
const net = require('net');
const addonManager = require('./addonManager');
const settings = require('./settings');
const soundsManager = require('./soundsManager');
const { setupLogging } = require('./utils');
const logger = setupLogging();

let mainWindow;
let webviewWebContents = null;
let hookProcess = null;
let overlayProcess = null;
let pipeClient = null;
let pipeReconnectTimer = null;
const pressedKeys = new Map();
let currentPTTHotkeyCodes = null;
let captureMode = false;
const capturedCodes = new Set();
let pttActive = false;
const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');

fs.ensureDirSync(SOUNDS_DIR);

const SOUND_MAP = {
  'message': 'message.mp3',
  'user-join': 'user-join.mp3',
  'user-leave': 'user-leave.mp3',
  'mic-on': 'mic-on.mp3',
  'mic-off': 'mic-off.mp3',
  'pop-up-message': 'notification.mp3',
  'room-join': 'room-join.mp3'
};

function playSoundSilent(filePath) {
  if (!fs.existsSync(filePath)) {
    logger.error(`[SOUND] File not found: ${filePath}`);
    return;
  }
  
  logger.info(`[SOUND] Playing: ${filePath}`);
  const uriPath = 'file:///' + filePath.replace(/\\/g, '/').replace(/ /g, '%20');
  
  if (process.platform === 'win32') {
    const psCommand = `Add-Type -AssemblyName presentationCore; $player = New-Object System.Windows.Media.MediaPlayer; $player.Open('${uriPath}'); $player.Play(); Start-Sleep -Seconds 3; $player.Stop(); $player.Dispose()`;
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${psCommand}"`, (err, stdout, stderr) => {
      if (err) {
        logger.error(`[SOUND] PowerShell error: ${err.message}`);
        if (stderr) logger.error(`[SOUND] stderr: ${stderr}`);
      } else {
        logger.info(`[SOUND] Playback completed`);
      }
    });
  } else {
    const player = process.platform === 'darwin' ? 'afplay' : 'play';
    exec(`${player} "${filePath}"`, (err) => {
      if (err) logger.error(`[SOUND] Playback error: ${err.message}`);
    });
  }
}

async function ensureGamePath() {
  if (settings.isGamePathValid()) return true;
  const result = await dialog.showOpenDialog({
    title: 'Выберите файл Wow.exe',
    properties: ['openFile'],
    filters: [{ name: 'Executable files', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return false;
  const selectedPath = path.dirname(result.filePaths[0]);
  const wowPath = path.join(selectedPath, 'Wow.exe');
  if (!fs.existsSync(wowPath)) {
    logger.error(`[GAME_PATH] Selected path missing Wow.exe: ${wowPath}`);
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  return true;
}

function startRustHook() {
  if (hookProcess) return;
  const exeName = process.platform === 'win32' ? 'global-mouse-hook.exe' : 'global-mouse-hook';
  const exePath = app.isPackaged
    ? path.join(process.resourcesPath, exeName)
    : path.join(__dirname, '..', exeName);
  if (!fs.existsSync(exePath)) {
    logger.error(`[HOOK] Executable not found: ${exePath}`);
    dialog.showErrorBox('Ошибка', `Не найден файл хука: ${exeName}. Проверьте наличие в корне проекта или resources.`);
    return;
  }
  try {
    hookProcess = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env }
    });
    hookProcess.stdout.on('data', (data) => {
      const raw = data.toString();
      if (!raw.trim()) return;
      const lines = raw.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let code;
        let isDown;
        try {
          const json = JSON.parse(trimmed);
          if (typeof json.code !== 'number') continue;
          code = json.code;
          isDown = json.event === 'down';
        } catch {
          const [typeStr, codeStr] = trimmed.split(':');
          code = parseInt(codeStr, 10);
          isDown = typeStr.toLowerCase() === 'down';
        }
        if (isNaN(code)) continue;
        pressedKeys.set(code, isDown);
        if (captureMode && isDown) {
          capturedCodes.add(code);
          mainWindow?.webContents?.send('key-captured', code);
        }
        if (currentPTTHotkeyCodes && currentPTTHotkeyCodes.length > 0) {
          const allPressed = currentPTTHotkeyCodes.every(c => pressedKeys.get(c) === true);
          const allReleased = currentPTTHotkeyCodes.every(c => pressedKeys.get(c) !== true);
          if (allPressed && !pttActive) {
            pttActive = true;
            mainWindow?.webContents?.send('ptt-pressed');
          } else if (allReleased && pttActive) {
            pttActive = false;
            mainWindow?.webContents?.send('ptt-released');
          }
        }
      }
    });
    hookProcess.stderr.on('data', (data) => {
      const err = data.toString().trim();
      if (err) logger.error(`[HOOK_STDERR] ${err}`);
    });
    hookProcess.on('close', () => { hookProcess = null; });
    hookProcess.on('error', (err) => {
      logger.error(`[HOOK] Process error: ${err.message}`);
      hookProcess = null;
    });
  } catch (err) {
    logger.error(`[HOOK] Spawn failed: ${err.message}\n${err.stack}`);
    hookProcess = null;
  }
}

function stopRustHook() {
  if (hookProcess) {
    try { hookProcess.kill(); } catch (err) { logger.error(`[HOOK] Kill failed: ${err.message}`); }
    hookProcess = null;
  }
}

function startOverlay() {
  if (overlayProcess) return;
  
  const exeName = 'chat-overlay.exe';
  const exePath = app.isPackaged
    ? path.join(process.resourcesPath, exeName)
    : path.join(__dirname, '..', exeName);
  
  if (!fs.existsSync(exePath)) {
    logger.warn(`[OVERLAY] Executable not found: ${exePath}`);
    return;
  }
  
  logger.info(`[OVERLAY] Found at: ${exePath}`);
  
  try {
    overlayProcess = spawn(exePath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      detached: false
    });
    
    overlayProcess.stdout.on('data', (data) => {
      logger.info(`[OVERLAY_STDOUT] ${data.toString().trim()}`);
    });
    
    overlayProcess.stderr.on('data', (data) => {
      const err = data.toString().trim();
      if (err) logger.error(`[OVERLAY_STDERR] ${err}`);
    });
    
    overlayProcess.on('close', (code) => {
      logger.info(`[OVERLAY] Process closed with code: ${code}`);
      overlayProcess = null;
      if (pipeClient) {
        pipeClient.destroy();
        pipeClient = null;
      }
    });
    
    overlayProcess.on('error', (err) => {
      logger.error(`[OVERLAY] Process error: ${err.message}`);
      overlayProcess = null;
    });
    
    logger.info('[OVERLAY] Process started, connecting in 1 second...');
    setTimeout(connectToOverlayPipe, 1000);
  } catch (err) {
    logger.error(`[OVERLAY] Failed to start overlay: ${err.message}`);
    overlayProcess = null;
  }
}

function stopOverlay() {
  if (overlayProcess) {
    try { overlayProcess.kill(); } catch (err) { logger.error(`[OVERLAY] Kill failed: ${err.message}`); }
    overlayProcess = null;
  }
  if (pipeClient) {
    pipeClient.destroy();
    pipeClient = null;
  }
  if (pipeReconnectTimer) {
    clearTimeout(pipeReconnectTimer);
    pipeReconnectTimer = null;
  }
}

function connectToOverlayPipe() {
  if (pipeClient) {
    pipeClient.destroy();
  }
  
  const pipePath = '\\\\.\\pipe\\NSQCuE_Overlay_Pipe';
  
  pipeClient = net.createConnection(pipePath);
  
  pipeClient.on('connect', () => {
    logger.info('[OVERLAY] Connected to overlay pipe');
    sendToOverlay('message', { text: 'Electron connected!' });
  });
  
  pipeClient.on('data', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'input') {
        logger.info(`[OVERLAY] Received input: ${msg.text}`);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('overlay-input-received', msg.text);
        }
        
        sendToWebClient(msg.text);
      }
    } catch (err) {
      logger.error('[OVERLAY] Failed to parse message:', err.message);
    }
  });
  
  pipeClient.on('error', (err) => {
    logger.error('[OVERLAY] Pipe error:', err.message);
    schedulePipeReconnect();
  });
  
  pipeClient.on('close', () => {
    logger.info('[OVERLAY] Pipe closed');
    schedulePipeReconnect();
  });
}

function schedulePipeReconnect() {
  if (pipeReconnectTimer) {
    clearTimeout(pipeReconnectTimer);
  }
  
  pipeReconnectTimer = setTimeout(() => {
    logger.info('[OVERLAY] Reconnecting to pipe...');
    connectToOverlayPipe();
  }, 2000);
}

function sendToOverlay(type, data) {
  if (!pipeClient || pipeClient.destroyed) {
    logger.warn('[OVERLAY] Pipe not connected, cannot send');
    return false;
  }
  
  try {
    const msg = JSON.stringify({ type, ...data });
    pipeClient.write(msg);
    logger.info(`[OVERLAY] Sent to overlay: ${msg}`);
    return true;
  } catch (err) {
    logger.error('[OVERLAY] Failed to send to overlay:', err.message);
    return false;
  }
}

function sendToWebClient(text) {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) {
    logger.warn('[OVERLAY] WebView not available, cannot send message');
    return;
  }
  
  try {
    const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    const code = `
      (function() {
        console.log('[Overlay] Attempting to send message:', '${escapedText}');
        
        const selectors = [
          'input[type="text"]',
          'textarea',
          '[contenteditable="true"]',
          '.chat-input',
          '#chat-input',
          '.message-input',
          '[data-testid="chat-input"]'
        ];
        
        let inputField = null;
        for (const selector of selectors) {
          inputField = document.querySelector(selector);
          if (inputField) break;
        }
        
        if (inputField) {
          if (inputField.tagName === 'INPUT' || inputField.tagName === 'TEXTAREA') {
            inputField.value = '${escapedText}';
            inputField.dispatchEvent(new Event('input', { bubbles: true }));
            inputField.dispatchEvent(new Event('change', { bubbles: true }));
            
            const sendSelectors = [
              'button[type="submit"]',
              '.send-button',
              '#send-button',
              '.chat-send',
              '[data-testid="send-button"]'
            ];
            
            let sendButton = null;
            for (const selector of sendSelectors) {
              sendButton = document.querySelector(selector);
              if (sendButton) break;
            }
            
            if (!sendButton) {
              inputField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
              inputField.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
            } else {
              sendButton.click();
            }
            
            return true;
          } else if (inputField.getAttribute('contenteditable') === 'true') {
            inputField.textContent = '${escapedText}';
            inputField.dispatchEvent(new Event('input', { bubbles: true }));
            inputField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            return true;
          }
        }
        
        console.warn('[Overlay] Could not find chat input field');
        return false;
      })();
    `;
    
    webviewWebContents.executeJavaScript(code).then(result => {
      if (result) {
        logger.info('[OVERLAY] Message sent to web client successfully');
      } else {
        logger.warn('[OVERLAY] Failed to send message to web client - input field not found');
      }
    }).catch(err => {
      logger.error('[OVERLAY] Error sending to web client:', err.message);
    });
  } catch (err) {
    logger.error('[OVERLAY] Failed to execute JavaScript in webview:', err.message);
  }
}

function getKeyName(code) {
  const names = {
    16: 'Shift', 17: 'Ctrl', 18: 'Alt', 32: 'Space', 27: 'Esc', 13: 'Enter',
    9: 'Tab', 8: 'Backspace', 46: 'Del', 37: '←', 38: '↑', 39: '→', 40: '↓',
    112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8',
    120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
    272: 'Mouse4', 273: 'Mouse5', 276: 'MouseLeft', 277: 'MouseRight', 278: 'MouseMiddle'
  };
  return names[code] || `K${code}`;
}

function setupWebviewHandlers(webContents) {
  webviewWebContents = webContents;
  
  // ПРИНУДИТЕЛЬНО ОТКРЫВАЕМ КОНСОЛЬ ВЕБ-КЛИЕНТА
  webContents.openDevTools({ mode: 'detach' });
  logger.info('[WEBVIEW] DevTools opened');
  
  const isExternalUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.origin !== 'https://ns.fiber-gate.ru';
    } catch { return false; }
  };
  
  webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  
  webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  
  webContents.on('did-fail-load', (e, code, desc) => {
    logger.error(`[WEBVIEW] Failed: ${code} - ${desc}`);
  });
  
  webContents.on('ipc-message', (event, channel, ...args) => {
    logger.info(`[WEBVIEW_IPC] Channel: ${channel}, Args: ${JSON.stringify(args)}`);
    
    if (channel === 'play-sound') {
      const soundType = args[0];
      logger.info(`[WEBVIEW] Play sound requested: ${soundType}`);
      const fileName = SOUND_MAP[soundType] || `${soundType}.mp3`;
      const soundPath = path.join(SOUNDS_DIR, fileName);
      let finalPath = null;
      if (fs.existsSync(soundPath)) {
        finalPath = soundPath;
      } else {
        const resourcePath = app.isPackaged
          ? path.join(process.resourcesPath, 'sounds', fileName)
          : path.join(__dirname, '..', 'sounds', fileName);
        if (fs.existsSync(resourcePath)) finalPath = resourcePath;
      }
      if (!finalPath) {
        logger.error(`[WEBVIEW] Sound file not found: ${fileName}`);
        return;
      }
      playSoundSilent(finalPath);
    }
  });
  
  webContents.on('did-finish-load', () => {
    const injectCode = `
(function() {
  let ipcRenderer = null;
  try { if (typeof require !== 'undefined') { ipcRenderer = require('electron').ipcRenderer; } } catch (e) {}
  if (!ipcRenderer && window.ipcRenderer) ipcRenderer = window.ipcRenderer;
  window.ELECTRON_CUSTOM_SOUNDS_ENABLED = true;
  window.electronAPI = {
    playSound: (soundType) => {
      if (ipcRenderer) {
        try { ipcRenderer.sendToHost('play-sound', soundType); return Promise.resolve(true); } catch (e) {}
      }
      window.postMessage({ type: 'ELECTRON_PLAY_SOUND', soundType: soundType, source: 'webview' }, '*');
      return Promise.resolve(true);
    }
  };
  
  console.log('[Overlay] Setting up chat observer');
  
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const messageSelectors = ['.message', '.chat-message', '.msg', '[data-message]'];
          for (const selector of messageSelectors) {
            if (node.matches && node.matches(selector)) {
              const text = node.textContent || '';
              if (text.trim()) {
                window.postMessage({ 
                  type: 'CHAT_MESSAGE', 
                  text: text, 
                  source: 'webview' 
                }, '*');
              }
              break;
            }
          }
        }
      }
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();`;
    webContents.executeJavaScript(injectCode).catch(() => {});
  });
}

function createWindow() {
  const nsSession = session.fromPartition('persist:ns');
  nsSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'camera', 'clipboard-read', 'clipboard-sanitized-write', 'clipboard'];
    callback(allowedPermissions.includes(permission));
  });
  
  const applyCSP = (details, callback, isDefault) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDefault
            ? "default-src 'self'; script-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; style-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; img-src 'self' https://ns.fiber-gate.ru blob:; connect-src 'self' http://194.31.171.29:38592 https://ns.fiber-gate.ru wss://ns.fiber-gate.ru; media-src 'self' blob: https://ns.fiber-gate.ru; child-src 'self' https://ns.fiber-gate.ru blob:; frame-src 'self' https://ns.fiber-gate.ru blob:; worker-src 'self' blob:; font-src 'self' https://ns.fiber-gate.ru;"
            : "default-src 'self' https://ns.fiber-gate.ru; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://ns.fiber-gate.ru https://cdn.socket.io https://unpkg.com; style-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; img-src 'self' https://ns.fiber-gate.ru blob:; connect-src 'self' http://194.31.171.29:38592 https://ns.fiber-gate.ru wss://ns.fiber-gate.ru wss://*.fiber-gate.ru; media-src 'self' blob: https://ns.fiber-gate.ru; child-src 'self' https://ns.fiber-gate.ru blob:; frame-src 'self' https://ns.fiber-gate.ru blob:; worker-src 'self' blob: https://ns.fiber-gate.ru; font-src 'self' https://ns.fiber-gate.ru;"
        ],
        'X-Frame-Options': 'ALLOW-FROM file:// app://'
      }
    });
  };
  
  nsSession.webRequest.onHeadersReceived((details, callback) => applyCSP(details, callback, false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => applyCSP(details, callback, true));
  
  mainWindow = new BrowserWindow({
    width: 550, height: 650, minWidth: 300, minHeight: 500,
    title: 'Ночная стража: установщик аддонов',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, webviewTag: true, permissions: ['microphone']
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });
  
  // ПРИНУДИТЕЛЬНО ОТКРЫВАЕМ КОНСОЛЬ MAIN WINDOW
  mainWindow.webContents.openDevTools({ mode: 'detach' });
  
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    setupWebviewHandlers(webContents);
  });
  mainWindow.webContents.on('did-create-webview', (event, webContents) => {
    setupWebviewHandlers(webContents);
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));
  
  logger.info(`[SOUNDS] User data sounds dir: ${SOUNDS_DIR}`);
  logger.info(`[SOUNDS] App packaged: ${app.isPackaged}`);
  logger.info(`[SOUNDS] Resources path: ${process.resourcesPath}`);
  
  for (const [type, file] of Object.entries(SOUND_MAP)) {
    const userPath = path.join(SOUNDS_DIR, file);
    const exists = fs.existsSync(userPath);
    logger.info(`[SOUNDS] ${type}: ${file} - ${exists ? 'EXISTS' : 'MISSING'}`);
  }
  
  const gamePathValid = await ensureGamePath();
  if (!gamePathValid) {
    logger.error('[APP] Invalid game path, quitting');
    app.quit();
    return;
  }
  addonManager.setGamePath(settings.getGamePath());
  createWindow();
  startRustHook();
  startOverlay();
  const savedHotkey = settings.getPTTHotkey();
  if (savedHotkey && Array.isArray(savedHotkey)) currentPTTHotkeyCodes = savedHotkey;
  try { await addonManager.loadAddons(); } catch (err) { logger.error('[APP] Failed to load addons:', err.message); }
  try { await addonManager.startupUpdateCheck(mainWindow); } catch (err) { logger.error('[STARTUP] Update check error:', err.message); }
  addonManager.startBackgroundChecker(mainWindow);
  soundsManager.autoDownloadBaseSounds().catch(err => logger.error('[SOUNDS] Auto-download failed:', err.message));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { 
  stopRustHook(); 
  stopOverlay();
  globalShortcut.unregisterAll(); 
});

ipcMain.handle('load-addons', async () => {
  try { return await addonManager.loadAddons(); } catch (error) { logger.error('[IPC] load-addons error:', error.message); return {}; }
});

ipcMain.handle('toggle-addon', async (event, name, install) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    await addonManager.toggleAddon(name, install, mainWindow);
    return true;
  } catch (error) {
    logger.error(`[IPC] toggle-addon ${name} error:`, error.message);
    dialog.showErrorBox('Ошибка установки', error.message);
    return false;
  }
});

ipcMain.handle('launch-game', async () => {
  try { return await addonManager.launchGame(); } catch (error) { logger.error('[IPC] launch-game error:', error.message); return false; }
});

ipcMain.handle('check-game', async () => {
  try {
    const gamePath = settings.getGamePath();
    if (!gamePath) return false;
    return fs.existsSync(path.join(gamePath, 'Wow.exe'));
  } catch (error) { logger.error('[IPC] check-game error:', error.message); return false; }
});

ipcMain.handle('change-game-path', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выберите файл Wow.exe', properties: ['openFile'],
    filters: [{ name: 'Executable files', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return false;
  const selectedPath = path.dirname(result.filePaths[0]);
  if (!fs.existsSync(path.join(selectedPath, 'Wow.exe'))) {
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  addonManager.setGamePath(selectedPath);
  return true;
});

ipcMain.on('open-logs-folder', () => { shell.openPath(path.join(app.getPath('userData'), 'logs')); });
ipcMain.on('go-back', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`file://${__dirname}/../renderer/index.html`); });

ipcMain.handle('start-key-capture', async () => { captureMode = true; capturedCodes.clear(); pressedKeys.clear(); return { success: true }; });
ipcMain.handle('stop-key-capture', async () => { captureMode = false; const codes = Array.from(capturedCodes); capturedCodes.clear(); return { success: true, codes }; });
ipcMain.handle('set-ptt-hotkey', async (event, codes) => {
  if (!Array.isArray(codes)) return { success: false, message: 'Invalid hotkey format' };
  currentPTTHotkeyCodes = codes;
  settings.setPTTHotkey(codes);
  pttActive = false;
  return { success: true };
});
ipcMain.handle('get-ptt-hotkey', async () => currentPTTHotkeyCodes);
ipcMain.handle('get-platform', async () => process.platform);
ipcMain.handle('register-ptt-hotkey', async () => ({ success: true, message: 'Use set-ptt-hotkey with array of codes instead' }));

ipcMain.on('webclient-mic-state', (event, state) => {});

ipcMain.handle('clear-session-cache', async (event, partition) => {
  const sess = session.fromPartition(partition);
  await sess.clearCache();
  await sess.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'filesystem', 'indexeddb', 'localstorage'] });
  return true;
});

ipcMain.handle('execute-in-webview', async (event, { code }) => {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) {
    logger.error('[IPC] execute-in-webview: WebView not available');
    throw new Error('WebView webContents not available');
  }
  try { return await webviewWebContents.executeJavaScript(code); } catch (error) { logger.error('[IPC] execute-in-webview error:', error.message); throw error; }
});

ipcMain.handle('open-external', async (event, url) => {
  if (!url || typeof url !== 'string') return false;
  try { await shell.openExternal(url); return true; } catch (err) { logger.error(`[IPC] open-external failed: ${err.message}`); return false; }
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
  if (typeof text !== 'string') return false;
  try { clipboard.writeText(text); return true; } catch (error) { logger.error('[IPC] copy-to-clipboard error:', error.message); return false; }
});

ipcMain.handle('play-sound', async (event, soundType) => {
  logger.info(`[SOUND] Requested sound type: ${soundType}`);
  const fileName = SOUND_MAP[soundType] || `${soundType}.mp3`;
  logger.info(`[SOUND] File name: ${fileName}`);
  const soundPath = path.join(SOUNDS_DIR, fileName);
  let finalPath = null;
  if (fs.existsSync(soundPath)) {
    finalPath = soundPath;
    logger.info(`[SOUND] Found in user data: ${finalPath}`);
  } else {
    const resourcePath = app.isPackaged
      ? path.join(process.resourcesPath, 'sounds', fileName)
      : path.join(__dirname, '..', 'sounds', fileName);
    logger.info(`[SOUND] Checking resource path: ${resourcePath}`);
    if (fs.existsSync(resourcePath)) finalPath = resourcePath;
  }
  if (!finalPath) {
    logger.error(`[SOUND] Sound file not found: ${fileName}`);
    return false;
  }
  playSoundSilent(finalPath);
  return true;
});

ipcMain.handle('select-sounds-folder', async () => {
  const result = await dialog.showOpenDialog({ title: 'Выберите папку со звуками', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('import-sounds', async (event, sourceFolder) => {
  if (!sourceFolder || !fs.existsSync(sourceFolder)) {
    logger.error('[IPC] import-sounds: source folder not found');
    return { success: false, error: 'Папка не найдена' };
  }
  const imported = [];
  const missing = [];
  for (const [soundType, fileName] of Object.entries(SOUND_MAP)) {
    const sourcePath = path.join(sourceFolder, fileName);
    const destPath = path.join(SOUNDS_DIR, fileName);
    if (fs.existsSync(sourcePath)) {
      try { await fs.copy(sourcePath, destPath, { overwrite: true }); imported.push(soundType); } catch (err) { missing.push({ soundType, error: err.message }); logger.error(`[SOUND] Failed to import ${fileName}:`, err.message); }
    } else { missing.push({ soundType, error: 'Файл не найден' }); }
  }
  return { success: true, imported, missing };
});

ipcMain.handle('get-sounds-status', async () => {
  const status = {};
  for (const [soundType, fileName] of Object.entries(SOUND_MAP)) {
    const soundPath = path.join(SOUNDS_DIR, fileName);
    status[soundType] = { fileName, exists: fs.existsSync(soundPath), path: soundPath };
  }
  return status;
});

ipcMain.on('open-sounds-folder', () => { shell.openPath(SOUNDS_DIR); });

ipcMain.handle('fetch-sounds-config', async () => {
  try { return await soundsManager.fetchSoundsConfig(); } catch (error) { logger.error('[SOUNDS] Fetch config failed:', error.message); throw error; }
});

ipcMain.handle('download-sounds-section', async (event, sectionName) => {
  try {
    const config = await soundsManager.fetchSoundsConfig();
    await soundsManager.downloadSection(sectionName, config, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sounds-download-progress', progress);
      }
    });
    return { success: true };
  } catch (error) {
    logger.error('[SOUNDS] Download section failed:', error.message);
    throw error;
  }
});

ipcMain.handle('is-sounds-dir-empty', async () => {
  return await soundsManager.isSoundsDirEmpty();
});

ipcMain.handle('send-test-to-overlay', async () => {
  return sendToOverlay('message', { text: 'Тест' });
});

ipcMain.handle('send-message-to-overlay', async (event, text) => {
  return sendToOverlay('message', { text });
});

ipcMain.on('chat-message-from-webview', (event, text) => {
  sendToOverlay('message', { text });
});