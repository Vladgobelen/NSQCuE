const { app, globalShortcut, BrowserWindow } = require('electron');
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

    // Отключаем проверку сертификатов для нашего IP (грязный, но рабочий метод для тестов)
    app.commandLine.appendSwitch('ignore-certificate-errors');

    app.whenReady().then(async () => {
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

        // ВАЖНО: Регистрируем IPC и создаем окно ДО запуска сайдкара
        console.log('[APP] Registering IPC handlers...');
        registerIpcHandlers();

        console.log('[APP] Creating main window...');
        createWindow();
        const mainWindow = getMainWindow();

        if (mainWindow) {
            console.log('[APP] Initializing addons...');
            initAddons(mainWindow);
        }

        console.log('[APP] Initialization complete');

        // Запускаем сайдкар в фоне, НЕ блокируя запуск приложения
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