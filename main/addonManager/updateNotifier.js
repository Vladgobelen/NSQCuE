// Анонс обновления аддона через штатные всплывающие уведомления клиента
// (тот же механизм, что у войс-чата: main/tray.js → renderer/notification.html).
// Единственная точка связи addonManager → tray: текст и правила показа
// собраны здесь, а не размазаны по reinstall/toggleAddon.
const logger = require('./logger');
const { showCustomNotification } = require('../tray');

const UPDATE_DURATION = 6000;
const ERROR_DURATION = 8000;

function show(title, body, options) {
  try {
    showCustomNotification(title, body, options);
  } catch (e) {
    // Уведомление — не критичный путь: установка не должна падать из-за него.
    logger.warn(`[NOTIFY] не удалось показать уведомление: ${e.message}`);
  }
}

function notifyAddonUpdated(name, from, to) {
  const fromText = from || '?';
  const toText = to || '?';
  logger.info(`[NOTIFY] ${name}: обновлён ${fromText} >> ${toText}`);
  show(name, `${fromText} >> ${toText}`, {
    kind: 'addon-update',
    addon: name,
    from: fromText,
    to: toText,
    duration: UPDATE_DURATION,
  });
}

function notifyAddonUpdateFailed(name, from, to, reason) {
  const fromText = from || '?';
  const toText = to || '?';
  const text = reason ? String(reason) : 'причина не указана';
  logger.warn(`[NOTIFY] ${name}: обновление не удалось (${text})`);
  show(name, text, {
    kind: 'addon-error',
    addon: name,
    from: fromText,
    to: toText,
    duration: ERROR_DURATION,
  });
}

module.exports = { notifyAddonUpdated, notifyAddonUpdateFailed };