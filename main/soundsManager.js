const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

const SOUNDS_CONFIG_URL = 'https://raw.githubusercontent.com/Vladgobelen/NSQCu/main/sounds.json';
const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');

/**
 * Проверка: пуста ли папка кастомных звуков (нет .mp3 файлов)
 */
async function isSoundsDirEmpty() {
  try {
    await fs.ensureDir(SOUNDS_DIR);
    const files = await fs.readdir(SOUNDS_DIR);
    const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
    return mp3Files.length === 0;
  } catch (error) {
    console.error('[SOUNDS] Error checking sounds dir:', error.message);
    return true; // Treat errors as "empty" to trigger download
  }
}

/**
 * Скачивание файла по URL в указанную папку
 */
async function downloadFileFromUrl(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 30000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'NSQCuE-Sounds/1.0' }
  });
  
  const writer = fs.createWriteStream(destPath);
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Получение конфигурации звуков (парсинг sounds.json)
 */
async function fetchSoundsConfig() {
  try {
    const response = await axios.get(SOUNDS_CONFIG_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'NSQCuE-Sounds/1.0' }
    });
    return response.data;
  } catch (error) {
    console.error('[SOUNDS] Failed to fetch config:', error.message);
    throw new Error(`Не удалось загрузить конфигурацию звуков: ${error.message}`);
  }
}

/**
 * Получение списка доступных разделов
 */
function getSections(config) {
  if (!config?.sections) return [];
  return Object.keys(config.sections);
}

/**
 * Скачивание всех файлов из указанного раздела
 * @param {string} sectionName - имя раздела (например, "Стандартные")
 * @param {object} config - конфигурация из sounds.json
 * @param {function} onProgress - колбэк для прогресса (optional)
 */
async function downloadSection(sectionName, config, onProgress = null) {
  const section = config.sections?.[sectionName];
  if (!section) {
    throw new Error(`Раздел "${sectionName}" не найден в конфигурации`);
  }

  await fs.ensureDir(SOUNDS_DIR);
  
  const entries = Object.entries(section);
  const total = entries.length;
  
  for (let i = 0; i < total; i++) {
    const [soundKey, url] = entries[i];
    const fileName = `${soundKey}.mp3`;
    const destPath = path.join(SOUNDS_DIR, fileName);
    
    try {
      await downloadFileFromUrl(url, destPath);
      if (onProgress) {
        onProgress({ 
          current: i + 1, 
          total, 
          sound: soundKey, 
          success: true 
        });
      }
    } catch (error) {
      console.error(`[SOUNDS] Failed to download ${soundKey}:`, error.message);
      if (onProgress) {
        onProgress({ 
          current: i + 1, 
          total, 
          sound: soundKey, 
          success: false, 
          error: error.message 
        });
      }
      // Continue with other files even if one fails
    }
  }
}

/**
 * Авто-загрузка базовых звуков при первом запуске
 * Скачивает раздел "Стандартные" если папка пуста
 */
async function autoDownloadBaseSounds() {
  if (!await isSoundsDirEmpty()) {
    return { skipped: true, reason: 'sounds_dir_not_empty' };
  }
  
  try {
    const config = await fetchSoundsConfig();
    if (!config.sections?.['Стандартные']) {
      return { skipped: true, reason: 'no_standard_section' };
    }
    
    await downloadSection('Стандартные', config);
    return { success: true, section: 'Стандартные' };
  } catch (error) {
    console.error('[SOUNDS] Auto-download failed:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  SOUNDS_DIR,
  isSoundsDirEmpty,
  fetchSoundsConfig,
  getSections,
  downloadSection,
  downloadFileFromUrl,
  autoDownloadBaseSounds
};