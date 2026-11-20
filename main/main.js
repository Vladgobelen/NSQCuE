const { app, globalShortcut, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./utils').setupLogging();

// Подключаем наши модули
const { startSidecarAndProxy, stopSidecar } = require('./sidecar');
const {
  createWindow,
  getMainWindow,
  createOverlayWindow,
  getOverlayWindow,
  stopOverlay,
} = require('./window');
const {
  createTray,
  updateTrayMenu,
  destroyTray,
  closeNotificationWindow,
} = require('./tray');
const { initAddons, stopAddons } = require('./addons');
const { registerIpcHandlers } = require('./ipcHandlers');
const settings = require('./settings');
const soundsManager = require('./soundsManager');

app.isQuitting = false;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    let win = getMainWindow();
    if (!win || win.isDestroyed()) {
      createWindow();
      win = getMainWindow();
    }
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // Отключаем проверку сертификатов для нашего IP.
  // appendSwitch покрывает main-процесс, но НЕ покрывает
  // cert_verify_proc_builtin в webview/рендерере — для них
  // нужен ещё app.on('certificate-error') (см. ниже).
  app.commandLine.appendSwitch('ignore-certificate-errors');

  // Разрешаем самоподписанный сертификат для локального IP.
  // Без этого webview грузит interstitial "Your connection is not private",
  // voiceClient не инициализируется, звуки не играют.
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (url.startsWith('https://100.126.188.12') || url.startsWith('wss://100.126.188.12')) {
      console.log('[CERT] Allowing self-signed for', url);
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  app.whenReady().then(async () => {
    // Убираем стандартное меню (Файл, Правка и т.д.) на Linux
    Menu.setApplicationMenu(null);
    console.log('[APP] app.whenReady() started');
    fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));

    console.log('[APP] Creating tray...');
    createTray();

    globalShortcut.register('CommandOrControl+Shift+O', () => {
      console.log('[HOTKEY] Ctrl+Shift+O pressed');
      const overlayWindow = getOverlayWindow();
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (overlayWindow.isVisible()) {
          overlayWindow.hide();
        } else {
          overlayWindow.show();
          overlayWindow.focus();
          overlayWindow.webContents.send('focus-input');
        }
      } else {
        createOverlayWindow();
        const win = getOverlayWindow();
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
          win.webContents.send('focus-input');
        }
      }
    });

    if (!settings.getGamePath()) {
      console.warn('[APP] Game path not set, but continuing anyway');
    } else {
      console.log('[APP] Game path is set:', settings.getGamePath());
    }

    // Регистрируем IPC и создаем окно ДО запуска сайдкара
    console.log('[APP] Registering IPC handlers...');
    registerIpcHandlers();

    console.log('[APP] Creating main window...');
    createWindow();
    const mainWindow = getMainWindow();

    // DevTools отключён. Для отладки раскомментируйте:
    // if (mainWindow && !mainWindow.isDestroyed()) {
    //   mainWindow.webContents.openDevTools({ mode: 'detach' });
    // }

    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[APP] Initializing addons...');
      initAddons(mainWindow);
    }

    // Автозагрузка базовых звуков
    console.log('[APP] Auto-downloading base sounds...');
    soundsManager.autoDownloadBaseSounds().catch((err) => {
      logger.error(`[SOUNDS] Auto-download failed: ${err.message}`);
    });

    console.log('[APP] Initialization complete');

    // Запускаем сайдкар в фоне
    console.log('[APP] Starting sidecar in background...');
    startSidecarAndProxy()
      .then(() => {
        console.log('[APP] Sidecar startup sequence initiated successfully.');
      })
      .catch((err) => {
        console.error('[APP] Failed to start sidecar:', err.message);
      });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // ───────────────────────────────────────────────────────────
  //  Lifecycle
  // ───────────────────────────────────────────────────────────
  app.on('before-quit', () => {
    app.isQuitting = true;
  });

  app.on('window-all-closed', (event) => {
    // Не мешаем выходу, если он запрошен явно (крестик → "Закрыть", трей → "Выход").
    if (process.platform !== 'darwin' && !app.isQuitting) {
      event.preventDefault();
    }
  });

  app.on('will-quit', () => {
    console.log('[APP] Quitting...');
    app.isQuitting = true;
    stopSidecar();
    stopOverlay();
    stopAddons();
    closeNotificationWindow();
    destroyTray();
    globalShortcut.unregisterAll();
  });
}