const { app } = require('electron');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const os = require('os');
const { setupLogging } = require('./utils');
const logger = setupLogging();
let checkingUpdate = false;
let gamePath = null;

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
  }
  
  // Устанавливаем путь к игре
  setGamePath(path) {
    gamePath = path;
    logger.info(`[ADDON_MANAGER] Game path set to: ${gamePath}`);
  }
  
  // Получаем путь к игре
  getGamePath() {
    if (!gamePath) {
      throw new Error('Game path is not set. Call setGamePath first.');
    }
    return gamePath;
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
    const gameBasePath = this.getGamePath();
    logger.info(`[CHECK_INSTALLED] Game base path: ${gameBasePath}`);

    for (const addon of Object.values(this.addons)) {
      try {
        if (addon.name === 'NSQC') {
          const versPath = path.join(gameBasePath, addon.target_path, 'NSQC', 'vers');
          addon.installed = fs.existsSync(versPath);
          logger.debug(`[CHECK_INSTALLED] NSQC installed status: ${addon.installed} (checked: ${versPath})`);
        } else {
          const targetDir = path.join(gameBasePath, addon.target_path);
          if (!fs.existsSync(targetDir)) {
            addon.installed = false;
            logger.debug(`[CHECK_INSTALLED] ${addon.name} installed status: false (target dir missing: ${targetDir})`);
            continue;
          }
          const items = fs.readdirSync(targetDir);
          addon.installed = items.some(item => 
            item.toLowerCase().includes(addon.name.toLowerCase())
          );
          logger.debug(`[CHECK_INSTALLED] ${addon.name} installed status: ${addon.installed} (items in ${targetDir}: [${items.join(', ')}])`);
        }
      } catch (error) {
        logger.error(`[CHECK_INSTALLED] Error checking addon ${addon.name}:`, error);
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
      const gameBasePath = this.getGamePath();
      const versPath = path.join(gameBasePath, 'Interface', 'AddOns', 'NSQC', 'vers');
      logger.debug(`[GET_LOCAL_NSQC_VER] Checking version at: ${versPath}`);
      if (!fs.existsSync(versPath)) {
        logger.debug(`[GET_LOCAL_NSQC_VER] Version file not found.`);
        return null;
      }
      const version = fs.readFileSync(versPath, 'utf-8').trim();
      logger.debug(`[GET_LOCAL_NSQC_VER] Local version: ${version}`);
      return version;
    } catch (error) {
      logger.error('[GET_LOCAL_NSQC_VER] Error reading local NSQC version:', error);
      return null;
    }
  }

  async _getRemoteNSQCVersion() {
    try {
      const response = await axios.get(
        'https://raw.githubusercontent.com/Vladgobelen/NSQC/main/vers',
        { headers: { 'User-Agent': 'NightWatchUpdater' }, timeout: 5000 }
      );
      const version = response.data.trim();
      logger.debug(`[GET_REMOTE_NSQC_VER] Remote version: ${version}`);
      return version;
    } catch (error) {
      logger.error('[GET_REMOTE_NSQC_VER] Error getting remote NSQC version:', error);
      return null;
    }
  }

  async toggleAddon(name, install, mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const addon = this.addons[name];
    if (!addon) {
      logger.error(`[TOGGLE] Addon ${name} not found`);
      throw new Error(`Аддон ${name} не найден`);
    }
    if (addon.being_processed) {
      logger.warn(`[TOGGLE] Addon ${name} is already being processed`);
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
      logger.error(`[TOGGLE] Error ${install ? 'installing' : 'uninstalling'} addon ${name}:`, error);
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
    logger.info(`[INSTALL_NSQC] Starting installation for NSQC`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', addon.name, 0.1);
    }
    const gameBasePath = this.getGamePath();
    logger.debug(`[INSTALL_NSQC] Game base path: ${gameBasePath}`);
    
    const localVer = await this._getLocalNSQCVersion();
    const remoteVer = await this._getRemoteNSQCVersion();
    if (localVer === remoteVer && localVer) {
      logger.info('[INSTALL_NSQC] NSQC is already up to date');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 1.0);
      }
      return;
    }

    const tempDir = path.join(os.tmpdir(), 'nsqc_temp');
    const zipPath = path.join(os.tmpdir(), 'nsqc_main.zip');

    try {
      if (fs.existsSync(tempDir)) {
        logger.debug(`[INSTALL_NSQC] Cleaning up previous temp dir: ${tempDir}`);
        await fs.remove(tempDir);
      }
      if (fs.existsSync(zipPath)) {
        logger.debug(`[INSTALL_NSQC] Cleaning up previous temp zip: ${zipPath}`);
        await fs.unlink(zipPath);
      }
    } catch (error) {
      logger.warn('[INSTALL_NSQC] Error cleaning up previous temp files:', error);
    }

    try {
      logger.info('[INSTALL_NSQC] Downloading NSQC...');
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
      logger.debug(`[INSTALL_NSQC] NSQC zip size: ${totalLength} bytes`);
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

      logger.info('[INSTALL_NSQC] Download completed, extracting...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.75);
      }
      await fs.ensureDir(tempDir);
      logger.debug(`[INSTALL_NSQC] Extracting to temp dir: ${tempDir}`);
      await fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: tempDir }))
        .promise();

      const targetDir = path.join(gameBasePath, 'Interface', 'AddOns', 'NSQC');
      logger.debug(`[INSTALL_NSQC] Target directory for NSQC: ${targetDir}`);

      if (fs.existsSync(targetDir)) {
        logger.debug(`[INSTALL_NSQC] Removing old NSQC directory: ${targetDir}`);
        await fs.remove(targetDir);
      }

      const sourceDir = path.join(tempDir, 'NSQC-main');
      logger.debug(`[INSTALL_NSQC] Copying from ${sourceDir} to ${targetDir}`);
      await fs.copy(sourceDir, targetDir);

      if (remoteVer) {
        const versFilePath = path.join(targetDir, 'vers');
        logger.debug(`[INSTALL_NSQC] Writing version file: ${versFilePath}`);
        await fs.writeFile(versFilePath, remoteVer);
      }

      logger.info('[INSTALL_NSQC] NSQC installed successfully');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.95);
      }

      try {
        if (fs.existsSync(tempDir)) await fs.remove(tempDir);
        if (fs.existsSync(zipPath)) await fs.unlink(zipPath);
      } catch (error) {
        logger.warn('[INSTALL_NSQC] Error cleaning up temp files:', error);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 1.0);
      }
    } catch (error) {
      logger.error('[INSTALL_NSQC] Error installing NSQC:', error);
      try {
        if (fs.existsSync(tempDir)) await fs.remove(tempDir);
        if (fs.existsSync(zipPath)) await fs.unlink(zipPath);
      } catch (cleanupError) {
        logger.error('[INSTALL_NSQC] Error cleaning up after failed installation:', cleanupError);
      }
      throw error;
    }
  }

  async _installAddon(addon, mainWindow) {
    logger.info(`[INSTALL] Starting installation for ${addon.name}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', addon.name, 0.1);
    }
    const gameBasePath = this.getGamePath();
    const targetDir = path.join(gameBasePath, addon.target_path);
    logger.info(`[INSTALL] Target directory for ${addon.name} is: ${targetDir}`);

    try {
      logger.info(`[INSTALL] Ensuring directory exists: ${targetDir}`);
      await fs.ensureDir(targetDir);
      logger.info(`[INSTALL] Directory ensured: ${targetDir}`);
    } catch (ensureDirError) {
      logger.error(`[INSTALL] Failed to ensure directory ${targetDir}:`, ensureDirError);
      throw new Error(`Не удалось создать директорию ${targetDir}: ${ensureDirError.message}`);
    }

    const isMpqFile = addon.link.toLowerCase().endsWith('.mpq');

    if (isMpqFile) {
      const targetPath = path.join(targetDir, path.basename(addon.link));
      logger.info(`[INSTALL] Target path for .mpq file: ${targetPath}`);
      try {
        logger.info(`[INSTALL] Downloading .mpq file: ${addon.name} from ${addon.link}`);
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
        logger.info(`[INSTALL] .mpq file size: ${totalLength} bytes`);
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

        logger.info(`[INSTALL] ${addon.name} (.mpq) downloaded successfully`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('progress', addon.name, 1.0);
        }
      } catch (error) {
        logger.error(`[INSTALL] Error downloading .mpq file ${addon.name}:`, error);
        if (fs.existsSync(targetPath)) await fs.unlink(targetPath);
        throw new Error(`Ошибка скачивания .mpq ${addon.name}: ${error.message}`);
      }
      return;
    }

    const tempZip = path.join(os.tmpdir(), `${addon.name}.zip`);
    logger.info(`[INSTALL] Temp zip path for ${addon.name}: ${tempZip}`);

    try {
      logger.info(`[INSTALL] Downloading ${addon.name} (.zip) from ${addon.link}...`);
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
      logger.info(`[INSTALL] .zip file size: ${totalLength} bytes`);
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

      logger.info('[INSTALL] Download completed, extracting...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.75);
      }

      await fs.createReadStream(tempZip)
        .pipe(unzipper.Extract({ path: targetDir }))
        .promise();

      logger.info(`[INSTALL] Extraction finished. Contents of ${targetDir}:`);
      try {
        const contents = fs.readdirSync(targetDir);
        logger.info(`[INSTALL] ${contents.join(', ')}`);
      } catch (e) { /* ignore */ }

      const installedItems = fs.readdirSync(targetDir);
      const installed = installedItems.some(item => 
        item.toLowerCase().includes(addon.name.toLowerCase())
      );

      if (!installed) {
        logger.warn(`[INSTALL] Addon ${addon.name} not found in ${targetDir} after extraction`);
        throw new Error(`Аддон ${addon.name} не найден. Проверьте структуру архива.`);
      }

      logger.info(`[INSTALL] ${addon.name} installed successfully`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 0.95);
      }

      try {
        if (fs.existsSync(tempZip)) await fs.unlink(tempZip);
      } catch (error) {
        logger.warn('[INSTALL] Error cleaning up temp file:', error);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', addon.name, 1.0);
      }
    } catch (error) {
      logger.error(`[INSTALL] Error installing ${addon.name}:`, error);
      try {
        if (fs.existsSync(tempZip)) await fs.unlink(tempZip);
      } catch (cleanupError) {
        logger.error('[INSTALL] Error cleaning up after failed installation:', cleanupError);
      }
      throw new Error(`Ошибка установки ${addon.name}: ${error.message}`);
    }
  }

  async _uninstallAddon(addon, mainWindow) {
    const gameBasePath = this.getGamePath();
    const targetDir = path.join(gameBasePath, addon.target_path);
    logger.info(`[UNINSTALL] Uninstalling ${addon.name} from ${targetDir}`);
    if (!fs.existsSync(targetDir)) return;

    const items = fs.readdirSync(targetDir);
    const itemsToRemove = items.filter(item => 
      item.toLowerCase().includes(addon.name.toLowerCase())
    );

    if (itemsToRemove.length === 0) return;

    let success = true;
    for (let i = 0; i < itemsToRemove.length; i++) {
      const item = itemsToRemove[i];
      const itemPath = path.join(targetDir, item);
      try {
        logger.info(`[UNINSTALL] Removing: ${itemPath}`);
        await fs.remove(itemPath);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('progress', addon.name, 0.1 + 0.8 * ((i + 1) / itemsToRemove.length));
        }
      } catch (error) {
        logger.error(`[UNINSTALL] Error removing ${item}:`, error);
        success = false;
      }
    }

    if (!success) throw new Error('Failed to completely uninstall addon');

    logger.info(`[UNINSTALL] ${addon.name} uninstalled successfully`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', addon.name, 1.0);
    }
  }

  async launchGame() {
    const gameBasePath = this.getGamePath();
    const wowPath = path.join(gameBasePath, 'Wow.exe');
    logger.info(`[LAUNCH] Attempting to launch game from: ${wowPath}`);
    if (!fs.existsSync(wowPath)) {
      logger.error('[LAUNCH] Wow.exe not found');
      return false;
    }
    try {
      logger.info('[LAUNCH] Launching game...');
      if (process.platform === 'win32') {
        require('child_process').exec(`start "" "${wowPath}"`, { cwd: gameBasePath });
      } else {
        require('child_process').spawn(wowPath, [], { cwd: gameBasePath });
      }
      return true;
    } catch (error) {
      logger.error('[LAUNCH] Error launching game:', error);
      return false;
    }
  }
}

module.exports = new AddonManager();