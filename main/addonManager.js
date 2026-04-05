const { app } = require('electron');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const os = require('os');
const { setupLogging } = require('./utils');

const logger = setupLogging();

class AddonManager {
  constructor() {
    this.addons = {};
    this.gamePath = null;
    this.checkingUpdate = false;
    this.updateInterval = null;
  }

  setGamePath(p) {
    this.gamePath = p;
  }

  getGamePath() {
    if (!this.gamePath) throw new Error('Game path is not set.');
    return this.gamePath;
  }

  async loadAddons() {
    try {
      const configUrl = 'https://raw.githubusercontent.com/Vladgobelen/NSQCu/main/addons.json';
      const response = await axios.get(configUrl, {
        headers: { 'User-Agent': 'NightWatchUpdater/1.0' },
        timeout: 10000,
        maxRedirects: 5
      });
      const config = response.data;
      if (!config.addons) throw new Error("No 'addons' field in config");

      this.addons = {};
      const gamePath = this.getGamePath();

      for (const [name, cfg] of Object.entries(config.addons)) {
        const link = cfg.link || '';
        const description = cfg.description || '';
        const targetPath = cfg.target_path || '';
        const isZip = cfg.is_zip !== undefined ? cfg.is_zip : !link.toLowerCase().endsWith('.mpq');
        const installed = this._checkInstalled(name, targetPath, gamePath);
        logger.info(`[LOAD] Addon ${name}: installed=${installed}`);

        this.addons[name] = {
          name,
          description,
          installed,
          needs_update: false,
          being_processed: false,
          updating: false,
          link,
          target_path: targetPath.replace(/\//g, path.sep),
          is_zip: isZip
        };
      }
      return this.addons;
    } catch (error) {
      logger.error('[LOAD_ADDONS] Error:', error.message || error);
      throw error;
    }
  }

  _checkInstalled(name, targetPath, gamePath) {
    if (!gamePath) return false;
    const fullTarget = path.join(gamePath, targetPath);

    if (name === 'NSQC') {
      const versPath = path.join(fullTarget, 'NSQC', 'vers');
      return fs.existsSync(versPath);
    }
    if (name === 'NSQC3') {
      const nsqc3Path = path.join(fullTarget, 'NSQC3');
      return fs.existsSync(nsqc3Path);
    }

    if (!fs.existsSync(fullTarget)) return false;
    try {
      const items = fs.readdirSync(fullTarget, { withFileTypes: true });
      // Совпадение по подстроке оставлено намеренно для захвата всех связанных файлов
      return items.some(item => item.name.toLowerCase().includes(name.toLowerCase()));
    } catch {
      return false;
    }
  }

  async startupUpdateCheck(mainWindow) {
    logger.info('[STARTUP_CHECK] Blocking launch, checking updates...');
    this._emitBlockLaunch(mainWindow, true);

    const gamePath = this.getGamePath();
    if (!gamePath) {
      this._emitBlockLaunch(mainWindow, false);
      return false;
    }

    const versPath = path.join(gamePath, 'Interface', 'AddOns', 'NSQC', 'vers');
    let localVersion = '';
    try {
      if (fs.existsSync(versPath)) {
        localVersion = fs.readFileSync(versPath, 'utf-8').trim();
      }
    } catch { /* ignore */ }

    if (!localVersion) {
      this._emitBlockLaunch(mainWindow, false);
      return false;
    }

    logger.info(`[STARTUP_CHECK] Local version: '${localVersion}'`);
    const githubUrl = 'https://github.com/Vladgobelen/NSQC/blob/main/vers';

    try {
      const res = await axios.get(githubUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000,
        maxRedirects: 5
      });
      const html = res.data;
      const found = html.includes(localVersion) || html.includes(this._htmlEscape(localVersion));

      if (found) {
        logger.info(`[STARTUP_CHECK] ✓ Version '${localVersion}' found - up to date`);
        this._emitBlockLaunch(mainWindow, false);
        return false;
      }

      logger.warn(`[STARTUP_CHECK] ✗ Version '${localVersion}' NOT found - UPDATE REQUIRED!`);
      await this._forceReinstall(mainWindow);
    } catch (err) {
      logger.error('[STARTUP_CHECK] Fetch error:', err.message || err);
    } finally {
      setTimeout(() => this._emitBlockLaunch(mainWindow, false), 3000);
    }
    return true;
  }

  startBackgroundChecker(mainWindow) {
    if (this.updateInterval) clearInterval(this.updateInterval);
    this.updateInterval = setInterval(async () => {
      if (this.checkingUpdate) return;
      this.checkingUpdate = true;
      try {
        await this._checkForUpdates(mainWindow);
      } catch (e) {
        logger.error('[BACKGROUND_CHECK] Error:', e.message || e);
      } finally {
        this.checkingUpdate = false;
      }
    }, 30000);
  }

  async _checkForUpdates(mainWindow) {
    const gamePath = this.getGamePath();
    if (!gamePath) return;

    const versPath = path.join(gamePath, 'Interface', 'AddOns', 'NSQC', 'vers');
    let localVersion = '';
    try {
      if (fs.existsSync(versPath)) localVersion = fs.readFileSync(versPath, 'utf-8').trim();
    } catch { return; }

    if (!localVersion) return;
    logger.info(`[UPDATE_CHECK] Local version: '${localVersion}'`);

    const githubUrl = 'https://github.com/Vladgobelen/NSQC/blob/main/vers';
    try {
      const res = await axios.get(githubUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000,
        maxRedirects: 5
      });
      const html = res.data;
      const found = html.includes(localVersion) || html.includes(this._htmlEscape(localVersion));

      if (found) {
        logger.info(`[UPDATE_CHECK] ✓ Up to date`);
        return;
      }

      logger.warn(`[UPDATE_CHECK] ✗ Update required!`);
      await this._forceReinstall(mainWindow);
    } catch (e) {
      logger.error('[UPDATE_CHECK] Error:', e.message || e);
    }
  }

  async _forceReinstall(mainWindow) {
    logger.info('[REINSTALL] Starting forced reinstall: NSQC & NSQC3');
    // 🔒 Блокируем запуск игры на время обновления
    this._emitBlockLaunch(mainWindow, true);

    const config = await this._fetchConfig();
    if (!config) throw new Error('Config fetch failed');

    const addonsToReinstall = ['NSQC', 'NSQC3'];

    for (const addonName of addonsToReinstall) {
      const cfg = config[addonName];
      if (!cfg) continue;

      const addon = {
        name: addonName,
        description: cfg.description || '',
        installed: true,
        needs_update: false,
        being_processed: true,
        updating: true,
        link: cfg.link || '',
        target_path: (cfg.target_path || '').replace(/\//g, path.sep),
        is_zip: cfg.is_zip !== undefined ? cfg.is_zip : !cfg.link.toLowerCase().endsWith('.mpq')
      };

      this._emitEvent(mainWindow, 'addon-install-started', { name: addonName, install: true });
      this._emitProgress(mainWindow, addonName, 0.1);

      try {
        logger.info(`[REINSTALL] Uninstalling ${addonName}...`);
        await this._uninstallAddon(addon, mainWindow);
        this._emitProgress(mainWindow, addonName, 0.4);
        await new Promise(r => setTimeout(r, 200));

        logger.info(`[REINSTALL] Installing ${addonName}...`);
        await this._installAddon(addon, mainWindow);
        this._emitProgress(mainWindow, addonName, 1.0);

        if (this.addons[addonName]) {
          Object.assign(this.addons[addonName], {
            being_processed: false,
            updating: false,
            installed: true,
            needs_update: false
          });
        }

        // ✅ Отправляем событие в формате, который ожидает preload.js: (event, name, success)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('operation-finished', addonName, true);
        }
      } catch (err) {
        logger.error(`[REINSTALL] Failed on ${addonName}:`, err.message || err);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('operation-error', err.message || 'Unknown error');
        }
      }

      await new Promise(r => setTimeout(r, 300));
    }

    await this.loadAddons();
    logger.info('[REINSTALL] Reinstall completed');

    // ⏱️ Разблокируем кнопку запуска через 3 секунды после полного завершения
    setTimeout(() => {
      this._emitBlockLaunch(mainWindow, false);
    }, 3000);
  }

  async _fetchConfig() {
    const configUrl = 'https://raw.githubusercontent.com/Vladgobelen/NSQCu/main/addons.json';
    const res = await axios.get(configUrl, { timeout: 10000, maxRedirects: 5 });
    return res.data.addons;
  }

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
      } else {
        await this._uninstallAddon(addon, mainWindow);
      }
      if (install && name === 'NSQC') {
        logger.info('[TOGGLE] NSQC installed, triggering NSQC3 auto-update');
        await this._autoUpdateNSQC3(mainWindow);
      }
    } catch (error) {
      logger.error(`[TOGGLE] Error ${install ? 'installing' : 'uninstalling'} ${name}:`, error.message || error);
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
    }, 3000);

    return true;
  }

  async _autoUpdateNSQC3(mainWindow) {
    logger.info('[AUTO_NSQC3] Checking NSQC3...');
    const nsqc3 = this.addons['NSQC3'];
    if (!nsqc3) return;

    const gamePath = this.getGamePath();
    if (this._checkInstalled('NSQC3', nsqc3.target_path, gamePath)) {
      logger.info('[AUTO_NSQC3] NSQC3 installed, uninstalling first...');
      await this._uninstallAddon(nsqc3, mainWindow);
    }
    logger.info('[AUTO_NSQC3] Installing fresh NSQC3...');
    await this._installAddon(nsqc3, mainWindow);
  }

  async _installAddon(addon, mainWindow) {
    logger.info(`[INSTALL] Installing ${addon.name}`);
    this._emitProgress(mainWindow, addon.name, 0.15);

    const gamePath = this.getGamePath();
    const targetDir = path.join(gamePath, addon.target_path);
    await fs.ensureDir(targetDir);

    const isMpq = addon.link.toLowerCase().endsWith('.mpq');
    const tempDir = path.join(os.tmpdir(), `extract_${addon.name}_${Date.now()}`);
    const tempZip = path.join(os.tmpdir(), `download_${addon.name}_${Date.now()}.zip`);

    try {
      if (isMpq) {
        const response = await axios.get(addon.link, {
          responseType: 'stream',
          headers: { 'User-Agent': 'NightWatchUpdater/1.0' },
          timeout: 30000,
          maxRedirects: 5
        });
        let downloaded = 0;
        const totalLength = parseInt(response.headers['content-length'], 10) || 0;
        response.data.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalLength > 0) {
            this._emitProgress(mainWindow, addon.name, 0.15 + 0.6 * (downloaded / totalLength));
          }
        });
        const writer = fs.createWriteStream(tempZip);
        await new Promise((resolve, reject) => {
          response.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        const mpqPath = path.join(targetDir, path.basename(addon.link));
        await fs.move(tempZip, mpqPath, { overwrite: true });
      } else {
        const response = await axios.get(addon.link, {
          responseType: 'stream',
          headers: { 'User-Agent': 'NightWatchUpdater/1.0' },
          timeout: 30000,
          maxRedirects: 5
        });
        let downloaded = 0;
        const totalLength = parseInt(response.headers['content-length'], 10) || 0;
        response.data.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalLength > 0) {
            this._emitProgress(mainWindow, addon.name, 0.15 + 0.5 * (downloaded / totalLength));
          }
        });
        const writer = fs.createWriteStream(tempZip);
        await new Promise((resolve, reject) => {
          response.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        await fs.ensureDir(tempDir);
        await new Promise((resolve, reject) => {
          fs.createReadStream(tempZip)
            .pipe(unzipper.Extract({ path: tempDir }))
            .on('close', resolve)
            .on('error', reject);
        });
        await this._handleGithubStructure(tempDir, targetDir, addon.name);
      }
      this._emitProgress(mainWindow, addon.name, 1.0);
      logger.info(`[INSTALL] Completed ${addon.name}`);
    } catch (error) {
      logger.error(`[INSTALL] Error ${addon.name}:`, error.message || error);
      throw new Error(`Failed to install ${addon.name}: ${error.message || 'Unknown error'}`);
    } finally {
      await Promise.allSettled([
        fs.remove(tempDir).catch(() => {}),
        fs.remove(tempZip).catch(() => {})
      ]);
    }
  }

  async _handleGithubStructure(tempDir, targetDir, addonName) {
    try {
      const entries = await fs.readdir(tempDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirName = entry.name;
          const expected = [`${addonName}-main`, `${addonName}-master`];
          if (expected.includes(dirName)) {
            const finalPath = path.join(targetDir, addonName);
            logger.info(`[STRUCTURE] Renaming ${dirName} -> ${addonName}`);
            if (await fs.pathExists(finalPath)) await fs.remove(finalPath);
            await fs.move(path.join(tempDir, dirName), finalPath);
            return;
          }
        }
      }
    } catch {}

    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(tempDir, entry.name);
      const dst = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await fs.copy(src, dst);
      } else {
        await fs.copyFile(src, dst);
      }
    }
  }

  async _uninstallAddon(addon, mainWindow) {
    logger.info(`[UNINSTALL] Uninstalling ${addon.name}`);
    const gamePath = this.getGamePath();
    const targetDir = path.join(gamePath, addon.target_path);

    if (!await fs.pathExists(targetDir)) {
      logger.info(`[UNINSTALL] Target dir not exists, skipping`);
      this._emitProgress(mainWindow, addon.name, 1.0);
      return;
    }

    const items = await fs.readdir(targetDir, { withFileTypes: true });
    const toRemove = items.filter(i => i.name.toLowerCase().includes(addon.name.toLowerCase()));

    for (let i = 0; i < toRemove.length; i++) {
      const progress = 0.1 + 0.8 * ((i + 1) / toRemove.length);
      this._emitProgress(mainWindow, addon.name, progress);
      const itemPath = path.join(targetDir, toRemove[i].name);
      await fs.remove(itemPath);
    }
    this._emitProgress(mainWindow, addon.name, 1.0);
    logger.info(`[UNINSTALL] Completed ${addon.name}`);
  }

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

  _htmlEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async launchGame() {
    const wowPath = path.join(this.getGamePath(), 'Wow.exe');
    if (!fs.existsSync(wowPath)) return false;
    try {
      require('child_process').exec(`start "" "${wowPath}"`, { cwd: this.getGamePath() });
      return true;
    } catch { return false; }
  }
}

module.exports = new AddonManager();