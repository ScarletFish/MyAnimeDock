// server/lib/config.js — 路径、配置管理
const path = require('path');
const fs = require('fs');

// ── 引导日志（写入 %TEMP%，崩溃也不丢）──
const BOOT_LOG = path.join(process.env.TEMP || process.env.TMP || '.', 'myanimedock-bootstrap.log');
const bootLog = (msg) => { try { fs.appendFileSync(BOOT_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {} };

// ── 用户数据目录 ──
// pkg 模式：%APPDATA%/MyAnimeDock（可写），开发模式：本模块上级 server/
const DATA_DIR = process.pkg
  ? path.join(process.env.APPDATA || process.env.HOME || '.', 'MyAnimeDock')
  : path.join(__dirname, '..');
const ASSET_DIR = path.join(__dirname, '..', '..'); // 前端静态资源根
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SCANNED_TREE_PATH = path.join(DATA_DIR, 'scanned-tree.json');
const PORT = 3456;
const MAX_PLAY_SESSIONS = 5000;

// --- Default config ---
const DEFAULT_CONFIG = {
  mediaDir: '',
  playerMode: 'mpv',
  mpvPath: 'mpv',
  theme: 'default',
  themeMode: 'dark',
  autoMarkWatched: true,
  uiScale: 1.25,
  apiSources: [
    { type: 'bangumi', url: 'https://api.bangumi.lol', key: '' },
  ],
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const cfg = JSON.parse(raw);
    // Migrate legacy format → apiSources
    if (!cfg.apiSources && cfg.scrapers) {
      const sources = [];
      if (cfg.scrapers.bangumi?.enabled !== false) {
        sources.push({
          type: 'bangumi',
          url: cfg.scrapers.bangumi?.apiBase || 'https://api.bangumi.lol',
          key: '',
        });
      }
      if (cfg.scrapers.tmdb?.enabled !== false && cfg.tmdbApiKey) {
        sources.push({
          type: 'tmdb',
          url: 'https://api.themoviedb.org/3',
          key: cfg.tmdbApiKey,
        });
      }
      cfg.apiSources = sources.length > 0 ? sources : DEFAULT_CONFIG.apiSources;
      delete cfg.scrapers;
      delete cfg.tmdbApiKey;
      saveConfig(cfg);
    }
    return { ...DEFAULT_CONFIG, ...cfg };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

function loadScannedTree() {
  try {
    const raw = fs.readFileSync(SCANNED_TREE_PATH, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveScannedTree(tree) {
  try {
    fs.writeFileSync(SCANNED_TREE_PATH, JSON.stringify(tree, null, 2), 'utf-8');
  } catch (e) {
    // logger not available here, error swallowed
  }
}

module.exports = {
  BOOT_LOG, bootLog,
  DATA_DIR, ASSET_DIR, CONFIG_PATH, SCANNED_TREE_PATH,
  PORT, MAX_PLAY_SESSIONS,
  DEFAULT_CONFIG,
  loadConfig, saveConfig,
  loadScannedTree, saveScannedTree,
};