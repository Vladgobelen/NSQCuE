const { setupLogging } = require('../utils');

const base = setupLogging();

function fmt(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

const logger = {
  info: (...a) => {
    base.info(...a);
    console.log('[INFO]', fmt(a));
  },
  warn: (...a) => {
    base.warn(...a);
    console.warn('[WARN]', fmt(a));
  },
  error: (...a) => {
    base.error(...a);
    console.error('[ERROR]', fmt(a));
  },
};

module.exports = logger;