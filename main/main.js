const { app, globalShortcut, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./utils').setupLogging();

// Подключаем наши модули
const { startSidecarAndProxy, stopSidecar } = require('./sidecar');
const { createWindow, getMainWindow, createOverlayWindow, getOverlayWindow, stopOverlay } = require('./window');
const { createTray, updateTrayMenu } = require('./tray');
const { initAddons, stopAddons } = require('./addons');
const { registerIpcHandlers } = require('./ipcHandlers');
const settings = require('./settings');
const soundsManager = require('./soundsManager');

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Отключаем проверку сертификатов для нашего IP.
    // appendSwitch покрывает main-процесс, но НЕ покрывает
    // cert_verify_proc_builtin в webview/рендерере — для них
    // нужен ещё app.on('certificate-error') (см. ниже) и
    // setCertificateVerifyProc на persist:ns в window.js.
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
                if (win) {
                    win.show();
                    win.focus();
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

        // ✅ DevTools для отладки рендерера.
        //    Открывается в отдельном окне, чтобы не перекрывать UI.
        //    В продакшене можно обернуть в if (!app.isPackaged) { ... }
        if (mainWindow && !mainWindow.isDestroyed()) {
            console.log('[APP] DevTools opened (detached)');
        }

        if (mainWindow) {
            console.log('[APP] Initializing addons...');
            initAddons(mainWindow);
        }

        // ✅ Автозагрузка базовых звуков (в новом main.js этого вызова не было).
        //    Скачивает baseSounds в userData/sounds, чтобы findSoundFile
        //    находил файлы до того, как пользователь импортирует свои.
        console.log('[APP] Auto-downloading base sounds...');
        soundsManager.autoDownloadBaseSounds().catch((err) => {
            logger.error('[SOUNDS] Auto-download failed:', err.message);
        });

        console.log('[APP] Initialization complete');

        // Запускаем сайдкар в фоне
        console.log('[APP] Starting sidecar in background...');
        startSidecarAndProxy().then(() => {
            console.log('[APP] Sidecar startup sequence initiated successfully.');
        }).catch(err => {
            console.error('[APP] Failed to start sidecar:', err.message);
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', (event) => {
        if (process.platform !== 'darwin') event.preventDefault();
    });

    app.on('will-quit', () => {
        console.log('[APP] Quitting...');
        app.isQuitting = true;
        stopSidecar();
        stopOverlay();
        stopAddons();
        globalShortcut.unregisterAll();
    });
}