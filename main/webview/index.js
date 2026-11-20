// Публичный API модуля. Всё, что использовалось из старого main/webview.js,
// доступно по тем же именам — менять импорты в других файлах не нужно.
const { setWebviewWebContents, getWebviewWebContents } = require('./state');
const { getSoundsMap, findSoundFile, playSoundSilent, SOUNDS_DIR } = require('./sounds');
const { sendToOverlay, sendToWebClient } = require('./overlay');
const { setupWebviewHandlers } = require('./setup');

module.exports = {
  setupWebviewHandlers,
  getWebviewWebContents,
  getSoundsMap,
  findSoundFile,
  playSoundSilent,
  sendToOverlay,
  sendToWebClient,
  SOUNDS_DIR,
};