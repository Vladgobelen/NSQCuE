const addonManager = require('./addonManager');
const settings = require('./settings');
const logger = require('./utils').setupLogging();

function initAddons(mainWindow) {
    if (!settings.getGamePath()) {
        logger.warn('[ADDONS] Game path not set, skipping initialization');
        return;
    }
    addonManager.setGamePath(settings.getGamePath());
    addonManager.setMainWindow(mainWindow);

    // Загружаем список аддонов
    addonManager.loadAddons().catch(err => {
        logger.error('[ADDONS] Failed to load addons:', err.message);
    });

    // Проверяем обновления при старте
    addonManager.startupUpdateCheck(mainWindow).catch(err => {
        logger.error('[ADDONS] Startup update check failed:', err.message);
    });

    // Проверяем версии всех аддонов
    addonManager.checkAllAddonsVersions().catch(err => {
        logger.error('[ADDONS] checkAllAddonsVersions failed:', err.message);
    });

    // Запускаем фоновый чекер
    addonManager.startBackgroundChecker(mainWindow);
}

function stopAddons() {
    if (addonManager.updateInterval) {
        clearTimeout(addonManager.updateInterval);
        addonManager.updateInterval = null;
    }
}

module.exports = {
    initAddons,
    stopAddons
};