const axios = require('axios');
const https = require('https');
const fs = require('fs-extra');
const logger = require('./logger');
const { emitEvent } = require('./events');
const { sleep } = require('./sleep');
const { isCancelled } = require('./cancel');
const {
  NET_TIMEOUT_ADDON,
  DOWNLOAD_RETRY_DELAY,
} = require('./constants');

async function downloadFile(url, dest, onProgress, addonName, attemptCallback) {
  console.log('[DOWNLOAD] downloadFile START');
  console.log('[DOWNLOAD]   url =', url);
  console.log('[DOWNLOAD]   dest =', dest);
  console.log('[DOWNLOAD]   addonName =', addonName);

  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Некорректная ссылка: ${url}`);
  }

  let attempt = 0;

  while (true) {
    if (addonName && isCancelled(addonName)) {
      console.warn(`[DOWNLOAD] ${addonName}: отменено пользователем`);
      throw new Error('CANCELLED');
    }

    attempt++;
    console.log(`[DOWNLOAD] попытка #${attempt}`);
    const agent = new https.Agent({ keepAlive: false });

    try {
      console.log('[DOWNLOAD] → axios.get()');
      const response = await axios.get(url, {
        responseType: 'stream',
        headers: {
          'User-Agent': 'NightWatchUpdater/1.0',
          'Accept': '*/*',
          'Connection': 'close',
        },
        timeout: NET_TIMEOUT_ADDON,
        maxRedirects: 5,
        validateStatus: null,
        httpsAgent: agent,
        decompress: true,
      });
      console.log('[DOWNLOAD] ← axios.get() status =', response.status);
      console.log('[DOWNLOAD]   content-length =', response.headers['content-length']);
      console.log('[DOWNLOAD]   content-type =', response.headers['content-type']);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }

      const totalLength =
        parseInt(response.headers['content-length'], 10) || 0;
      let downloaded = 0;

      if (onProgress && totalLength > 0) {
        response.data.on('data', (chunk) => {
          downloaded += chunk.length;
          onProgress(Math.min(downloaded / totalLength, 1));
        });
        console.log('[DOWNLOAD] прогресс-хук установлен, totalLength =', totalLength);
      } else {
        console.log('[DOWNLOAD] прогресс-хук НЕ установлен (totalLength =', totalLength, ')');
      }

      console.log('[DOWNLOAD] → pipe to', dest);
      const writer = fs.createWriteStream(dest);
      await new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
        writer.on('close', resolve);
      });
      console.log('[DOWNLOAD] ← pipe OK');

      const stat = await fs.stat(dest).catch(() => null);
      console.log('[DOWNLOAD] stat =', stat ? { size: stat.size } : null);
      if (!stat || stat.size === 0) {
        throw new Error('Скачан пустой файл');
      }

      console.log(`[DOWNLOAD] END ${url}: успех (${stat.size} байт, попытка ${attempt})`);
      logger.info(`[DOWNLOAD] ${url}: успех (${stat.size} байт, попытка ${attempt})`);
      return;
    } catch (err) {
      const msg = err.message || err.code || String(err);
      console.warn(`[DOWNLOAD] ошибка на попытке ${attempt}: ${msg}`);
      logger.warn(`[DOWNLOAD] ${url}: ошибка на попытке ${attempt}: ${msg}`);
      try {
        await fs.remove(dest);
      } catch {}

      if (attemptCallback) {
        try {
          attemptCallback(attempt, url, msg);
        } catch {}
      }

      if (addonName && isCancelled(addonName)) {
        console.warn(`[DOWNLOAD] ${addonName}: отменено во время паузы`);
        throw new Error('CANCELLED');
      }

      console.log(`[DOWNLOAD] пауза ${DOWNLOAD_RETRY_DELAY}мс перед попыткой ${attempt + 1}`);
      await sleep(DOWNLOAD_RETRY_DELAY);
    }
  }
}

async function downloadWithFallback(urls, dest, onProgress, addonName) {
  console.log('[DOWNLOAD_WITH_FALLBACK] START');
  console.log('[DOWNLOAD_WITH_FALLBACK] urls =', urls);
  console.log('[DOWNLOAD_WITH_FALLBACK] dest =', dest);
  console.log('[DOWNLOAD_WITH_FALLBACK] addonName =', addonName);

  const errors = [];
  let attemptCounter = 0;
  let linkIndex = 0;

  while (true) {
    const url = urls[linkIndex];
    console.log(
      `[DOWNLOAD_WITH_FALLBACK] ссылка ${linkIndex + 1}/${urls.length} — ${url}`
    );

    try {
      await downloadFile(
        url,
        dest,
        onProgress,
        addonName,
        (attempt, attemptedUrl, errMsg) => {
          attemptCounter++;
          console.log(
            `[DOWNLOAD_WITH_FALLBACK] attempt event #${attemptCounter}: ${attemptedUrl} — ${errMsg}`
          );
          emitEvent('download-attempt', {
            addonName,
            attempt: attemptCounter,
            url: attemptedUrl,
            linkIndex: linkIndex + 1,
            linkTotal: urls.length,
            error: errMsg,
          });
        }
      );

      console.log(`[DOWNLOAD_WITH_FALLBACK] END успех с ${url}`);
      return { usedUrl: url };
    } catch (err) {
      const msg = err.message || err.code || String(err);

      if (msg === 'CANCELLED') {
        console.warn('[DOWNLOAD_WITH_FALLBACK] отменено — проброс');
        throw err;
      }

      console.warn(`[DOWNLOAD_WITH_FALLBACK] ссылка ${url} не сработала: ${msg}`);
      errors.push(`${url} → ${msg}`);
      try {
        await fs.remove(dest);
      } catch {}

      linkIndex = (linkIndex + 1) % urls.length;
      console.log('[DOWNLOAD_WITH_FALLBACK] следующая ссылка, пауза 1000мс');
      await sleep(1000);
    }
  }
}

module.exports = { downloadFile, downloadWithFallback };