const logger = require('./logger');
const state = require('./state');
const {
  BACKGROUND_CHECK_INTERVAL,
  ALL_ADDONS_CHECK_EVERY_N_TICKS,
} = require('./constants');
const { checkForUpdates } = require('./autoUpdate');
const { checkAllAddonsVersions } = require('./checkAllVersions');

function startBackgroundChecker() {
  if (state.state.updateInterval) clearTimeout(state.state.updateInterval);

  let failCount = 0;
  state.state._tickCounter = 0;

  const tick = async () => {
    if (state.state.checkingUpdate) return schedule();
    state.state.checkingUpdate = true;

    state.state._tickCounter++;
    const doAllAddonsCheck =
      state.state._tickCounter % ALL_ADDONS_CHECK_EVERY_N_TICKS === 0;

    try {
      const updated = await checkForUpdates();
      if (updated === false) failCount = 0;

      if (doAllAddonsCheck) {
        logger.info('[BACKGROUND_CHECK] Пора проверять все аддоны');
        try {
          await checkAllAddonsVersions();
        } catch (e) {
          logger.warn(
            '[BACKGROUND_CHECK] checkAllAddonsVersions failed:',
            e.message
          );
        }
      }
    } catch (e) {
      failCount++;
      logger.error('[BACKGROUND_CHECK]', e.message);
    } finally {
      state.state.checkingUpdate = false;
      schedule();
    }
  };

  const schedule = () => {
    const delay = Math.min(
      BACKGROUND_CHECK_INTERVAL * Math.pow(2, Math.min(failCount, 4)),
      5 * 60 * 1000
    );
    state.state.updateInterval = setTimeout(tick, delay);
  };

  schedule();
}

module.exports = { startBackgroundChecker };