const logger = require('./logger');
const state = require('./state');
const { sleep } = require('./sleep');
const { emitProgress, emitBlockLaunch } = require('./events');
const { installAddon } = require('./installer');
const { uninstallAddon } = require('./uninstaller');
const { checkInstalled } = require('./installChecker');
const { POST_INSTALL_DELAY } = require('./constants');

async function toggleAddon(name, install) {
  console.log('==================================================');
  console.log(`[TOGGLE] START name=${name} install=${install}`);
  console.log('==================================================');

  const { mainWindow } = state.state;
  console.log('[TOGGLE] mainWindow exists =', !!mainWindow, 'destroyed =', mainWindow ? mainWindow.isDestroyed() : 'n/a');

  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[TOGGLE] mainWindow недоступен — выход');
    return false;
  }

  const addon = state.state.addons[name];
  console.log('[TOGGLE] addon =', addon ? {
    name: addon.name,
    target_path: addon.target_path,
    links: addon.links,
    is_zip: addon.is_zip,
    wrap_in_folder: addon.wrap_in_folder,
    installed: addon.installed,
    being_processed: addon.being_processed,
  } : null);

  if (!addon) throw new Error(`Addon ${name} not found`);
  if (addon.being_processed) {
    console.warn(`[TOGGLE] ${name} уже обрабатывается — выход`);
    throw new Error(`Addon ${name} is already processing`);
  }

  addon.being_processed = true;
  addon.updating = true;
  emitBlockLaunch(true);
  emitProgress(name, 0.1);
  console.log('[TOGGLE] being_processed=true, emitBlockLaunch(true), emitProgress(0.1)');

  try {
    if (install) {
      console.log('[TOGGLE] → installAddon()');
      await installAddon(addon);
      console.log('[TOGGLE] ← installAddon() завершён');

      const gamePath = state.getGamePath();
      console.log('[TOGGLE] checkInstalled: gamePath=', gamePath, 'target_path=', addon.target_path);
      const ok = checkInstalled(name, addon.target_path, gamePath, addon);
      console.log('[TOGGLE] checkInstalled =', ok);

      if (ok) {
        console.log(`[TOGGLE] ${name} установлен, ждём ${POST_INSTALL_DELAY}мс`);
        await sleep(POST_INSTALL_DELAY);
      } else {
        console.warn(`[TOGGLE] ${name} не подтверждён, ждём 1000мс`);
        await sleep(1000);
      }

      addon.needs_update = false;
      addon.installed = ok;
      console.log('[TOGGLE] addon.needs_update=false, addon.installed=', ok);
    } else {
      console.log('[TOGGLE] → uninstallAddon()');
      await uninstallAddon(addon);
      console.log('[TOGGLE] ← uninstallAddon() завершён');
      addon.installed = false;
    }
  } catch (error) {
    console.error('[TOGGLE] ОШИБКА:', error && error.stack ? error.stack : error);
    logger.error(
      `[TOGGLE] ${install ? 'install' : 'uninstall'} ${name}:`,
      error.message || error.code || String(error)
    );
    throw error;
  } finally {
    addon.being_processed = false;
    addon.updating = false;
    console.log('[TOGGLE] being_processed=false, updating=false (finally)');
  }

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[TOGGLE] → operation-finished', name, true);
      mainWindow.webContents.send('operation-finished', name, true);
      emitBlockLaunch(false);
    }
  }, POST_INSTALL_DELAY);

  console.log(`[TOGGLE] END name=${name} install=${install} → true`);
  return true;
}

module.exports = { toggleAddon };