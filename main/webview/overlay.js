const logger = require('../utils').setupLogging();

// Антидубль: одно и то же сообщение приходит двумя путями
// (main console-handler и renderer webview-bridge) почти одновременно.
const DEDUP_WINDOW_MS = 500;
let lastSentText = null;
let lastSentAt = 0;

// СТАРОЕ ПОВЕДЕНИЕ: окно оверлея НЕ создаётся автоматически.
// Открыть: Ctrl+Shift+O или пункт "Оверлей" в трее.
// Автосоздание ломало доставку: текст уходил в окно до загрузки
// overlay.html, когда слушатели ipcRenderer ещё не зарегистрированы.
function sendToOverlay(type, data) {
  const { getOverlayWindow } = require('../window');
  const overlayWindow = getOverlayWindow();
  const text = data && data.text;

  console.log(
    `[OVERLAY] sendToOverlay: type=${type}, len=${text ? String(text).length : 0}, ` +
    `text="${String(text || '').slice(0, 80)}"`
  );

  if (!text) {
    console.warn('[OVERLAY] sendToOverlay: пустой текст — пропуск');
    return false;
  }

  const now = Date.now();
  if (text === lastSentText && now - lastSentAt < DEDUP_WINDOW_MS) {
    console.log('[OVERLAY] sendToOverlay: дубль (второй канал) — пропуск');
    return true;
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    console.warn('[OVERLAY] sendToOverlay: окно не открыто — текст НЕ доставлен (Ctrl+Shift+O)');
    logger.warn('[OVERLAY] sendToOverlay: окно не открыто, сообщение потеряно');
    return false;
  }

  if (overlayWindow.webContents.isLoading()) {
    console.warn('[OVERLAY] sendToOverlay: overlay.html ещё грузится — текст НЕ доставлен');
    logger.warn('[OVERLAY] sendToOverlay: окно загружается, сообщение потеряно');
    return false;
  }

  lastSentText = text;
  lastSentAt = now;
  overlayWindow.webContents.send('overlay-message', text);
  console.log('[OVERLAY] sendToOverlay: overlay-message отправлен в окно');
  logger.info(`[OVERLAY] доставлено в оверлей: ${String(text).slice(0, 80)}`);
  return true;
}

function sendToWebClient(text) {
  const { getWebviewWebContents } = require('./state');
  const wc = getWebviewWebContents();

  console.log(`[OVERLAY→CHAT] sendToWebClient: "${String(text).slice(0, 80)}"`);

  if (!wc || wc.isDestroyed()) {
    console.warn('[OVERLAY→CHAT] WebView не доступен');
    logger.warn('[OVERLAY] WebView not available');
    return;
  }

  try {
    const escaped = String(text)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');

    const code = `
(function() {
  var inputField = document.querySelector('textarea.message-input')
    || document.querySelector('textarea')
    || document.querySelector('input[type="text"]');
  if (!inputField) return false;
  inputField.value = '${escaped}';
  inputField.dispatchEvent(new Event('input', { bubbles: true }));
  var sendButton = document.querySelector('button.send-btn')
    || document.querySelector('button[type="submit"]');
  if (sendButton) sendButton.click();
  else inputField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  return true;
})();
`;

    wc.executeJavaScript(code)
      .then((result) => {
        if (result) {
          console.log('[OVERLAY→CHAT] сообщение вставлено и отправлено');
          logger.info('[OVERLAY] Message sent to web client');
        } else {
          console.warn('[OVERLAY→CHAT] поле ввода чата не найдено');
          logger.warn('[OVERLAY] Input field not found');
        }
      })
      .catch((err) => {
        console.error('[OVERLAY→CHAT] executeJavaScript FAIL:', err.message);
        logger.error(`[OVERLAY] Error: ${err.message}`);
      });
  } catch (err) {
    console.error('[OVERLAY→CHAT] Failed:', err.message);
    logger.error(`[OVERLAY] Failed: ${err.message}`);
  }
}

module.exports = { sendToOverlay, sendToWebClient };