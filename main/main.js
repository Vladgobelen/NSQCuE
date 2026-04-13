const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process');
const addonManager = require('./addonManager');
const settings = require('./settings');
const { setupLogging } = require('./utils');
const logger = setupLogging();

let mainWindow;
let webviewWebContents = null;
let hookProcess = null;
const pressedKeys = new Map();
let currentPTTHotkeyCodes = null;
let captureMode = false;
const capturedCodes = new Set();
let pttActive = false;

// 🎵 Директория для кастомных звуков
const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');
fs.ensureDirSync(SOUNDS_DIR);

// 🎵 Маппинг типов звуков на имена файлов
const SOUND_MAP = {
    'message': 'message.mp3',
    'user-join': 'user-join.mp3',
    'user-leave': 'user-leave.mp3',
    'mic-on': 'mic-on.mp3',
    'mic-off': 'mic-off.mp3',
    'pop-up-message': 'notification.mp3',
    'room-join': 'room-join.mp3'
};

async function ensureGamePath() {
  logger.debug('[GAME_PATH] Checking game path validity...');
  if (settings.isGamePathValid()) {
    logger.info(`[GAME_PATH] Valid: ${settings.getGamePath()}`);
    return true;
  }
  logger.warn('[GAME_PATH] Invalid or not set, prompting user...');
  const result = await dialog.showOpenDialog({
    title: 'Выберите файл Wow.exe',
    properties: ['openFile'],
    filters: [{ name: 'Executable files', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    logger.warn('[GAME_PATH] User canceled path selection');
    return false;
  }
  const selectedPath = path.dirname(result.filePaths[0]);
  const wowPath = path.join(selectedPath, 'Wow.exe');
  if (!fs.existsSync(wowPath)) {
    logger.error(`[GAME_PATH] Selected path missing Wow.exe: ${wowPath}`);
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  logger.info(`[GAME_PATH] Set to: ${selectedPath}`);
  return true;
}

function startRustHook() {
  logger.info('[HOOK] === startRustHook() ===');
  if (hookProcess) {
    logger.warn(`[HOOK] Hook process already running (PID: ${hookProcess.pid}). Skipping.`);
    return;
  }
  const exeName = process.platform === 'win32' ? 'global-mouse-hook.exe' : 'global-mouse-hook';
  const exePath = app.isPackaged
    ? path.join(process.resourcesPath, exeName)
    : path.join(__dirname, '..', exeName);

  logger.debug(`[HOOK] Resolution context:`);
  logger.debug(`  app.isPackaged: ${app.isPackaged}`);
  logger.debug(`  process.resourcesPath: ${process.resourcesPath}`);
  logger.debug(`  __dirname: ${__dirname}`);
  logger.info(`[HOOK] Resolved executable path: ${exePath}`);

  if (!fs.existsSync(exePath)) {
    logger.error(`[HOOK] ❌ Executable NOT FOUND: ${exePath}`);
    dialog.showErrorBox('Ошибка', `Не найден файл хука: ${exeName}. Проверьте наличие в корне проекта или resources.`);
    return;
  }

  logger.info(`[HOOK] ✓ Executable exists. Spawning process...`);
  logger.debug(`[HOOK] Spawn options: { stdio: 'pipe', windowsHide: true, detached: false }`);

  try {
    hookProcess = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env }
    });

    logger.info(`[HOOK] ✓ Process spawned successfully with PID: ${hookProcess.pid}`);

    hookProcess.stdout.on('data', (data) => {
      const raw = data.toString();
      logger.debug(`[HOOK_RAW] ← STDOUT chunk (${raw.length} bytes): "${raw.trim()}"`);
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
        } catch (e) {
          const [typeStr, codeStr] = trimmed.split(':');
          code = parseInt(codeStr, 10);
          isDown = typeStr.toLowerCase() === 'down';
        }

        if (isNaN(code)) {
          logger.warn(`[HOOK] Invalid payload format: "${trimmed}"`);
          continue;
        }

        logger.info(`[HOOK_EVENT] Key ${code} (${getKeyName(code)}) ${isDown ? 'DOWN' : 'UP'}`);
        pressedKeys.set(code, isDown);

        if (captureMode && isDown) {
          capturedCodes.add(code);
          logger.debug(`[CAPTURE] Added code ${code}, current set: [${Array.from(capturedCodes).join(', ')}]`);
          mainWindow?.webContents?.send('key-captured', code);
        }

        if (currentPTTHotkeyCodes && currentPTTHotkeyCodes.length > 0) {
          const allPressed = currentPTTHotkeyCodes.every(c => pressedKeys.get(c) === true);
          const allReleased = currentPTTHotkeyCodes.every(c => pressedKeys.get(c) !== true);

          if (allPressed && !pttActive) {
            pttActive = true;
            logger.info('[PTT] >>> ACTIVATED <<<');
            mainWindow?.webContents?.send('ptt-pressed');
          } else if (allReleased && pttActive) {
            pttActive = false;
            logger.info('[PTT] >>> RELEASED <<<');
            mainWindow?.webContents?.send('ptt-released');
          }
        }
      }
    });

    hookProcess.stderr.on('data', (data) => {
      const err = data.toString().trim();
      if (err) logger.error(`[HOOK_STDERR] → ${err}`);
    });

    hookProcess.on('close', (code, signal) => {
      logger.info(`[HOOK] Process exited. Code: ${code}, Signal: ${signal || 'none'}`);
      hookProcess = null;
    });

    hookProcess.on('error', (err) => {
      logger.error(`[HOOK] ❌ Process error: ${err.message}`);
      logger.error(`[HOOK] Stack: ${err.stack}`);
      hookProcess = null;
    });

    logger.info('[HOOK] ✓ Listeners attached. Awaiting key events...');
  } catch (err) {
    logger.error(`[HOOK] ❌ Spawn failed: ${err.message}\n${err.stack}`);
    hookProcess = null;
  }
}

function stopRustHook() {
  logger.info('[HOOK] stopRustHook() called');
  if (hookProcess) {
    try {
      logger.info(`[HOOK] Sending termination signal to PID: ${hookProcess.pid}`);
      hookProcess.kill();
      logger.info('[HOOK] ✓ Kill signal sent successfully');
    } catch (err) {
      logger.error(`[HOOK] ❌ Kill failed: ${err.message}`);
    }
    hookProcess = null;
  } else {
    logger.info('[HOOK] No active process to stop.');
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

  const isExternalUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.origin !== 'https://ns.fiber-gate.ru';
    } catch {
      return false;
    }
  };

  webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  webContents.on('did-fail-load', (e, code, desc) => {
    logger.error(`[WEBVIEW] Failed: ${code} - ${desc}`);
  });

  webContents.on('ipc-message', (event, channel, ...args) => {
    if (channel === 'play-sound') {
      const soundType = args[0];
      const fileName = SOUND_MAP[soundType];
      if (!fileName) return;
      
      const soundPath = path.join(SOUNDS_DIR, fileName);
      let finalPath = soundPath;
      
      if (!fs.existsSync(soundPath)) {
        const resourcePath = app.isPackaged 
          ? path.join(process.resourcesPath, 'sounds', fileName)
          : path.join(__dirname, '..', 'sounds', fileName);
        
        if (fs.existsSync(resourcePath)) {
          finalPath = resourcePath;
        } else {
          return;
        }
      }
      
      try {
        if (process.platform === 'win32') {
          exec(`powershell -c (New-Object Media.SoundPlayer '${finalPath}').PlaySync()`, (err) => {
            if (err) logger.error(`[SOUND] Error: ${err.message}`);
          });
        } else if (process.platform === 'linux') {
          exec(`which paplay > /dev/null 2>&1 && paplay '${finalPath}' || which aplay > /dev/null 2>&1 && aplay '${finalPath}' || which play > /dev/null 2>&1 && play '${finalPath}'`, (err) => {
            if (err) logger.error(`[SOUND] Error: ${err.message}`);
          });
        } else if (process.platform === 'darwin') {
          exec(`afplay '${finalPath}'`, (err) => {
            if (err) logger.error(`[SOUND] Error: ${err.message}`);
          });
        }
      } catch (error) {
        logger.error(`[SOUND] Error: ${error.message}`);
      }
    }
  });

  webContents.on('did-finish-load', () => {
    const injectCode = `
      (function() {
        let ipcRenderer = null;
        try {
          if (typeof require !== 'undefined') {
            ipcRenderer = require('electron').ipcRenderer;
          }
        } catch (e) {}
        
        if (!ipcRenderer && window.ipcRenderer) {
          ipcRenderer = window.ipcRenderer;
        }
        
        window.ELECTRON_CUSTOM_SOUNDS_ENABLED = true;
        
        window.electronAPI = {
          playSound: (soundType) => {
            if (ipcRenderer) {
              try {
                ipcRenderer.sendToHost('play-sound', soundType);
                return Promise.resolve(true);
              } catch (e) {}
            }
            
            window.postMessage({
              type: 'ELECTRON_PLAY_SOUND',
              soundType: soundType,
              source: 'webview'
            }, '*');
            
            return Promise.resolve(true);
          }
        };
      })();
    `;
    
    webContents.executeJavaScript(injectCode).catch(() => {});
  });
}

function createWindow() {
  logger.info('[WINDOW] Creating BrowserWindow...');
  const nsSession = session.fromPartition('persist:ns');
  nsSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = [
      'media', 
      'microphone', 
      'camera', 
      'clipboard-read', 
      'clipboard-sanitized-write',
      'clipboard'
    ];
    
    const granted = allowedPermissions.includes(permission);
    logger.debug(`[PERM] Request: ${permission} → ${granted ? 'GRANTED' : 'DENIED'}`);
    callback(granted);
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

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // 👇 ОТКРЫВАЕМ DEVTOOLS ДЛЯ ОСНОВНОГО ОКНА
  //mainWindow.webContents.openDevTools({ mode: 'detach' });
  
  mainWindow.on('closed', () => {
    logger.info('[WINDOW] Closed');
    mainWindow = null;
  });

  // 👇 Обработчик прикрепления webview
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    logger.info('[WEBVIEW] Attached (did-attach-webview)');
    setupWebviewHandlers(webContents);
  });

  // 👇 Обработчик создания webview (для случаев перезагрузки)
  mainWindow.webContents.on('did-create-webview', (event, webContents) => {
    logger.info('[WEBVIEW] Created (did-create-webview)');
    setupWebviewHandlers(webContents);
  });

  mainWindow.webContents.on('did-finish-load', () =>
    logger.info('[WINDOW] Finished load')
  );
}

app.whenReady().then(async () => {
  logger.info('[APP] Ready');
  Menu.setApplicationMenu(null);
  fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));

  const gamePathValid = await ensureGamePath();
  if (!gamePathValid) {
    logger.error('[APP] Invalid game path, quitting');
    app.quit();
    return;
  }

  addonManager.setGamePath(settings.getGamePath());
  createWindow();
  startRustHook();

  const savedHotkey = settings.getPTTHotkey();
  if (savedHotkey && Array.isArray(savedHotkey)) {
    currentPTTHotkeyCodes = savedHotkey;
    logger.info(`[PTT] Loaded saved hotkey: ${savedHotkey.join('+')}`);
  }

  try {
    await addonManager.loadAddons();
    logger.info('[APP] Addons loaded successfully');
  } catch (err) {
    logger.error('[APP] Failed to load addons:', err.message);
  }

  try {
    await addonManager.startupUpdateCheck(mainWindow);
  } catch (err) {
    logger.error('[STARTUP] Update check error:', err.message);
  }
  addonManager.startBackgroundChecker(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  logger.info('[APP] All windows closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  logger.info('[APP] Will quit, cleaning up resources');
  stopRustHook();
  globalShortcut.unregisterAll();
});

// === IPC Handlers ===
ipcMain.handle('load-addons', async () => {
  logger.debug('[IPC] load-addons');
  try {
    const result = await addonManager.loadAddons();
    logger.debug(`[IPC] load-addons → ${Object.keys(result).length} addons`);
    return result;
  } catch (error) {
    logger.error('[IPC] load-addons error:', error.message);
    return {};
  }
});

ipcMain.handle('toggle-addon', async (event, name, install) => {
  logger.info(`[IPC] toggle-addon: ${name} → ${install ? 'INSTALL' : 'UNINSTALL'}`);
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    await addonManager.toggleAddon(name, install, mainWindow);
    logger.info(`[IPC] toggle-addon ${name} → SUCCESS`);
    return true;
  } catch (error) {
    logger.error(`[IPC] toggle-addon ${name} error:`, error.message);
    dialog.showErrorBox('Ошибка установки', error.message);
    return false;
  }
});

ipcMain.handle('launch-game', async () => {
  logger.info('[IPC] launch-game');
  try {
    const result = await addonManager.launchGame();
    logger.info(`[IPC] launch-game → ${result ? 'OK' : 'FAIL'}`);
    return result;
  } catch (error) {
    logger.error('[IPC] launch-game error:', error.message);
    return false;
  }
});

ipcMain.handle('check-game', async () => {
  try {
    const gamePath = settings.getGamePath();
    if (!gamePath) return false;
    const exists = fs.existsSync(path.join(gamePath, 'Wow.exe'));
    logger.debug(`[IPC] check-game → ${exists}`);
    return exists;
  } catch (error) {
    logger.error('[IPC] check-game error:', error.message);
    return false;
  }
});

ipcMain.handle('change-game-path', async () => {
  logger.info('[IPC] change-game-path');
  const result = await dialog.showOpenDialog({
    title: 'Выберите файл Wow.exe', properties: ['openFile'],
    filters: [{ name: 'Executable files', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    logger.warn('[IPC] change-game-path canceled');
    return false;
  }
  const selectedPath = path.dirname(result.filePaths[0]);
  if (!fs.existsSync(path.join(selectedPath, 'Wow.exe'))) {
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  addonManager.setGamePath(selectedPath);
  logger.info(`[IPC] change-game-path → ${selectedPath}`);
  return true;
});

ipcMain.on('open-logs-folder', () => {
  logger.info('[IPC] open-logs-folder');
  shell.openPath(path.join(app.getPath('userData'), 'logs'));
});

ipcMain.on('go-back', () => {
  logger.debug('[IPC] go-back');
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.loadURL(`file://${__dirname}/../renderer/index.html`);
});

ipcMain.handle('start-key-capture', async () => {
  logger.info('[IPC] start-key-capture');
  captureMode = true;
  capturedCodes.clear();
  pressedKeys.clear();
  return { success: true };
});

ipcMain.handle('stop-key-capture', async () => {
  logger.info(`[IPC] stop-key-capture → ${Array.from(capturedCodes).join('+')}`);
  captureMode = false;
  const codes = Array.from(capturedCodes);
  capturedCodes.clear();
  return { success: true, codes };
});

ipcMain.handle('set-ptt-hotkey', async (event, codes) => {
  logger.info(`[IPC] set-ptt-hotkey: ${codes?.join('+') || 'none'}`);
  if (!Array.isArray(codes)) return { success: false, message: 'Invalid hotkey format' };
  currentPTTHotkeyCodes = codes;
  settings.setPTTHotkey(codes);
  pttActive = false;
  return { success: true };
});

ipcMain.handle('get-ptt-hotkey', async () => {
  logger.debug(`[IPC] get-ptt-hotkey → ${currentPTTHotkeyCodes?.join('+') || 'none'}`);
  return currentPTTHotkeyCodes;
});

ipcMain.handle('get-platform', async () => {
  logger.debug(`[IPC] get-platform → ${process.platform}`);
  return process.platform;
});

ipcMain.handle('register-ptt-hotkey', async () => {
  logger.warn('[IPC] register-ptt-hotkey deprecated, use set-ptt-hotkey');
  return { success: true, message: 'Use set-ptt-hotkey with array of codes instead' };
});

ipcMain.on('webclient-mic-state', (event, state) => {
  logger.debug(`[IPC] webclient-mic-state: ${JSON.stringify(state)}`);
});

ipcMain.handle('clear-session-cache', async (event, partition) => {
  logger.info(`[IPC] clear-session-cache: ${partition}`);
  const sess = session.fromPartition(partition);
  await sess.clearCache();
  await sess.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'filesystem', 'indexeddb', 'localstorage'] });
  logger.info('[IPC] clear-session-cache → DONE');
  return true;
});

ipcMain.handle('execute-in-webview', async (event, { code }) => {
  logger.debug(`[IPC] execute-in-webview: ${code.substring(0, 50)}...`);
  if (!webviewWebContents || webviewWebContents.isDestroyed()) {
    logger.error('[IPC] execute-in-webview: WebView not available');
    throw new Error('WebView webContents not available');
  }
  try {
    const result = await webviewWebContents.executeJavaScript(code);
    logger.debug('[IPC] execute-in-webview → OK');
    return result;
  } catch (error) {
    logger.error('[IPC] execute-in-webview error:', error.message);
    throw error;
  }
});

ipcMain.handle('open-external', async (event, url) => {
  if (!url || typeof url !== 'string') return false;
  logger.info(`[IPC] open-external: ${url}`);
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    logger.error(`[IPC] open-external failed: ${err.message}`);
    return false;
  }
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
  logger.debug(`[IPC] copy-to-clipboard: ${text?.substring(0, 50)}...`);
  if (typeof text !== 'string') return false;
  
  try {
    clipboard.writeText(text);
    logger.info('[IPC] copy-to-clipboard → SUCCESS');
    return true;
  } catch (error) {
    logger.error('[IPC] copy-to-clipboard error:', error.message);
    return false;
  }
});

// 🎵 IPC Handler для воспроизведения звука
ipcMain.handle('play-sound', async (event, soundType) => {
  logger.info(`🔊🔊🔊 [IPC] play-sound CALLED with: ${soundType}`);
  logger.debug(`[IPC] play-sound: ${soundType}`);
  
  const fileName = SOUND_MAP[soundType];
  if (!fileName) {
    logger.warn(`[SOUND] Unknown sound type: ${soundType}`);
    return false;
  }
  
  const soundPath = path.join(SOUNDS_DIR, fileName);
  
  let finalPath = soundPath;
  if (!fs.existsSync(soundPath)) {
    const resourcePath = app.isPackaged 
      ? path.join(process.resourcesPath, 'sounds', fileName)
      : path.join(__dirname, '..', 'sounds', fileName);
    
    if (fs.existsSync(resourcePath)) {
      finalPath = resourcePath;
      logger.debug(`[SOUND] Using built-in sound: ${resourcePath}`);
    } else {
      logger.debug(`[SOUND] No sound file for: ${soundType} (${fileName})`);
      return false;
    }
  }
  
  try {
    if (process.platform === 'win32') {
      exec(`powershell -c (New-Object Media.SoundPlayer '${finalPath}').PlaySync()`, (err) => {
        if (err) logger.error(`[SOUND] Windows playback error:`, err.message);
        else logger.info(`[SOUND] ✓ Windows playback completed: ${soundType}`);
      });
    } else if (process.platform === 'linux') {
      exec(`which paplay > /dev/null 2>&1 && paplay '${finalPath}' || which aplay > /dev/null 2>&1 && aplay '${finalPath}' || which play > /dev/null 2>&1 && play '${finalPath}'`, (err) => {
        if (err) logger.error(`[SOUND] Linux playback error:`, err.message);
        else logger.info(`[SOUND] ✓ Linux playback completed: ${soundType}`);
      });
    } else if (process.platform === 'darwin') {
      exec(`afplay '${finalPath}'`, (err) => {
        if (err) logger.error(`[SOUND] macOS playback error:`, err.message);
        else logger.info(`[SOUND] ✓ macOS playback completed: ${soundType}`);
      });
    }
    
    logger.info(`[SOUND] Playing: ${soundType} → ${path.basename(finalPath)}`);
    return true;
  } catch (error) {
    logger.error(`[SOUND] Error playing ${soundType}:`, error.message);
    return false;
  }
});

// 🎵 IPC Handler для выбора папки со звуками
ipcMain.handle('select-sounds-folder', async () => {
  logger.info('[IPC] select-sounds-folder');
  const result = await dialog.showOpenDialog({
    title: 'Выберите папку со звуками',
    properties: ['openDirectory']
  });
  
  if (result.canceled || !result.filePaths.length) {
    logger.info('[IPC] select-sounds-folder → canceled');
    return null;
  }
  
  logger.info(`[IPC] select-sounds-folder → ${result.filePaths[0]}`);
  return result.filePaths[0];
});

// 🎵 IPC Handler для импорта звуков из папки
ipcMain.handle('import-sounds', async (event, sourceFolder) => {
  logger.info(`[IPC] import-sounds from: ${sourceFolder}`);
  
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
      try {
        await fs.copy(sourcePath, destPath, { overwrite: true });
        imported.push(soundType);
        logger.debug(`[SOUND] Imported: ${fileName} for ${soundType}`);
      } catch (err) {
        missing.push({ soundType, error: err.message });
        logger.error(`[SOUND] Failed to import ${fileName}:`, err.message);
      }
    } else {
      missing.push({ soundType, error: 'Файл не найден' });
      logger.debug(`[SOUND] Missing file: ${fileName}`);
    }
  }
  
  logger.info(`[IPC] import-sounds → imported: ${imported.length}, missing: ${missing.length}`);
  return { success: true, imported, missing };
});

// 🎵 IPC Handler для получения списка доступных звуков и их статуса
ipcMain.handle('get-sounds-status', async () => {
  const status = {};
  
  for (const [soundType, fileName] of Object.entries(SOUND_MAP)) {
    const soundPath = path.join(SOUNDS_DIR, fileName);
    status[soundType] = {
      fileName,
      exists: fs.existsSync(soundPath),
      path: soundPath
    };
  }
  
  return status;
});

// 🎵 IPC Handler для открытия папки со звуками
ipcMain.on('open-sounds-folder', () => {
  logger.info('[IPC] open-sounds-folder');
  shell.openPath(SOUNDS_DIR);
});