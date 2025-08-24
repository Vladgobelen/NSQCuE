const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const addonManager = require('./addonManager');
const { setupLogging } = require('./utils');

const logger = setupLogging();
logger.info('Application started');

let mainWindow;
let checkingUpdate = false;

function createWindow() {
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

app.whenReady().then(() => {
  fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));
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
    const wowPath = path.join(process.cwd(), 'Wow.exe');
    return fs.existsSync(wowPath);
  } catch (error) {
    logger.error('Error checking game:', error);
    return false;
  }
});

ipcMain.on('open-logs-folder', () => {
  const logsPath = path.join(app.getPath('userData'), 'logs');
  shell.openPath(logsPath);
});