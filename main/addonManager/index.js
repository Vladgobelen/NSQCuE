const state = require('./state');

// Фундамент
const { sleep } = require('./sleep');
const { emitProgress, emitBlockLaunch, emitEvent } = require('./events');

// Хелперы
const { decodeFileName, candidateFileNames, getLinks } = require('./paths');
const {
  getLocalVersion,
  getRemoteVersion,
  parseVersion,
  versionsEqual,
} = require('./versions');

// Конфиг и сборка
const { fetchConfigWithFallback } = require('./config');
const { buildAddonFromConfig, computeNeedsUpdate } = require('./addonBuilder');
const { checkInstalled } = require('./installChecker');

// Скачивание и распаковка
const { downloadFile, downloadWithFallback } = require('./downloader');
const { handleArchiveStructure } = require('./archive');
const { installAddon } = require('./installer');
const { uninstallAddon } = require('./uninstaller');
const { cancelDownload, clearCancel, isCancelled } = require('./cancel');

// Операции верхнего уровня
const { loadAddons } = require('./loadAddons');
const { toggleAddon } = require('./toggleAddon');
const { forceReinstall } = require('./reinstall');

// Автообновление
const {
  fetchRemoteVersion,
  readLocalVersion,
  isUpdateNeeded,
  checkOne,
  startupUpdateCheck,
  checkForUpdates,
} = require('./autoUpdate');

const { checkAllAddonsVersions, buildVersionsSnapshot } = require('./checkAllVersions');
const { startBackgroundChecker } = require('./backgroundChecker');
const { launchGame } = require('./launchGame');

// ─────────────────────────────────────────────────────────────
//  Публичный API (совместим со старым addonManager.js)
// ─────────────────────────────────────────────────────────────
module.exports = {
  // state
  setMainWindow: state.setMainWindow,
  setGamePath: state.setGamePath,
  getGamePath: state.getGamePath,

  // config / load
  loadAddons,
  fetchConfigWithFallback,

  // builder / checker
  buildAddonFromConfig,
  computeNeedsUpdate,
  checkInstalled,

  // paths / versions (на случай внешнего использования)
  decodeFileName,
  candidateFileNames,
  getLinks,
  getLocalVersion,
  getRemoteVersion,
  parseVersion,
  versionsEqual,

  // download / archive
  downloadFile,
  downloadWithFallback,
  handleArchiveStructure,
  installAddon,
  uninstallAddon,

  // cancel
  cancelDownload,
  clearCancel,
  isCancelled,

  // operations
  toggleAddon,
  forceReinstall,

  // auto-update
  fetchRemoteVersion,
  readLocalVersion,
  isUpdateNeeded,
  checkOne,
  startupUpdateCheck,
  checkForUpdates,

  // versions snapshot / background
  checkAllAddonsVersions,
  buildVersionsSnapshot,
  startBackgroundChecker,

  // launch
  launchGame,

  // helpers (на случай внешнего использования)
  sleep,
  emitProgress,
  emitBlockLaunch,
  emitEvent,
};