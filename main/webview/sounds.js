const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils').setupLogging();

const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');

// Антидубль: один звук может прийти по нескольким каналам
// (ELECTRON_SOUND + логи клиента) почти одновременно.
const SOUND_DEDUP_MS = 500;
let lastPlayedPath = null;
let lastPlayedAt = 0;

function getSoundsMap() {
  const map = {};
  try {
    if (fs.existsSync(SOUNDS_DIR)) {
      for (const file of fs.readdirSync(SOUNDS_DIR)) {
        if (file.toLowerCase().endsWith('.mp3')) {
          map[file.replace(/\.mp3$/i, '')] = file;
        }
      }
    }
  } catch (e) {
    console.error('[SOUNDS] ошибка чтения папки:', e.message);
    logger.error(`[SOUNDS] Error reading sounds dir: ${e.message}`);
  }
  return map;
}

function findSoundFile(soundType) {
  console.log(`[SOUND] findSoundFile: "${soundType}"`);

  const soundMap = getSoundsMap();
  const fileName = soundMap[soundType];
  if (fileName) {
    const p = path.join(SOUNDS_DIR, fileName);
    if (fs.existsSync(p)) {
      console.log(`[SOUND] найден по карте: ${p}`);
      return p;
    }
  }

  const direct = path.join(SOUNDS_DIR, `${soundType}.mp3`);
  if (fs.existsSync(direct)) {
    console.log(`[SOUND] найден напрямую: ${direct}`);
    return direct;
  }

  const resource = app.isPackaged
    ? path.join(process.resourcesPath, 'sounds', `${soundType}.mp3`)
    : path.join(__dirname, '..', '..', 'sounds', `${soundType}.mp3`);
  if (fs.existsSync(resource)) {
    console.log(`[SOUND] найден в ресурсах: ${resource}`);
    return resource;
  }

  console.error(
    `[SOUND] НЕ НАЙДЕН: "${soundType}". Доступные звуки: ${JSON.stringify(Object.keys(soundMap))}`
  );
  logger.error(
    `[SOUND] not found: ${soundType}, dir=${SOUNDS_DIR}, known=${JSON.stringify(Object.keys(soundMap))}`
  );
  return null;
}

function playSoundSilent(filePath) {
  console.log(`[SOUND] playSoundSilent: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`[SOUND] файл не существует: ${filePath}`);
    logger.error(`[SOUND] File not found: ${filePath}`);
    return;
  }

  const now = Date.now();
  if (filePath === lastPlayedPath && now - lastPlayedAt < SOUND_DEDUP_MS) {
    console.log('[SOUND] дубль (второй канал) — пропуск');
    return;
  }
  lastPlayedPath = filePath;
  lastPlayedAt = now;

  const { getWebviewWebContents } = require('./state');
  const wc = getWebviewWebContents();
  if (!wc || wc.isDestroyed()) {
    console.warn('[SOUND] webview недоступен — звук НЕ проигран');
    logger.warn('[SOUND] webview unavailable');
    return;
  }

  let audioData;
  try {
    audioData = fs.readFileSync(filePath);
  } catch (e) {
    console.error(`[SOUND] ошибка чтения файла: ${e.message}`);
    logger.error(`[SOUND] read failed: ${e.message}`);
    return;
  }

  const base64 = audioData.toString('base64');
  console.log(`[SOUND] файл прочитан: ${audioData.length} байт → base64 ${base64.length} символов`);

  // Передаём base64, декодируем в Blob — не упираемся в лимиты
  // executeJavaScript на больших mp3; CSP media-src разрешает blob:.
  const code = `
(function() {
  try {
    var b64 = '${base64}';
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    var blob = new Blob([bytes], { type: 'audio/mpeg' });
    var url = URL.createObjectURL(blob);
    var audio = new Audio(url);
    audio.volume = 1.0;
    audio.onended = function() {
      URL.revokeObjectURL(url);
      console.log('[SOUND][WEBVIEW] playback ended');
    };
    audio.onerror = function() {
      console.error('[SOUND][WEBVIEW] audio error, code=' + (audio.error && audio.error.code));
      URL.revokeObjectURL(url);
    };
    audio.play()
      .then(function() { console.log('[SOUND][WEBVIEW] play() OK'); })
      .catch(function(e) { console.error('[SOUND][WEBVIEW] play() FAIL: ' + (e && e.message)); });
    console.log('[SOUND][WEBVIEW] audio created, bytes=' + len);
  } catch (e) {
    console.error('[SOUND][WEBVIEW] exception: ' + (e && e.message));
  }
})();
`;

  wc.executeJavaScript(code)
    .then(() => {
      console.log('[SOUND] код проигрывания внедрён в webview');
    })
    .catch((err) => {
      console.error('[SOUND] executeJavaScript FAIL:', err.message);
      logger.error(`[SOUND] Web Audio error: ${err.message}`);
    });
}

function logSoundsDir() {
  try {
    const files = fs.existsSync(SOUNDS_DIR) ? fs.readdirSync(SOUNDS_DIR) : [];
    console.log(`[SOUNDS] DIR=${SOUNDS_DIR} files=${JSON.stringify(files)}`);
    logger.info(`[SOUNDS] DIR=${SOUNDS_DIR} files=${JSON.stringify(files)}`);
  } catch (e) {
    console.warn('[SOUNDS] readdir failed:', e.message);
    logger.warn(`[SOUNDS] readdir failed: ${e.message}`);
  }
}

module.exports = { SOUNDS_DIR, getSoundsMap, findSoundFile, playSoundSilent, logSoundsDir };