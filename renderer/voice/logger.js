const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

let displayName = 'anonymous';
let isReady = false;
const logBuffer = [];

function flushBuffer() {
  logBuffer.forEach(({ level, message, timestamp }) => {
    sendLogToServerNow(level, message, timestamp);
  });
  logBuffer.length = 0;
}

function sendLogToServerNow(level, message, timestamp) {
  const safeName = String(displayName).replace(/[<>:"/\\|?*\x00-\x1F\s]+/g, '_').substring(0, 64) || 'anonymous';
  fetch('/api/client-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientID: safeName,
      level,
      message,
      timestamp
    }),
    keepalive: true
  }).catch(() => {});
}

function sendLog(level, message) {
  const timestamp = new Date().toISOString();
  if (isReady) {
    sendLogToServerNow(level, message, timestamp);
  } else {
    logBuffer.push({ level, message, timestamp });
  }
}

// Экспорт функции для вызова из основного кода
window.setLoggerDisplayName = function(name) {
  if (!isReady) {
    displayName = name || 'anonymous';
    isReady = true;
    flushBuffer();
  }
};

console.log = (...args) => {
  originalLog(...args);
  sendLog('log', args.map(String).join(' '));
};

console.error = (...args) => {
  originalError(...args);
  sendLog('error', args.map(String).join(' '));
};

console.warn = (...args) => {
  originalWarn(...args);
  sendLog('warn', args.map(String).join(' '));
};
