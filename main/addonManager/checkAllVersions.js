const logger = require('./logger');
const state = require('./state');
const { emitEvent } = require('./events');
const { fetchConfigWithFallback } = require('./config');
const { buildAddonFromConfig, computeNeedsUpdate } = require('./addonBuilder');
const { getLocalVersion, getRemoteVersion } = require('./versions');
const { AUTO_UPDATE_ADDONS } = require('./constants');
const { loadAddons } = require('./loadAddons');

function buildVersionsSnapshot() {
  const snap = {};
  // Итерируемся строго по сохранённому порядку из конфига,
  // чтобы снапшот не зависел от порядка ключей JS-объекта.
  const order = Array.isArray(state.state.addonOrder) && state.state.addonOrder.length > 0
    ? state.state.addonOrder
    : Object.keys(state.state.addons);

  for (const name of order) {
    const addon = state.state.addons[name];
    if (!addon) continue;
    snap[name] = {
      needs_update: !!addon.needs_update,
      version: addon.version || 0,
      local_version: addon.local_version || 0,
      installed: !!addon.installed,
    };
  }
  return snap;
}

async function checkAllAddonsVersions() {
  try {
    logger.info('[VERSIONS] Проверка версий всех аддонов...');

    // Гарантируем, что state.addons и state.addonOrder заполнены
    // и соответствуют порядку конфига. loadAddons идемпотентен
    // (защищён флагом loadingAddons), поэтому повторный вызов безопасен.
    await loadAddons();

    const config = await fetchConfigWithFallback();
    const updates = [];

    for (const [name, cfg] of Object.entries(config.addons)) {
      if (AUTO_UPDATE_ADDONS[name]) continue;

      const needs = computeNeedsUpdate(name, cfg);
      const remote = getRemoteVersion(cfg);
      const local = getLocalVersion(name);

      const addon = state.state.addons[name];
      if (addon) {
        // Обновляем существующий объект на месте — порядок не меняется.
        const was = !!addon.needs_update;
        addon.needs_update = needs;
        addon.version = remote;
        addon.local_version = local;
        if (needs && !was) updates.push(name);
      } else {
        // Аддона нет в state (например, конфиг обновился между вызовами).
        // Пересобираем state.addons целиком в порядке конфига,
        // чтобы новый аддон встал на свою позицию, а не в конец.
        logger.warn(
          `[VERSIONS] ${name} отсутствует в state — пересборка списка`
        );
        await loadAddons();

        const rebuiltAddon = state.state.addons[name];
        if (rebuiltAddon) {
          const was = !!rebuiltAddon.needs_update;
          rebuiltAddon.needs_update = needs;
          rebuiltAddon.version = remote;
          rebuiltAddon.local_version = local;
          if (needs && !was) updates.push(name);
        } else {
          // Совсем крайний случай: аддона нет даже после пересборки.
          // Строим его и добавляем, но параллельно синхронизируем порядок
          // (позиция в state.addons всё равно будет в конце, пока
          // не вызовется следующий loadAddons; addonOrder уже содержит
          // правильный порядок, и рендер по нему покажет аддон на месте).
          const built = buildAddonFromConfig(name, cfg);
          built.needs_update = needs;
          state.state.addons[name] = built;
          if (needs) updates.push(name);
        }
      }
    }

    logger.info(
      `[VERSIONS] Проверено аддонов: ${
        Object.keys(config.addons).length
      }, новых обновлений: ${updates.length}`
    );

    emitEvent('addons-update-status', {
      addons: buildVersionsSnapshot(),
      updates,
    });

    return { updates, all: buildVersionsSnapshot() };
  } catch (err) {
    logger.warn(`[VERSIONS] Ошибка проверки версий: ${err.message}`);
    return { updates: [], all: null, error: err.message };
  }
}

module.exports = { checkAllAddonsVersions, buildVersionsSnapshot };