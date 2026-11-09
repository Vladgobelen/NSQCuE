const { ipcMain, dialog, shell, app, clipboard } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const settings = require('./settings');
const logger = require('./utils').setupLogging();
const addonManager = require('./addonManager');
const soundsManager = require('./soundsManager');

const { getMainWindow, getOverlayWindow, createOverlayWindow, stopOverlay } = require('./window');
const { getTray, showCustomNotification, updateTrayBadge, closeNotificationWindow } = require('./tray');
const { getWebviewWebContents, findSoundFile, playSoundSilent, sendToOverlay, sendToWebClient } = require('./webview');

const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');
const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');

let currentPTTHotkeyCodes = null;
let captureMode = false;
let pttActive = false;
const capturedCodes = new Set();
const pressedKeys = new Map();

// ───────────────────────────────────────────────────────────
//  Аккаунты (файл)
// ───────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────
//  Регистрация всех обработчиков
// ───────────────────────────────────────────────────────────
function registerIpcHandlers() {
    // ── Уведомления / трей ──────────────────────────────────
    ipcMain.on('overlay-ping', () => {
        const overlayWindow = getOverlayWindow();
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('overlay-pong');
        }
    });

    ipcMain.on('update-tray-badge', (event, count) => updateTrayBadge(count));
    ipcMain.on('show-notification', (event, title, body) => showCustomNotification(title, body));
    ipcMain.on('show-notification-from-webview', (event, title, body) => showCustomNotification(title, body));
    ipcMain.on('update-tray-badge-from-webview', (event, count) => updateTrayBadge(parseInt(count, 10) || 0));
    ipcMain.on('close-notification-window', () => closeNotificationWindow());
    ipcMain.on('notification-clicked', () => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // ── Аддоны ──────────────────────────────────────────────
    ipcMain.handle('load-addons', async () => {
        try { return await addonManager.loadAddons(); }
        catch (error) { logger.error('[IPC] load-addons error:', error.message); return {}; }
    });

    ipcMain.handle('toggle-addon', async (event, name, install) => {
        try {
            const mainWindow = getMainWindow();
            if (!mainWindow || mainWindow.isDestroyed()) return false;
            await addonManager.toggleAddon(name, install, mainWindow);
            return true;
        } catch (error) {
            logger.error(`[IPC] toggle-addon ${name} error:`, error.message);
            dialog.showErrorBox('Ошибка установки', error.message);
            return false;
        }
    });

    ipcMain.handle('cancel-download', async (event, name) => {
        try { addonManager.cancelDownload(name); return true; }
        catch (error) { logger.error(`[IPC] cancel-download ${name} error:`, error.message); return false; }
    });

    ipcMain.handle('launch-game', async () => {
        try { return await addonManager.launchGame(); }
        catch (error) { logger.error('[IPC] launch-game error:', error.message); return false; }
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
            title: 'Выберите файл Wow.exe',
            properties: ['openFile'],
            filters: [{ name: 'Executable files', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }],
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

    ipcMain.on('open-logs-folder', () => shell.openPath(path.join(app.getPath('userData'), 'logs')));
    ipcMain.on('go-back', () => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`file://${__dirname}/../renderer/index.html`);
    });

    // ── PTT / Хоткеи ────────────────────────────────────────
    ipcMain.handle('start-key-capture', async () => {
        captureMode = true; capturedCodes.clear(); pressedKeys.clear();
        return { success: true };
    });

    ipcMain.handle('stop-key-capture', async () => {
        captureMode = false;
        const codes = Array.from(capturedCodes);
        capturedCodes.clear();
        return { success: true, codes };
    });

    ipcMain.handle('set-ptt-hotkey', async (event, codes) => {
        if (!Array.isArray(codes)) return { success: false, message: 'Invalid hotkey format' };
        currentPTTHotkeyCodes = codes;
        settings.setPTTHotkey(codes);
        pttActive = false;
        return { success: true };
    });

    ipcMain.handle('get-ptt-hotkey', async () => currentPTTHotkeyCodes);
    ipcMain.handle('get-platform', async () => process.platform);

    // ── Webview / Session ───────────────────────────────────
    ipcMain.handle('clear-session-cache', async (event, partition) => {
        const { session } = require('electron');
        const sess = session.fromPartition(partition);
        let savedAccounts = null;
        let savedLastUser = null;
        const webviewWebContents = getWebviewWebContents();

        if (webviewWebContents && !webviewWebContents.isDestroyed()) {
            try {
                const result = await webviewWebContents.executeJavaScript(`
                    (function() {
                        return { accounts: localStorage.getItem('voicechat_accounts'), lastUser: localStorage.getItem('voicechat_lastuser') };
                    })();
                `);
                savedAccounts = result.accounts;
                savedLastUser = result.lastUser;
            } catch {}
        }

        await sess.clearCache();
        await sess.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'filesystem', 'indexeddb', 'localstorage'] });

        if (webviewWebContents && !webviewWebContents.isDestroyed() && (savedAccounts || savedLastUser)) {
            webviewWebContents.once('dom-ready', () => {
                const code = `
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
        const webviewWebContents = getWebviewWebContents();
        if (!webviewWebContents || webviewWebContents.isDestroyed()) throw new Error('WebView webContents not available');
        return await webviewWebContents.executeJavaScript(code);
    });

    ipcMain.handle('open-external', async (event, url) => {
        if (!url || typeof url !== 'string') return false;
        try { await shell.openExternal(url); return true; } catch { return false; }
    });

    ipcMain.handle('copy-to-clipboard', (event, text) => {
        if (typeof text !== 'string') return false;
        try { clipboard.writeText(text); return true; } catch { return false; }
    });

    // ── Звуки ───────────────────────────────────────────────
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
        if (!sourceFolder || !fs.existsSync(sourceFolder)) return { success: false, error: 'Папка не найдена' };
        const imported = [];
        const missing = [];
        const files = fs.readdirSync(sourceFolder);
        const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        for (const file of mp3Files) {
            const sourcePath = path.join(sourceFolder, file);
            const destPath = path.join(SOUNDS_DIR, file);
            const soundType = file.replace(/\.mp3$/i, '');
            try { await fs.copy(sourcePath, destPath, { overwrite: true }); imported.push(soundType); }
            catch (err) { missing.push({ soundType, error: err.message }); }
        }
        return { success: true, imported, missing };
    });

    ipcMain.handle('get-sounds-status', async () => {
        const status = {};
        const webviewWebContents = getWebviewWebContents();
        // Здесь можно использовать getSoundsMap из webview.js, но для простоты дублируем логику
        const { getSoundsMap } = require('./webview');
        const soundMap = getSoundsMap();
        for (const [soundType, fileName] of Object.entries(soundMap)) {
            const soundPath = path.join(SOUNDS_DIR, fileName);
            status[soundType] = { fileName, exists: fs.existsSync(soundPath), path: soundPath };
        }
        return status;
    });

    ipcMain.on('open-sounds-folder', () => shell.openPath(SOUNDS_DIR));

    ipcMain.handle('fetch-sounds-config', async () => {
        try { return await soundsManager.fetchSoundsConfig(); }
        catch (error) { throw error; }
    });

    ipcMain.handle('download-sounds-section', async (event, sectionName) => {
        try {
            const config = await soundsManager.fetchSoundsConfig();
            await soundsManager.downloadSection(sectionName, config, (progress) => {
                const mainWindow = getMainWindow();
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sounds-download-progress', progress);
            });
            return { success: true };
        } catch (error) { throw error; }
    });

    ipcMain.handle('is-sounds-dir-empty', async () => {
        return await soundsManager.isSoundsDirEmpty();
    });

    // ── Оверлей ─────────────────────────────────────────────
    ipcMain.on('overlay-input', (event, text) => sendToWebClient(text));
    ipcMain.on('hide-overlay', () => {
        const overlayWindow = getOverlayWindow();
        if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    });

    ipcMain.handle('send-test-to-overlay', async () => sendToOverlay('message', { text: 'Тест' }));
    ipcMain.on('quit-app', () => { app.isQuitting = true; app.quit(); });
    ipcMain.handle('send-message-to-overlay', async (event, text) => sendToOverlay('message', { text }));

    // ── Аккаунты ────────────────────────────────────────────
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
            const webviewWebContents = getWebviewWebContents();
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
        const account = { ...accountData, lastLogin: new Date().toISOString() };
        if (existing >= 0) accounts[existing] = account;
        else accounts.push(account);
        data.accounts = accounts;
        data.lastUser = account;
        saveAccountsToStorage(data);
    });
}

module.exports = {
    registerIpcHandlers,
    loadAccountsFromStorage,
    saveAccountsToStorage,
    // Экспортируем для доступа из main.js (хоткеи)
    getPTTState: () => ({ currentPTTHotkeyCodes, captureMode, pttActive }),
    setPTTCaptureMode: (val) => { captureMode = val; },
    setPTTActive: (val) => { pttActive = val; },
    getCapturedCodes: () => capturedCodes,
    getPressedKeys: () => pressedKeys
};