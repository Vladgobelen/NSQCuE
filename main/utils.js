const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

let cachedLogger = null;

function getLogFile() {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.ensureDirSync(logsDir);
    return path.join(logsDir, 'main_ui.log');
  } catch (e) {
    const fallbackDir = path.join(__dirname, '..', 'logs');
    try { fs.ensureDirSync(fallbackDir); } catch {}
    return path.join(fallbackDir, 'main_ui.log');
  }
}

function log(level, message, logFile) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (error) {
    console.error('Failed to write to log file:', error.message);
    console.log(logMessage);
  }
}

function setupLogging() {
  if (cachedLogger) return cachedLogger;
  const logFile = getLogFile();
  cachedLogger = {
    debug: (m) => log('DEBUG', m, logFile),
    info:  (m) => log('INFO',  m, logFile),
    warn:  (m) => log('WARN',  m, logFile),
    error: (m) => log('ERROR', m, logFile),
  };
  return cachedLogger;
}

module.exports = { setupLogging };