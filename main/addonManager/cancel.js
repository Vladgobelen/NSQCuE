const logger = require('./logger');
const state = require('./state');

function cancelDownload(addonName) {
  state.state._cancelDownloads.add(addonName);
  logger.info(`[DOWNLOAD] ${addonName}: запрошена отмена`);
}

function clearCancel(addonName) {
  state.state._cancelDownloads.delete(addonName);
}

function isCancelled(addonName) {
  return state.state._cancelDownloads.has(addonName);
}

module.exports = { cancelDownload, clearCancel, isCancelled };