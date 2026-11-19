const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const state = require('./state');

async function launchGame() {
  const gamePath = state.getGamePath();
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

module.exports = { launchGame };