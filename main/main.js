const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const addonManager = require('./addonManager');
const settings = require('./settings');
const { setupLogging } = require('./utils');
const logger = setupLogging();

let mainWindow;
let webviewWebContents = null;
let stopHookFn = null;
const pressedKeys = new Map();
let currentPTTHotkeyCodes = null;
let captureMode = false;
const capturedCodes = new Set();
let pttActive = false;

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
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  return true;
}

function startRustHook() {
  const addonPath = app.isPackaged
    ? path.join(process.resourcesPath, 'global-mouse-hook.win32-x64-msvc.node')
    : path.join(__dirname, '../global-mouse-hook.win32-x64-msvc.node');

  if (!fs.existsSync(addonPath)) {
    logger.error(`[HOOK] Addon not found: ${addonPath}`);
    return;
  }

  try {
    const hook = require(addonPath);
    logger.info('[HOOK] Loaded successfully');

    const startFn = hook.startGlobalKeyboardHook || hook.start_global_keyboard_hook;
    stopHookFn = hook.stopGlobalKeyboardHook || hook.stop_global_keyboard_hook;

    if (typeof startFn !== 'function') {
      logger.error('[HOOK] start function not found');
      return;
    }

    startFn((msg) => {
      if (!msg || typeof msg !== 'string') return;
      const [type, codeStr] = msg.split(':');
      const code = parseInt(codeStr, 10);
      if (isNaN(code)) return;

      const isDown = type === 'down';
      pressedKeys.set(code, isDown);

      if (captureMode && isDown) {
        capturedCodes.add(code);
        mainWindow?.webContents?.send('key-captured', code);
      }

      if (currentPTTHotkeyCodes && Array.isArray(currentPTTHotkeyCodes) && currentPTTHotkeyCodes.length > 0) {
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
    });
  } catch (err) {
    logger.error(`[HOOK] Failed to load: ${err.message}`);
  }
}

function stopRustHook() {
  if (typeof stopHookFn === 'function') {
    try { stopHookFn(); } catch {}
    stopHookFn = null;
  }
}

function createWindow() {
  const nsSession = session.fromPartition('persist:ns');
  nsSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'camera') {
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
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    webviewWebContents = webContents;
    webContents.on('did-fail-load', (e, code, desc) => logger.error(`[WebView] Failed to load: ${code} - ${desc}`));
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));
  
  const gamePathValid = await ensureGamePath();
  if (!gamePathValid) { app.quit(); return; }
  
  addonManager.setGamePath(settings.getGamePath());
  createWindow();
  startRustHook();
  
  const savedHotkey = settings.getPTTHotkey();
  if (savedHotkey && Array.isArray(savedHotkey)) currentPTTHotkeyCodes = savedHotkey;
  
  try {
    await addonManager.startupUpdateCheck(mainWindow);
  } catch (err) {
    logger.error('[STARTUP] Update check error:', err.message);
  }
  
  addonManager.startBackgroundChecker(mainWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { stopRustHook(); globalShortcut.unregisterAll(); });

ipcMain.handle('load-addons', async () => {
  try { return await addonManager.loadAddons(); }
  catch (error) { logger.error('[IPC] Error loading addons:', error.message); return {}; }
});

ipcMain.handle('toggle-addon', async (event, name, install) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    await addonManager.toggleAddon(name, install, mainWindow);
    return true;
  } catch (error) {
    logger.error(`[IPC] Error toggling addon ${name}:`, error.message);
    dialog.showErrorBox('Ошибка установки', error.message);
    return false;
  }
});

ipcMain.handle('launch-game', async () => {
  try { return await addonManager.launchGame(); }
  catch (error) { logger.error('[IPC] Error launching game:', error.message); return false; }
});

ipcMain.handle('check-game', async () => {
  try {
    const gamePath = settings.getGamePath();
    if (!gamePath) return false;
    return fs.existsSync(path.join(gamePath, 'Wow.exe'));
  } catch (error) { logger.error('[IPC] Error checking game:', error.message); return false; }
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

ipcMain.on('open-logs-folder', () => shell.openPath(path.join(app.getPath('userData'), 'logs')));
ipcMain.on('go-back', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`file://${__dirname}/../renderer/index.html`); });
ipcMain.handle('start-key-capture', async () => { captureMode = true; capturedCodes.clear(); pressedKeys.clear(); return { success: true }; });
ipcMain.handle('stop-key-capture', async () => { captureMode = false; const codes = Array.from(capturedCodes); capturedCodes.clear(); return { success: true, codes }; });

ipcMain.handle('set-ptt-hotkey', async (event, codes) => {
  if (!Array.isArray(codes)) return { success: false, message: 'Invalid hotkey format' };
  currentPTTHotkeyCodes = codes; settings.setPTTHotkey(codes); pttActive = false;
  return { success: true };
});

ipcMain.handle('get-ptt-hotkey', async () => currentPTTHotkeyCodes);
ipcMain.handle('get-platform', async () => process.platform);
ipcMain.handle('register-ptt-hotkey', async () => ({ success: true, message: 'Use set-ptt-hotkey with array of codes instead' }));
ipcMain.on('webclient-mic-state', () => {});

ipcMain.handle('clear-session-cache', async (event, partition) => {
  const sess = session.fromPartition(partition);
  await sess.clearCache();
  await sess.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'filesystem', 'indexeddb', 'localstorage'] });
  return true;
});

ipcMain.handle('execute-in-webview', async (event, { code }) => {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) throw new Error('WebView webContents not available');
  try { return await webviewWebContents.executeJavaScript(code); }
  catch (error) { logger.error('[IPC] execute-in-webview error:', error.message); throw error; }
});