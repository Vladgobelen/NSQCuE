const { Tray, Menu, BrowserWindow, screen, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const settings = require('./settings');
const logger = require('./utils').setupLogging();

let tray = null;
let notificationWindow = null;
let notificationQueue = [];
let isNotificationShowing = false;
let notificationsEnabled = true;
let unreadMessagesCount = 0;

function getTray() { return tray; }

function createTray() {
    if (tray) return;

    let iconPath;
    const possiblePaths = [
        app.isPackaged ? path.join(process.resourcesPath, 'assets', 'icon.png') : null,
        path.join(__dirname, '..', 'assets', 'icon.png'),
        path.join(__dirname, 'assets', 'icon.png'),
        path.join(app.getAppPath(), 'assets', 'icon.png'),
    ].filter(p => p !== null);

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) { iconPath = p; break; }
    }

    try {
        if (iconPath) {
            tray = new Tray(iconPath);
        } else {
            tray = new Tray(nativeImage.createEmpty());
        }
    } catch (err) {
        logger.error('[TRAY] Failed to create tray:', err.message);
        return;
    }

    updateTrayMenu();

    tray.on('click', () => {
        const mainWindow = BrowserWindow.getAllWindows().find(w => w.title === 'Ночная стража: установщик аддонов');
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
                if (tray) { tray.setTitle(''); unreadMessagesCount = 0; }
            }
        }
    });
}

function updateTrayMenu() {
    if (!tray) return;

    const currentPos = settings.getNotificationPosition();
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Показать',
            click: () => {
                const mainWindow = BrowserWindow.getAllWindows().find(w => w.title === 'Ночная стража: установщик аддонов');
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            },
        },
        {
            label: 'Оверлей',
            click: () => {
                const { createOverlayWindow, getOverlayWindow } = require('./window');
                createOverlayWindow();
                const win = getOverlayWindow();
                if (win && !win.isDestroyed()) {
                    win.show();
                    win.focus();
                    win.webContents.send('focus-input');
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Позиция уведомлений',
            submenu: [
                { label: '↖ Слева вверху', type: 'radio', checked: currentPos === 'top-left', click: () => { settings.setNotificationPosition('top-left'); updateTrayMenu(); } },
                { label: '↑ Вверху', type: 'radio', checked: currentPos === 'top', click: () => { settings.setNotificationPosition('top'); updateTrayMenu(); } },
                { label: '↗ Справа вверху', type: 'radio', checked: currentPos === 'top-right', click: () => { settings.setNotificationPosition('top-right'); updateTrayMenu(); } },
                { label: '→ Справа', type: 'radio', checked: currentPos === 'right', click: () => { settings.setNotificationPosition('right'); updateTrayMenu(); } },
                { label: '↘ Снизу справа', type: 'radio', checked: currentPos === 'bottom-right', click: () => { settings.setNotificationPosition('bottom-right'); updateTrayMenu(); } },
                { label: '↓ Снизу', type: 'radio', checked: currentPos === 'bottom', click: () => { settings.setNotificationPosition('bottom'); updateTrayMenu(); } },
                { label: '↙ Снизу слева', type: 'radio', checked: currentPos === 'bottom-left', click: () => { settings.setNotificationPosition('bottom-left'); updateTrayMenu(); } },
                { label: '← Слева', type: 'radio', checked: currentPos === 'left', click: () => { settings.setNotificationPosition('left'); updateTrayMenu(); } },
            ],
        },
        { type: 'separator' },
        {
            label: notificationsEnabled ? '🔔 Уведомления включены' : '🔕 Уведомления выключены',
            type: 'checkbox',
            checked: notificationsEnabled,
            click: (menuItem) => {
                notificationsEnabled = menuItem.checked;
                updateTrayMenu();
            },
        },
        { type: 'separator' },
        {
            label: 'Выход',
            click: () => { app.isQuitting = true; app.quit(); },
        },
    ]);

    tray.setToolTip('Ночная стража');
    tray.setContextMenu(contextMenu);
}

// ───────────────────────────────────────────────────────────
//  Уведомления
// ───────────────────────────────────────────────────────────
function createNotificationWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) return notificationWindow;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const position = settings.getNotificationPosition();
    const winWidth = 300;
    const winHeight = 60;
    const margin = 15;

    const posMap = {
        'top-left': { x: margin, y: margin },
        'top': { x: (width - winWidth) / 2, y: margin },
        'top-right': { x: width - winWidth - margin, y: margin },
        'right': { x: width - winWidth - margin, y: (height - winHeight) / 2 },
        'bottom-right': { x: width - winWidth - margin, y: height - winHeight - margin - 40 },
        'bottom': { x: (width - winWidth) / 2, y: height - winHeight - margin - 40 },
        'bottom-left': { x: margin, y: height - winHeight - margin - 40 },
        'left': { x: margin, y: (height - winHeight) / 2 },
    };

    const coords = posMap[position] || posMap['top-right'];

    notificationWindow = new BrowserWindow({
        width: winWidth, height: winHeight, x: coords.x, y: coords.y,
        frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
        resizable: false, focusable: false, show: false,
        backgroundColor: '#00000000', hasShadow: false, thickFrame: false, useContentSize: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
    });

    notificationWindow.setBackgroundColor('#00000000');
    notificationWindow.setVisibleOnAllWorkspaces(true);
    notificationWindow.setAlwaysOnTop(true, 'screen-saver');
    notificationWindow.loadFile(path.join(__dirname, '../renderer/notification.html'));

    notificationWindow.on('closed', () => {
        notificationWindow = null;
        isNotificationShowing = false;
        showNextNotification();
    });

    return notificationWindow;
}

function showCustomNotification(title, body) {
    if (!notificationsEnabled) return;
    notificationQueue.push({ title, body });
    if (!isNotificationShowing) showNextNotification();
}

function showNextNotification() {
    if (notificationQueue.length === 0) { isNotificationShowing = false; return; }
    const { title, body } = notificationQueue.shift();
    const win = createNotificationWindow();
    isNotificationShowing = true;

    win.webContents.once('did-finish-load', () => {
        win.webContents.send('show-notification', { title, body });
        win.showInactive();
        setTimeout(() => { if (win && !win.isDestroyed()) win.close(); }, 5000);
    });
}

function updateTrayBadge(count) {
    if (!tray) return;
    const num = parseInt(count, 10) || 0;
    unreadMessagesCount = num;
    if (num > 0) {
        tray.setTitle(num.toString());
        tray.setToolTip('Ночная стража (непрочитано: ' + num + ')');
    } else {
        tray.setTitle('');
        tray.setToolTip('Ночная стража');
    }
}

function closeNotificationWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.close();
    }
}

module.exports = {
    createTray,
    updateTrayMenu,
    getTray,
    showCustomNotification,
    updateTrayBadge,
    closeNotificationWindow
};