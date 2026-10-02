const { app } = require('electron');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const os = require('os');
const { spawn } = require('child_process');
const { setupLogging } = require('./utils');
const logger = setupLogging();

// ─────────────────────────────────────────────────────────────
//  КОНСТАНТЫ
// ─────────────────────────────────────────────────────────────
const CONFIG_URLS = [
  'https://ns.fiber-gate.ru/addons/addons.json',
  'https://gitlab.com/Vladgobelen/NSQCu/-/raw/main/addons.json',
  'https://raw.githubusercontent.com/Vladgobelen/NSQCu/refs/heads/main/addons.json',
  'https://gitlab.com/Vladgobelen/nsqcmap/-/raw/main/addons.json',
];

const NSQC4_VERSION_URL =
  'https://raw.githubusercontent.com/Vladgobelen/NSQC4/main/VERSION.lua';

const AUTO_UPDATE_ADDON = 'NSQC4';

const BACKGROUND_CHECK_INTERVAL = 30 * 1000;
const POST_INSTALL_DELAY = 3000;
const NET_TIMEOUT_CONFIG = 10000;
const NET_TIMEOUT_ADDON = 30000;
const NET_TIMEOUT_VERSION = 15000;

// ─────────────────────────────────────────────────────────────
//  AddonManager
// ─────────────────────────────────────────────────────────────
class AddonManager {
  constructor() {
    this.addons = {};
    this.gamePath = null;
    this.mainWindow = null;

    // Мьютексы
    this.checkingUpdate = false;
    this.isReinstalling = false;
    this.reinstallQueue = null;

    // Мьютекс на loadAddons
    this.loadingAddons = false;
    this.loadingAddonsPromise = null;

    this.updateInterval = null;
  }

  setMainWindow(win) { this.mainWindow = win; }
  setGamePath(p) { this.gamePath = p; }

  getGamePath() {
    if (!this.gamePath) throw new Error('Game path is not set.');
    return this.gamePath;
  }

  // ───────────────────────────────────────────────────────────
  //  Хелперы для имён файлов
  // ───────────────────────────────────────────────────────────

  /**
   * Безопасно декодирует имя файла, полученное из URL.
   * `%20` → пробел, `%2B` → `+`. Если декодировать нельзя — возвращает как есть.
   */
  _decodeFileName(rawName) {
    if (!rawName) return rawName;
    try {
      // decodeURIComponent делает ОДНО декодирование.
      // Если в строке был двойной энкод (%2520), останется %20 — это ожидаемо,
      // т.к. сервер не должен был отдавать двойной энкод.
      return decodeURIComponent(rawName);
    } catch {
      return rawName;
    }
  }

  /**
   * Возвращает ВСЕ возможные варианты имени файла для поиска на диске:
   *  - декодированное (нормальное: "patch AIO.mpq")
   *  - исходное из URL (заэнкоженное: "patch%20AIO.mpq")
   * Нужно для обратной совместимости со старыми установками.
   */
  _candidateFileNames(link) {
    const base = path.basename(link || '');
    if (!base) return [];
    const decoded = this._decodeFileName(base);
    const set = new Set([base, decoded]);
    // На случай двойного энкода
    const decodedTwice = this._decodeFileName(decoded);
    if (decodedTwice && decodedTwice !== decoded) set.add(decodedTwice);
    return Array.from(set).map((s) => s.toLowerCase());
  }

  // ───────────────────────────────────────────────────────────
  //  Загрузка конфигурации с fallback + диагностика
  // ───────────────────────────────────────────────────────────
  async _fetchConfigWithFallback() {
    const total = CONFIG_URLS.length;

    for (let i = 0; i < total; i++) {
      const url = CONFIG_URLS[i];
      this._emitEvent(this.mainWindow, 'config-source-status', {
        index: i + 1, total, url, state: 'trying',
      });

      try {
        logger.info(`[CONFIG] Trying: ${url}`);

        const response = await axios.get(url, {
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
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
          this._emitEvent(this.mainWindow, 'config-source-status', {
            index: i + 1, total, url, state: 'failed',
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
          this._emitEvent(this.mainWindow, 'config-source-status', {
            index: i + 1, total, url, state: 'failed',
          });
          continue;
        }

        if (!config || typeof config !== 'object' || !config.addons) {
          logger.warn(
            `[CONFIG] No 'addons' in response from ${url} ` +
            `(type=${typeof config}, keys=${config && typeof config === 'object' ? Object.keys(config).join(',') : 'n/a'}, ` +
            `preview="${preview}...")`
          );
          this._emitEvent(this.mainWindow, 'config-source-status', {
            index: i + 1, total, url, state: 'failed',
          });
          continue;
        }

        const addonCount = Object.keys(config.addons).length;
        logger.info(
          `[CONFIG] Loaded from: ${url} (addons: ${addonCount})`
        );
        this._emitEvent(this.mainWindow, 'config-source-status', {
          index: i + 1, total, url, state: 'loaded',
        });
        return config;
      } catch (error) {
        logger.warn(
          `[CONFIG] Failed ${url}: ${error.message || error} ` +
          `(code=${error.code || 'n/a'})`
        );
        this._emitEvent(this.mainWindow, 'config-source-status', {
          index: i + 1, total, url, state: 'failed',
        });
      }
    }
    throw new Error('Failed to load config from all sources');
  }

  // ───────────────────────────────────────────────────────────
  //  Разбор cfg → нормализованный addon
  // ───────────────────────────────────────────────────────────
  _buildAddonFromConfig(name, cfg) {
    const link = cfg.link || '';
    const description = cfg.description || '';
    const targetPath = cfg.target_path || '';
    const isZip = cfg.is_zip !== undefined
      ? cfg.is_zip
      : !link.toLowerCase().endsWith('.mpq');

    const wrapInFolder = cfg.wrap_in_folder !== undefined
      ? !!cfg.wrap_in_folder
      : (isZip && /(^|\/)AddOns\/?$/i.test(targetPath.replace(/\\/g, '/')));

    return {
      name,
      description,
      installed: false,
      needs_update: false,
      being_processed: false,
      updating: false,
      link,
      target_path: targetPath.replace(/\//g, path.sep),
      is_zip: isZip,
      wrap_in_folder: wrapInFolder,
    };
  }

  // ───────────────────────────────────────────────────────────
  //  loadAddons — с мьютексом
  // ───────────────────────────────────────────────────────────
  async loadAddons() {
    if (this.loadingAddons) {
      logger.info('[LOAD_ADDONS] Уже выполняется, ждём завершения');
      return this.loadingAddonsPromise;
    }

    this.loadingAddons = true;
    this.loadingAddonsPromise = (async () => {
      try {
        const config = await this._fetchConfigWithFallback();
        const gamePath = this.getGamePath();
        const newNames = new Set(Object.keys(config.addons));

        // Удаляем аддоны, которых больше нет в конфиге
        for (const name of Object.keys(this.addons)) {
          if (!newNames.has(name)) delete this.addons[name];
        }

        // Обновляем/создаём
        for (const [name, cfg] of Object.entries(config.addons)) {
          const built = this._buildAddonFromConfig(name, cfg);
          built.installed = this._checkInstalled(name, cfg.target_path || '', gamePath, built.link);

          const existing = this.addons[name];
          if (existing) {
            Object.assign(existing, {
              description: built.description,
              installed: built.installed,
              link: built.link,
              target_path: built.target_path,
              is_zip: built.is_zip,
              wrap_in_folder: built.wrap_in_folder,
            });
          } else {
            this.addons[name] = built;
          }
        }

        logger.info(`[LOAD_ADDONS] Загружено аддонов: ${Object.keys(this.addons).length}`);
        return this.addons;
      } catch (err) {
        logger.error('[LOAD_ADDONS] Ошибка:', err.message);
        throw err;
      } finally {
        this.loadingAddons = false;
        this.loadingAddonsPromise = null;
      }
    })();

    return this.loadingAddonsPromise;
  }

  // ───────────────────────────────────────────────────────────
  //  Проверка установки
  // ───────────────────────────────────────────────────────────
  _checkInstalled(name, targetPath, gamePath, link) {
    if (!gamePath) return false;
    const fullTarget = path.join(gamePath, targetPath);
    if (!fs.existsSync(fullTarget)) return false;

    const lowerName = name.toLowerCase();

    try {
      const items = fs.readdirSync(fullTarget, { withFileTypes: true });
      const namesLower = items.map((it) => it.name.toLowerCase());

      // Точное совпадение имени папки/файла с именем аддона
      if (namesLower.includes(lowerName)) return true;

      // Для NSQC4 — папка NSQC4 внутри AddOns
      if (name === AUTO_UPDATE_ADDON) {
        const nsqcDir = path.join(fullTarget, AUTO_UPDATE_ADDON);
        if (fs.existsSync(nsqcDir)) return true;
      }

      // MPQ-патчи: ищем файл как по имени аддона, так и по имени из URL
      if (lowerName.endsWith('.mpq')) {
        // 1. Имя аддона + .mpq
        if (namesLower.includes(`${lowerName}.mpq`)) return true;
        // 2. Имя из URL (декодированное / заэнкоженное / двойное)
        const candidates = this._candidateFileNames(link);
        for (const cand of candidates) {
          if (namesLower.includes(cand)) return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────
  //  Версия NSQC4
  // ───────────────────────────────────────────────────────────
  async _fetchRemoteNSQC4Version() {
    logger.info(`[VERSION] Запрос: ${NSQC4_VERSION_URL}`);
    const res = await axios.get(NSQC4_VERSION_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/plain, */*',
      },
      params: { _t: Date.now() },
      timeout: NET_TIMEOUT_VERSION,
      maxRedirects: 5,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: null,
    });

    logger.info(`[VERSION] Статус: ${res.status}, len=${(res.data || '').length}`);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`VERSION.lua HTTP ${res.status}`);
    }
    const text = String(res.data);
    return this._parseVersionLua(text);
  }

  _parseVersionLua(text) {
    const majorMatch = text.match(/major\s*=\s*(\d+)/i);
    const minorMatch = text.match(/minor\s*=\s*(\d+)/i);
    if (!majorMatch || !minorMatch) {
      throw new Error('VERSION.lua: не найдены major/minor');
    }
    return {
      major: parseInt(majorMatch[1], 10),
      minor: parseInt(minorMatch[1], 10),
    };
  }

  _readLocalNSQC4Version() {
    try {
      const gamePath = this.getGamePath();
      const versFile = path.join(
        gamePath, 'Interface', 'AddOns', AUTO_UPDATE_ADDON, 'VERSION.lua'
      );
      if (!fs.existsSync(versFile)) return null;
      const text = fs.readFileSync(versFile, 'utf-8');
      return this._parseVersionLua(text);
    } catch (e) {
      logger.warn(`[VERSION] Локальный VERSION.lua не прочитан: ${e.message}`);
      return null;
    }
  }

  _versionsEqual(a, b) {
    if (!a || !b) return false;
    return a.major === b.major && a.minor === b.minor;
  }

  // ───────────────────────────────────────────────────────────
  //  startupUpdateCheck
  // ───────────────────────────────────────────────────────────
  async startupUpdateCheck(mainWindow) {
    this._emitBlockLaunch(mainWindow, true);
    try {
      const gamePath = this.getGamePath();
      if (!gamePath) return false;

      const local = this._readLocalNSQC4Version();
      if (!local) {
        logger.info('[STARTUP] NSQC4 не установлен локально — пропуск');
        return false;
      }

      logger.info(`[STARTUP] Локальная версия NSQC4: ${local.major}.${local.minor}`);
      const remote = await this._fetchRemoteNSQC4Version();
      logger.info(`[STARTUP] Удалённая версия NSQC4: ${remote.major}.${remote.minor}`);

      if (this._versionsEqual(local, remote)) {
        logger.info(`[STARTUP] Версия актуальна: ${remote.major}.${remote.minor}`);
        return false;
      }

      logger.info(
        `[STARTUP] Обновление: локально ${local.major}.${local.minor} → ` +
        `удалённо ${remote.major}.${remote.minor}`
      );
      await this._forceReinstall(mainWindow, [AUTO_UPDATE_ADDON]);
      return true;
    } catch (err) {
      logger.error('[STARTUP] Ошибка проверки:', err.message);
      return false;
    } finally {
      setTimeout(() => this._emitBlockLaunch(mainWindow, false), POST_INSTALL_DELAY);
    }
  }

  // ───────────────────────────────────────────────────────────
  //  startBackgroundChecker
  // ───────────────────────────────────────────────────────────
  startBackgroundChecker(mainWindow) {
    if (this.updateInterval) clearTimeout(this.updateInterval);

    let failCount = 0;

    const tick = async () => {
      if (this.checkingUpdate) return schedule();
      this.checkingUpdate = true;
      try {
        const updated = await this._checkForUpdates(mainWindow);
        if (updated === false) failCount = 0;
      } catch (e) {
        failCount++;
        logger.error('[BACKGROUND_CHECK]', e.message);
      } finally {
        this.checkingUpdate = false;
        schedule();
      }
    };

    const schedule = () => {
      const delay = Math.min(
        BACKGROUND_CHECK_INTERVAL * Math.pow(2, Math.min(failCount, 4)),
        5 * 60 * 1000
      );
      this.updateInterval = setTimeout(tick, delay);
    };

    schedule();
  }

  async _checkForUpdates(mainWindow) {
    const gamePath = this.getGamePath();
    if (!gamePath) return false;

    const local = this._readLocalNSQC4Version();
    if (!local) return false;

    const remote = await this._fetchRemoteNSQC4Version();
    if (this._versionsEqual(local, remote)) return false;

    logger.info(`[UPDATE_CHECK] Доступно обновление NSQC4`);
    await this._forceReinstall(mainWindow, [AUTO_UPDATE_ADDON]);
    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  _forceReinstall
  // ───────────────────────────────────────────────────────────
  async _forceReinstall(mainWindow, addonNames) {
    if (this.isReinstalling) {
      logger.info('[REINSTALL] Уже выполняется, ждём завершения');
      return this.reinstallQueue;
    }

    this.isReinstalling = true;
    this.reinstallQueue = (async () => {
      try {
        const config = await this._fetchConfigWithFallback();
        for (const addonName of addonNames) {
          const cfg = config.addons[addonName];
          if (!cfg) {
            logger.warn(`[REINSTALL] ${addonName} нет в конфиге — пропуск`);
            continue;
          }

          const addon = this._buildAddonFromConfig(addonName, cfg);
          addon.installed = true;
          addon.being_processed = true;
          addon.updating = true;

          this._emitEvent(mainWindow, 'addon-install-started',
            { name: addonName, install: true });
          this._emitProgress(mainWindow, addonName, 0.1);

          try {
            await this._uninstallAddon(addon, mainWindow);
            this._emitProgress(mainWindow, addonName, 0.4);
            await this._sleep(200);

            await this._installAddon(addon, mainWindow);

            const gamePath = this.getGamePath();
            const ok = this._checkInstalled(addonName, addon.target_path, gamePath, addon.link);
            if (ok) {
              logger.info(`[REINSTALL] ${addonName} OK, ждём ${POST_INSTALL_DELAY}мс`);
              await this._sleep(POST_INSTALL_DELAY);
            } else {
              logger.warn(`[REINSTALL] ${addonName} не подтверждён`);
            }

            this._emitProgress(mainWindow, addonName, 1.0);

            if (this.addons[addonName]) {
              Object.assign(this.addons[addonName], {
                being_processed: false,
                updating: false,
                installed: true,
                needs_update: false,
              });
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('operation-finished', addonName, true);
            }
          } catch (err) {
            logger.error(`[REINSTALL] ${addonName}:`, err.message);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('operation-error', err.message || 'Unknown error');
            }
          }
          await this._sleep(300);
        }
        await this.loadAddons();
      } finally {
        this.isReinstalling = false;
        this.reinstallQueue = null;
      }
    })();

    return this.reinstallQueue;
  }

  // ───────────────────────────────────────────────────────────
  //  toggleAddon
  // ───────────────────────────────────────────────────────────
  async toggleAddon(name, install, mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return false;

    const addon = this.addons[name];
    if (!addon) throw new Error(`Addon ${name} not found`);
    if (addon.being_processed) throw new Error(`Addon ${name} is already processing`);

    addon.being_processed = true;
    addon.updating = true;
    this._emitBlockLaunch(mainWindow, true);
    this._emitProgress(mainWindow, name, 0.1);

    try {
      if (install) {
        await this._installAddon(addon, mainWindow);

        const gamePath = this.getGamePath();
        const ok = this._checkInstalled(name, addon.target_path, gamePath, addon.link);
        if (ok) {
          logger.info(`[TOGGLE] ${name} установлен, ждём ${POST_INSTALL_DELAY}мс`);
          await this._sleep(POST_INSTALL_DELAY);
        } else {
          logger.warn(`[TOGGLE] ${name} не подтверждён`);
          await this._sleep(1000);
        }
      } else {
        await this._uninstallAddon(addon, mainWindow);
      }
    } catch (error) {
      logger.error(`[TOGGLE] ${install ? 'install' : 'uninstall'} ${name}:`,
        error.message);
      throw error;
    } finally {
      addon.being_processed = false;
      addon.updating = false;
    }

    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('operation-finished', name, true);
        this._emitBlockLaunch(mainWindow, false);
      }
    }, POST_INSTALL_DELAY);

    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  _installAddon
  // ───────────────────────────────────────────────────────────
  async _installAddon(addon, mainWindow) {
    this._emitProgress(mainWindow, addon.name, 0.15);

    const gamePath = this.getGamePath();
    const targetDir = path.join(gamePath, addon.target_path);
    await fs.ensureDir(targetDir);

    const isMpq = addon.link.toLowerCase().endsWith('.mpq');
    const stamp = Date.now();
    const tempDir = path.join(os.tmpdir(), `extract_${addon.name}_${stamp}`);
    const tempFile = path.join(
      os.tmpdir(),
      `download_${addon.name}_${stamp}${isMpq ? '.mpq' : '.zip'}`
    );

    try {
      logger.info(`[INSTALL] ${addon.name}: скачивание ${addon.link}`);
      await this._downloadFile(addon.link, tempFile, (frac) => {
        const base = 0.15;
        const span = isMpq ? 0.60 : 0.50;
        this._emitProgress(mainWindow, addon.name, base + span * frac);
      });
      logger.info(`[INSTALL] ${addon.name}: скачано, распаковка`);

      if (isMpq) {
        // ✅ ВАЖНО: декодируем имя файла из URL, чтобы получить нормальное
        // имя на диске (без %20, %2B). Иначе WoW не найдёт патч.
        const rawName = path.basename(addon.link);
        const decodedName = this._decodeFileName(rawName);
        const mpqPath = path.join(targetDir, decodedName);

        // Если на диске уже лежит файл с заэнкоженным именем — удалим его
        // (последствие старой версии приложения)
        const altPath = path.join(targetDir, rawName);
        if (altPath !== mpqPath && await fs.pathExists(altPath)) {
          try { await fs.remove(altPath); } catch { /* ignore */ }
        }

        await fs.move(tempFile, mpqPath, { overwrite: true });
        logger.info(`[INSTALL] ${addon.name}: MPQ перемещён в ${mpqPath}`);
      } else {
        await fs.ensureDir(tempDir);
        await new Promise((resolve, reject) => {
          fs.createReadStream(tempFile)
            .pipe(unzipper.Extract({ path: tempDir }))
            .on('close', resolve)
            .on('error', reject);
        });
        logger.info(`[INSTALL] ${addon.name}: распаковано, разбор структуры`);
        await this._handleArchiveStructure(
          tempDir,
          targetDir,
          addon.name,
          addon.wrap_in_folder !== false
        );
      }

      this._emitProgress(mainWindow, addon.name, 1.0);
      logger.info(`[INSTALL] ${addon.name}: завершено`);
    } catch (error) {
      logger.error(`[INSTALL] ${addon.name}:`, error.message);
      throw new Error(`Failed to install ${addon.name}: ${error.message || 'Unknown error'}`);
    } finally {
      await Promise.allSettled([
        fs.remove(tempDir).catch(() => {}),
        fs.remove(tempFile).catch(() => {}),
      ]);
    }
  }

  // ───────────────────────────────────────────────────────────
  //  Скачивание с прогрессом
  // ───────────────────────────────────────────────────────────
  async _downloadFile(url, dest, onProgress) {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`Некорректная ссылка: ${url}`);
    }
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'NightWatchUpdater/1.0',
      },
      timeout: NET_TIMEOUT_ADDON,
      maxRedirects: 5,
      validateStatus: null,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} при скачивании ${url}`);
    }

    const totalLength = parseInt(response.headers['content-length'], 10) || 0;
    let downloaded = 0;
    if (onProgress && totalLength > 0) {
      response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        onProgress(Math.min(downloaded / totalLength, 1));
      });
    }

    const writer = fs.createWriteStream(dest);
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  // ───────────────────────────────────────────────────────────
  //  Разбор архива
  // ───────────────────────────────────────────────────────────
  async _handleArchiveStructure(tempDir, targetDir, addonName, wrapInFolder) {
    const topEntries = await fs.readdir(tempDir, { withFileTypes: true });

    let sourceDir = tempDir;
    if (topEntries.length === 1 && topEntries[0].isDirectory()) {
      sourceDir = path.join(tempDir, topEntries[0].name);
    }

    const inner = await fs.readdir(sourceDir, { withFileTypes: true });

    if (wrapInFolder) {
      const destDir = path.join(targetDir, addonName);

      const namedDir = inner.find(
        (e) => e.isDirectory() && e.name.toLowerCase() === addonName.toLowerCase()
      );

      if (namedDir) {
        const src = path.join(sourceDir, namedDir.name);
        if (await fs.pathExists(destDir)) await fs.remove(destDir);
        await fs.move(src, destDir, { overwrite: true });
        logger.info(`[ARCHIVE] ${addonName}: папка-аддон перемещена в ${destDir}`);
        return;
      }

      if (await fs.pathExists(destDir)) await fs.remove(destDir);
      await fs.ensureDir(destDir);

      for (const e of inner) {
        const src = path.join(sourceDir, e.name);
        const dst = path.join(destDir, e.name);
        await fs.move(src, dst, { overwrite: true });
      }
      logger.info(`[ARCHIVE] ${addonName}: содержимое обёрнуто в ${destDir}`);
      return;
    }

    for (const e of inner) {
      const src = path.join(sourceDir, e.name);
      const dst = path.join(targetDir, e.name);
      if (e.isDirectory()) {
        await fs.copy(src, dst);
      } else {
        await fs.copyFile(src, dst);
      }
    }
    logger.info(`[ARCHIVE] ${addonName}: распаковано плоско в ${targetDir}`);
  }

  // ───────────────────────────────────────────────────────────
  //  Удаление
  // ───────────────────────────────────────────────────────────
  async _uninstallAddon(addon, mainWindow) {
    const gamePath = this.getGamePath();
    const targetDir = path.join(gamePath, addon.target_path);

    if (!(await fs.pathExists(targetDir))) {
      this._emitProgress(mainWindow, addon.name, 1.0);
      return;
    }

    const items = await fs.readdir(targetDir, { withFileTypes: true });
    const lowerName = addon.name.toLowerCase();

    // Возможные имена файлов MPQ: по имени аддона и по имени из URL
    const candidates = new Set([
      lowerName,
      `${lowerName}.mpq`,
      `${lowerName}.zip`,
    ]);
    for (const cand of this._candidateFileNames(addon.link)) {
      candidates.add(cand);
      candidates.add(`${cand}.mpq`);
      candidates.add(`${cand}.zip`);
    }

    const toRemove = items.filter((i) => {
      const n = i.name.toLowerCase();
      // Точное совпадение с любым кандидатом
      if (candidates.has(n)) return true;
      // Префикс по имени аддона (name-, name_)
      if (n.startsWith(`${lowerName}-`) || n.startsWith(`${lowerName}_`)) return true;
      // Заэнкоженный вариант имени аддона как префикс (обратная совместимость)
      const encodedName = encodeURIComponent(addon.name).toLowerCase();
      if (n.startsWith(`${encodedName}-`) || n.startsWith(`${encodedName}_`)) return true;
      return false;
    });

    logger.info(`[UNINSTALL] ${addon.name}: к удалению ${toRemove.length} элементов`);
    for (const item of toRemove) {
      logger.info(`[UNINSTALL] ${addon.name}: удаляю ${item.name}`);
    }

    for (let i = 0; i < toRemove.length; i++) {
      const progress = 0.1 + 0.8 * ((i + 1) / toRemove.length);
      this._emitProgress(mainWindow, addon.name, progress);
      await fs.remove(path.join(targetDir, toRemove[i].name));
    }
    this._emitProgress(mainWindow, addon.name, 1.0);
  }

  // ───────────────────────────────────────────────────────────
  //  Запуск игры
  // ───────────────────────────────────────────────────────────
  async launchGame() {
    const gamePath = this.getGamePath();
    const wowPath = path.join(gamePath, 'Wow.exe');
    if (!fs.existsSync(wowPath)) return false;

    try {
      const child = spawn(wowPath, [], {
        cwd: gamePath,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return true;
    } catch (e) {
      logger.error('[LAUNCH]', e.message);
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────
  //  Хелперы
  // ───────────────────────────────────────────────────────────
  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  _emitProgress(mainWindow, name, progress) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', name, progress);
    }
  }

  _emitBlockLaunch(mainWindow, shouldBlock) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('block-launch-game', shouldBlock);
    }
  }

  _emitEvent(mainWindow, event, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(event, data);
    }
  }
}

module.exports = new AddonManager();