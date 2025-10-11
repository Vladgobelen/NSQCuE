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
let activeKeys = new Set(); // Set<number> — клавиши как есть, мышь как 1000 + button_code
let pttHotkeySet = new Set(); // Set<number>
let pttActive = false;

function loadPTTHotkeyFromSettings() {
  const raw = settings.settings.pttHotkeyCodes;
  logger.info(`🔍 Загружаем PTT хоткей из settings.json:`, JSON.stringify(raw));
  if (Array.isArray(raw)) {
    pttHotkeySet = new Set(raw);
    logger.info(`✅ PTT хоткей установлен: [${raw.join(', ')}]`);
  } else {
    pttHotkeySet = new Set();
    logger.warn('⚠️ PTT хоткей отсутствует или повреждён в settings.json');
  }
}

async function startGlobalHooks() {
  if (!globalMouseHook) {
    logger.error('❌ globalMouseHook not available — PTT will not work');
    return;
  }
  activeKeys.clear();
  loadPTTHotkeyFromSettings();

  try {
    // === КЛАВИАТУРА ===
    logger.info('🔌 Starting global keyboard hook...');
    await globalMouseHook.startGlobalKeyboardHook((err, event) => {
      if (err) {
        logger.error('❌ Keyboard hook error:', err);
        return;
      }
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const code = event.code;
      const type = event.event_type;
      logger.debug(`⌨️ Raw keyboard event: code=${code}, type=${type}`);
      if (type === 'down') {
        activeKeys.add(code);
      } else if (type === 'up') {
        activeKeys.delete(code);
      }
      checkPTTState(type);
    });

    // === МЫШЬ ===
    logger.info('🔌 Starting global mouse hook...');
    await globalMouseHook.startGlobalMouseHook((err, event) => {
      if (err) {
        logger.error('❌ Mouse hook error:', err);
        return;
      }
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // Игнорируем колёсико (модуль уже фильтрует 4/5, но на всякий)
      if (event.button_code < 1 || event.button_code > 5) return;
      const unifiedCode = 1000 + event.button_code; // 1001 = левая, 1002 = правая и т.д.
      const type = event.event_type;
      logger.debug(`🖱️ Raw mouse event: button=${event.button_code} → code=${unifiedCode}, type=${type}`);
      if (type === 'down') {
        activeKeys.add(unifiedCode);
      } else if (type === 'up') {
        activeKeys.delete(unifiedCode);
      }
      checkPTTState(type);
    });

    logger.info('✅ Global hooks (keyboard + mouse) started successfully');
  } catch (e) {
    logger.error('💥 Failed to start global hooks:', e);
  }
}

function checkPTTState(eventType) {
  const activeArray = [...activeKeys].sort((a, b) => a - b);
  const hotkeyArray = [...pttHotkeySet].sort((a, b) => a - b);
  const isMatch = (
    activeKeys.size === pttHotkeySet.size &&
    hotkeyArray.every((k, i) => activeArray[i] === k)
  );
  logger.debug(`📊 Active keys: [${activeArray.join(', ')}]`);
  logger.debug(`🎯 PTT hotkey: [${hotkeyArray.join(', ')}]`);
  logger.debug(`matchCondition: ${isMatch}, pttActive: ${pttActive}`);

  if (isMatch && eventType === 'down' && !pttActive) {
    pttActive = true;
    logger.info('🎙️ PTT ACTIVATED (keydown/mousedown)');
    mainWindow.webContents.send('ptt-pressed', true);
  } else if (eventType === 'up' && pttActive) {
    const stillPressed = [...pttHotkeySet].some(k => activeKeys.has(k));
    if (!stillPressed) {
      pttActive = false;
      logger.info('🔇 PTT DEACTIVATED (keyup/mouseup)');
      mainWindow.webContents.send('ptt-pressed', false);
    } else {
      logger.debug('⏸️ PTT still active — some keys/buttons still pressed');
    }
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
          "img-src 'self' https://ns.fiber-gate.ru data:; " +
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
  // Запускаем глобальные хуки
// Запускаем глобальные хуки ТОЛЬКО на Windows
if (globalMouseHook && os.platform() === 'win32') {
  startGlobalHooks();
} else if (globalMouseHook && os.platform() === 'linux') {
  logger.warn('⚠️ Global PTT отключён на Linux (X11 grab блокирует систему)');
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

// === MINI TEST FOR GLOBAL-MOUSE-HOOK (в development) ===
if (globalMouseHook && process.env.NODE_ENV === 'development') {
  setTimeout(async () => {
    logger.info('🧪 ЗАПУСК ТЕСТА РАБОТОСПОСОБНОСТИ global-mouse-hook');
    try {
      await globalMouseHook.startGlobalKeyboardHook((err, event) => {
        if (err) {
          logger.error('🧪 ТЕСТ: ОШИБКА клавиатуры:', err);
          return;
        }
        logger.info(`⌨️ [TEST] KEY: code=${event.code}, type=${event.event_type}`);
      });
      await globalMouseHook.startGlobalMouseHook((err, event) => {
        if (err) {
          logger.error('🧪 ТЕСТ: ОШИБКА мыши:', err);
          return;
        }
        if (event.button_code >= 1 && event.button_code <= 5) {
          logger.info(`🖱️ [TEST] MOUSE: button=${event.button_code}, type=${event.event_type}`);
        }
      });
      logger.info('🧪 ТЕСТ: ХУКИ ЗАПУЩЕНЫ. Нажмите клавиши или кнопки мыши (10 сек).');
      setTimeout(() => {
        logger.info('🧪 ТЕСТ: ЗАВЕРШЁН.');
      }, 10000);
    } catch (e) {
      logger.error('🧪 ТЕСТ: НЕ УДАЛОСЬ ЗАПУСТИТЬ ХУКИ:', e);
    }
  }, 3000);
}

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
    logger.info(`💾 PTT hotkey saved via IPC: [${codes.join(', ')}]`);
    return { success: true };
  } catch (error) {
    logger.error('Error setting PTT hotkey:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-ptt-hotkey', async () => {
  const codes = settings.getPTTHotkeyCodes();
  logger.debug(`📤 Sending PTT hotkey to renderer: [${codes ? codes.join(', ') : 'null'}]`);
  return codes;
});