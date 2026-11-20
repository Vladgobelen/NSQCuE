// Preload для main-окна (contextIsolation: true, nodeIntegration: false).
// Все вызовы из renderer идут через window.electronAPI.<method>.
// Список методов совпадает с renderer/renderer/core/ipc.js.

const { contextBridge, ipcRenderer } = require('electron');

const api = {
    // ── Аддоны ─────────────────────────────────────────────
    loadAddons: () => ipcRenderer.invoke('load-addons'),
    toggleAddon: (name, install) => ipcRenderer.invoke('toggle-addon', name, install),
    cancelDownload: (name) => ipcRenderer.invoke('cancel-download', name),

    // ── Игра ───────────────────────────────────────────────
    checkGame: () => ipcRenderer.invoke('check-game'),
    launchGame: () => ipcRenderer.invoke('launch-game'),
    changeGamePath: () => ipcRenderer.invoke('change-game-path'),
    openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
    goBack: () => ipcRenderer.send('go-back'),

    // ── Платформа / webview ────────────────────────────────
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    clearWebviewCache: () => ipcRenderer.invoke('clear-session-cache', 'persist:ns'),
    executeInWebview: (code) => ipcRenderer.invoke('execute-in-webview', { code }),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

    // ── Webview ↔ renderer: сообщения в веб-клиент ─────────
    sendToWebClient: (channel, payload) => {
        // Прокидываем в main → webview через ipcHandlers? Нет: sendToWebClient
        // в main — это утилита для webContents. Из renderer напрямую
        // вызываем execute-in-webview с готовым кодом.
        // Для обратной совместимости с renderer.js оставлен канал
        // 'send-to-web-client' — его обрабатывает ipcHandlers.
        return ipcRenderer.invoke('send-to-web-client', channel, payload);
    },
    sendMicState: (state) => ipcRenderer.send('send-mic-state', state),
    registerPTTHotkey: (hotkey) => ipcRenderer.invoke('register-ptt-hotkey', hotkey),

    // ── Уведомления / трей ─────────────────────────────────
    showNotification: (title, body) => ipcRenderer.send('show-notification', title, body),
    updateTrayBadge: (count) => ipcRenderer.send('update-tray-badge', count),
    closeNotificationWindow: () => ipcRenderer.send('close-notification-window'),
    notificationClicked: () => ipcRenderer.send('notification-clicked'),

    // ── Звуки ──────────────────────────────────────────────
    playSound: (soundType) => ipcRenderer.invoke('play-sound', soundType),
    selectSoundsFolder: () => ipcRenderer.invoke('select-sounds-folder'),
    importSounds: (folder) => ipcRenderer.invoke('import-sounds', folder),
    getSoundsStatus: () => ipcRenderer.invoke('get-sounds-status'),
    openSoundsFolder: () => ipcRenderer.send('open-sounds-folder'),
    fetchSoundsConfig: () => ipcRenderer.invoke('fetch-sounds-config'),
    downloadSoundsSection: (name) => ipcRenderer.invoke('download-sounds-section', name),
    isSoundsDirEmpty: () => ipcRenderer.invoke('is-sounds-dir-empty'),

    // ── PTT / hotkeys ──────────────────────────────────────
    startKeyCapture: () => ipcRenderer.invoke('start-key-capture'),
    stopKeyCapture: () => ipcRenderer.invoke('stop-key-capture'),
    setPTTHotkey: (codes) => ipcRenderer.invoke('set-ptt-hotkey', codes),
    getPTTHotkey: () => ipcRenderer.invoke('get-ptt-hotkey'),

    // ── Аккаунты ───────────────────────────────────────────
    loadCredentials: () => ipcRenderer.invoke('load-credentials'),
    saveCredentials: (u, p) => ipcRenderer.invoke('save-credentials', u, p),
    deleteCredentials: () => ipcRenderer.invoke('delete-credentials'),
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    switchAccount: (userId) => ipcRenderer.invoke('switch-account', userId),

    // ── Оверлей ────────────────────────────────────────────
    sendMessageToOverlay: (text) => ipcRenderer.invoke('send-message-to-overlay', text),
    hideOverlay: () => ipcRenderer.send('hide-overlay'),
    sendTestToOverlay: () => ipcRenderer.invoke('send-test-to-overlay'),

    // ── События main → renderer ────────────────────────────
    onConfigSourceStatus: (cb) => ipcRenderer.on('config-source-status', (_e, data) => cb(data)),
    onDownloadAttempt: (cb) => ipcRenderer.on('download-attempt', (_e, data) => cb(data)),
    onAddonsUpdateStatus: (cb) => ipcRenderer.on('addons-update-status', (_e, data) => cb(data)),
    onBlockLaunchGame: (cb) => ipcRenderer.on('block-launch-game', (_e, blocked) => cb(blocked)),
    onProgress: (cb) => ipcRenderer.on('progress', (_e, name, progress) => cb(name, progress)),
    onOperationFinished: (cb) => ipcRenderer.on('operation-finished', (_e, name, success) => cb(name, success)),
    onAddonUpdateAvailable: (cb) => ipcRenderer.on('addon-update-available', (_e, name) => cb(name)),
    onError: (cb) => ipcRenderer.on('operation-error', (_e, msg) => cb(msg)),
    onKeyCaptured: (cb) => ipcRenderer.on('key-captured', (_e, code) => cb(code)),
    onPTTPressed: (cb) => ipcRenderer.on('ptt-pressed', () => cb()),
    onPTTReleased: (cb) => ipcRenderer.on('ptt-released', () => cb()),
    onOverlayInput: (cb) => ipcRenderer.on('overlay-input', (_e, text) => cb(text)),
    onSoundsDownloadProgress: (cb) => ipcRenderer.on('sounds-download-progress', (_e, progress) => cb(progress)),
    onWebClientEvent: (channel, cb) => ipcRenderer.on(`webclient-${channel}`, (_e, data) => cb(data)),
};

contextBridge.exposeInMainWorld('electronAPI', api);