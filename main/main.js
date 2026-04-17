const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, Menu, clipboard, Tray, Notification } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process');
const addonManager = require('./addonManager');
const settings = require('./settings');
const soundsManager = require('./soundsManager');
const { setupLogging } = require('./utils');
const logger = setupLogging();
const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, Menu, clipboard, Tray, Notification } = require('electron');
let mainWindow;
let overlayWindow = null;
let webviewWebContents = null;
let hookProcess = null;
let tray = null;
let unreadMessagesCount = 0;
const pressedKeys = new Map();
let currentPTTHotkeyCodes = null;
let captureMode = false;
const capturedCodes = new Set();
let pttActive = false;
const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');
app.isQuitting = false;
fs.ensureDirSync(SOUNDS_DIR);

const SOUND_MAP = {
  'message': 'message.mp3',
  'user-join': 'user-join.mp3',
  'user-leave': 'user-leave.mp3',
  'mic-on': 'mic-on.mp3',
  'mic-off': 'mic-off.mp3',
  'pop-up-message': 'notification.mp3',
  'room-join': 'room-join.mp3'
};

function playSoundSilent(filePath) {
  if (!fs.existsSync(filePath)) {
    logger.error(`[SOUND] File not found: ${filePath}`);
    return;
  }
  
  logger.info(`[SOUND] Playing: ${filePath}`);
  
  // Конвертируем в data URL
  const audioData = fs.readFileSync(filePath);
  const base64 = audioData.toString('base64');
  const dataUrl = `data:audio/mp3;base64,${base64}`;
  
  const code = `
    (function() {
      const audio = new Audio('${dataUrl}');
      audio.volume = 1.0;
      audio.play().catch(e => console.error('Audio error:', e));
    })();
  `;
  
  if (webviewWebContents && !webviewWebContents.isDestroyed()) {
    webviewWebContents.executeJavaScript(code).catch(err => {
      logger.error('[SOUND] Web Audio error:', err.message);
    });
  }
}

async function ensureGamePath() {
  if (settings.isGamePathValid()) return true;
  const result = await dialog.showOpenDialog({
    title: 'Выберите файл Wow.exe',
    properties: ['openFile'],
    filters: [{ name: 'Executable files', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return false;
  const selectedPath = path.dirname(result.filePaths[0]);
  const wowPath = path.join(selectedPath, 'Wow.exe');
  if (!fs.existsSync(wowPath)) {
    logger.error(`[GAME_PATH] Selected path missing Wow.exe: ${wowPath}`);
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  return true;
}

function startRustHook() {
  if (hookProcess) return;
  const exeName = process.platform === 'win32' ? 'global-mouse-hook.exe' : 'global-mouse-hook';
  const exePath = app.isPackaged
    ? path.join(process.resourcesPath, exeName)
    : path.join(__dirname, '..', exeName);
  if (!fs.existsSync(exePath)) {
    logger.error(`[HOOK] Executable not found: ${exePath}`);
    dialog.showErrorBox('Ошибка', `Не найден файл хука: ${exeName}. Проверьте наличие в корне проекта или resources.`);
    return;
  }
  try {
    hookProcess = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env }
    });
    hookProcess.stdout.on('data', (data) => {
      const raw = data.toString();
      if (!raw.trim()) return;
      const lines = raw.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let code;
        let isDown;
        try {
          const json = JSON.parse(trimmed);
          if (typeof json.code !== 'number') continue;
          code = json.code;
          isDown = json.event === 'down';
        } catch {
          const [typeStr, codeStr] = trimmed.split(':');
          code = parseInt(codeStr, 10);
          isDown = typeStr.toLowerCase() === 'down';
        }
        if (isNaN(code)) continue;
        pressedKeys.set(code, isDown);
        if (captureMode && isDown) {
          capturedCodes.add(code);
          mainWindow?.webContents?.send('key-captured', code);
        }
        if (currentPTTHotkeyCodes && currentPTTHotkeyCodes.length > 0) {
          const allPressed = currentPTTHotkeyCodes.every(c => pressedKeys.get(c) === true);
          const allReleased = currentPTTHotkeyCodes.every(c => pressedKeys.get(c) !== true);
          if (allPressed && !pttActive) {
            pttActive = true;
            mainWindow?.webContents?.send('ptt-pressed');
          } else if (allReleased && pttActive) {
            pttActive = false;
            mainWindow?.webContents?.send('ptt-released');
          }
        }
      }
    });
    hookProcess.stderr.on('data', (data) => {
      const err = data.toString().trim();
      if (err) logger.error(`[HOOK_STDERR] ${err}`);
    });
    hookProcess.on('close', () => { hookProcess = null; });
    hookProcess.on('error', (err) => {
      logger.error(`[HOOK] Process error: ${err.message}`);
      hookProcess = null;
    });
  } catch (err) {
    logger.error(`[HOOK] Spawn failed: ${err.message}\n${err.stack}`);
    hookProcess = null;
  }
}

function stopRustHook() {
  if (hookProcess) {
    try { hookProcess.kill(); } catch (err) { logger.error(`[HOOK] Kill failed: ${err.message}`); }
    hookProcess = null;
  }
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Окно уже существует, ничего не делаем
    logger.info('[OVERLAY] Window already exists, skipping creation');
    return;
  }
  
  logger.info('[OVERLAY] Creating new overlay window');
  
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
    focusable: true,
    show: false,               // ← ВАЖНО: создаем скрытым
    title: 'NSQCuE — Оверлей чата',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  });
  
  // Загружаем HTML
  const overlayPath = path.join(__dirname, '../renderer/overlay.html');
  overlayWindow.loadFile(overlayPath).catch(err => {
    logger.error(`[OVERLAY] Failed to load: ${err.message}`);
  });
  
  // Открываем DevTools для отладки (опционально)
  //overlayWindow.webContents.openDevTools({ mode: 'detach' });
  
  // Логируем успешную загрузку
  overlayWindow.webContents.once('did-finish-load', () => {
    logger.info('[OVERLAY] Window loaded successfully (hidden)');
  });
  
  // Обработчики событий окна
  overlayWindow.on('closed', () => {
    logger.info('[OVERLAY] Window closed');
    overlayWindow = null;
  });
  
  overlayWindow.on('show', () => {
    logger.info('[OVERLAY] Window shown');
  });
  
  overlayWindow.on('hide', () => {
    logger.info('[OVERLAY] Window hidden');
  });
  
  // Логируем консоль оверлея (для отладки)
  overlayWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    logger.info(`[OVERLAY_CONSOLE] ${levels[level] || 'LOG'}: ${message}`);
  });
  
  // Обработка крашей рендерера
  overlayWindow.webContents.on('render-process-gone', (event, details) => {
    logger.error(`[OVERLAY] Render process gone: ${details.reason}`);
    overlayWindow = null;
    // Автоматически пересоздаем при краше (но оставляем скрытым)
    setTimeout(() => createOverlayWindow(), 1000);
  });
  
  logger.info('[OVERLAY] Overlay window created (hidden)');
}

function startOverlay() {
  createOverlayWindow();
}

function stopOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

function sendToOverlay(type, data) {
  logger.info(`[OVERLAY] sendToOverlay called: ${type}, ${data.text}`);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Только отправляем сообщение, НЕ показываем окно
    overlayWindow.webContents.send('overlay-message', data.text);
    
    // УБИРАЕМ ЭТО:
    // if (!overlayWindow.isVisible()) {
    //   overlayWindow.showInactive();
    // }
    
    return true;
  }
  return false;
}

function sendToWebClient(text) {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) {
    logger.warn('[OVERLAY] WebView not available');
    return;
  }
  
  try {
    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
    
    const code = `
      (function() {
        const inputField = document.querySelector('textarea.message-input');
        if (inputField) {
          inputField.value = '${escapedText}';
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
          const sendButton = document.querySelector('button.send-btn');
          if (sendButton) {
            sendButton.click();
          } else {
            inputField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          }
          return true;
        }
        return false;
      })();
    `;
    
    webviewWebContents.executeJavaScript(code).then(result => {
      if (result) {
        logger.info('[OVERLAY] Message sent to web client');
      } else {
        logger.warn('[OVERLAY] Input field not found');
      }
    }).catch(err => {
      logger.error('[OVERLAY] Error:', err.message);
    });
  } catch (err) {
    logger.error('[OVERLAY] Failed:', err.message);
  }
}

function setupWebviewHandlers(webContents) {
  webviewWebContents = webContents;
  //webContents.openDevTools({ mode: 'detach' });
  
  const isExternalUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.origin !== 'https://ns.fiber-gate.ru';
    } catch { return false; }
  };
  
  webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  
  webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  
// Перехват звуков через console-message
  webContents.on('console-message', (event, level, message) => {
    let soundType = null;
    
    if (message.includes('[electronAPI] playSound called:')) {
      const match = message.match(/playSound called:\s*([^\)]+)/);
      if (match) soundType = match[1].trim();
    } else if (message.includes('[message listener] Received sound postMessage:')) {
      const match = message.match(/postMessage:\s*(\w+-\w+|\w+)/);
      if (match) soundType = match[1].trim();
    } else if (message.includes('playSound called with:') && message.includes('[CLIENT]')) {
      const match = message.match(/playSound called with:\s*(\w+-\w+|\w+)/);
      if (match) soundType = match[1].trim();
    }
    
    if (soundType) {
      logger.info(`[WEBVIEW_CONSOLE] Sound detected: ${soundType}`);
      const fileName = SOUND_MAP[soundType] || `${soundType}.mp3`;
      const soundPath = path.join(SOUNDS_DIR, fileName);
      let finalPath = null;
      if (fs.existsSync(soundPath)) {
        finalPath = soundPath;
      } else {
        const resourcePath = app.isPackaged
          ? path.join(process.resourcesPath, 'sounds', fileName)
          : path.join(__dirname, '..', 'sounds', fileName);
        if (fs.existsSync(resourcePath)) finalPath = resourcePath;
      }
      if (finalPath) {
        playSoundSilent(finalPath);
      } else {
        logger.error(`[WEBVIEW_CONSOLE] Sound file not found: ${fileName}`);
      }
    }
  });
  
  webContents.on('ipc-message', (event, channel, ...args) => {
    if (channel === 'play-sound') {
      const soundType = args[0];
      const fileName = SOUND_MAP[soundType] || `${soundType}.mp3`;
      const soundPath = path.join(SOUNDS_DIR, fileName);
      let finalPath = null;
      if (fs.existsSync(soundPath)) {
        finalPath = soundPath;
      } else {
        const resourcePath = app.isPackaged
          ? path.join(process.resourcesPath, 'sounds', fileName)
          : path.join(__dirname, '..', 'sounds', fileName);
        if (fs.existsSync(resourcePath)) finalPath = resourcePath;
      }
      if (finalPath) playSoundSilent(finalPath);
    }
  });
  
  webContents.on('did-finish-load', () => {
    const injectCode = `
(function() {
  let ipcRenderer = null;
  try { if (typeof require !== 'undefined') { ipcRenderer = require('electron').ipcRenderer; } } catch (e) {}
  if (!ipcRenderer && window.ipcRenderer) ipcRenderer = window.ipcRenderer;
  
  window.ELECTRON_CUSTOM_SOUNDS_ENABLED = true;
  
  window.electronAPI = {
    playSound: (soundType) => {
      console.log('[electronAPI] playSound called:', soundType);
      if (ipcRenderer) {
        try { ipcRenderer.sendToHost('play-sound', soundType); return Promise.resolve(true); } catch (e) {}
      }
      window.postMessage({ type: 'ELECTRON_PLAY_SOUND', soundType: soundType, source: 'webview' }, '*');
      return Promise.resolve(true);
    }
  };
  
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'ELECTRON_PLAY_SOUND' && event.data.soundType) {
      console.log('[message listener] Received sound postMessage:', event.data.soundType);
    }
  });
})();`;
    webContents.executeJavaScript(injectCode).catch(() => {});
  });
}

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
            ? "default-src 'self'; script-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; style-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; img-src 'self' https://ns.fiber-gate.ru blob: data:; connect-src 'self' http://194.31.171.29:38592 https://ns.fiber-gate.ru wss://ns.fiber-gate.ru; media-src 'self' blob: data: https://ns.fiber-gate.ru; child-src 'self' https://ns.fiber-gate.ru blob:; frame-src 'self' https://ns.fiber-gate.ru blob:; worker-src 'self' blob:; font-src 'self' https://ns.fiber-gate.ru;"
            : "default-src 'self' https://ns.fiber-gate.ru; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://ns.fiber-gate.ru https://cdn.socket.io https://unpkg.com; style-src 'self' 'unsafe-inline' https://ns.fiber-gate.ru; img-src 'self' https://ns.fiber-gate.ru blob: data:; connect-src 'self' http://194.31.171.29:38592 https://ns.fiber-gate.ru wss://ns.fiber-gate.ru wss://*.fiber-gate.ru; media-src 'self' blob: data: https://ns.fiber-gate.ru; child-src 'self' https://ns.fiber-gate.ru blob:; frame-src 'self' https://ns.fiber-gate.ru blob:; worker-src 'self' blob: https://ns.fiber-gate.ru; font-src 'self' https://ns.fiber-gate.ru;"
        ],
        'X-Frame-Options': 'ALLOW-FROM file:// app://'
      }
    });
  };
  
  nsSession.webRequest.onHeadersReceived((details, callback) => applyCSP(details, callback, false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => applyCSP(details, callback, true));
  
  mainWindow = new BrowserWindow({
    width: 550, height: 650, minWidth: 300, minHeight: 500,
    title: 'Ночная стража: установщик аддонов',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, webviewTag: true, permissions: ['microphone']
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });
  
  //mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('close', (event) => {
  // Если приложение не завершается - сворачиваем в трей
  if (!app.isQuitting) {
    event.preventDefault();
    mainWindow.hide();
    
    // Показываем уведомление (опционально)
    if (tray) {
      tray.displayBalloon({
        title: 'Ночная стража',
        content: 'Приложение свернуто в трей',
        noSound: true
      });
    }
    
    logger.info('[APP] Minimized to tray');
  }
  
  return false;
});


mainWindow.on('closed', () => { 
  // При закрытии главного окна закрываем и оверлей
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  mainWindow = null; 
});  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    setupWebviewHandlers(webContents);
  });
  mainWindow.webContents.on('did-create-webview', (event, webContents) => {
    setupWebviewHandlers(webContents);
  });
}

function createTray() {
  if (tray) {
    logger.info('[TRAY] Tray already exists');
    return;
  }
  
  logger.info('[TRAY] Creating system tray...');
  
  let iconPath;
  let icon = null;
  
  // Пробуем разные пути
  const possiblePaths = [
    app.isPackaged ? path.join(process.resourcesPath, 'assets', 'icon.png') : null,
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(app.getAppPath(), 'assets', 'icon.png')
  ].filter(p => p !== null);
  
  logger.info('[TRAY] Checking paths:', possiblePaths);
  
  // Ищем существующий файл
  for (const p of possiblePaths) {
    logger.info(`[TRAY] Checking: ${p}`);
    if (fs.existsSync(p)) {
      iconPath = p;
      logger.info(`[TRAY] Found icon at: ${p}`);
      break;
    }
  }
  
  // Создаем трей
  try {
    if (iconPath) {
      tray = new Tray(iconPath);
      logger.info('[TRAY] Tray created with icon file');
    } else {
      // Создаем пустую иконку если файл не найден
      const { nativeImage } = require('electron');
      const emptyIcon = nativeImage.createEmpty();
      tray = new Tray(emptyIcon);
      logger.warn('[TRAY] Icon file not found, using empty icon');
    }
  } catch (err) {
    logger.error('[TRAY] Failed to create tray:', err.message);
    return;
  }
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Показать',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Оверлей',
      click: () => {
        if (!overlayWindow || overlayWindow.isDestroyed()) {
          createOverlayWindow();
        }
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.show();
          overlayWindow.focus();
          overlayWindow.webContents.send('focus-input');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Ночная стража');
  tray.setContextMenu(contextMenu);
  
// По клику (одинарному) показывать/скрывать окно
tray.on('click', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  } else {
    createWindow();
  }
});

  logger.info('[TRAY] System tray created successfully');
}
/**
 * Показывает системное уведомление
 * @param {string} title - Заголовок
 * @param {string} body - Текст уведомления
 */
function showSystemNotification(title, body) {
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: title,
            body: body,
            icon: path.join(__dirname, '../assets/icon.png'), // Убедитесь что иконка существует
            silent: false,
        });

        notification.on('click', () => {
            // Разворачиваем окно при клике на уведомление
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });

        notification.show();
    } else {
        logger.warn('Системные уведомления не поддерживаются');
    }
}
/**
 * Обновляет счетчик непрочитанных сообщений в трее
 * @param {number} count - Количество непрочитанных сообщений
 */
function updateTrayBadge(count) {
    if (!tray) return;
    
    unreadMessagesCount = count;
    
    if (count > 0) {
        // Устанавливаем текст счетчика поверх иконки
        tray.setTitle(count.toString());
        tray.setToolTip(`Ночная стража (непрочитано: ${count})`);
    } else {
        // Убираем текст, если все прочитано
        tray.setTitle('');
        tray.setToolTip('Ночная стража');
    }
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));
    createTray();
globalShortcut.register('CommandOrControl+Shift+O', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();  // ← ТУТ МОЖНО show() - юзер явно вызвал
      overlayWindow.focus(); // ← Явно даем фокус
      overlayWindow.webContents.send('focus-input');
    }
  } else {
    createOverlayWindow();
    // При создании по хоткею тоже даем фокус
    if (overlayWindow) {
      overlayWindow.show();
      overlayWindow.focus();
    }
  }
});
  
  const gamePathValid = await ensureGamePath();
  if (!gamePathValid) {
    logger.error('[APP] Invalid game path, quitting');
    app.quit();
    return;
  }
  addonManager.setGamePath(settings.getGamePath());
  createWindow();
  startRustHook();
  
  const savedHotkey = settings.getPTTHotkey();
  if (savedHotkey && Array.isArray(savedHotkey)) currentPTTHotkeyCodes = savedHotkey;
  try { await addonManager.loadAddons(); } catch (err) { logger.error('[APP] Failed to load addons:', err.message); }
  try { await addonManager.startupUpdateCheck(mainWindow); } catch (err) { logger.error('[STARTUP] Update check error:', err.message); }
  addonManager.startBackgroundChecker(mainWindow);
  soundsManager.autoDownloadBaseSounds().catch(err => logger.error('[SOUNDS] Auto-download failed:', err.message));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// В main.js добавьте обработку пинга от оверлея
ipcMain.on('overlay-ping', (event) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-pong');
  }
});

// Обработчик для обновления значка в трее (счетчик непрочитанных)
ipcMain.on('update-tray-badge', (event, count) => {
    logger.info(`[TRAY] Получен запрос на обновление счетчика: ${count}`);
    updateTrayBadge(count);
});

// Обработчик для показа уведомления
ipcMain.on('show-notification', (event, { title, body }) => {
    logger.info(`[NOTIFICATION] Получен запрос на показ уведомления: ${title}`);
    showSystemNotification(title, body);
});

app.on('window-all-closed', (event) => {
  // На Windows и Linux не выходим, а остаемся в трее
  if (process.platform !== 'darwin') {
    // Не вызываем app.quit(), просто предотвращаем выход
    event.preventDefault();
    logger.info('[APP] All windows closed, staying in tray');
  }
});
// В начале файла после переменных
app.isQuitting = false;

// В app.on('will-quit')
app.on('will-quit', () => { 
  app.isQuitting = true;
  
  stopRustHook(); 
  stopOverlay();
  
  // Убрать или закомментировать:
  // if (soundWindow && !soundWindow.isDestroyed()) {
  //   soundWindow.close();
  // }
  
  if (tray) {
    tray.destroy();
    tray = null;
  }
  
  globalShortcut.unregisterAll(); 
});

ipcMain.handle('load-addons', async () => {
  try { return await addonManager.loadAddons(); } catch (error) { logger.error('[IPC] load-addons error:', error.message); return {}; }
});

ipcMain.handle('toggle-addon', async (event, name, install) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    await addonManager.toggleAddon(name, install, mainWindow);
    return true;
  } catch (error) {
    logger.error(`[IPC] toggle-addon ${name} error:`, error.message);
    dialog.showErrorBox('Ошибка установки', error.message);
    return false;
  }
});

ipcMain.handle('launch-game', async () => {
  try { return await addonManager.launchGame(); } catch (error) { logger.error('[IPC] launch-game error:', error.message); return false; }
});

ipcMain.handle('check-game', async () => {
  try {
    const gamePath = settings.getGamePath();
    if (!gamePath) return false;
    return fs.existsSync(path.join(gamePath, 'Wow.exe'));
  } catch (error) { logger.error('[IPC] check-game error:', error.message); return false; }
});

ipcMain.handle('change-game-path', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выберите файл Wow.exe', properties: ['openFile'],
    filters: [{ name: 'Executable files', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return false;
  const selectedPath = path.dirname(result.filePaths[0]);
  if (!fs.existsSync(path.join(selectedPath, 'Wow.exe'))) {
    dialog.showErrorBox('Ошибка', 'Выбранный путь не содержит файл Wow.exe');
    return false;
  }
  settings.setGamePath(selectedPath);
  addonManager.setGamePath(selectedPath);
  return true;
});

ipcMain.on('open-logs-folder', () => { shell.openPath(path.join(app.getPath('userData'), 'logs')); });
ipcMain.on('go-back', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`file://${__dirname}/../renderer/index.html`); });

ipcMain.handle('start-key-capture', async () => { captureMode = true; capturedCodes.clear(); pressedKeys.clear(); return { success: true }; });
ipcMain.handle('stop-key-capture', async () => { captureMode = false; const codes = Array.from(capturedCodes); capturedCodes.clear(); return { success: true, codes }; });
ipcMain.handle('set-ptt-hotkey', async (event, codes) => {
  if (!Array.isArray(codes)) return { success: false, message: 'Invalid hotkey format' };
  currentPTTHotkeyCodes = codes;
  settings.setPTTHotkey(codes);
  pttActive = false;
  return { success: true };
});
ipcMain.handle('get-ptt-hotkey', async () => currentPTTHotkeyCodes);
ipcMain.handle('get-platform', async () => process.platform);

ipcMain.handle('clear-session-cache', async (event, partition) => {
  const sess = session.fromPartition(partition);
  await sess.clearCache();
  await sess.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'filesystem', 'indexeddb', 'localstorage'] });
  return true;
});

ipcMain.handle('execute-in-webview', async (event, { code }) => {
  if (!webviewWebContents || webviewWebContents.isDestroyed()) {
    throw new Error('WebView webContents not available');
  }
  try { return await webviewWebContents.executeJavaScript(code); } catch (error) { throw error; }
});

ipcMain.handle('open-external', async (event, url) => {
  if (!url || typeof url !== 'string') return false;
  try { await shell.openExternal(url); return true; } catch (err) { return false; }
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
  if (typeof text !== 'string') return false;
  try { clipboard.writeText(text); return true; } catch (error) { return false; }
});

ipcMain.handle('play-sound', async (event, soundType) => {
  const fileName = SOUND_MAP[soundType] || `${soundType}.mp3`;
  const soundPath = path.join(SOUNDS_DIR, fileName);
  let finalPath = null;
  if (fs.existsSync(soundPath)) {
    finalPath = soundPath;
  } else {
    const resourcePath = app.isPackaged
      ? path.join(process.resourcesPath, 'sounds', fileName)
      : path.join(__dirname, '..', 'sounds', fileName);
    if (fs.existsSync(resourcePath)) finalPath = resourcePath;
  }
  if (!finalPath) return false;
  playSoundSilent(finalPath);
  return true;
});

ipcMain.handle('select-sounds-folder', async () => {
  const result = await dialog.showOpenDialog({ title: 'Выберите папку со звуками', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('import-sounds', async (event, sourceFolder) => {
  if (!sourceFolder || !fs.existsSync(sourceFolder)) {
    return { success: false, error: 'Папка не найдена' };
  }
  const imported = [];
  const missing = [];
  for (const [soundType, fileName] of Object.entries(SOUND_MAP)) {
    const sourcePath = path.join(sourceFolder, fileName);
    const destPath = path.join(SOUNDS_DIR, fileName);
    if (fs.existsSync(sourcePath)) {
      try { await fs.copy(sourcePath, destPath, { overwrite: true }); imported.push(soundType); } catch (err) { missing.push({ soundType, error: err.message }); }
    } else { missing.push({ soundType, error: 'Файл не найден' }); }
  }
  return { success: true, imported, missing };
});

ipcMain.handle('get-sounds-status', async () => {
  const status = {};
  for (const [soundType, fileName] of Object.entries(SOUND_MAP)) {
    const soundPath = path.join(SOUNDS_DIR, fileName);
    status[soundType] = { fileName, exists: fs.existsSync(soundPath), path: soundPath };
  }
  return status;
});

ipcMain.on('open-sounds-folder', () => { shell.openPath(SOUNDS_DIR); });

ipcMain.handle('fetch-sounds-config', async () => {
  try { return await soundsManager.fetchSoundsConfig(); } catch (error) { throw error; }
});

ipcMain.handle('download-sounds-section', async (event, sectionName) => {
  try {
    const config = await soundsManager.fetchSoundsConfig();
    await soundsManager.downloadSection(sectionName, config, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sounds-download-progress', progress);
      }
    });
    return { success: true };
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('is-sounds-dir-empty', async () => {
  return await soundsManager.isSoundsDirEmpty();
});

ipcMain.on('overlay-input', (event, text) => {
  logger.info(`[OVERLAY] Input: ${text}`);
  sendToWebClient(text);
});

ipcMain.on('hide-overlay', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
});

ipcMain.handle('send-test-to-overlay', async () => {
  return sendToOverlay('message', { text: 'Тест' });
});
ipcMain.on('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});
ipcMain.handle('send-message-to-overlay', async (event, text) => {
  logger.info(`[OVERLAY] Received from chat: ${text}`);
  return sendToOverlay('message', { text });
});