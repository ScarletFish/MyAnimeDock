// server/logger.ts — Structured logger with levels, timestamps, and file output.
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
//   dbLog.warn('Database engine not found');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 99 } as const;
const LEVEL_LABELS = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' } as const;

type LevelKey = keyof typeof LEVELS;

const envLevel = (process.env.LOG_LEVEL || '').toLowerCase();
const defaultLevel = process.pkg ? 'info' : 'debug';
const currentLevel = LEVELS[envLevel as LevelKey] !== undefined ? LEVELS[envLevel as LevelKey] : LEVELS[defaultLevel as LevelKey];

function formatTimestamp(): string {
  return new Date().toISOString();
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (tag: string) => Logger;
}

function createLogger(tag?: string): Logger {
  const prefix = tag ? `${tag} ` : '';

  function log(level: LevelKey, levelLabel: string, args: unknown[]): void {
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
    debug: (...args: unknown[]) => log('debug', 'DEBUG', args),
    info:  (...args: unknown[]) => log('info',  'INFO ', args),
    warn:  (...args: unknown[]) => log('warn',  'WARN ', args),
    error: (...args: unknown[]) => log('error', 'ERROR', args),
    child: (childTag: string) => createLogger(childTag),
  };
}

module.exports = createLogger(null);