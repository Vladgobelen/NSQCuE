const {
  Tray,
  Menu,
  screen,
  nativeImage,
  app,
  BrowserWindow,
  ipcMain,
} = require('electron');
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

let currentNotification = null;
let readyTimer = null;
let hardTimer = null;
let notificationIpcRegistered = false;

const NOTIF_WIDTH = 320;
const NOTIF_DEFAULT_HEIGHT = 72;
const NOTIF_MIN_HEIGHT = 48;
const NOTIF_MAX_HEIGHT = 180;
const NOTIF_MARGIN = 15;
const NOTIF_TASKBAR_GAP = 40;
const NOTIF_QUEUE_LIMIT = 12;
const NOTIF_READY_TIMEOUT = 2500;

function getTray() {
  return tray;
}

// Показать главное окно, а если оно уничтожено — создать заново.
function showOrCreateMainWindow() {
  const { getMainWindow, createWindow } = require('./window');
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
  return win;
}

// ───────────────────────────────────────────────────────────
//  Геометрия окна уведомлений
// ───────────────────────────────────────────────────────────
function notificationPosition(position, winWidth, winHeight, screenWidth, screenHeight) {
  const m = NOTIF_MARGIN;
  const map = {
    'top-left': { x: m, y: m },
    'top': { x: (screenWidth - winWidth) / 2, y: m },
    'top-right': { x: screenWidth - winWidth - m, y: m },
    'right': { x: screenWidth - winWidth - m, y: (screenHeight - winHeight) / 2 },
    'bottom-right': {
      x: screenWidth - winWidth - m,
      y: screenHeight - winHeight - m - NOTIF_TASKBAR_GAP,
    },
    'bottom': {
      x: (screenWidth - winWidth) / 2,
      y: screenHeight - winHeight - m - NOTIF_TASKBAR_GAP,
    },
    'bottom-left': { x: m, y: screenHeight - winHeight - m - NOTIF_TASKBAR_GAP },
    'left': { x: m, y: (screenHeight - winHeight) / 2 },
  };
  return map[position] || map['top-right'];
}

// Высота приходит из notification.html по факту контента —
// длинный текст ошибки больше не режется окном в 60px.
function applyNotificationBounds(contentHeight) {
  if (!notificationWindow || notificationWindow.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workAreaSize;
  const parsed = Math.round(Number(contentHeight));
  const height = Math.max(
    NOTIF_MIN_HEIGHT,
    Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : NOTIF_DEFAULT_HEIGHT, NOTIF_MAX_HEIGHT)
  );
  const pos = notificationPosition(
    settings.getNotificationPosition(),
    NOTIF_WIDTH,
    height,
    area.width,
    area.height
  );
  try {
    notificationWindow.setContentBounds({
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      width: NOTIF_WIDTH,
      height,
    });
  } catch (e) {
    logger.warn(`[NOTIF] не удалось выставить геометрию: ${e.message}`);
  }
}

function clearNotificationTimers() {
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  if (hardTimer) {
    clearTimeout(hardTimer);
    hardTimer = null;
  }
}

// IPC окна уведомлений принадлежит трею — он же владеет его жизненным циклом.
// Канал 'notification-clicked' (чат) остаётся в ipcHandlers.js.
function registerNotificationIpc() {
  if (notificationIpcRegistered) return;
  notificationIpcRegistered = true;

  ipcMain.on('notification-ready', (event, data) => {
    if (!notificationWindow || notificationWindow.isDestroyed()) return;
    if (event.sender !== notificationWindow.webContents) return;
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    applyNotificationBounds(data && data.height);
    notificationWindow.showInactive();
  });

  // Закрыть ТОЛЬКО текущее уведомление, очередь продолжает идти.
  ipcMain.on('dismiss-notification', (event) => {
    if (!notificationWindow || notificationWindow.isDestroyed()) return;
    if (event.sender !== notificationWindow.webContents) return;
    notificationWindow.close();
  });

  ipcMain.on('addon-notification-clicked', (event, addonName) => {
    if (
      notificationWindow &&
      !notificationWindow.isDestroyed() &&
      event.sender !== notificationWindow.webContents
    ) {
      return;
    }
    focusAddonInMainWindow(typeof addonName === 'string' ? addonName : null);
  });
}

function focusAddonInMainWindow(addonName) {
  const win = showOrCreateMainWindow();
  if (!win || win.isDestroyed() || !addonName) return;
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send('focus-addon', addonName);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => setTimeout(send, 250));
  } else {
    setTimeout(send, 120);
  }
}

function createTray() {
  registerNotificationIpc();
  if (tray) return;

  let iconPath;
  const possiblePaths = [
    app.isPackaged ? path.join(process.resourcesPath, 'assets', 'icon.png') : null,
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(app.getAppPath(), 'assets', 'icon.png'),
  ].filter((p) => p !== null);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      iconPath = p;
      break;
    }
  }

  try {
    if (iconPath) {
      tray = new Tray(iconPath);
    } else {
      tray = new Tray(nativeImage.createEmpty());
    }
  } catch (err) {
    logger.error(`[TRAY] Failed to create tray: ${err.message}`);
    return;
  }

  updateTrayMenu();

  tray.on('click', () => {
    const { getMainWindow } = require('./window');
    const win = getMainWindow();
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide();
      return;
    }
    showOrCreateMainWindow();
    if (tray) {
      tray.setTitle('');
      unreadMessagesCount = 0;
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
        showOrCreateMainWindow();
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
        {
          label: '↖ Слева вверху',
          type: 'radio',
          checked: currentPos === 'top-left',
          click: () => {
            settings.setNotificationPosition('top-left');
            updateTrayMenu();
          },
        },
        {
          label: '↑ Вверху',
          type: 'radio',
          checked: currentPos === 'top',
          click: () => {
            settings.setNotificationPosition('top');
            updateTrayMenu();
          },
        },
        {
          label: '↗ Справа вверху',
          type: 'radio',
          checked: currentPos === 'top-right',
          click: () => {
            settings.setNotificationPosition('top-right');
            updateTrayMenu();
          },
        },
        {
          label: '→ Справа',
          type: 'radio',
          checked: currentPos === 'right',
          click: () => {
            settings.setNotificationPosition('right');
            updateTrayMenu();
          },
        },
        {
          label: '↘ Снизу справа',
          type: 'radio',
          checked: currentPos === 'bottom-right',
          click: () => {
            settings.setNotificationPosition('bottom-right');
            updateTrayMenu();
          },
        },
        {
          label: '↓ Снизу',
          type: 'radio',
          checked: currentPos === 'bottom',
          click: () => {
            settings.setNotificationPosition('bottom');
            updateTrayMenu();
          },
        },
        {
          label: '↙ Снизу слева',
          type: 'radio',
          checked: currentPos === 'bottom-left',
          click: () => {
            settings.setNotificationPosition('bottom-left');
            updateTrayMenu();
          },
        },
        {
          label: '← Слева',
          type: 'radio',
          checked: currentPos === 'left',
          click: () => {
            settings.setNotificationPosition('left');
            updateTrayMenu();
          },
        },
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
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Ночная стража');
  tray.setContextMenu(contextMenu);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// ───────────────────────────────────────────────────────────
//  Уведомления (войс-чат + обновления аддонов)
// ───────────────────────────────────────────────────────────
function createNotificationWindow() {
  if (notificationWindow && !notificationWindow.isDestroyed()) return notificationWindow;

  const area = screen.getPrimaryDisplay().workAreaSize;
  const pos = notificationPosition(
    settings.getNotificationPosition(),
    NOTIF_WIDTH,
    NOTIF_DEFAULT_HEIGHT,
    area.width,
    area.height
  );

  notificationWindow = new BrowserWindow({
    width: NOTIF_WIDTH,
    height: NOTIF_DEFAULT_HEIGHT,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    useContentSize: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  notificationWindow.setBackgroundColor('#00000000');
  notificationWindow.setVisibleOnAllWorkspaces(true);
  notificationWindow.setAlwaysOnTop(true, 'screen-saver');
  notificationWindow.loadFile(path.join(__dirname, '../renderer/notification.html'));

  notificationWindow.webContents.on('did-fail-load', (event, code, desc) => {
    logger.error(`[NOTIF] окно уведомления не загрузилось: ${code} ${desc}`);
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.close();
    }
  });

  notificationWindow.webContents.on('render-process-gone', () => {
    logger.error('[NOTIF] renderer окна уведомлений упал');
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.close();
    }
  });

  notificationWindow.on('closed', () => {
    notificationWindow = null;
    currentNotification = null;
    isNotificationShowing = false;
    clearNotificationTimers();
    showNextNotification();
  });

  return notificationWindow;
}

// options: { kind: 'chat'|'addon-update'|'addon-error', addon, from, to, duration }
// Старые вызовы showCustomNotification(title, body) работают как раньше.
function showCustomNotification(title, body, options) {
  if (!notificationsEnabled || app.isQuitting) return;

  const opts = options && typeof options === 'object' ? options : {};
  const kind =
    opts.kind === 'addon-update' || opts.kind === 'addon-error' ? opts.kind : 'chat';
  const rawDuration = Number(opts.duration);
  const duration = Number.isFinite(rawDuration)
    ? Math.min(Math.max(rawDuration, 2000), 20000)
    : kind === 'chat'
      ? 5000
      : 6000;

  notificationQueue.push({
    title: String(title == null ? '' : title),
    body: String(body == null ? '' : body),
    kind,
    addon: typeof opts.addon === 'string' && opts.addon ? opts.addon : null,
    from: opts.from == null ? null : String(opts.from),
    to: opts.to == null ? null : String(opts.to),
    duration,
  });

  while (notificationQueue.length > NOTIF_QUEUE_LIMIT) notificationQueue.shift();

  if (!isNotificationShowing) showNextNotification();
}

function showNextNotification() {
  clearNotificationTimers();

  if (app.isQuitting || notificationQueue.length === 0) {
    isNotificationShowing = false;
    currentNotification = null;
    return;
  }

  const item = notificationQueue.shift();
  currentNotification = item;
  isNotificationShowing = true;

  const win = createNotificationWindow();
  if (!win || win.isDestroyed()) {
    isNotificationShowing = false;
    currentNotification = null;
    return;
  }

  const deliver = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('show-notification', item);

    // Страховки: зависшая загрузка/мёртвый рендерер не должны
    // навсегда заблокировать очередь (isNotificationShowing).
    readyTimer = setTimeout(() => {
      logger.warn('[NOTIF] окно уведомления не ответило — пропуск');
      if (!win.isDestroyed()) win.close();
    }, NOTIF_READY_TIMEOUT);

    hardTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.close();
    }, item.duration + 6000);
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', deliver);
  } else {
    deliver();
  }
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

// Полный сброс: используется при выходе и из ipcHandlers.
function closeNotificationWindow() {
  notificationQueue = [];
  clearNotificationTimers();
  currentNotification = null;
  isNotificationShowing = false;
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.close();
  }
}

module.exports = {
  createTray,
  updateTrayMenu,
  destroyTray,
  getTray,
  showCustomNotification,
  updateTrayBadge,
  closeNotificationWindow,
};