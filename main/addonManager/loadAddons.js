const logger = require('./logger');
const state = require('./state');
const { fetchConfigWithFallback } = require('./config');
const { buildAddonFromConfig, computeNeedsUpdate } = require('./addonBuilder');
const { checkInstalled } = require('./installChecker');

async function loadAddons() {
  if (state.state.loadingAddons) {
    logger.info('[LOAD_ADDONS] Уже выполняется, ждём завершения');
    return state.state.loadingAddonsPromise;
  }

  state.state.loadingAddons = true;
  state.state.loadingAddonsPromise = (async () => {
    try {
      const config = await fetchConfigWithFallback();
      const gamePath = state.getGamePath();
      const newNames = new Set(Object.keys(config.addons));

      for (const name of Object.keys(state.state.addons)) {
        if (!newNames.has(name)) delete state.state.addons[name];
      }

      for (const [name, cfg] of Object.entries(config.addons)) {
        const built = buildAddonFromConfig(name, cfg);
        built.installed = checkInstalled(
          name,
          cfg.target_path || '',
          gamePath,
          built
        );
        built.needs_update = computeNeedsUpdate(name, cfg);

        const existing = state.state.addons[name];
        if (existing) {
          Object.assign(existing, {
            description: built.description,
            installed: built.installed,
            link: built.link,
            links: built.links,
            target_path: built.target_path,
            is_zip: built.is_zip,
            wrap_in_folder: built.wrap_in_folder,
            version: built.version,
            local_version: built.local_version,
            needs_update: built.needs_update,
          });
        } else {
          state.state.addons[name] = built;
        }
      }

      logger.info(
        `[LOAD_ADDONS] Загружено аддонов: ${
          Object.keys(state.state.addons).length
        }`
      );
      return state.state.addons;
    } catch (err) {
      logger.error('[LOAD_ADDONS] Ошибка:', err.message);
      throw err;
    } finally {
      state.state.loadingAddons = false;
      state.state.loadingAddonsPromise = null;
    }
  })();

  return state.state.loadingAddonsPromise;
}

module.exports = { loadAddons };