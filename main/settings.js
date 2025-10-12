// settings.js
const { app } = require('electron');
const fs = require('fs-extra');
const path = require('path');

class Settings {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = this.loadSettings();
  }

  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        return fs.readJsonSync(this.settingsPath);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
    return {};
  }

  saveSettings() {
    try {
      fs.writeJsonSync(this.settingsPath, this.settings, { spaces: 2 });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  getGamePath() {
    return this.settings.gamePath;
  }

  setGamePath(path) {
    this.settings.gamePath = path;
    this.saveSettings();
  }

  isGamePathValid() {
    const gamePath = this.getGamePath();
    if (!gamePath) return false;
    return fs.existsSync(path.join(gamePath, 'Wow.exe'));
  }

  // === НОВЫЕ МЕТОДЫ ДЛЯ PTT ===
  getPTTHotkeyCodes() {
    return this.settings.pttHotkeyCodes || null;
  }

  setPTTHotkeyCodes(codes) {
    this.settings.pttHotkeyCodes = codes;
    this.saveSettings();
  }
}

module.exports = new Settings();
