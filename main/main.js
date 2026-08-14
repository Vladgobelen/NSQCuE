const { app, BrowserWindow, ipcMain, shell, dialog, session, globalShortcut, Menu, clipboard, Tray } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const addonManager = require('./addonManager');
const settings = require('./settings');
const soundsManager = require('./soundsManager');
const { setupLogging } = require('./utils');
const logger = setupLogging();

// ✅ Изменение 3: Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // Уже запущен другой экземпляр — выходим
    app.quit();
} else {
    // Слушаем попытки запуска второго экземпляра
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    let notificationsEnabled = true;
    let mainWindow;
    let overlayWindow = null;
    let notificationWindow = null;
    let notificationQueue = [];
    let isNotificationShowing = false;
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
    const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
    app.isQuitting = false;
    fs.ensureDirSync(SOUNDS_DIR);

    function loadAccountsFromStorage() {
        try {
            if (fs.existsSync(ACCOUNTS_FILE)) {
                return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
            }
        } catch (e) {
            logger.error('[ACCOUNTS] Failed to load:', e.message);
        }
        return { accounts: [], lastUser: null, lastCredentials: null };
    }

    function saveAccountsToStorage(data) {
        try {
            fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            logger.error('[ACCOUNTS] Failed to save:', e.message);
        }
    }

    function getSoundsMap() {
        const map = {};
        try {
            if (fs.existsSync(SOUNDS_DIR)) {
                const files = fs.readdirSync(SOUNDS_DIR);
                for (const file of files) {
                    if (file.toLowerCase().endsWith('.mp3')) {
                        const nameWithoutExt = file.replace(/\.mp3$/i, '');
                        map[nameWithoutExt] = file;
                    }
                }
            }
        } catch (e) {
            logger.error('[SOUNDS] Error reading sounds dir:', e.message);
        }
        return map;
    }

    function findSoundFile(soundType) {
        const soundMap = getSoundsMap();
        const fileName = soundMap[soundType];
        if (fileName) {
            const soundPath = path.join(SOUNDS_DIR, fileName);
            if (fs.existsSync(soundPath)) return soundPath;
        }
        const directPath = path.join(SOUNDS_DIR, `${soundType}.mp3`);
        if (fs.existsSync(directPath)) return directPath;
        const resourcePath = app.isPackaged
            ? path.join(process.resourcesPath, 'sounds', `${soundType}.mp3`)
            : path.join(__dirname, '..', 'sounds', `${soundType}.mp3`);
        if (fs.existsSync(resourcePath)) return resourcePath;
        return null;
    }

    function playSoundSilent(filePath) {
        if (!fs.existsSync(filePath)) {
            logger.error(`[SOUND] File not found: ${filePath}`);
            return;
        }
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
            overlayWindow.show();
            return;
        }

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
                contextIsolation: false
            }
        });

        overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));

        overlayWindow.on('closed', () => {
            overlayWindow = null;
        });
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
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('overlay-message', data.text);
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

        webContents.on('did-fail-load', (e, code, desc) => {
            logger.error(`[WEBVIEW] Failed: ${code} - ${desc}`);
        });

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
                const soundPath = findSoundFile(soundType);
                if (soundPath) {
                    playSoundSilent(soundPath);
                } else {
                    logger.error(`[WEBVIEW_CONSOLE] Sound file not found: ${soundType}`);
                }
            }

            if (message.startsWith('ELECTRON_NOTIFICATION:')) {
                try {
                    const jsonStr = message.substring('ELECTRON_NOTIFICATION:'.length);
                    const data = JSON.parse(jsonStr);
                    logger.info(`[NOTIFICATION] Received from webview: ${data.title} - ${data.body}`);
                    showCustomNotification(data.title, data.body);
                } catch (e) {
                    logger.error('[NOTIFICATION] Parse error:', e.message);
                }
            }

            if (message.includes('[CHAT] Sending to overlay:')) {
                const match = message.match(/Sending to overlay:\s*(.+)$/);
                if (match) {
                    const text = match[1].trim();
                    logger.info(`[CHAT] Captured for overlay: ${text}`);
                    sendToOverlay('message', { text });
                }
            }
        });

        webContents.on('ipc-message', (event, channel, ...args) => {
            if (channel === 'play-sound') {
                const soundType = args[0];
                const soundPath = findSoundFile(soundType);
                if (soundPath) {
                    playSoundSilent(soundPath);
                } else {
                    logger.error(`[WEBVIEW] Sound file not found: ${soundType}`);
                }
            }
        });

        webContents.on('did-finish-load', () => {
            webContents.executeJavaScript(`
                (function() {
                    var originalSetItem = localStorage.setItem;
                    localStorage.setItem = function(key, value) {
                        originalSetItem.call(this, key, value);
                        if (key === 'voicechat_lastuser' && value) {
                            try {
                                var accountData = JSON.parse(value);
                                if (accountData && accountData.userId && accountData.token) {
                                    var accounts = JSON.parse(localStorage.getItem('voicechat_accounts') || '[]');
                                    var existing = accounts.findIndex(function(a) { return a.userId === accountData.userId; });
                                    var account = {
                                        username: accountData.username,
                                        userId: accountData.userId,
                                        token: accountData.token,
                                        tokenVersion: accountData.tokenVersion,
                                        avatarUrl: accountData.avatarUrl || null,
                                        lastLogin: new Date().toISOString()
                                    };
                                    if (existing >= 0) {
                                        accounts[existing] = account;
                                    } else {
                                        accounts.push(account);
                                    }
                                    localStorage.setItem('voicechat_accounts', JSON.stringify(accounts));
                                }
                            } catch (e) {}
                        }
                    };
                })();
            `).catch(() => {});

            const injectCode = `
                (function() {
                    console.log('[NotificationCatcher] Starting...');
                    let ipcRenderer = null;
                    try { if (typeof require !== 'undefined') { ipcRenderer = require('electron').ipcRenderer; } } catch (e) {}
                    if (!ipcRenderer && window.ipcRenderer) ipcRenderer = window.ipcRenderer;

                    window.ELECTRON_CUSTOM_SOUNDS_ENABLED = true;
                    window.electronAPI = {
                        playSound: (soundType) => {
                            console.log('[electronAPI] playSound called:', soundType);
                            if (ipcRenderer) {
                                try {
                                    ipcRenderer.sendToHost('play-sound', soundType);
                                    return Promise.resolve(true);
                                } catch (e) {
                                    console.error('[electronAPI] ipcRenderer error:', e);
                                }
                            }
                            window.postMessage({ type: 'ELECTRON_PLAY_SOUND', soundType: soundType, source: 'webview' }, '*');
                            return Promise.resolve(true);
                        },
                        showNotification: (title, body) => {
                            console.log('[electronAPI] showNotification:', title);
                            window.postMessage({
                                type: 'ELECTRON_SHOW_NOTIFICATION',
                                title: title,
                                body: body,
                                source: 'webview'
                            }, '*');
                        },
                        updateTrayBadge: (count) => {
                            console.log('[electronAPI] updateTrayBadge:', count);
                            window.postMessage({
                                type: 'ELECTRON_UPDATE_TRAY_BADGE',
                                count: count,
                                source: 'webview'
                            }, '*');
                        }
                    };

                    window.addEventListener('message', (event) => {
                        if (event.data && event.data.type === 'ELECTRON_PLAY_SOUND' && event.data.soundType) {
                            console.log('[message listener] Received sound postMessage:', event.data.soundType);
                        }
                    });

                    if (window.__notificationObserver) {
                        window.__notificationObserver.disconnect();
                    }

                    let pendingNotification = null;
                    let notificationTimer = null;
                    let lastProcessedId = null;
                    let processingTimeout = null;

                    function hookVoiceClient() {
                        if (window.voiceClient && window.voiceClient.socket) {
                            if (!window.voiceClient.socket.__originalOnevent) {
                                window.voiceClient.socket.__originalOnevent = window.voiceClient.socket.onevent;
                            }
                            window.voiceClient.socket.onevent = function(packet) {
                                const event = packet.data[0];
                                const data = packet.data[1];
                                if (event === 'personal-notification') {
                                    console.log('[NotificationCatcher] Personal notification:', data.sender, data.text);
                                    pendingNotification = {
                                        sender: data.sender || data.username || '',
                                        text: data.text || '',
                                        roomName: data.roomName || ''
                                    };
                                    if (notificationTimer) clearTimeout(notificationTimer);
                                    notificationTimer = setTimeout(() => {
                                        pendingNotification = null;
                                    }, 5000);
                                }
                                return window.voiceClient.socket.__originalOnevent.call(this, packet);
                            };
                            console.log('[NotificationCatcher] Socket hooked');
                            return true;
                        }
                        return false;
                    }

                    function tryHookVoiceClient(attempts) {
                        attempts = attempts || 0;
                        if (attempts > 30) {
                            console.log('[NotificationCatcher] Failed to hook voiceClient after 30 attempts');
                            return;
                        }
                        if (!hookVoiceClient()) {
                            setTimeout(() => tryHookVoiceClient(attempts + 1), 1000);
                        }
                    }

                    function sendNotification(data) {
                        const notificationId = data.sender + '|' + data.text + '|' + data.roomName;
                        if (lastProcessedId === notificationId) {
                            console.log('[NotificationCatcher] Skipping duplicate');
                            return;
                        }
                        lastProcessedId = notificationId;
                        const title = data.sender;
                        const body = data.text;
                        console.log('ELECTRON_NOTIFICATION:' + JSON.stringify({ title, body }));
                        console.log('[NotificationCatcher] Sent:', { title, body });
                        window.postMessage({
                            type: 'ELECTRON_SHOW_NOTIFICATION',
                            title: title,
                            body: body,
                            source: 'webview'
                        }, '*');
                        setTimeout(() => { lastProcessedId = null; }, 2000);
                    }

                    window.__notificationObserver = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            for (const node of mutation.addedNodes) {
                                if (node.id === 'live-notification-banner') {
                                    console.log('[NotificationCatcher] Banner detected!');
                                    if (processingTimeout) clearTimeout(processingTimeout);
                                    processingTimeout = setTimeout(() => {
                                        const strongEl = node.querySelector('strong');
                                        const domAuthor = strongEl?.textContent?.trim() || '';
                                        if (pendingNotification) {
                                            sendNotification({
                                                sender: pendingNotification.sender,
                                                text: pendingNotification.text,
                                                roomName: pendingNotification.roomName
                                            });
                                            pendingNotification = null;
                                        } else {
                                            const spanEl = node.querySelector('span[style*="opacity"]');
                                            const domAction = spanEl?.textContent?.trim() || '';
                                            if (domAuthor && domAction) {
                                                sendNotification({
                                                    sender: domAuthor,
                                                    text: domAction,
                                                    roomName: ''
                                                });
                                            }
                                        }
                                        if (notificationTimer) {
                                            clearTimeout(notificationTimer);
                                            notificationTimer = null;
                                        }
                                        processingTimeout = null;
                                    }, 100);
                                }
                            }
                        }
                    });

                    window.__notificationObserver.observe(document.body, { childList: true, subtree: true });

                    const chatObserver = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            for (const node of mutation.addedNodes) {
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    const messageSelectors = ['.message', '.chat-message', '.msg', '[data-message]'];
                                    for (const selector of messageSelectors) {
                                        if (node.matches && node.matches(selector)) {
                                            const textElement = node.querySelector('.message-text');
                                            const usernameElement = node.querySelector('.message-username');
                                            const text = textElement?.textContent?.trim() || '';
                                            const username = usernameElement?.textContent?.trim() || '';
                                            if (text && text !== '🔴 Отключен' && text !== '🟢 Подключен') {
                                                const fullMessage = username ? username + ': ' + text : text;
                                                console.log('[CHAT] Sending to overlay:', fullMessage);
                                                window.postMessage({ type: 'CHAT_MESSAGE', text: fullMessage, source: 'webview' }, '*');
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    });

                    chatObserver.observe(document.body, { childList: true, subtree: true });
                    tryHookVoiceClient();
                    console.log('[NotificationCatcher] Ready!');
                })();
            `;

            webContents.executeJavaScript(injectCode).catch((err) => {
                logger.error('[WEBVIEW] Failed to inject NotificationCatcher:', err.message);
            });
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

        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

        mainWindow.on('close', (event) => {
            if (!app.isQuitting) {
                event.preventDefault();
                mainWindow.hide();
                if (tray) {
                    tray.displayBalloon({
                        title: 'Ночная стража',
                        content: 'Приложение свернуто в трей',
                        noSound: true
                    });
                }
            }
            return false;
        });

        mainWindow.on('closed', () => {
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.close();
            }
            mainWindow = null;
        });

        mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
            setupWebviewHandlers(webContents);
        });

        mainWindow.webContents.on('did-create-webview', (event, webContents) => {
            setupWebviewHandlers(webContents);
        });
    }

    function createTray() {
        if (tray) return;

        let iconPath;
        const possiblePaths = [
            app.isPackaged ? path.join(process.resourcesPath, 'assets', 'icon.png') : null,
            path.join(__dirname, '..', 'assets', 'icon.png'),
            path.join(__dirname, 'assets', 'icon.png'),
            path.join(app.getAppPath(), 'assets', 'icon.png')
        ].filter(p => p !== null);

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
                const { nativeImage } = require('electron');
                const emptyIcon = nativeImage.createEmpty();
                tray = new Tray(emptyIcon);
            }
        } catch (err) {
            logger.error('[TRAY] Failed to create tray:', err.message);
            return;
        }

        updateTrayMenu();

        tray.on('click', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                    mainWindow.focus();
                    if (tray) {
                        tray.setTitle('');
                        unreadMessagesCount = 0;
                    }
                }
            } else {
                createWindow();
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
                label: 'Позиция уведомлений',
                submenu: [
                    { label: '↖ Слева вверху', type: 'radio', checked: currentPos === 'top-left',
                      click: () => { settings.setNotificationPosition('top-left'); } },
                    { label: '↑ Вверху', type: 'radio', checked: currentPos === 'top',
                      click: () => { settings.setNotificationPosition('top'); } },
                    { label: '↗ Справа вверху', type: 'radio', checked: currentPos === 'top-right',
                      click: () => { settings.setNotificationPosition('top-right'); } },
                    { label: '→ Справа', type: 'radio', checked: currentPos === 'right',
                      click: () => { settings.setNotificationPosition('right'); } },
                    { label: '↘ Снизу справа', type: 'radio', checked: currentPos === 'bottom-right',
                      click: () => { settings.setNotificationPosition('bottom-right'); } },
                    { label: '↓ Снизу', type: 'radio', checked: currentPos === 'bottom',
                      click: () => { settings.setNotificationPosition('bottom'); } },
                    { label: '↙ Снизу слева', type: 'radio', checked: currentPos === 'bottom-left',
                      click: () => { settings.setNotificationPosition('bottom-left'); } },
                    { label: '← Слева', type: 'radio', checked: currentPos === 'left',
                      click: () => { settings.setNotificationPosition('left'); } }
                ]
            },
            { type: 'separator' },
            {
                label: '🔔 Уведомления включены',
                type: 'checkbox',
                checked: notificationsEnabled,
                click: (menuItem) => {
                    notificationsEnabled = menuItem.checked;
                    menuItem.label = notificationsEnabled ? '🔔 Уведомления включены' : '🔕 Уведомления выключены';
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
    }

    function createNotificationWindow() {
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            return notificationWindow;
        }

        const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
        const position = settings.getNotificationPosition();
        const winWidth = 300;
        const winHeight = 60;
        const margin = 15;
        let x, y;

        const posMap = {
            'top-left':      { x: margin, y: margin },
            'top':           { x: (width - winWidth) / 2, y: margin },
            'top-right':     { x: width - winWidth - margin, y: margin },
            'right':         { x: width - winWidth - margin, y: (height - winHeight) / 2 },
            'bottom-right':  { x: width - winWidth - margin, y: height - winHeight - margin - 40 },
            'bottom':        { x: (width - winWidth) / 2, y: height - winHeight - margin - 40 },
            'bottom-left':   { x: margin, y: height - winHeight - margin - 40 },
            'left':          { x: margin, y: (height - winHeight) / 2 }
        };

        const coords = posMap[position] || posMap['top-right'];
        x = coords.x;
        y = coords.y;

        notificationWindow = new BrowserWindow({
            width: winWidth,
            height: winHeight,
            x, y,
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
                contextIsolation: false
            }
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
        if (!isNotificationShowing) {
            showNextNotification();
        }
    }

    function showNextNotification() {
        if (notificationQueue.length === 0) {
            isNotificationShowing = false;
            return;
        }

        const { title, body } = notificationQueue.shift();
        const win = createNotificationWindow();
        isNotificationShowing = true;

        win.webContents.once('did-finish-load', () => {
            win.webContents.send('show-notification', { title, body });
            win.showInactive();

            setTimeout(() => {
                if (win && !win.isDestroyed()) {
                    win.close();
                }
            }, 5000);
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

    app.whenReady().then(async () => {
        Menu.setApplicationMenu(null);
        fs.ensureDirSync(path.join(app.getPath('userData'), 'logs'));
        createTray();

        globalShortcut.register('CommandOrControl+Shift+O', () => {
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
        addonManager.setMainWindow(mainWindow);
        startRustHook();

        const savedHotkey = settings.getPTTHotkey();
        if (savedHotkey && Array.isArray(savedHotkey)) currentPTTHotkeyCodes = savedHotkey;

        try { await addonManager.loadAddons(); } catch (err) { logger.error('[APP] Failed to load addons:', err.message); }
        try { await addonManager.startupUpdateCheck(mainWindow); } catch (err) { logger.error('[STARTUP] Update check error:', err.message); }
        addonManager.startBackgroundChecker(mainWindow);
        soundsManager.autoDownloadBaseSounds().catch(err => logger.error('[SOUNDS] Auto-download failed:', err.message));

        app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    });

    ipcMain.on('overlay-ping', (event) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('overlay-pong');
        }
    });

    ipcMain.on('update-tray-badge', (event, count) => {
        updateTrayBadge(count);
    });

    ipcMain.on('show-notification', (event, title, body) => {
        showCustomNotification(title, body);
    });

    ipcMain.on('show-notification-from-webview', (event, title, body) => {
        showCustomNotification(title, body);
    });

    ipcMain.on('update-tray-badge-from-webview', (event, count) => {
        const num = parseInt(count, 10) || 0;
        updateTrayBadge(num);
    });

    ipcMain.on('close-notification-window', () => {
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            notificationWindow.close();
        }
    });

    ipcMain.on('notification-clicked', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        } else {
            createWindow();
        }
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
        var savedAccounts = null;
        var savedLastUser = null;

        if (webviewWebContents && !webviewWebContents.isDestroyed()) {
            try {
                var result = await webviewWebContents.executeJavaScript(`
                    (function() {
                        return {
                            accounts: localStorage.getItem('voicechat_accounts'),
                            lastUser: localStorage.getItem('voicechat_lastuser')
                        };
                    })();
                `);
                savedAccounts = result.accounts;
                savedLastUser = result.lastUser;
            } catch (e) {}
        }

        await sess.clearCache();
        await sess.clearStorageData({
            storages: ['cachestorage', 'serviceworkers', 'filesystem', 'indexeddb', 'localstorage']
        });

        if (webviewWebContents && !webviewWebContents.isDestroyed() && (savedAccounts || savedLastUser)) {
            webviewWebContents.once('dom-ready', () => {
                var code = `
                    (function() {
                        var accounts = '${savedAccounts || '[]'}';
                        var lastUser = '${savedLastUser || 'null'}';
                        if (accounts !== '[]') localStorage.setItem('voicechat_accounts', accounts);
                        if (lastUser !== 'null') localStorage.setItem('voicechat_lastuser', lastUser);
                    })();
                `;
                webviewWebContents.executeJavaScript(code).catch(() => {});
            });
        }
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
        const soundPath = findSoundFile(soundType);
        if (!soundPath) return false;
        playSoundSilent(soundPath);
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
        const files = fs.readdirSync(sourceFolder);
        const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        for (const file of mp3Files) {
            const sourcePath = path.join(sourceFolder, file);
            const destPath = path.join(SOUNDS_DIR, file);
            const soundType = file.replace(/\.mp3$/i, '');
            try {
                await fs.copy(sourcePath, destPath, { overwrite: true });
                imported.push(soundType);
            } catch (err) {
                missing.push({ soundType, error: err.message });
            }
        }
        return { success: true, imported, missing };
    });

    ipcMain.handle('get-sounds-status', async () => {
        const status = {};
        const soundMap = getSoundsMap();
        for (const [soundType, fileName] of Object.entries(soundMap)) {
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
        return sendToOverlay('message', { text });
    });

    ipcMain.handle('load-credentials', async () => {
        const data = loadAccountsFromStorage();
        return data.lastCredentials || null;
    });

    ipcMain.handle('save-credentials', async (event, username, password) => {
        const data = loadAccountsFromStorage();
        data.lastCredentials = { username, password };
        saveAccountsToStorage(data);
        return true;
    });

    ipcMain.handle('delete-credentials', async () => {
        const data = loadAccountsFromStorage();
        delete data.lastCredentials;
        saveAccountsToStorage(data);
        return true;
    });

    ipcMain.handle('get-accounts', async () => {
        const data = loadAccountsFromStorage();
        return { accounts: data.accounts || [], current: data.lastUser };
    });

    ipcMain.handle('switch-account', async (event, userId) => {
        const data = loadAccountsFromStorage();
        const account = data.accounts?.find(a => a.userId === userId);
        if (account) {
            data.lastUser = account;
            saveAccountsToStorage(data);
            if (webviewWebContents && !webviewWebContents.isDestroyed()) {
                webviewWebContents.executeJavaScript(`
                    (function() {
                        localStorage.setItem('voicechat_lastuser', JSON.stringify(${JSON.stringify(account)}));
                        location.reload();
                    })();
                `);
            }
        }
        return true;
    });

    ipcMain.on('save-account-from-webview', (event, accountData) => {
        const data = loadAccountsFromStorage();
        const accounts = data.accounts || [];
        const existing = accounts.findIndex(a => a.userId === accountData.userId);
        const account = {
            ...accountData,
            lastLogin: new Date().toISOString()
        };
        if (existing >= 0) {
            accounts[existing] = account;
        } else {
            accounts.push(account);
        }
        data.accounts = accounts;
        data.lastUser = account;
        saveAccountsToStorage(data);
    });

    app.on('window-all-closed', (event) => {
        if (process.platform !== 'darwin') {
            event.preventDefault();
        }
    });

    app.on('will-quit', () => {
        app.isQuitting = true;
        stopRustHook();
        stopOverlay();
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            notificationWindow.close();
        }
        if (tray) {
            tray.destroy();
            tray = null;
        }
        globalShortcut.unregisterAll();
    });
}