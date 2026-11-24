const logger = require('./logger');
const state = require('./state');
const { sleep } = require('./sleep');
const { emitEvent, emitProgress } = require('./events');
const { fetchConfigWithFallback } = require('./config');
const { buildAddonFromConfig } = require('./addonBuilder');
const { installAddon } = require('./installer');
const { uninstallAddon } = require('./uninstaller');
const { checkInstalled } = require('./installChecker');
const { POST_INSTALL_DELAY, AUTO_UPDATE_ADDONS } = require('./constants');
const { loadAddons } = require('./loadAddons');
const {
  getLocalVersion,
  setLocalVersion,
  getRemoteVersion,
  readLocalVersionFile,
  formatVersion,
} = require('./versions');
const { notifyAddonUpdated, notifyAddonUpdateFailed } = require('./updateNotifier');

// Единый канал для UI: подсветка карточки + "прошлая >> текущая".
function emitUpdateState(name, updating, from, to) {
  emitEvent('addon-update-state', {
    name,
    updating: !!updating,
    from: formatVersion(from),
    to: formatVersion(to),
  });
}

// knownRemoteVersions — необязательная карта { name: parsedVersion }
// для автообновляемых аддонов (приходит из autoUpdate.checkOne).
async function forceReinstall(addonNames, knownRemoteVersions = {}) {
  if (state.state.isReinstalling) {
    logger.info('[REINSTALL] Уже выполняется, ждём завершения');
    return state.state.reinstallQueue;
  }

  state.state.isReinstalling = true;
  state.state.reinstallQueue = (async () => {
    try {
      const config = state.state._lastConfig || (await fetchConfigWithFallback());

      for (const addonName of addonNames) {
        const cfg = config.addons[addonName];
        if (!cfg) {
          logger.warn(`[REINSTALL] ${addonName} нет в конфиге — пропуск`);
          continue;
        }

        const addon = buildAddonFromConfig(addonName, cfg);
        const isAuto = !!AUTO_UPDATE_ADDONS[addonName];

        // Прошлая версия: у автообновляемых — из файла в игре,
        // у обычных — из персистентного учёта установленных версий.
        const fromVersion = isAuto
          ? readLocalVersionFile(addonName)
          : getLocalVersion(addonName);
        let toVersion = isAuto
          ? knownRemoteVersions[addonName]
          : getRemoteVersion(cfg);

        addon.installed = true;
        addon.being_processed = true;
        addon.updating = true;

        if (state.state.addons[addonName]) {
          state.state.addons[addonName].being_processed = true;
          state.state.addons[addonName].updating = true;
        }

        logger.info(
          `[REINSTALL] ${addonName}: старт ` +
            `${formatVersion(fromVersion)} >> ${formatVersion(toVersion)}`
        );

        emitEvent('addon-install-started', { name: addonName, install: true });
        emitUpdateState(addonName, true, fromVersion, toVersion);
        emitProgress(addonName, 0.1);

        let ok = false;

        try {
          await uninstallAddon(addon);
          emitProgress(addonName, 0.4);
          await sleep(200);
          await installAddon(addon);

          const gamePath = state.getGamePath();
          ok = checkInstalled(addonName, addon.target_path, gamePath, addon);

          if (ok) {
            if (isAuto) {
              // После установки истина — файл версии в игре.
              const installedVersion = readLocalVersionFile(addonName);
              if (installedVersion !== null) toVersion = installedVersion;
            } else {
              setLocalVersion(addonName, toVersion);
            }
            logger.info(
              `[REINSTALL] ${addonName} OK ` +
                `(${formatVersion(fromVersion)} >> ${formatVersion(toVersion)}), ` +
                `ждём ${POST_INSTALL_DELAY}мс`
            );
            await sleep(POST_INSTALL_DELAY);
          } else {
            logger.warn(`[REINSTALL] ${addonName} не подтверждён`);
          }

          emitProgress(addonName, 1.0);

          const st = state.state.addons[addonName];
          if (st) {
            st.being_processed = false;
            st.updating = false;
            st.installed = ok;
            st.needs_update = false;
            if (ok && !isAuto) st.local_version = getLocalVersion(addonName);
          }

          emitUpdateState(addonName, false, fromVersion, toVersion);
          emitEvent('operation-finished', addonName, ok);

          if (ok) {
            notifyAddonUpdated(
              addonName,
              formatVersion(fromVersion),
              formatVersion(toVersion)
            );
          } else {
            const reason = 'установка не подтверждена';
            notifyAddonUpdateFailed(
              addonName,
              formatVersion(fromVersion),
              formatVersion(toVersion),
              reason
            );
            emitEvent('operation-error', `${addonName}: ${reason}`);
          }
        } catch (err) {
          const msg = err.message || err.code || String(err);
          logger.error(`[REINSTALL] ${addonName}:`, msg);

          if (state.state.addons[addonName]) {
            state.state.addons[addonName].being_processed = false;
            state.state.addons[addonName].updating = false;
          }

          emitProgress(addonName, 0);
          emitUpdateState(addonName, false, fromVersion, toVersion);
          notifyAddonUpdateFailed(
            addonName,
            formatVersion(fromVersion),
            formatVersion(toVersion),
            msg
          );
          emitEvent('operation-error', msg);
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