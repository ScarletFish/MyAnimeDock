// server/logger.js — Structured logger with levels, timestamps, and file output.
//
// Dev mode:  console with [ISO timestamp] [LEVEL] [TAG] prefix
// Pkg mode:  console (already redirected to server.log by server.js bootstrap)
//
// LOG_LEVEL env: 'debug' | 'info' | 'warn' | 'error' (default: 'debug' in dev, 'info' in pkg)
//
// Usage:
//   const logger = require('./logger');
//   logger.info('Server started');
//   const dbLog = logger.child('[DB]');
//   dbLog.warn('Prisma engine not found');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 99 };
const LEVEL_LABELS = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

const envLevel = (process.env.LOG_LEVEL || '').toLowerCase();
const defaultLevel = process.pkg ? 'info' : 'debug';
const currentLevel = LEVELS[envLevel] !== undefined ? LEVELS[envLevel] : LEVELS[defaultLevel];

function formatTimestamp() {
  return new Date().toISOString();
}

function createLogger(tag) {
  const prefix = tag ? `${tag} ` : '';

  function log(level, levelLabel, args) {
    if (LEVELS[level] < currentLevel) return;
    const ts = formatTimestamp();
    const msg = args.map(a => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch (_) { return String(a); }
      }
      return String(a);
    }).join(' ');
    console.log(`[${ts}] [${levelLabel}] ${prefix}${msg}`);
  }

  return {
    debug: (...args) => log('debug', 'DEBUG', args),
    info:  (...args) => log('info',  'INFO ', args),
    warn:  (...args) => log('warn',  'WARN ', args),
    error: (...args) => log('error', 'ERROR', args),
    child: (childTag) => createLogger(childTag),
  };
}

module.exports = createLogger(null);