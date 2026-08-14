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
      if (fs.existsSync(this.settingsPath)) return fs.readJsonSync(this.settingsPath);
    } catch (error) { console.error('Error loading settings:', error.message); }
    return { gamePath: null, pttHotkey: null };
  }

  saveSettings() {
    try {
      fs.ensureDirSync(path.dirname(this.settingsPath));
      fs.writeJsonSync(this.settingsPath, this.settings, { spaces: 2 });
    } catch (error) { console.error('Error saving settings:', error.message); }
  }

  getGamePath() { return this.settings.gamePath || null; }
  setGamePath(p) { this.settings.gamePath = p; this.saveSettings(); }
  isGamePathValid() {
    const gp = this.getGamePath();
    if (!gp) return false;
    return fs.existsSync(path.join(gp, 'Wow.exe'));
  }

  getPTTHotkey() { return this.settings.pttHotkey || null; }
  setPTTHotkey(hotkey) { this.settings.pttHotkey = hotkey; this.saveSettings(); }
}

module.exports = new Settings();