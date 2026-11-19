const logger = require('./logger');
const state = require('./state');
const { emitEvent } = require('./events');
const { fetchConfigWithFallback } = require('./config');
const { buildAddonFromConfig, computeNeedsUpdate } = require('./addonBuilder');
const { getLocalVersion, getRemoteVersion } = require('./versions');
const { AUTO_UPDATE_ADDONS } = require('./constants');

function buildVersionsSnapshot() {
  const snap = {};
  for (const [name, addon] of Object.entries(state.state.addons)) {
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
    const config = await fetchConfigWithFallback();

    const updates = [];

    for (const [name, cfg] of Object.entries(config.addons)) {
      if (AUTO_UPDATE_ADDONS[name]) continue;

      const needs = computeNeedsUpdate(name, cfg);
      const remote = getRemoteVersion(cfg);
      const local = getLocalVersion(name);

      const addon = state.state.addons[name];
      if (addon) {
        const was = !!addon.needs_update;
        addon.needs_update = needs;
        addon.version = remote;
        addon.local_version = local;
        if (needs && !was) updates.push(name);
      } else {
        const built = buildAddonFromConfig(name, cfg);
        built.needs_update = needs;
        state.state.addons[name] = built;
        if (needs) updates.push(name);
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