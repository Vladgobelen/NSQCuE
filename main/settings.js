const { app } = require('electron');
const fs = require('fs-extra');
const path = require('path');

class Settings {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = this.loadSettings();
  }

  loadSettings() {
    const defaults = {
      gamePath: null,
      pttHotkey: null,
      notificationPosition: 'top-right',
    };
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readJsonSync(this.settingsPath);
        return { ...defaults, ...data };
      }
    } catch (error) {
      console.error('Error loading settings:', error.message);
    }
    return defaults;
  }

  saveSettings() {
    try {
      fs.ensureDirSync(path.dirname(this.settingsPath));
      fs.writeJsonSync(this.settingsPath, this.settings, { spaces: 2 });
    } catch (error) {
      console.error('Error saving settings:', error.message);
    }
  }

  getGamePath() {
    return this.settings.gamePath || null;
  }

  setGamePath(p) {
    this.settings.gamePath = p;
    this.saveSettings();
  }

  isGamePathValid() {
    const gp = this.getGamePath();
    if (!gp) return false;
    try {
      return fs.existsSync(path.join(gp, 'Wow.exe'));
    } catch {
      return false;
    }
  }

  getPTTHotkey() {
    return Array.isArray(this.settings.pttHotkey) ? this.settings.pttHotkey : null;
  }

  setPTTHotkey(hotkey) {
    this.settings.pttHotkey = Array.isArray(hotkey) ? hotkey : null;
    this.saveSettings();
  }

  getNotificationPosition() {
    return this.settings.notificationPosition || 'top-right';
  }

  setNotificationPosition(pos) {
    this.settings.notificationPosition = pos;
    this.saveSettings();
  }
}

module.exports = new Settings();