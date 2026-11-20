const logger = require('../utils').setupLogging();
const { findSoundFile, playSoundSilent } = require('./sounds');

// Резервный канал: ipcRenderer.sendToHost('play-sound', ...) из webview.
// В текущей конфигурации webview (nodeIntegration=no, sandbox=yes)
// ipcRenderer недоступен, поэтому канал фактически мёртв. Оставлен
// на случай, если кто-то включит nodeIntegration в webview.
function handleIpcMessage(channel, args) {
  if (channel === 'play-sound') {
    const soundType = args[0];
    const p = findSoundFile(soundType);
    if (p) playSoundSilent(p);
    else logger.error(`[WEBVIEW] Sound file not found: ${soundType}`);
  }
}

module.exports = { handleIpcMessage };