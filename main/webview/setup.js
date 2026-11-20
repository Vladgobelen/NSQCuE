const { shell } = require('electron');
const logger = require('../utils').setupLogging();
const { setWebviewWebContents } = require('./state');
const { isExternalUrl } = require('./url');
const { handleConsoleMessage } = require('./console-handler');
const { handleIpcMessage } = require('./ipc-handler');
const { injectIntoWebview } = require('./inject');
const { logSoundsDir } = require('./sounds');

// Защита от повторной регистрации обработчиков:
// did-attach-webview и did-create-webview могут сработать оба,
// тогда каждый console-message обрабатывался бы дважды.
const registered = new WeakSet();

function setupWebviewHandlers(webContents) {
  if (registered.has(webContents)) {
    console.log('[WEBVIEW] обработчики уже зарегистрированы — пропуск');
    return;
  }
  registered.add(webContents);

  console.log('[WEBVIEW] setupWebviewHandlers: webview подключён');
  logger.info('[WEBVIEW] handlers attached');

  setWebviewWebContents(webContents);
  logSoundsDir();

  webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  webContents.on('did-fail-load', (e, code, desc) => {
    console.error(`[WEBVIEW] did-fail-load: ${code} ${desc}`);
    logger.error(`[WEBVIEW] Failed: ${code} - ${desc}`);
  });

  webContents.on('console-message', (event, level, message) => {
    handleConsoleMessage(message);
  });

  webContents.on('ipc-message', (event, channel, ...args) => {
    handleIpcMessage(channel, args);
  });

  webContents.on('did-finish-load', () => {
    console.log('[WEBVIEW] did-finish-load → инъекция');
    logger.info('[WEBVIEW] did-finish-load, injecting');
    injectIntoWebview(webContents);
  });
}

module.exports = { setupWebviewHandlers };