// main/addonManager.js
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const os = require('os');
const { setupLogging } = require('./utils');

const logger = setupLogging();
let checkingUpdate = false;

class AddonData {
  constructor(name, config) {
    this.name = name;
    this.link = config.link;
    this.description = config.description;
    this.target_path = config.target_path.replace(/\//g, path.sep);
    this.installed = false;
    this.updating = false;
    this.needs_update = false;
    this.being_processed = false;
    this.is_zip = config.is_zip !== undefined ? config.is_zip : true;
  }
}

class AddonManager {
  constructor() {
    this.addons = {};
    this.loadAddons();
  }

  async loadAddonsConfig() {
    try {
      const response = await axios.get('https://raw.githubusercontent.com/Vladgobelen/NSQCu/main/addons.json', {
        headers: { 'User-Agent': 'NightWatchUpdater' },
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      logger.error('Error loading addons config:', error.message);
      if (error.code === 'ECONNABORTED') {
        throw new Error('Таймаут при загрузке конфигурации. Проверьте подключение к интернету.');
      }
      throw new Error('Failed to load addons configuration');
    }
  }

  async loadAddons() {
    try {
      const config = await this.loadAddonsConfig();
      this.addons = {};
      for (const [name, configData] of Object.entries(config.addons)) {
        this.addons[name] = new AddonData(name, configData);
      }
      this.checkInstalled();
      return this.addons;
    } catch (error) {
      logger.error('Error loading addons:', error);
      throw error;
    }
  }

  checkInstalled() {
    for (const addon of Object.values(this.addons)) {
      try {
        if (addon.name === 'NSQC') {
          const versPath = path.join(process.cwd(), addon.target_path, 'NSQC', 'vers');
          addon.installed = fs.existsSync(versPath);
        } else {
          const targetDir = path.join(process.cwd(), addon.target_path);
          if (!fs.existsSync(targetDir)) {
            addon.installed = false;
            continue;
          }
          const items = fs.readdirSync(targetDir);
          addon.installed = items.some(item => 
            item.toLowerCase().includes(addon.name.toLowerCase())
          );
        }
      } catch (error) {
        logger.error(`Error checking addon ${addon.name}:`, error);
        addon.installed = false;
      }
    }
  }

  async checkNSQCUpdate(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (checkingUpdate) return;
    checkingUpdate = true;
    try {
      const addon = this.addons['NSQC'];
      if (!addon || !addon.installed) return;
      const localVer = await this._getLocalNSQCVersion();
      const remoteVer = await this._getRemoteNSQCVersion();
      if (!localVer || !remoteVer) {
        addon.needs_update = false;
        return;
      }
      addon.needs_update = remoteVer !== localVer;
      if (addon.needs_update && !addon.being_processed) {
        mainWindow.webContents.send('addon-update-available', 'NSQC');
      }
    } catch (error) {
      logger.error('Error checking NSQC update:', error);
    } finally {
      checkingUpdate = false;
    }
  }

  async _getLocalNSQCVersion() {
    try {
      const versPath = path.join(process.cwd(), 'Interface', 'AddOns', 'NSQC', 'vers');
      if (!fs.existsSync(versPath)) return null;
      return fs.readFileSync(versPath, 'utf-8').trim();
    } catch (error) {
      logger.error('Error reading local NSQC version:', error);
      return null;
    }
  }

  async _getRemoteNSQCVersion() {
    try {
      const response = await axios.get(
        'https://raw.githubusercontent.com/Vladgobelen/NSQC/main/vers',
        { headers: { 'User-Agent': 'NightWatchUpdater' }, timeout: 5000 }
      );
      return response.data.trim();
    } catch (error) {
      logger.error('Error getting remote NSQC version:', error);
      return null;
    }
  }

  async toggleAddon(name, install, mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const addon = this.addons[name];
    if (!addon) {
      logger.error(`Addon ${name} not found`);
      throw new Error(`Аддон ${name} не найден`);
    }
    if (addon.being_processed) {
      logger.warn(`Addon ${name} is already being processed`);
      throw new Error(`Аддон ${name} уже обрабатывается`);
    }
    addon.being_processed = true;
    addon.updating = true;
    try {
      if (install) {
        if (name === 'NSQC') {
          await this._installNSQC(addon, mainWindow);
        } else {
          await this._installAddon(addon, mainWindow);
        }
      } else {
        await this._uninstallAddon(addon, mainWindow);
      }
      this.checkInstalled();
      if (name === 'NSQC') {
        await this.checkNSQCUpdate(mainWindow);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('operation-finished', name, true);
      }
    } catch (error) {
      logger.error(`Error ${install ? 'installing' : 'uninstalling'} addon ${name}:`, error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('operation-error', error.message);
      }
      throw error;
    } finally {
      addon.updating = false;
      addon.being_processed = false;
    }
  }

  async _installNSQC(addon, mainWindow) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', addon.name, 0.1);
    }
    const localVer = await this._getLocalNSQCVersion();
    const remoteVer = await this._getRemoteNSQCVersion();
    if (localVer === remoteVer && localVer) {
      logger.info('NSQC is already up to date');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 1.0);
      }
      return;
    }
    const tempDir = path.join(os.tmpdir(), 'nsqc_temp');
    const zipPath = path.join(os.tmpdir(), 'nsqc_main.zip');
    try {
      if (fs.existsSync(tempDir)) await fs.remove(tempDir);
      if (fs.existsSync(zipPath)) await fs.unlink(zipPath);
    } catch (error) {
      logger.warn('Error cleaning up previous temp files:', error);
    }
    try {
      logger.info('Downloading NSQC...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.15);
      }
      const response = await axios.get(
        'https://github.com/Vladgobelen/NSQC/archive/refs/heads/main.zip',
        { responseType: 'stream', headers: { 'User-Agent': 'NightWatchUpdater' }, timeout: 30000 }
      );
      const writer = fs.createWriteStream(zipPath);
      let downloaded = 0;
      const totalLength = parseInt(response.headers['content-length'], 10) || 0;
      response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalLength > 0 && mainWindow && !mainWindow.isDestroyed()) {
          const progress = 0.15 + 0.6 * (downloaded / totalLength);
          mainWindow.webContents.send('progress', addon.name, progress);
        }
      });
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      logger.info('Download completed, extracting...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.75);
      }
      await fs.ensureDir(tempDir);
      await fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: tempDir }))
        .promise();
      const targetDir = path.join(process.cwd(), 'Interface', 'AddOns', 'NSQC');
      if (fs.existsSync(targetDir)) {
        await fs.remove(targetDir);
      }
      await fs.copy(path.join(tempDir, 'NSQC-main'), targetDir);
      if (remoteVer) {
        await fs.writeFile(path.join(targetDir, 'vers'), remoteVer);
      }
      logger.info('NSQC installed successfully');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.95);
      }
      try {
        if (fs.existsSync(tempDir)) await fs.remove(tempDir);
        if (fs.existsSync(zipPath)) await fs.unlink(zipPath);
      } catch (error) {
        logger.warn('Error cleaning up temp files:', error);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 1.0);
      }
    } catch (error) {
      logger.error('Error installing NSQC:', error);
      try {
        if (fs.existsSync(tempDir)) await fs.remove(tempDir);
        if (fs.existsSync(zipPath)) await fs.unlink(zipPath);
      } catch (cleanupError) {
        logger.error('Error cleaning up after failed installation:', cleanupError);
      }
      throw error;
    }
  }

  async _installAddon(addon, mainWindow) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', addon.name, 0.1);
    }
    const targetDir = path.join(process.cwd(), addon.target_path);
    await fs.ensureDir(targetDir);

    // Определяем, является ли файл .zip или .mpq
    const isZipFile = addon.link.toLowerCase().endsWith('.zip');
    const isMpqFile = addon.link.toLowerCase().endsWith('.mpq');

    // Если это .mpq — скачиваем напрямую
    if (isMpqFile) {
      const targetPath = path.join(targetDir, path.basename(addon.link));
      try {
        logger.info(`Downloading .mpq file: ${addon.name}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('progress', addon.name, 0.2);
        }
        const response = await axios.get(addon.link, {
          responseType: 'stream',
          headers: { 'User-Agent': 'NightWatchUpdater' },
          timeout: 30000
        });
        const writer = fs.createWriteStream(targetPath);
        let downloaded = 0;
        const totalLength = parseInt(response.headers['content-length'], 10) || 0;
        response.data.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalLength > 0 && mainWindow && !mainWindow.isDestroyed()) {
            const progress = 0.2 + 0.7 * (downloaded / totalLength);
            mainWindow.webContents.send('progress', addon.name, progress);
          }
        });
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        logger.info(`${addon.name} downloaded successfully`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('progress', addon.name, 1.0);
        }
        return;
      } catch (error) {
        logger.error(`Error downloading .mpq file ${addon.name}:`, error);
        try {
          if (fs.existsSync(targetPath)) {
            await fs.unlink(targetPath);
          }
        } catch (cleanupError) {
          logger.warn('Error cleaning up after failed download:', cleanupError);
        }
        throw error;
      }
    }

    // Для ZIP-файлов — обычная логика
    const tempZip = path.join(os.tmpdir(), `${addon.name}.zip`);
    try {
      logger.info(`Downloading ${addon.name}...`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.15);
      }
      const response = await axios.get(addon.link, {
        responseType: 'stream',
        headers: { 'User-Agent': 'NightWatchUpdater' },
        timeout: 30000
      });
      const writer = fs.createWriteStream(tempZip);
      let downloaded = 0;
      const totalLength = parseInt(response.headers['content-length'], 10) || 0;
      response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalLength > 0 && mainWindow && !mainWindow.isDestroyed()) {
          const progress = 0.15 + 0.6 * (downloaded / totalLength);
          mainWindow.webContents.send('progress', addon.name, progress);
        }
      });
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      logger.info('Download completed, extracting...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.75);
      }
      await fs.createReadStream(tempZip)
        .pipe(unzipper.Extract({ path: targetDir }))
        .promise();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.9);
      }
      const installedItems = fs.readdirSync(targetDir);
      const installed = installedItems.some(item => 
        item.toLowerCase().includes(addon.name.toLowerCase())
      );
      if (!installed) {
        throw new Error(`Addon ${addon.name} not found after installation`);
      }
      logger.info(`${addon.name} installed successfully`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.95);
      }
      try {
        if (fs.existsSync(tempZip)) {
          await fs.unlink(tempZip);
        }
      } catch (error) {
        logger.warn('Error cleaning up temp file:', error);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 1.0);
      }
    } catch (error) {
      logger.error(`Error installing ${addon.name}:`, error);
      try {
        if (fs.existsSync(tempZip)) {
          await fs.unlink(tempZip);
        }
      } catch (cleanupError) {
        logger.error('Error cleaning up after failed installation:', cleanupError);
      }
      throw error;
    }
  }

  async _uninstallAddon(addon, mainWindow) {
    const targetDir = path.join(process.cwd(), addon.target_path);
    if (!fs.existsSync(targetDir)) {
      logger.info(`Target directory ${targetDir} does not exist, nothing to uninstall`);
      return;
    }
    const items = fs.readdirSync(targetDir);
    const itemsToRemove = items.filter(item => 
      item.toLowerCase().includes(addon.name.toLowerCase())
    );
    if (itemsToRemove.length === 0) {
      logger.info(`No items found to uninstall for ${addon.name}`);
      return;
    }
    let success = true;
    logger.info(`Uninstalling ${addon.name}, removing ${itemsToRemove.length} items`);
    for (let i = 0; i < itemsToRemove.length; i++) {
      const item = itemsToRemove[i];
      try {
        const itemPath = path.join(targetDir, item);
        await fs.remove(itemPath);
        logger.info(`Removed: ${itemPath}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('progress', addon.name, 0.1 + 0.8 * ((i + 1) / itemsToRemove.length));
        }
      } catch (error) {
        logger.error(`Error removing ${item}:`, error);
        success = false;
      }
    }
    if (!success) {
      throw new Error('Failed to completely uninstall addon');
    }
    logger.info(`${addon.name} uninstalled successfully`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', addon.name, 0.95);
    }
    this.checkInstalled();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', addon.name, 1.0);
    }
  }

  async launchGame() {
    const wowPath = path.join(process.cwd(), 'Wow.exe');
    if (!fs.existsSync(wowPath)) {
      logger.error('Wow.exe not found');
      return false;
    }
    try {
      logger.info('Launching game...');
      if (process.platform === 'win32') {
        require('child_process').exec(`start "" "${wowPath}"`);
      } else {
        require('child_process').spawn(wowPath);
      }
      return true;
    } catch (error) {
      logger.error('Error launching game:', error);
      return false;
    }
  }
}

module.exports = new AddonManager();