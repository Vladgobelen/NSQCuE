// main.js
const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const addonManager = require('./addonManager');
const settings = require('./settings');
const { setupLogging } = require('./utils');
const logger = setupLogging();

let mainWindow;
let checkingUpdate = false;

// === Загрузка native модуля global-mouse-hook ===
let globalMouseHook = null;
try {
  const moduleName = os.platform() === 'win32'
    ? 'global-mouse-hook.win32-x64-msvc.node'
    : 'global-mouse-hook.linux-x64-gnu.node';
  const modulePath = path.join(__dirname, '..', moduleName);
  if (fs.existsSync(modulePath)) {
    globalMouseHook = require(modulePath);
    logger.info(`✅ Loaded native module: ${moduleName}`);
  } else {
    logger.error(`❌ Native module not found: ${modulePath}`);
  }
} catch (e) {
  logger.error('❌ Failed to load global-mouse-hook native module:', e);
}

// === Состояние PTT ===
let keyStates = new Map(); // Map<number, boolean>
let pttHotkeySet = new Set(); // Set<number>
let pttActive = false;

// === Режим захвата для настройки PTT ===
let captureMode = false;
let capturedCodesTemp = new Set();

function loadPTTHotkeyFromSettings() {
  const raw = settings.settings.pttHotkeyCodes;
  if (Array.isArray(raw)) {
    pttHotkeySet = new Set(raw);
    logger.info(`🎯 PTT hotkey loaded: [${raw.join(', ')}]`);
  } else {
    pttHotkeySet = new Set();
    logger.warn('⚠️ PTT hotkey missing or invalid in settings.json');
  }
}

function isPTTHotkeyPressed() {
  if (pttHotkeySet.size === 0) return false;
  for (const code of pttHotkeySet) {
    if (!keyStates.get(code)) return false;
  }
  return true;
}

async function startGlobalHooks() {
  if (!globalMouseHook) {
    logger.error('❌ globalMouseHook not available — PTT will not work');
    return;
  }
  keyStates.clear();
  loadPTTHotkeyFromSettings();
  try {
    // === КЛАВИАТУРА ===
    await globalMouseHook.startGlobalKeyboardHook((err, event) => {
      if (err || !Array.isArray(event) || event.length < 2) return;
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
      const [code, type] = event;

      // === Режим захвата ===
      if (captureMode) {
        if (type === 3) { // key down
          capturedCodesTemp.add(code);
          mainWindow.webContents.send('ptt-capture-update', Array.from(capturedCodesTemp));
          logger.debug(`[PTT CAPTURE] Keyboard code captured: ${code}`);
        }
        return;
      }

      const prevState = keyStates.get(code) || false;
      let changed = false;
      if (type === 3 && !prevState) {
        keyStates.set(code, true);
        changed = true;
      } else if (type === 4 && prevState) { // key up
        keyStates.set(code, false);
        changed = true;
      }
      if (changed) {
        const now = isPTTHotkeyPressed();
        if (pttActive !== now) {
          pttActive = now;
          mainWindow.webContents.send('ptt-pressed', now);
          logger.info(now ? '🎙️ PTT ON' : '🔇 PTT OFF');
        }
      }
    });

    // === МЫШЬ ===
    await globalMouseHook.startGlobalMouseHook((err, event) => {
      if (err || !Array.isArray(event) || event.length < 2) return;
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
      const [button, type] = event;
      if (button < 1 || button > 5) return;

      // 🔥 ИСПРАВЛЕНИЕ: используем отрицательные коды для мыши → -1, -2, ..., -5
      const code = -button;

      // === Режим захвата ===
      if (captureMode) {
        if (type === 1) { // mouse down
          capturedCodesTemp.add(code);
          mainWindow.webContents.send('ptt-capture-update', Array.from(capturedCodesTemp));
          logger.debug(`[PTT CAPTURE] Mouse button captured: ${button} → code ${code}`);
        }
        return;
      }

      const prevState = keyStates.get(code) || false;
      let changed = false;
      if (type === 1 && !prevState) {
        keyStates.set(code, true);
        changed = true;
      } else if (type === 2 && prevState) { // mouse up
        keyStates.set(code, false);
        changed = true;
      }
      if (changed) {
        const now = isPTTHotkeyPressed();
        if (pttActive !== now) {
          pttActive = now;
          mainWindow.webContents.send('ptt-pressed', now);
          logger.info(now ? '🎙️ PTT ON' : '🔇 PTT OFF');
        }
      }
    });
    logger.info('✅ Global hooks (keyboard + mouse) started successfully');
  } catch (e) {
    logger.error('💥 Failed to start global hooks:', e);
  }
}

// === Game path ===
async function ensureGamePath() {
  if (settings.isGamePathValid()) {
    logger.info(`Using saved game path: ${settings.getGamePath()}`);
    return true;
  }
  logger.warn('Game path is not set or invalid');
  const result = await dialog.showOpenDialog({
    title: 'Выберите файл Wow.exe',
    properties: ['openFile'],
    filters: [
      { name: 'Executable files', extensions: ['exe'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    logger.error('Game path selection canceled by user');
    return false;
  }
  const selectedPath = path.dirname(result.filePaths[0]);
  const wowPath = path.join(selectedPath, 'Wow.exe');
  if (!fs.existsSync(wowPath)) {
    logger.error('Selected path does not contain Wow.exe');
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  logger.info(`Game path set to: ${selectedPath}`);
  return true;
}

// === Window ===
function createWindow() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' https://ns.fiber-gate.ru ; " +
          "connect-src 'self' http://194.31.171.29:38592 https://ns.fiber-gate.ru wss://ns.fiber-gate.ru; " +
          "media-src 'self' blob:; " +
          "child-src 'self' blob:; " +
          "worker-src 'self' blob:; " +
          "font-src 'self' ;"
        ]
      }
    });
  });
  mainWindow = new BrowserWindow({
    width: 550,
    height: 650,
    minWidth: 450,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });
  logger.info('Main window created');
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  setInterval(() => {
    if (!checkingUpdate) {
      addonManager.checkNSQCUpdate(mainWindow)
        .catch(err => logger.error('Error checking updates:', err));
    }
  }, 30000);
  mainWindow.on('closed', () => {
    logger.info('Main window closed');
    mainWindow = null;
  });
}

// === App lifecycle ===
app.whenReady().then(async () => {
  fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));
  const gamePathValid = await ensureGamePath();
  if (!gamePathValid) {
    app.quit();
    return;
  }
  addonManager.setGamePath(settings.getGamePath());
  createWindow();
  if (globalMouseHook) {
    startGlobalHooks();
  } else {
    logger.warn('⚠️ Global PTT disabled — native module not loaded');
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// === IPC Handlers ===
ipcMain.handle('load-addons', async () => {
  try {
    return await addonManager.loadAddons();
  } catch (error) {
    logger.error('Error loading addons:', error);
    return {};
  }
});

ipcMain.handle('toggle-addon', async (event, name, install) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    await addonManager.toggleAddon(name, install, mainWindow);
    return true;
  } catch (error) {
    logger.error(`Error toggling addon ${name}:`, error);
    dialog.showErrorBox('Ошибка установки', error.message);
    return false;
  }
});

ipcMain.handle('launch-game', async () => {
  try {
    return await addonManager.launchGame();
  } catch (error) {
    logger.error('Error launching game:', error);
    return false;
  }
});

ipcMain.handle('check-game', async () => {
  try {
    const gamePath = settings.getGamePath();
    if (!gamePath) return false;
    const wowPath = path.join(gamePath, 'Wow.exe');
    return fs.existsSync(wowPath);
  } catch (error) {
    logger.error('Error checking game:', error);
    return false;
  }
});

ipcMain.handle('change-game-path', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выберите файл Wow.exe',
    properties: ['openFile'],
    filters: [
      { name: 'Executable files', extensions: ['exe'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return false;
  }
  const selectedPath = path.dirname(result.filePaths[0]);
  const wowPath = path.join(selectedPath, 'Wow.exe');
  if (!fs.existsSync(wowPath)) {
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  addonManager.setGamePath(selectedPath);
  return true;
});

ipcMain.on('open-logs-folder', () => {
  const logsPath = path.join(app.getPath('userData'), 'logs');
  shell.openPath(logsPath);
});

ipcMain.on('go-back', (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const indexPath = `file://${__dirname}/../renderer/index.html`;
    mainWindow.loadURL(indexPath);
  }
});

// === PTT IPC ===
ipcMain.handle('set-ptt-hotkey', async (event, codes) => {
  try {
    if (!Array.isArray(codes)) {
      throw new Error('Hotkey must be array of key codes (numbers)');
    }
    settings.setPTTHotkeyCodes(codes);
    pttHotkeySet = new Set(codes);
    keyStates.clear();
    logger.info(`💾 PTT hotkey saved via IPC: [${codes.join(', ')}]`);
    return { success: true };
  } catch (error) {
    logger.error('Error setting PTT hotkey:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-ptt-hotkey', async () => {
  const codes = settings.getPTTHotkeyCodes();
  return codes;
});

// === ИСПРАВЛЕННЫЕ ОБРАБОТЧИКИ ЗАХВАТА ===
ipcMain.handle('start-ptt-capture', async () => {
  captureMode = true;
  capturedCodesTemp.clear();
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('ptt-capture-update', []);
  }
  logger.info('🎙️ PTT capture mode: STARTED');
  return true;
});

ipcMain.handle('stop-ptt-capture', async () => {
  captureMode = false;
  const codes = Array.from(capturedCodesTemp);
  logger.info(`🎙️ PTT capture mode: STOPPED → [${codes.join(', ')}]`);
  return codes;
});

ipcMain.handle('clear-ptt-capture', async () => {
  capturedCodesTemp.clear();
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('ptt-capture-update', []);
  }
  logger.info('🧹 PTT capture cleared');
  return true;
});
