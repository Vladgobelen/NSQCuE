const logger = require('../utils').setupLogging();
const { findSoundFile, playSoundSilent } = require('./sounds');
const { sendToOverlay } = require('./overlay');

// Единая точка обработки console-message из webview.
// Звук идёт по каналу ELECTRON_SOUND:<type> — не зависит от nodeIntegration.
function handleConsoleMessage(message) {
  if (!message) return;

  // 0. Служебные логи инъекции и отчёты о проигрывании — в терминал
  if (
    message.startsWith('[INJECT]') ||
    message.startsWith('[INJECT-FAIL]') ||
    message.startsWith('[RENDERER-INJECT]') ||
    message.startsWith('[SOUND][WEBVIEW]')
  ) {
    console.log('[CONSOLE]' + message);
    return;
  }

  // 1. Звук — основной канал
  if (message.startsWith('ELECTRON_SOUND:')) {
    const soundType = message.substring('ELECTRON_SOUND:'.length).trim();
    console.log(`[CONSOLE][SOUND] ELECTRON_SOUND: "${soundType}"`);
    if (!soundType) {
      console.warn('[CONSOLE][SOUND] пустой тип звука — пропуск');
      return;
    }
    const p = findSoundFile(soundType);
    if (p) {
      playSoundSilent(p);
    } else {
      console.error(`[CONSOLE][SOUND] файл не найден: ${soundType}`);
      logger.error(`[SOUND] not found: ${soundType}`);
    }
    return;
  }

  // 2. Резервный канал (если веб-клиент логирует старым способом)
  let soundType = null;
  if (message.includes('[electronAPI] playSound called:')) {
    const m = message.match(/playSound called:\s*([^)]+)/);
    if (m) soundType = m[1].trim();
  } else if (message.includes('[message listener] Received sound postMessage:')) {
    const m = message.match(/postMessage:\s*(\w+-\w+|\w+)/);
    if (m) soundType = m[1].trim();
  } else if (message.includes('playSound called with:') && message.includes('[CLIENT]')) {
    const m = message.match(/playSound called with:\s*(\w+-\w+|\w+)/);
    if (m) soundType = m[1].trim();
  }

  if (soundType) {
    console.log(`[CONSOLE][SOUND] резервный канал: "${soundType}"`);
    const p = findSoundFile(soundType);
    if (p) {
      playSoundSilent(p);
    } else {
      console.error(`[CONSOLE][SOUND] файл не найден (резерв): ${soundType}`);
      logger.error(`[WEBVIEW_CONSOLE] Sound file not found: ${soundType}`);
    }
  }

  // 3. Уведомления
  if (message.startsWith('ELECTRON_NOTIFICATION:')) {
    try {
      const data = JSON.parse(message.substring('ELECTRON_NOTIFICATION:'.length));
      console.log(`[CONSOLE][NOTIF] ${data.title}: ${data.body}`);
      logger.info(`[NOTIFICATION] Received from webview: ${data.title} - ${data.body}`);
      const { showCustomNotification } = require('../tray');
      showCustomNotification(data.title, data.body);
    } catch (e) {
      console.error('[CONSOLE][NOTIF] ошибка разбора JSON:', e.message);
      logger.error(`[NOTIFICATION] Parse error: ${e.message}`);
    }
  }

  // 4. Чат в оверлей
  if (message.includes('[CHAT] Sending to overlay:')) {
    const m = message.match(/Sending to overlay:\s*(.+)$/);
    if (m) {
      const text = m[1].trim();
      console.log(`[CONSOLE][CHAT] перехвачено: "${text.slice(0, 80)}"`);
      logger.info(`[CHAT] Captured for overlay: ${text}`);
      sendToOverlay('message', { text });
    } else {
      console.warn('[CONSOLE][CHAT] строка найдена, но текст не разобран:', message);
    }
  }
}

module.exports = { handleConsoleMessage };