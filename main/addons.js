const addonManager = require('./addonManager');
const settings = require('./settings');
const logger = require('./utils').setupLogging();

function initAddons(mainWindow) {
    console.log('[ADDONS] initAddons called');
    console.log('[ADDONS] gamePath =', settings.getGamePath());
    console.log('[ADDONS] addonManager keys =', Object.keys(addonManager));

    if (!settings.getGamePath()) {
        logger.warn('[ADDONS] Game path not set, skipping initialization');
        console.warn('[ADDONS] Game path not set, skipping initialization');
        return;
    }

    try {
        addonManager.setGamePath(settings.getGamePath());
        console.log('[ADDONS] setGamePath OK');
    } catch (e) {
        console.error('[ADDONS] setGamePath FAIL:', e);
    }

    try {
        addonManager.setMainWindow(mainWindow);
        console.log('[ADDONS] setMainWindow OK');
    } catch (e) {
        console.error('[ADDONS] setMainWindow FAIL:', e);
    }

    try {
        console.log('[ADDONS] getGamePath() =', addonManager.getGamePath());
    } catch (e) {
        console.error('[ADDONS] getGamePath FAIL:', e);
    }

    console.log('[ADDONS] calling loadAddons...');
    addonManager.loadAddons()
        .then((addons) => {
            console.log('[ADDONS] loadAddons OK, addons =', Object.keys(addons || {}));
        })
        .catch((err) => {
            console.error('[ADDONS] loadAddons FAIL:', err && err.stack ? err.stack : err);
        });

    console.log('[ADDONS] calling startupUpdateCheck...');
    addonManager.startupUpdateCheck()
        .then((updated) => {
            console.log('[ADDONS] startupUpdateCheck OK, updated =', updated);
        })
        .catch((err) => {
            console.error('[ADDONS] startupUpdateCheck FAIL:', err && err.stack ? err.stack : err);
        });

    console.log('[ADDONS] calling checkAllAddonsVersions...');
    addonManager.checkAllAddonsVersions()
        .then((res) => {
            console.log('[ADDONS] checkAllAddonsVersions OK, updates =', res && res.updates);
        })
        .catch((err) => {
            console.error('[ADDONS] checkAllAddonsVersions FAIL:', err && err.stack ? err.stack : err);
        });

    console.log('[ADDONS] calling startBackgroundChecker...');
    try {
        addonManager.startBackgroundChecker();
        console.log('[ADDONS] startBackgroundChecker OK');
    } catch (e) {
        console.error('[ADDONS] startBackgroundChecker FAIL:', e);
    }

    console.log('[ADDONS] initAddons done');
}

function stopAddons() {
    const state = require('./addonManager/state');
    if (state.state.updateInterval) {
        clearTimeout(state.state.updateInterval);
        state.state.updateInterval = null;
    }
}

module.exports = {
    initAddons,
    stopAddons
};