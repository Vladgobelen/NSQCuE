const axios = require('axios');
const logger = require('./logger');
const state = require('./state');
const { emitEvent } = require('./events');
const { CONFIG_URLS, NET_TIMEOUT_CONFIG } = require('./constants');

async function fetchConfigWithFallback() {
  const total = CONFIG_URLS.length;

  for (let i = 0; i < total; i++) {
    const url = CONFIG_URLS[i];

    emitEvent('config-source-status', {
      index: i + 1,
      total,
      url,
      state: 'trying',
    });

    try {
      logger.info(`[CONFIG] Trying: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        },
        params: { _t: Date.now() },
        timeout: NET_TIMEOUT_CONFIG,
        maxRedirects: 5,
        responseType: 'text',
        transformResponse: [(d) => d],
        validateStatus: null,
        decompress: true,
      });

      const status = response.status;
      const contentType = response.headers['content-type'] || 'n/a';
      const raw = response.data;
      const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const len = rawStr.length;
      const preview = rawStr.slice(0, 200).replace(/\s+/g, ' ');

      logger.info(
        `[CONFIG] Response from ${url} ` +
          `(status=${status}, content-type=${contentType}, len=${len})`
      );

      if (status < 200 || status >= 300) {
        logger.warn(
          `[CONFIG] HTTP ${status} from ${url} (preview="${preview}...")`
        );
        emitEvent('config-source-status', {
          index: i + 1,
          total,
          url,
          state: 'failed',
        });
        continue;
      }

      let config = null;
      try {
        config = JSON.parse(rawStr);
      } catch (parseErr) {
        logger.warn(
          `[CONFIG] JSON parse error from ${url}: ${parseErr.message} ` +
            `(preview="${preview}...")`
        );
        emitEvent('config-source-status', {
          index: i + 1,
          total,
          url,
          state: 'failed',
        });
        continue;
      }

      if (!config || typeof config !== 'object' || !config.addons) {
        logger.warn(
          `[CONFIG] No 'addons' in response from ${url} ` +
            `(type=${typeof config}, preview="${preview}...")`
        );
        emitEvent('config-source-status', {
          index: i + 1,
          total,
          url,
          state: 'failed',
        });
        continue;
      }

      const addonCount = Object.keys(config.addons).length;
      logger.info(`[CONFIG] Loaded from: ${url} (addons: ${addonCount})`);

      emitEvent('config-source-status', {
        index: i + 1,
        total,
        url,
        state: 'loaded',
      });

      state.state._lastConfig = config;
      return config;
    } catch (error) {
      logger.warn(
        `[CONFIG] Failed ${url}: ${error.message || error} ` +
          `(code=${error.code || 'n/a'})`
      );
      emitEvent('config-source-status', {
        index: i + 1,
        total,
        url,
        state: 'failed',
      });
    }
  }

  throw new Error('Failed to load config from all sources');
}

module.exports = { fetchConfigWithFallback };