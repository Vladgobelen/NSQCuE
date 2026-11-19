const state = require('./state');

function emitProgress(name, progress) {
  const { mainWindow } = state.state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('progress', name, progress);
  }
}

function emitBlockLaunch(shouldBlock) {
  const { mainWindow } = state.state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('block-launch-game', shouldBlock);
  }
}

function emitEvent(event, data) {
  const { mainWindow } = state.state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, data);
  }
}

module.exports = { emitProgress, emitBlockLaunch, emitEvent };