const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

function setupLogging() {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  const logFile = path.join(logsDir, 'main_ui.log');
  
  fs.ensureDirSync(logsDir);
  
  return {
    debug: (message) => log('DEBUG', message, logFile),
    info: (message) => log('INFO', message, logFile),
    warn: (message) => log('WARN', message, logFile),
    error: (message) => log('ERROR', message, logFile)
  };
}

function log(level, message, logFile) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (error) {
    console.error('Failed to write to log file:', error);
    console.log(logMessage); // Fallback to console
  }
}

module.exports = { setupLogging };