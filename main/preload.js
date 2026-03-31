const { contextBridge, ipcRenderer } = require('electron');

// === Мост между Electron и веб-клиентом ===
function sendToWebClient(channel, data) {
    const frame = document.getElementById('ns-webview');
    if (frame?.contentWindow) {
        loggerDebug(`[preload] sendToWebClient: channel=${channel}`);
        frame.contentWindow.postMessage(
            { channel, data, source: 'electron' },
            'https://ns.fiber-gate.ru'
        );
    } else {
        loggerDebug(`[preload] sendToWebClient: webview not found`);
    }
}

function listenFromWebClient(channel, callback) {
    const handler = (event) => {
        if (event.origin !== 'https://ns.fiber-gate.ru') return;
        if (event.data?.channel === channel && event.data?.source === 'webclient') {
            loggerDebug(`[preload] listenFromWebClient: received ${channel}`);
            callback(event.data.data);
        }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
}

// Отладка: безопасный логгер для preload (работает без Node.js API)
function loggerDebug(message) {
    if (typeof console !== 'undefined') {
        console.debug(`[NightWatchPreload] ${message}`);
    }
}

contextBridge.exposeInMainWorld('electronAPI', {
    // === Существующие методы менеджера аддонов ===
    loadAddons: () => {
        loggerDebug('[electronAPI] loadAddons called');
        return ipcRenderer.invoke('load-addons');
    },
    toggleAddon: (name, install) => {
        loggerDebug(`[electronAPI] toggleAddon: ${name}, install=${install}`);
        return ipcRenderer.invoke('toggle-addon', name, install);
    },
    launchGame: () => {
        loggerDebug('[electronAPI] launchGame called');
        return ipcRenderer.invoke('launch-game');
    },
    openLogsFolder: () => {
        loggerDebug('[electronAPI] openLogsFolder called');
        ipcRenderer.send('open-logs-folder');
    },
    checkGame: () => {
        loggerDebug('[electronAPI] checkGame called');
        return ipcRenderer.invoke('check-game');
    },
    changeGamePath: () => {
        loggerDebug('[electronAPI] changeGamePath called');
        return ipcRenderer.invoke('change-game-path');
    },
    goBack: () => {
        loggerDebug('[electronAPI] goBack called');
        ipcRenderer.send('go-back');
    },
    setPTTHotkey: (hotkey) => {
        loggerDebug(`[electronAPI] setPTTHotkey: ${hotkey || 'null'}`);
        return ipcRenderer.invoke('set-ptt-hotkey', hotkey);
    },
    getPTTHotkey: () => {
        loggerDebug('[electronAPI] getPTTHotkey called');
        return ipcRenderer.invoke('get-ptt-hotkey');
    },
    
    // === НОВЫЙ метод для получения платформы ===
    getPlatform: () => {
        loggerDebug('[electronAPI] getPlatform called');
        return ipcRenderer.invoke('get-platform');
    },
    
    // === Существующие слушатели событий ===
    onPTTPressed: (callback) => {
        loggerDebug('[electronAPI] onPTTPressed listener registered');
        if (typeof callback !== 'function') return;
        const handler = () => {
            loggerDebug('[electronAPI] PTT pressed event received');
            callback();
        };
        ipcRenderer.on('ptt-pressed', handler);
        return () => ipcRenderer.off('ptt-pressed', handler);
    },
    onProgress: (callback) => {
        loggerDebug('[electronAPI] onProgress listener registered');
        if (typeof callback !== 'function') return;
        const handler = (event, name, progress) => {
            if (typeof name === 'string' && typeof progress === 'number') {
                loggerDebug(`[electronAPI] Progress: ${name} = ${progress * 100}%`);
                callback(name, progress);
            }
        };
        ipcRenderer.on('progress', handler);
        return () => ipcRenderer.off('progress', handler);
    },
    onOperationFinished: (callback) => {
        loggerDebug('[electronAPI] onOperationFinished listener registered');
        if (typeof callback !== 'function') return;
        const handler = (event, name, success) => {
            loggerDebug(`[electronAPI] Operation finished: ${name}, success=${success}`);
            callback(name, success);
        };
        ipcRenderer.on('operation-finished', handler);
        return () => ipcRenderer.off('operation-finished', handler);
    },
    onError: (callback) => {
        loggerDebug('[electronAPI] onError listener registered');
        if (typeof callback !== 'function') return;
        const handler = (event, error) => {
            loggerDebug(`[electronAPI] Error received: ${error}`);
            callback(error);
        };
        ipcRenderer.on('operation-error', handler);
        return () => ipcRenderer.off('operation-error', handler);
    },
    onAddonUpdateAvailable: (callback) => {
        loggerDebug('[electronAPI] onAddonUpdateAvailable listener registered');
        if (typeof callback !== 'function') return;
        const handler = (event, name) => {
            loggerDebug(`[electronAPI] Update available: ${name}`);
            callback(name);
        };
        ipcRenderer.on('addon-update-available', handler);
        return () => ipcRenderer.off('addon-update-available', handler);
    },
    
    // === НОВЫЕ методы для веб-клиента ===
    sendToWebClient: (channel, data) => {
        loggerDebug(`[electronAPI] sendToWebClient: ${channel}`);
        sendToWebClient(channel, data);
    },
    onWebClientEvent: (channel, callback) => {
        loggerDebug(`[electronAPI] onWebClientEvent registered: ${channel}`);
        return listenFromWebClient(channel, callback);
    },
    registerPTTHotkey: (hotkey) => {
        loggerDebug(`[electronAPI] registerPTTHotkey: ${hotkey || 'null'}`);
        return ipcRenderer.invoke('register-ptt-hotkey', hotkey);
    },
    onPTTActivated: (callback) => {
        loggerDebug('[electronAPI] onPTTActivated listener registered');
        if (typeof callback !== 'function') return;
        const handler = () => {
            loggerDebug('[electronAPI] PTT activated, sending to web client');
            sendToWebClient('ptt-activated', { pressed: true });
            if (typeof callback === 'function') callback();
        };
        ipcRenderer.on('ptt-activated', handler);
        return () => ipcRenderer.off('ptt-activated', handler);
    },
    sendMicState: (state) => {
        loggerDebug(`[electronAPI] sendMicState: ${JSON.stringify(state)}`);
        ipcRenderer.send('webclient-mic-state', state);
    },
});

loggerDebug('[preload] Context bridge exposed successfully');