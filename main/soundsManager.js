const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');
const logger = require('./utils').setupLogging();

// Папка, в которую складываются все звуки (кастомные, из разделов, базовые).
// Совпадает с SOUNDS_DIR в main/webview/sounds.js — не менять отдельно.
const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');

const SOUNDS_CONFIG_URLS = [
  'https://gitlab.com/Vladgobelen/NSQCu/-/raw/main/sounds.json',
  'https://raw.githubusercontent.com/Vladgobelen/NSQCu/refs/heads/main/sounds.json',
];

const NET_TIMEOUT = 10000;

// ─────────────────────────────────────────────────────────────
//  Утилиты
// ─────────────────────────────────────────────────────────────
function ensureSoundsDir() {
  fs.ensureDirSync(SOUNDS_DIR);
}

async function isSoundsDirEmpty() {
  try {
    ensureSoundsDir();
    const files = await fs.readdir(SOUNDS_DIR);
    return files.filter((f) => f.toLowerCase().endsWith('.mp3')).length === 0;
  } catch (e) {
    logger.warn(`[SOUNDS] isSoundsDirEmpty failed: ${e.message}`);
    return true;
  }
}

// ─────────────────────────────────────────────────────────────
//  Конфиг разделов
// ─────────────────────────────────────────────────────────────
async function fetchSoundsConfig() {
  for (const url of SOUNDS_CONFIG_URLS) {
    try {
      console.log(`[SOUNDS] Fetching config: ${url}`);
      logger.info(`[SOUNDS] Fetching config: ${url}`);

      const res = await axios.get(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        },
        params: { _t: Date.now() },
        timeout: NET_TIMEOUT,
        maxRedirects: 5,
        responseType: 'text',
        transformResponse: [(d) => d],
        validateStatus: null,
      });

      if (res.status < 200 || res.status >= 300) {
        console.warn(`[SOUNDS] HTTP ${res.status} from ${url}`);
        logger.warn(`[SOUNDS] HTTP ${res.status} from ${url}`);
        continue;
      }

      let config;
      try {
        config = JSON.parse(String(res.data));
      } catch (e) {
        console.warn(`[SOUNDS] JSON parse error from ${url}: ${e.message}`);
        logger.warn(`[SOUNDS] JSON parse error from ${url}: ${e.message}`);
        continue;
      }

      if (!config || typeof config !== 'object' || !config.sections) {
        console.warn(`[SOUNDS] No 'sections' in response from ${url}`);
        logger.warn(`[SOUNDS] No 'sections' in response from ${url}`);
        continue;
      }

      const names = Object.keys(config.sections);
      console.log(`[SOUNDS] Config loaded from ${url}, sections: ${JSON.stringify(names)}`);
      logger.info(`[SOUNDS] Config loaded from ${url} (sections: ${names.length})`);
      return config;
    } catch (e) {
      console.warn(`[SOUNDS] Failed ${url}: ${e.message}`);
      logger.warn(`[SOUNDS] Failed ${url}: ${e.message}`);
    }
  }
  throw new Error('Failed to load sounds config from all sources');
}

// ─────────────────────────────────────────────────────────────
//  Скачивание раздела
// ─────────────────────────────────────────────────────────────
// Поддерживаются ОБА формата раздела:
//   старый: { "message": "https://.../message.mp3", ... }
//   новый:  [ { name: 'message', url: 'https://.../message.mp3' }, ... ]
// Новый soundsManager понимал только массив — со старым sounds.json
// разделы получались пустыми и звуки не скачивались.
function resolveSectionFiles(section) {
  const files = [];

  if (Array.isArray(section)) {
    for (const item of section) {
      if (typeof item === 'string') {
        files.push({ name: path.basename(item).replace(/\.mp3$/i, ''), url: item });
      } else if (item && typeof item === 'object') {
        const url = item.url || item.link || item.file;
        const name = item.name || (url ? path.basename(url).replace(/\.mp3$/i, '') : null);
        if (url && name) {
          files.push({ name, url });
        } else {
          console.warn('[SOUNDS] элемент массива без url/name:', JSON.stringify(item));
        }
      }
    }
  } else if (section && typeof section === 'object') {
    for (const [name, url] of Object.entries(section)) {
      if (typeof url === 'string' && url) {
        files.push({ name, url });
      } else {
        console.warn(`[SOUNDS] ключ "${name}" без строки-url — пропуск`);
      }
    }
  }

  return files;
}

async function downloadSection(sectionName, config, onProgress) {
  ensureSoundsDir();

  const section = config.sections[sectionName];
  if (!section) throw new Error(`Section not found: ${sectionName}`);

  const files = resolveSectionFiles(section);
  console.log(`[SOUNDS] Раздел "${sectionName}": файлов ${files.length}`);
  logger.info(`[SOUNDS] section "${sectionName}": ${files.length} files`);

  if (files.length === 0) throw new Error(`Section is empty: ${sectionName}`);

  let done = 0;
  let ok = 0;

  for (const { name, url } of files) {
    const dest = path.join(SOUNDS_DIR, `${name}.mp3`);
    try {
      console.log(`[SOUNDS] Download ${sectionName}/${name} ← ${url}`);
      logger.info(`[SOUNDS] Download ${sectionName}/${name} <- ${url}`);

      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'NightWatchUpdater/1.0', Accept: '*/*' },
        timeout: NET_TIMEOUT * 3,
        maxRedirects: 5,
        validateStatus: null,
      });

      if (res.status < 200 || res.status >= 300) {
        console.warn(`[SOUNDS] HTTP ${res.status} for ${url}`);
        logger.warn(`[SOUNDS] HTTP ${res.status} for ${url}`);
        continue;
      }

      const buf = Buffer.from(res.data);
      if (!buf || buf.length === 0) {
        console.warn(`[SOUNDS] пустой файл: ${url}`);
        logger.warn(`[SOUNDS] Empty file for ${url}`);
        continue;
      }

      await fs.writeFile(dest, buf);
      ok++;
      console.log(`[SOUNDS] Saved ${dest} (${buf.length} байт)`);
      logger.info(`[SOUNDS] Saved ${dest} (${buf.length} bytes)`);
    } catch (e) {
      console.error(`[SOUNDS] Failed ${url}: ${e.message}`);
      logger.error(`[SOUNDS] Failed ${url}: ${e.message}`);
    } finally {
      done++;
      if (typeof onProgress === 'function') {
        onProgress({ current: done, total: files.length, sound: name });
      }
    }
  }

  console.log(`[SOUNDS] Раздел "${sectionName}" завершён: ${ok}/${files.length}`);
  logger.info(`[SOUNDS] section "${sectionName}" done: ${ok}/${files.length}`);
}

// ─────────────────────────────────────────────────────────────
//  Автозагрузка базовых звуков при старте
// ─────────────────────────────────────────────────────────────
async function autoDownloadBaseSounds() {
  ensureSoundsDir();

  const empty = await isSoundsDirEmpty();
  if (!empty) {
    console.log('[SOUNDS] Папка звуков не пуста — автозагрузка пропущена');
    logger.info('[SOUNDS] Sounds dir not empty, skip auto-download');
    return;
  }

  console.log('[SOUNDS] Папка звуков пуста — пробуем автозагрузку');
  logger.info('[SOUNDS] Sounds dir is empty, trying auto-download...');

  let config;
  try {
    config = await fetchSoundsConfig();
  } catch (e) {
    console.warn('[SOUNDS] Автозагрузка пропущена (нет конфига):', e.message);
    logger.warn(`[SOUNDS] Auto-download skipped (no config): ${e.message}`);
    return;
  }

  // Приоритет: "Стандартные" (старый конфиг) → "base" → первый раздел.
  const sectionNames = Object.keys(config.sections || {});
  const baseSection =
    sectionNames.find((n) => n.toLowerCase() === 'стандартные') ||
    sectionNames.find((n) => n.toLowerCase() === 'base') ||
    sectionNames[0];

  if (!baseSection) {
    console.warn('[SOUNDS] В конфиге нет разделов — автозагрузка пропущена');
    logger.warn('[SOUNDS] No sections in config, skip auto-download');
    return;
  }

  console.log(`[SOUNDS] Автозагрузка раздела: "${baseSection}"`);
  logger.info(`[SOUNDS] Auto-downloading section: ${baseSection}`);

  try {
    await downloadSection(baseSection, config);
    console.log('[SOUNDS] Автозагрузка завершена');
    logger.info('[SOUNDS] Auto-download finished');
  } catch (e) {
    console.error('[SOUNDS] Автозагрузка не удалась:', e.message);
    logger.error(`[SOUNDS] Auto-download failed: ${e.message}`);
  }
}

module.exports = {
  SOUNDS_DIR,
  ensureSoundsDir,
  isSoundsDirEmpty,
  fetchSoundsConfig,
  downloadSection,
  autoDownloadBaseSounds,
};