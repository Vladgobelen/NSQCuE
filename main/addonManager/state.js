const state = {
  addons: {},
  gamePath: null,
  mainWindow: null,

  checkingUpdate: false,
  isReinstalling: false,
  reinstallQueue: null,

  loadingAddons: false,
  loadingAddonsPromise: null,

  updateInterval: null,
  _tickCounter: 0,

  _lastConfig: null,

  // Флаг отмены для бесконечных попыток (Set имён аддонов)
  _cancelDownloads: new Set(),

  // Время последней авто-проверки каждого автообновляемого аддона
  _lastAutoCheck: {},
};

function setMainWindow(win) {
  state.mainWindow = win;
}

function setGamePath(p) {
  state.gamePath = p;
}

function getGamePath() {
  if (!state.gamePath) throw new Error('Game path is not set.');
  return state.gamePath;
}

module.exports = {
  state,
  setMainWindow,
  setGamePath,
  getGamePath,
};