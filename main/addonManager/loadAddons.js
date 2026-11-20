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
      const configNames = Object.keys(config.addons);

      // Пересобираем объект аддонов целиком в порядке ключей из addons.json.
      // Это гарантирует, что порядок в state.addons совпадает с порядком
      // в конфиге при ЛЮБОМ количестве вызовов loadAddons (а не только первом).
      const rebuilt = {};

      for (const name of configNames) {
        const cfg = config.addons[name];
        const built = buildAddonFromConfig(name, cfg);

        built.installed = checkInstalled(
          name,
          cfg.target_path || '',
          gamePath,
          built
        );
        built.needs_update = computeNeedsUpdate(name, cfg);

        // Сохраняем рантайм-флаги уже существующего аддона,
        // чтобы не сбросить идущую установку/обновление.
        const existing = state.state.addons[name];
        if (existing) {
          built.being_processed = !!existing.being_processed;
          built.updating = !!existing.updating;
        }

        rebuilt[name] = built;
      }

      state.state.addons = rebuilt;
      state.state.addonOrder = configNames;

      logger.info(
        `[LOAD_ADDONS] Загружено аддонов: ${configNames.length} ` +
        `(порядок синхронизирован с конфигом)`
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