const logger = require('./logger');
const state = require('./state');
const { sleep } = require('./sleep');
const { emitProgress, emitBlockLaunch, emitEvent } = require('./events');
const { installAddon } = require('./installer');
const { uninstallAddon } = require('./uninstaller');
const { checkInstalled } = require('./installChecker');
const { POST_INSTALL_DELAY, AUTO_UPDATE_ADDONS } = require('./constants');
const {
  getLocalVersion,
  setLocalVersion,
  clearLocalVersion,
  formatVersion,
} = require('./versions');
const { notifyAddonUpdated, notifyAddonUpdateFailed } = require('./updateNotifier');

function emitUpdateState(name, updating, from, to) {
  emitEvent('addon-update-state', {
    name,
    updating: !!updating,
    from: formatVersion(from),
    to: formatVersion(to),
  });
}

async function toggleAddon(name, install) {
  console.log('==================================================');
  console.log(`[TOGGLE] START name=${name} install=${install}`);
  console.log('==================================================');

  const { mainWindow } = state.state;
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[TOGGLE] mainWindow недоступен — выход');
    return false;
  }

  const addon = state.state.addons[name];
  if (!addon) throw new Error(`Addon ${name} not found`);
  if (addon.being_processed) {
    console.warn(`[TOGGLE] ${name} уже обрабатывается — выход`);
    throw new Error(`Addon ${name} is already processing`);
  }

  const isAuto = !!AUTO_UPDATE_ADDONS[name];
  const isUpdate = !!install && !!addon.installed && !!addon.needs_update;
  const fromVersion = getLocalVersion(name);
  const toVersion = typeof addon.version === 'number' ? addon.version : 0;

  console.log(
    `[TOGGLE] isAuto=${isAuto} isUpdate=${isUpdate} ` +
      `versions=${formatVersion(fromVersion)} >> ${formatVersion(toVersion)}`
  );

  addon.being_processed = true;
  addon.updating = true;
  emitBlockLaunch(true);
  emitProgress(name, 0.1);
  if (isUpdate) emitUpdateState(name, true, fromVersion, toVersion);

  let success = false;

  try {
    if (install) {
      console.log('[TOGGLE] → installAddon()');
      await installAddon(addon);
      const gamePath = state.getGamePath();
      const ok = checkInstalled(name, addon.target_path, gamePath, addon);
      console.log('[TOGGLE] checkInstalled =', ok);

      if (ok) {
        console.log(`[TOGGLE] ${name} установлен, ждём ${POST_INSTALL_DELAY}мс`);
        await sleep(POST_INSTALL_DELAY);
        if (!isAuto && toVersion > 0) {
          setLocalVersion(name, toVersion);
          addon.local_version = toVersion;
        }
        addon.needs_update = false;
      } else {
        console.warn(`[TOGGLE] ${name} не подтверждён, ждём 1000мс`);
        await sleep(1000);
      }

      addon.installed = ok;
      success = ok;

      if (isUpdate) {
        emitUpdateState(name, false, fromVersion, toVersion);
        if (ok) {
          notifyAddonUpdated(
            name,
            formatVersion(fromVersion),
            formatVersion(toVersion)
          );
        } else {
          notifyAddonUpdateFailed(
            name,
            formatVersion(fromVersion),
            formatVersion(toVersion),
            'установка не подтверждена'
          );
        }
      }
    } else {
      console.log('[TOGGLE] → uninstallAddon()');
      await uninstallAddon(addon);
      addon.installed = false;
      if (!isAuto) {
        clearLocalVersion(name);
        addon.local_version = 0;
      }
      success = true;
    }
  } catch (error) {
    console.error('[TOGGLE] ОШИБКА:', error && error.stack ? error.stack : error);
    const msg = error.message || error.code || String(error);
    logger.error(`[TOGGLE] ${install ? 'install' : 'uninstall'} ${name}:`, msg);
    if (isUpdate) {
      emitUpdateState(name, false, fromVersion, toVersion);
      notifyAddonUpdateFailed(
        name,
        formatVersion(fromVersion),
        formatVersion(toVersion),
        msg
      );
    }
    emitProgress(name, 0);
    throw error;
  } finally {
    addon.being_processed = false;
    addon.updating = false;
    // Разблокировка запуска обязательно в finally: раньше при ошибке
    // блок оставался навсегда.
    setTimeout(() => emitBlockLaunch(false), POST_INSTALL_DELAY);
    console.log('[TOGGLE] being_processed=false, updating=false (finally)');
  }

  setTimeout(() => {
    console.log('[TOGGLE] → operation-finished', name, success);
    emitEvent('operation-finished', name, success);
  }, POST_INSTALL_DELAY);

  console.log(`[TOGGLE] END name=${name} install=${install} → ${success}`);
  return true;
}

module.exports = { toggleAddon };