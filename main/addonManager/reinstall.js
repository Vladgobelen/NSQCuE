const logger = require('./logger');
const state = require('./state');
const { sleep } = require('./sleep');
const { emitEvent, emitProgress } = require('./events');
const { fetchConfigWithFallback } = require('./config');
const { buildAddonFromConfig } = require('./addonBuilder');
const { installAddon } = require('./installer');
const { uninstallAddon } = require('./uninstaller');
const { checkInstalled } = require('./installChecker');
const { POST_INSTALL_DELAY } = require('./constants');
const { loadAddons } = require('./loadAddons');

async function forceReinstall(addonNames) {
  const { mainWindow } = state.state;

  if (state.state.isReinstalling) {
    logger.info('[REINSTALL] Уже выполняется, ждём завершения');
    return state.state.reinstallQueue;
  }

  state.state.isReinstalling = true;
  state.state.reinstallQueue = (async () => {
    try {
      const config =
        state.state._lastConfig || (await fetchConfigWithFallback());

      for (const addonName of addonNames) {
        const cfg = config.addons[addonName];
        if (!cfg) {
          logger.warn(`[REINSTALL] ${addonName} нет в конфиге — пропуск`);
          continue;
        }

        const addon = buildAddonFromConfig(addonName, cfg);
        addon.installed = true;
        addon.being_processed = true;
        addon.updating = true;

        emitEvent('addon-install-started', { name: addonName, install: true });
        emitProgress(addonName, 0.1);

        try {
          await uninstallAddon(addon);
          emitProgress(addonName, 0.4);
          await sleep(200);

          await installAddon(addon);

          const gamePath = state.getGamePath();
          const ok = checkInstalled(
            addonName,
            addon.target_path,
            gamePath,
            addon
          );

          if (ok) {
            logger.info(
              `[REINSTALL] ${addonName} OK, ждём ${POST_INSTALL_DELAY}мс`
            );
            await sleep(POST_INSTALL_DELAY);
          } else {
            logger.warn(`[REINSTALL] ${addonName} не подтверждён`);
          }

          emitProgress(addonName, 1.0);

          if (state.state.addons[addonName]) {
            Object.assign(state.state.addons[addonName], {
              being_processed: false,
              updating: false,
              installed: true,
              needs_update: false,
            });
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              'operation-finished',
              addonName,
              true
            );
          }
        } catch (err) {
          logger.error(
            `[REINSTALL] ${addonName}:`,
            err.message || err.code || String(err)
          );
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              'operation-error',
              err.message || 'Unknown error'
            );
          }
        }
        await sleep(300);
      }

      await loadAddons();
    } finally {
      state.state.isReinstalling = false;
      state.state.reinstallQueue = null;
    }
  })();

  return state.state.reinstallQueue;
}

module.exports = { forceReinstall };