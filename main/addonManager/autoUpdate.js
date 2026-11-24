const axios = require('axios');
const logger = require('./logger');
const state = require('./state');
const { emitBlockLaunch } = require('./events');
const {
  AUTO_UPDATE_ADDONS,
  NET_TIMEOUT_VERSION,
  POST_INSTALL_DELAY,
} = require('./constants');
const {
  parseVersion,
  versionsEqual,
  readLocalVersionFile,
  formatVersion,
} = require('./versions');
const { forceReinstall } = require('./reinstall');

// ─────────────────────────────────────────────────────────────
//  Чтение удалённой версии
// ─────────────────────────────────────────────────────────────
async function fetchRemoteVersion(addonName) {
  const meta = AUTO_UPDATE_ADDONS[addonName];
  if (!meta) throw new Error(`Нет реестровой записи для ${addonName}`);

  logger.info(`[VERSION] ${addonName}: запрос ${meta.versionUrl}`);

  const res = await axios.get(meta.versionUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Accept': 'text/plain, */*',
    },
    params: { _t: Date.now() },
    timeout: NET_TIMEOUT_VERSION,
    maxRedirects: 5,
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: null,
  });

  logger.info(
    `[VERSION] ${addonName}: статус ${res.status}, len=${(res.data || '').length}`
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${addonName} version HTTP ${res.status}`);
  }

  return parseVersion(meta.parser, String(res.data));
}

// ─────────────────────────────────────────────────────────────
//  Чтение локальной версии (делегат в versions.js)
// ─────────────────────────────────────────────────────────────
function readLocalVersion(addonName) {
  const meta = AUTO_UPDATE_ADDONS[addonName];
  if (!meta) return null;
  const version = readLocalVersionFile(addonName);
  if (version === null) {
    logger.info(`[VERSION] ${addonName}: локальный файл версии не прочитан`);
  }
  return version;
}

// ─────────────────────────────────────────────────────────────
//  Сравнение локальной и удалённой
// ─────────────────────────────────────────────────────────────
function isUpdateNeeded(addonName, local, remote) {
  const meta = AUTO_UPDATE_ADDONS[addonName];
  if (!meta) return false;
  return !versionsEqual(meta.parser, local, remote);
}

// ─────────────────────────────────────────────────────────────
//  Проверка одного автообновляемого аддона
//  Возвращает true, если было обновление
// ─────────────────────────────────────────────────────────────
async function checkOne(addonName) {
  const local = readLocalVersion(addonName);
  if (!local) {
    logger.info(`[AUTO_UPDATE] ${addonName} не установлен локально — пропуск`);
    return false;
  }

  const remote = await fetchRemoteVersion(addonName);
  logger.info(
    `[AUTO_UPDATE] ${addonName}: local=${formatVersion(local)}, remote=${formatVersion(remote)}`
  );

  if (!isUpdateNeeded(addonName, local, remote)) {
    logger.info(`[AUTO_UPDATE] ${addonName}: версия актуальна`);
    return false;
  }

  logger.info(
    `[AUTO_UPDATE] ${addonName}: требуется обновление ` +
      `${formatVersion(local)} >> ${formatVersion(remote)}`
  );

  // Удалённая версия передаётся явно — reinstall не должен ходить в сеть
  // и не должен зависеть от этого модуля (иначе цикл require).
  await forceReinstall([addonName], { [addonName]: remote });
  return true;
}

// ─────────────────────────────────────────────────────────────
//  Проверка при старте — по всем автообновляемым
// ─────────────────────────────────────────────────────────────
async function startupUpdateCheck() {
  emitBlockLaunch(true);
  let anyUpdated = false;

  try {
    const gamePath = state.state.gamePath;
    if (!gamePath) return false;

    for (const addonName of Object.keys(AUTO_UPDATE_ADDONS)) {
      try {
        const updated = await checkOne(addonName);
        if (updated) anyUpdated = true;
      } catch (err) {
        logger.error(`[STARTUP] ${addonName}: ошибка проверки: ${err.message}`);
      }
    }
    return anyUpdated;
  } catch (err) {
    logger.error('[STARTUP] Ошибка проверки:', err.message);
    return false;
  } finally {
    setTimeout(() => emitBlockLaunch(false), POST_INSTALL_DELAY);
  }
}

// ─────────────────────────────────────────────────────────────
//  Фоновая проверка — с учётом checkInterval каждого аддона
// ─────────────────────────────────────────────────────────────
async function checkForUpdates() {
  const gamePath = state.state.gamePath;
  if (!gamePath) return false;

  const now = Date.now();
  let anyUpdated = false;

  for (const [addonName, meta] of Object.entries(AUTO_UPDATE_ADDONS)) {
    const last = state.state._lastAutoCheck[addonName] || 0;
    if (now - last < meta.checkInterval) continue;
    state.state._lastAutoCheck[addonName] = now;

    try {
      const updated = await checkOne(addonName);
      if (updated) anyUpdated = true;
    } catch (err) {
      logger.error(`[BACKGROUND_CHECK] ${addonName}: ошибка проверки: ${err.message}`);
    }
  }

  return anyUpdated;
}

module.exports = {
  fetchRemoteVersion,
  readLocalVersion,
  isUpdateNeeded,
  checkOne,
  startupUpdateCheck,
  checkForUpdates,
};