const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const addonManager = require('./addonManager');
const settings = require('./settings');
const { setupLogging } = require('./utils');
const logger = setupLogging();
logger.info('Application started');
let mainWindow;
let checkingUpdate = false;

// Функция для проверки и установки пути к игре
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

function createWindow() {
  // Добавляем разрешение на загрузку внешних скриптов
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' http://194.31.171.29:38592; " +
          "script-src 'self' 'unsafe-inline' http://194.31.171.29:38592; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; " +
          "connect-src 'self' http://194.31.171.29:38592"
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
  // Проверка обновлений каждые 30 сек
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

app.whenReady().then(async () => {
  fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));
  
  // Проверяем и устанавливаем путь к игре
  const gamePathValid = await ensureGamePath();
  if (!gamePathValid) {
    // Если пользователь отменил выбор, закрываем приложение
    app.quit();
    return;
  }
  
  // Передаем путь к игре менеджеру аддонов
  addonManager.setGamePath(settings.getGamePath());
  
  createWindow();
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

// IPC обработчики
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
    if (!mainWindow) {
      logger.error('mainWindow is null in toggle-addon');
      return false;
    }
    if (mainWindow.isDestroyed()) {
      logger.error('mainWindow is destroyed in toggle-addon');
      return false;
    }
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