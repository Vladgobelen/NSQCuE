const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const addonManager = require('./addonManager');
const settings = require('./settings');
const { setupLogging } = require('./utils');
const logger = setupLogging();
let mainWindow;
let checkingUpdate = false;
let currentPTHHotkey = null;

async function ensureGamePath() {
    logger.debug('[ensureGamePath] Checking game path...');
    if (settings.isGamePathValid()) {
        logger.info(`[ensureGamePath] Using saved game path: ${settings.getGamePath()}`);
        return true;
    }
    logger.warn('[ensureGamePath] Game path is not set or invalid');
    const result = await dialog.showOpenDialog({
        title: 'Выберите файл Wow.exe',
        properties: ['openFile'],
        filters: [
            { name: 'Executable files', extensions: ['exe'] },
            { name: 'All files', extensions: ['*'] }
        ]
    });
    if (result.canceled || result.filePaths.length === 0) {
        logger.error('[ensureGamePath] Game path selection canceled by user');
        return false;
    }
    const selectedPath = path.dirname(result.filePaths[0]);
    const wowPath = path.join(selectedPath, 'Wow.exe');
    if (!fs.existsSync(wowPath)) {
        logger.error(`[ensureGamePath] Selected path does not contain Wow.exe: ${wowPath}`);
        dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
        return false;
    }
    settings.setGamePath(selectedPath);
    logger.info(`[ensureGamePath] Game path set to: ${selectedPath}`);
    return true;
}

function registerPTTHotkey(hotkey) {
    logger.debug(`[registerPTTHotkey] Registering hotkey: ${hotkey || 'null'}`);
    if (currentPTHHotkey) {
        globalShortcut.unregister(currentPTHHotkey);
        currentPTHHotkey = null;
        logger.debug('[registerPTTHotkey] Previous hotkey unregistered');
    }
    if (hotkey) {
        const success = globalShortcut.register(hotkey, () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                logger.debug('[registerPTTHotkey] PTT activated, sending to renderer');
                mainWindow.webContents.send('ptt-activated');
            }
        });
        if (success) {
            currentPTHHotkey = hotkey;
            logger.info(`[registerPTTHotkey] PTT Hotkey registered: ${hotkey}`);
        } else {
            logger.error(`[registerPTTHotkey] Failed to register PTT Hotkey: ${hotkey}`);
        }
    }
}

function createWindow() {
    logger.debug('[createWindow] Setting up CSP for default session...');
    // Настройка сессии для webview
    const nsSession = session.fromPartition('persist:ns');
    nsSession.setPermissionRequestHandler((webContents, permission, callback) => {
        logger.debug(`[createWindow] Permission request: ${permission}`);
        if (permission === 'media' || permission === 'microphone' || permission === 'camera') {
            logger.debug('[createWindow] Granting media permission');
            callback(true);
            return;
        }
        callback(false);
    });
    // CSP настройки для webview сессии
    nsSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' https://ns.fiber-gate.ru; " +
                    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://ns.fiber-gate.ru https://cdn.socket.io https://unpkg.com; " +
                    "style-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; " +
                    "img-src 'self' https://ns.fiber-gate.ru data: blob:; " +
                    "connect-src 'self' http://194.31.171.29:38592 https://ns.fiber-gate.ru wss://ns.fiber-gate.ru wss://*.fiber-gate.ru; " +
                    "media-src 'self' blob: https://ns.fiber-gate.ru; " +
                    "child-src 'self' https://ns.fiber-gate.ru blob:; " +
                    "frame-src 'self' https://ns.fiber-gate.ru blob:; " +
                    "worker-src 'self' blob: https://ns.fiber-gate.ru; " +
                    "font-src 'self' https://ns.fiber-gate.ru;"
                ],
                'X-Frame-Options': 'ALLOW-FROM file:// app://'
            }
        });
    });
    // CSP для основного окна
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; " +
                    "style-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; " +
                    "img-src 'self' https://ns.fiber-gate.ru data: blob:; " +
                    "connect-src 'self' http://194.31.171.29:38592 https://ns.fiber-gate.ru wss://ns.fiber-gate.ru; " +
                    "media-src 'self' blob: https://ns.fiber-gate.ru; " +
                    "child-src 'self' https://ns.fiber-gate.ru blob:; " +
                    "frame-src 'self' https://ns.fiber-gate.ru blob:; " +
                    "worker-src 'self' blob:; " +
                    "font-src 'self' https://ns.fiber-gate.ru;"
                ],
                'X-Frame-Options': 'ALLOW-FROM file:// app://'
            }
        });
    });
    logger.debug('[createWindow] Creating BrowserWindow...');
    mainWindow = new BrowserWindow({
        width: 550,
        height: 650,
        minWidth: 300,
        minHeight: 500,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            permissions: ['microphone']
        },
        icon: path.join(__dirname, '../assets/icon.png')
    });
    logger.info('[createWindow] Main window created');
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    // Проверка обновлений каждые 30 секунд
    setInterval(() => {
        if (!checkingUpdate) {
            logger.debug('[createWindow] Checking NSQC update...');
            addonManager.checkNSQCUpdate(mainWindow)
                .catch(err => logger.error('[createWindow] Error checking updates:', err));
        }
    }, 30000);
    mainWindow.on('closed', () => {
        logger.info('[createWindow] Main window closed');
        mainWindow = null;
    });
    // Отладка: логирование событий webview
    mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
        logger.debug('[createWindow] WebView attached');
        webContents.on('console-message', (e, level, message) => {
            logger.debug(`[WebView Console] Level ${level}: ${message}`);
        });
        webContents.on('did-fail-load', (e, code, desc) => {
            logger.error(`[WebView] Failed to load: ${code} - ${desc}`);
        });
    });
}

app.whenReady().then(async () => {
    logger.info('[app.whenReady] Application starting...');
    
    // ← Убираем меню полностью
    Menu.setApplicationMenu(null);
    
    fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));
    const gamePathValid = await ensureGamePath();
    if (!gamePathValid) {
        logger.error('[app.whenReady] Invalid game path, quitting');
        app.quit();
        return;
    }
    addonManager.setGamePath(settings.getGamePath());
    createWindow();
    const savedHotkey = settings.getPTTHotkey();
    if (savedHotkey) {
        logger.debug(`[app.whenReady] Restoring saved PTT hotkey: ${savedHotkey}`);
        registerPTTHotkey(savedHotkey);
    }
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            logger.debug('[app.whenReady] Activating, creating new window');
            createWindow();
        }
    });
    logger.info('[app.whenReady] Application ready');
});

app.on('window-all-closed', () => {
    logger.debug('[app.window-all-closed] All windows closed');
    if (process.platform !== 'darwin') {
        logger.info('[app.window-all-closed] Quitting application');
        app.quit();
    }
});

app.on('will-quit', () => {
    logger.info('[app.will-quit] Application quitting, cleaning up hotkeys');
    if (currentPTHHotkey) {
        globalShortcut.unregister(currentPTHHotkey);
        currentPTHHotkey = null;
    }
    globalShortcut.unregisterAll();
});

// === IPC Handlers ===
ipcMain.handle('load-addons', async () => {
    logger.debug('[IPC] Handling load-addons');
    try {
        const result = await addonManager.loadAddons();
        logger.debug(`[IPC] load-addons completed, loaded ${Object.keys(result).length} addons`);
        return result;
    } catch (error) {
        logger.error('[IPC] Error loading addons:', error);
        return {};
    }
});

ipcMain.handle('toggle-addon', async (event, name, install) => {
    logger.debug(`[IPC] Handling toggle-addon: ${name}, install=${install}`);
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            logger.error('[IPC] mainWindow is null or destroyed in toggle-addon');
            return false;
        }
        await addonManager.toggleAddon(name, install, mainWindow);
        logger.debug(`[IPC] toggle-addon completed: ${name}`);
        return true;
    } catch (error) {
        logger.error(`[IPC] Error toggling addon ${name}:`, error);
        dialog.showErrorBox('Ошибка установки', error.message);
        return false;
    }
});

ipcMain.handle('launch-game', async () => {
    logger.debug('[IPC] Handling launch-game');
    try {
        const result = await addonManager.launchGame();
        logger.debug(`[IPC] launch-game completed: ${result}`);
        return result;
    } catch (error) {
        logger.error('[IPC] Error launching game:', error);
        return false;
    }
});

ipcMain.handle('check-game', async () => {
    logger.debug('[IPC] Handling check-game');
    try {
        const gamePath = settings.getGamePath();
        if (!gamePath) {
            logger.debug('[IPC] check-game: no game path set');
            return false;
        }
        const wowPath = path.join(gamePath, 'Wow.exe');
        const exists = fs.existsSync(wowPath);
        logger.debug(`[IPC] check-game: Wow.exe exists: ${exists}`);
        return exists;
    } catch (error) {
        logger.error('[IPC] Error checking game:', error);
        return false;
    }
});

ipcMain.handle('change-game-path', async () => {
    logger.debug('[IPC] Handling change-game-path');
    const result = await dialog.showOpenDialog({
        title: 'Выберите файл Wow.exe',
        properties: ['openFile'],
        filters: [
            { name: 'Executable files', extensions: ['exe'] },
            { name: 'All files', extensions: ['*'] }
        ]
    });
    if (result.canceled || result.filePaths.length === 0) {
        logger.debug('[IPC] change-game-path: canceled by user');
        return false;
    }
    const selectedPath = path.dirname(result.filePaths[0]);
    const wowPath = path.join(selectedPath, 'Wow.exe');
    if (!fs.existsSync(wowPath)) {
        logger.error(`[IPC] change-game-path: Wow.exe not found at ${wowPath}`);
        dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
        return false;
    }
    settings.setGamePath(selectedPath);
    addonManager.setGamePath(selectedPath);
    logger.info(`[IPC] change-game-path: new path set to ${selectedPath}`);
    return true;
});

ipcMain.on('open-logs-folder', () => {
    logger.debug('[IPC] Handling open-logs-folder');
    const logsPath = path.join(app.getPath('userData'), 'logs');
    shell.openPath(logsPath);
});

ipcMain.on('go-back', (event) => {
    logger.debug('[IPC] Handling go-back');
    if (mainWindow && !mainWindow.isDestroyed()) {
        const indexPath = `file://${__dirname}/../renderer/index.html`;
        mainWindow.loadURL(indexPath);
    }
});

ipcMain.handle('set-ptt-hotkey', async (event, hotkey) => {
    logger.debug(`[IPC] Handling set-ptt-hotkey: ${hotkey || 'null'}`);
    try {
        registerPTTHotkey(hotkey);
        settings.setPTTHotkey(hotkey);
        logger.info(`[IPC] PTT hotkey set: ${hotkey || 'cleared'}`);
        return { success: true, message: 'Hotkey set successfully' };
    } catch (error) {
        logger.error('[IPC] Error setting PTT hotkey:', error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('get-ptt-hotkey', async () => {
    logger.debug('[IPC] Handling get-ptt-hotkey');
    const hotkey = settings.getPTTHotkey();
    logger.debug(`[IPC] get-ptt-hotkey returning: ${hotkey || 'null'}`);
    return hotkey;
});

// === Получение платформы (для renderer) ===
ipcMain.handle('get-platform', async () => {
    logger.debug('[IPC] Handling get-platform');
    const platform = process.platform;
    logger.debug(`[IPC] get-platform returning: ${platform}`);
    return platform;
});

// === PTT Hotkey Registration ===
ipcMain.handle('register-ptt-hotkey', async (event, hotkey) => {
    logger.debug(`[IPC] Handling register-ptt-hotkey: ${hotkey || 'null'}`);
    if (currentPTHHotkey) {
        globalShortcut.unregister(currentPTHHotkey);
        logger.debug('[IPC] Previous hotkey unregistered');
    }
    if (!hotkey) {
        currentPTHHotkey = null;
        logger.debug('[IPC] Hotkey cleared');
        return { success: true };
    }
    const registered = globalShortcut.register(hotkey, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            logger.debug('[IPC] PTT activated via global shortcut');
            mainWindow.webContents.send('ptt-activated');
        }
    });
    if (registered) {
        currentPTHHotkey = hotkey;
        logger.info(`[IPC] PTT hotkey registered: ${hotkey}`);
        return { success: true };
    } else {
        logger.error(`[IPC] Failed to register PTT hotkey: ${hotkey}`);
        return { success: false, error: 'Не удалось зарегистрировать хоткей' };
    }
});

// === Получение статуса микрофона от веб-клиента ===
ipcMain.on('webclient-mic-state', (event, state) => {
    logger.debug(`[IPC] webclient-mic-state: ${JSON.stringify(state)}`);
});