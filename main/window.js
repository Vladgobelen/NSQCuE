const { BrowserWindow, session, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { setupWebviewHandlers } = require('./webview');
const settings = require('./settings');
const logger = require('./utils').setupLogging();

let mainWindow = null;
let overlayWindow = null;

function getMainWindow() { return mainWindow; }
function getOverlayWindow() { return overlayWindow; }

function createWindow() {
    const nsSession = session.fromPartition('persist:ns');
    nsSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'microphone', 'camera', 'clipboard-read', 'clipboard-sanitized-write', 'clipboard'];
        callback(allowedPermissions.includes(permission));
    });

    const applyCSP = (details, callback, isDefault) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    isDefault
                        ? "default-src 'self'; script-src 'self' 'unsafe-inline' https://100.126.188.12; style-src 'self' 'unsafe-inline' https://100.126.188.12; img-src 'self' https://100.126.188.12 blob: data:; connect-src 'self' https://100.126.188.12 wss://100.126.188.12; media-src 'self' blob: data: https://100.126.188.12; child-src 'self' https://100.126.188.12 blob:; frame-src 'self' https://100.126.188.12 blob:; worker-src 'self' blob:; font-src 'self' https://100.126.188.12;"
                        : "default-src 'self' https://100.126.188.12; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://100.126.188.12 https://cdn.socket.io https://unpkg.com; style-src 'self' 'unsafe-inline' https://100.126.188.12; img-src 'self' https://100.126.188.12 blob: data:; connect-src 'self' https://100.126.188.12 wss://100.126.188.12; media-src 'self' blob: data: https://100.126.188.12; child-src 'self' https://100.126.188.12 blob:; frame-src 'self' https://100.126.188.12 blob:; worker-src 'self' blob: https://100.126.188.12; font-src 'self' https://100.126.188.12;"
                ],
                'X-Frame-Options': 'ALLOW-FROM file:// app://',
            },
        });
    };

    nsSession.webRequest.onHeadersReceived((details, callback) => applyCSP(details, callback, false));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => applyCSP(details, callback, true));

    mainWindow = new BrowserWindow({
        width: 550, height: 650, minWidth: 300, minHeight: 500,
        title: 'Ночная стража: установщик аддонов',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false, contextIsolation: true, webviewTag: true, permissions: ['microphone'],
        },
        icon: path.join(__dirname, '../assets/icon.png'),
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });

    mainWindow.on('closed', () => {
        if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
        mainWindow = null;
    });

    mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
        setupWebviewHandlers(webContents);
    });

    mainWindow.webContents.on('did-create-webview', (event, webContents) => {
        setupWebviewHandlers(webContents);
    });
}

// Окно оверлея (для чата поверх игры)
function createOverlayWindow() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.show();
        return;
    }

    overlayWindow = new BrowserWindow({
        width: 360, height: 260, x: 100, y: 100,
        frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
    });

    overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));
    overlayWindow.on('closed', () => { overlayWindow = null; });
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
    stopOverlay
};