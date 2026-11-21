const { BrowserWindow, session, dialog, app } = require('electron');
const path = require('path');
const { setupWebviewHandlers } = require('./webview');
const logger = require('./utils').setupLogging();

let mainWindow = null;
let overlayWindow = null;

function getMainWindow() {
    return mainWindow;
}

function getOverlayWindow() {
    return overlayWindow;
}

function createWindow() {
    const nsSession = session.fromPartition('persist:ns');
    nsSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = [
            'media',
            'microphone',
            'camera',
            'clipboard-read',
            'clipboard-sanitized-write',
            'clipboard',
            'fullscreen',
        ];
        callback(allowedPermissions.includes(permission));
    });

    const applyCSP = (details, callback, isDefault) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    isDefault
                        ? "default-src 'self'; script-src 'self' 'unsafe-inline' https://100.126.188.12; style-src 'self' 'unsafe-inline' https://100.126.188.12; img-src 'self' https://100.126.188.12 blob: data:; connect-src 'self' https://100.126.188.12 wss://100.126.188.12; media-src 'self' blob: data: https://100.126.188.12; child-src 'self' https://100.126.188.12 blob:; frame-src 'self' https://100.126.188.12 blob:; worker-src 'self' blob:; font-src 'self' https://100.126.188.12;"
                        : "default-src 'self' https://100.126.188.12; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://100.126.188.12 https://cdn.socket.io https://unpkg.com; style-src 'self' 'unsafe-inline' https://100.126.188.12; img-src 'self' https://100.126.188.12 blob: data:; connect-src 'self' https://100.126.188.12 wss://100.126.188.12; media-src 'self' blob: data: https://100.126.188.12; child-src 'self' https://100.126.188.12 blob:; frame-src 'self' https://100.126.188.12 blob:; worker-src 'self' blob: https://100.126.188.12; font-src 'self' https://100.126.188.12;",
                ],
                'X-Frame-Options': 'ALLOW-FROM file:// app://',
            },
        });
    };
    nsSession.webRequest.onHeadersReceived((details, callback) => applyCSP(details, callback, false));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => applyCSP(details, callback, true));

    mainWindow = new BrowserWindow({
        width: 550,
        height: 650,
        minWidth: 300,
        minHeight: 500,
        title: 'Ночная стража: установщик аддонов',
        fullscreenable: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            permissions: ['microphone', 'fullscreen'],
        },
        icon: path.join(__dirname, '../assets/icon.png'),
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Закрытие окна: свернуть (оверлей/трей) или выйти полностью.
    mainWindow.on('close', (event) => {
        if (app.isQuitting) return; // выход через трей/меню — без вопросов
        event.preventDefault();
        const choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'warning',
            title: 'Закрытие',
            message: 'Что сделать с приложением?',
            detail:
                'Свернуть — окно скроется, но оверлей, звуки и уведомления продолжат работать.\n' +
                'Закрыть — полный выход из приложения.',
            buttons: ['Свернуть в оверлей', 'Закрыть приложение', 'Отмена'],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
        });
        if (choice === 0) {
            mainWindow.hide();
        } else if (choice === 1) {
            app.isQuitting = true;
            // destroy() не вызывает close повторно — выход не может быть отменён.
            mainWindow.destroy();
            app.quit();
        }
        // choice === 2 (Отмена / Esc) — окно остаётся
    });

    mainWindow.on('closed', () => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.close();
        }
        mainWindow = null;
    });

    mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
        console.log('[WINDOW] did-attach-webview');
        setupWebviewHandlers(webContents);
    });
    mainWindow.webContents.on('did-create-webview', (event, webContents) => {
        console.log('[WINDOW] did-create-webview');
        setupWebviewHandlers(webContents);
    });

    // ── Разрешаем полноэкранный режим на уровне главного окна ──
    mainWindow.webContents.on('enter-html-full-screen', (event) => {
        console.log('[WINDOW] enter-html-full-screen — разрешаю');
        // НЕ вызываем event.preventDefault() — разрешаем вход
    });
    mainWindow.webContents.on('leave-html-full-screen', () => {
        console.log('[WINDOW] leave-html-full-screen');
    });
}

// Окно оверлея (чат поверх игры).
function createOverlayWindow() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.show();
        return;
    }
    console.log('[OVERLAY_WIN] создание окна оверлея');
    overlayWindow = new BrowserWindow({
        width: 360,
        height: 260,
        x: 100,
        y: 100,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));
    // Для отладки самого оверлея раскомментируйте:
    // overlayWindow.webContents.openDevTools({ mode: 'detach' });
    overlayWindow.webContents.on('did-finish-load', () => {
        console.log('[OVERLAY_WIN] overlay.html загружен');
    });
    overlayWindow.webContents.on('did-fail-load', (event, code, desc) => {
        logger.error(`[OVERLAY_WIN] load failed: ${code} ${desc}`);
    });
    overlayWindow.on('closed', () => {
        console.log('[OVERLAY_WIN] окно закрыто');
        overlayWindow = null;
    });
}

function stopOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
        overlayWindow = null;
    }
}

module.exports = {
    createWindow,
    getMainWindow,
    getOverlayWindow,
    createOverlayWindow,
    stopOverlay,
};