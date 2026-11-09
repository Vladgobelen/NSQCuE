const { shell, app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./utils').setupLogging();

let webviewWebContents = null;

const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');
const OVERLAY_URL = 'https://100.126.188.12'; // Ваш локальный адрес

function getWebviewWebContents() { return webviewWebContents; }

// ───────────────────────────────────────────────────────────
//  Звуки
// ───────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────
//  Отправка сообщений в оверлей и веб-клиент
// ───────────────────────────────────────────────────────────
function sendToOverlay(type, data) {
    const { getOverlayWindow } = require('./window');
    const overlayWindow = getOverlayWindow();
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
            if (result) logger.info('[OVERLAY] Message sent to web client');
            else logger.warn('[OVERLAY] Input field not found');
        }).catch(err => logger.error('[OVERLAY] Error:', err.message));
    } catch (err) {
        logger.error('[OVERLAY] Failed:', err.message);
    }
}

// ───────────────────────────────────────────────────────────
//  Основной обработчик webview
// ───────────────────────────────────────────────────────────
function setupWebviewHandlers(webContents) {
    webviewWebContents = webContents;

    const isExternalUrl = (url) => {
        try {
            if (url.startsWith('file://')) return false;
            const urlObj = new URL(url);
            return urlObj.origin !== OVERLAY_URL;
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
            if (soundPath) playSoundSilent(soundPath);
            else logger.error(`[WEBVIEW_CONSOLE] Sound file not found: ${soundType}`);
        }

        if (message.startsWith('ELECTRON_NOTIFICATION:')) {
            try {
                const jsonStr = message.substring('ELECTRON_NOTIFICATION:'.length);
                const data = JSON.parse(jsonStr);
                logger.info(`[NOTIFICATION] Received from webview: ${data.title} - ${data.body}`);
                const { showCustomNotification } = require('./tray');
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
            if (soundPath) playSoundSilent(soundPath);
            else logger.error(`[WEBVIEW] Sound file not found: ${soundType}`);
        }
    });

    // ───────────────────────────────────────────────────────────
    //  Инъекция при загрузке страницы
    // ───────────────────────────────────────────────────────────
    webContents.on('did-finish-load', () => {
        // 1. Перехват localStorage для сохранения аккаунтов
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
                                if (existing >= 0) accounts[existing] = account;
                                else accounts.push(account);
                                localStorage.setItem('voicechat_accounts', JSON.stringify(accounts));
                            }
                        } catch (e) {}
                    }
                };
            })();
        `).catch(() => {});

        // 2. Инъекция NotificationCatcher и electronAPI
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
                            try { ipcRenderer.sendToHost('play-sound', soundType); return Promise.resolve(true); }
                            catch (e) { console.error('[electronAPI] ipcRenderer error:', e); }
                        }
                        window.postMessage({ type: 'ELECTRON_PLAY_SOUND', soundType: soundType, source: 'webview' }, '*');
                        return Promise.resolve(true);
                    },
                    showNotification: (title, body) => {
                        window.postMessage({ type: 'ELECTRON_SHOW_NOTIFICATION', title: title, body: body, source: 'webview' }, '*');
                    },
                    updateTrayBadge: (count) => {
                        window.postMessage({ type: 'ELECTRON_UPDATE_TRAY_BADGE', count: count, source: 'webview' }, '*');
                    }
                };

                if (window.__notificationObserver) window.__notificationObserver.disconnect();

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
                                pendingNotification = { sender: data.sender || data.username || '', text: data.text || '', roomName: data.roomName || '' };
                                if (notificationTimer) clearTimeout(notificationTimer);
                                notificationTimer = setTimeout(() => { pendingNotification = null; }, 5000);
                            }
                            return window.voiceClient.socket.__originalOnevent.call(this, packet);
                        };
                        return true;
                    }
                    return false;
                }

                function tryHookVoiceClient(attempts) {
                    attempts = attempts || 0;
                    if (attempts > 30) return;
                    if (!hookVoiceClient()) setTimeout(() => tryHookVoiceClient(attempts + 1), 1000);
                }

                function sendNotification(data) {
                    const notificationId = data.sender + '|' + data.text + '|' + data.roomName;
                    if (lastProcessedId === notificationId) return;
                    lastProcessedId = notificationId;
                    console.log('ELECTRON_NOTIFICATION:' + JSON.stringify({ title: data.sender, body: data.text }));
                    window.postMessage({ type: 'ELECTRON_SHOW_NOTIFICATION', title: data.sender, body: data.text, source: 'webview' }, '*');
                    setTimeout(() => { lastProcessedId = null; }, 2000);
                }

                window.__notificationObserver = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.id === 'live-notification-banner') {
                                if (processingTimeout) clearTimeout(processingTimeout);
                                processingTimeout = setTimeout(() => {
                                    const strongEl = node.querySelector('strong');
                                    const domAuthor = strongEl?.textContent?.trim() || '';
                                    if (pendingNotification) {
                                        sendNotification(pendingNotification);
                                        pendingNotification = null;
                                    } else {
                                        const spanEl = node.querySelector('span[style*="opacity"]');
                                        const domAction = spanEl?.textContent?.trim() || '';
                                        if (domAuthor && domAction) sendNotification({ sender: domAuthor, text: domAction, roomName: '' });
                                    }
                                    if (notificationTimer) { clearTimeout(notificationTimer); notificationTimer = null; }
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

module.exports = {
    setupWebviewHandlers,
    getWebviewWebContents,
    findSoundFile,
    playSoundSilent,
    sendToOverlay,
    sendToWebClient
};