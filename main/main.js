const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const addonManager = require('./addonManager');
const settings = require('./settings');
const { setupLogging } = require('./utils');
const logger = setupLogging();

let mainWindow;
let webviewWebContents = null;
let mouseHook = null;
let stopHookFn = null;
const pressedKeys = new Map();
let currentPTTHotkeyCodes = null;
let captureMode = false;
const capturedCodes = new Set();
let pttActive = false;

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
  
  const addonPath = app.isPackaged
    ? path.join(process.resourcesPath, 'global-mouse-hook.win32-x64-msvc.node')
    : path.join(__dirname, '../global-mouse-hook.win32-x64-msvc.node');

  logger.debug(`[HOOK] Looking for addon at: ${addonPath}`);
  
  if (!fs.existsSync(addonPath)) {
    logger.error(`[HOOK] ❌ Addon file NOT FOUND: ${addonPath}`);
    logger.error(`[HOOK] app.isPackaged=${app.isPackaged}`);
    logger.error(`[HOOK] process.resourcesPath=${process.resourcesPath}`);
    logger.error(`[HOOK] __dirname=${__dirname}`);
    return;
  }
  logger.info(`[HOOK] ✓ Addon file exists`);

  try {
    logger.debug('[HOOK] Attempting require()...');
    mouseHook = require(addonPath);
    logger.info(`[HOOK] ✓ Module loaded via require()`);
    logger.debug(`[HOOK] Exports: ${JSON.stringify(Object.keys(mouseHook))}`);

    // Поиск функции старта (поддержка snake_case и camelCase)
    const startFn = mouseHook.startGlobalKeyboardHook 
      || mouseHook.start_global_keyboard_hook 
      || mouseHook.start;
    
    stopHookFn = mouseHook.stopGlobalKeyboardHook 
      || mouseHook.stop_global_keyboard_hook 
      || mouseHook.stop;

    if (typeof startFn !== 'function') {
      logger.error(`[HOOK] ❌ Start function not found. Available: ${Object.keys(mouseHook).join(', ')}`);
      return;
    }
    logger.debug(`[HOOK] Found start function`);

    // Регистрация коллбэка для событий от Rust
    const onKeyEvent = (msg) => {
      try {
        logger.debug(`[HOOK_RAW] ← Received from Rust: "${msg}" (type: ${typeof msg})`);
        
        if (!msg || typeof msg !== 'string') {
          logger.warn(`[HOOK] Invalid payload type: ${typeof msg}`);
          return;
        }

        const [type, codeStr] = msg.split(':');
        const code = parseInt(codeStr, 10);
        
        if (isNaN(code)) {
          logger.warn(`[HOOK] Invalid code in payload: "${msg}"`);
          return;
        }

        const isDown = type === 'down';
        logger.info(`[HOOK_EVENT] Key ${code} (${getKeyName(code)}) ${isDown ? 'DOWN' : 'UP'}`);
        
        pressedKeys.set(code, isDown);

        // Режим захвата хоткея
        if (captureMode && isDown) {
          capturedCodes.add(code);
          logger.debug(`[CAPTURE] Added code ${code}, set: ${Array.from(capturedCodes).join('+')}`);
          mainWindow?.webContents?.send('key-captured', code);
        }

        // Логика PTT
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
      } catch (err) {
        logger.error(`[HOOK_CALLBACK] Error: ${err.message}\n${err.stack}`);
      }
    };

    logger.debug('[HOOK] Calling start function with callback...');
    startFn(onKeyEvent);
    logger.info('[HOOK] ✓ Callback registered, waiting for events...');
    
  } catch (err) {
    logger.error(`[HOOK] ❌ Failed to load module: ${err.message}`);
    logger.error(`[HOOK] Stack: ${err.stack}`);
  }
}

function stopRustHook() {
  logger.info('[HOOK] stopRustHook() called');
  if (typeof stopHookFn === 'function') {
    try { 
      stopHookFn(); 
      logger.info('[HOOK] ✓ stop() invoked');
    } catch (err) { 
      logger.error(`[HOOK] stop() failed: ${err.message}`); 
    }
    stopHookFn = null;
  }
  mouseHook = null;
}

function getKeyName(code) {
  const names = {
    16: 'Shift', 17: 'Ctrl', 18: 'Alt', 32: 'Space', 27: 'Esc', 13: 'Enter',
    9: 'Tab', 8: 'Backspace', 46: 'Del', 37: '←', 38: '↑', 39: '→', 40: '↓',
    112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8',
    120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12'
  };
  return names[code] || `K${code}`;
}

function createWindow() {
  logger.info('[WINDOW] Creating BrowserWindow...');
  
  const nsSession = session.fromPartition('persist:ns');
  nsSession.setPermissionRequestHandler((webContents, permission, callback) => {
    logger.debug(`[PERM] Request: ${permission} → ${['media','microphone','camera'].includes(permission) ? 'GRANTED' : 'DENIED'}`);
    if (['media', 'microphone', 'camera'].includes(permission)) {
      callback(true); return;
    }
    callback(false);
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
  mainWindow.on('closed', () => { 
    logger.info('[WINDOW] Closed');
    mainWindow = null; 
  });
  
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    logger.info('[WEBVIEW] Attached');
    webviewWebContents = webContents;
    webContents.on('did-fail-load', (e, code, desc) => 
      logger.error(`[WEBVIEW] Failed: ${code} - ${desc}`)
    );
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
    app.quit(); return; 
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
  logger.info('[APP] Will quit, cleaning up hook');
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
  }
  catch (error) { 
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
  }
  catch (error) { 
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
  }
  catch (error) { 
    logger.error('[IPC] execute-in-webview error:', error.message); 
    throw error; 
  }
});