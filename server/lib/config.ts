// server/lib/config.ts — 路径、配置管理
import * as path from 'path';
import * as fs from 'fs';
import { SERVER_ROOT, PROJECT_ROOT } from './paths';

// ── 引导日志（写入 %TEMP%，崩溃也不丢）──
const BOOT_LOG = path.join(process.env.TEMP || process.env.TMP || '.', 'myanimedock-bootstrap.log');
const bootLog = (msg: string): void => { try { fs.appendFileSync(BOOT_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {} };

// ── 用户数据目录 ──
// pkg 模式：%APPDATA%/MyAnimeDock（可写）
// 开发模式：项目根 data/（运行时数据与源码分离，避免 tsc -w 监视运行时写入）
const DATA_DIR = process.pkg
  ? path.join(process.env.APPDATA || process.env.HOME || '.', 'MyAnimeDock')
  : path.join(PROJECT_ROOT, 'data');
const ASSET_DIR = process.pkg
  ? path.dirname(process.execPath)  // pkg: exe 同级，Tauri 把 resources 放根目录
  : PROJECT_ROOT; // 开发模式：config.ts 在 server/lib/
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SCANNED_TREE_PATH = path.join(DATA_DIR, 'scanned-tree.json');
const PORT = 3456;
const MAX_PLAY_SESSIONS = 5000;

// --- Default config ---
export interface ConfigShape {
  mediaDir: string;
  playerMode: string;
  mpvPath: string;
  theme: string;
  themeMode: string;
  autoMarkWatched: boolean;
  uiScale: number;
  apiSources: { type: string; url: string; key: string }[];
  // 运行时由 server.ts / routes 注入的字段（可选）
  reduceMotion?: boolean;
  bangumiAccessToken?: string;
  bangumiClientId?: string;
  bangumiClientSecret?: string;
  bangumiLastSync?: string;
  bangumiUsername?: string;
}

const DEFAULT_CONFIG: ConfigShape = {
  mediaDir: '',
  playerMode: 'mpv',
  mpvPath: 'mpv',
  theme: 'default',
  themeMode: 'dark',
  autoMarkWatched: true,
  uiScale: 1.0,
  apiSources: [
    { type: 'bangumi', url: 'https://api.bangumi.lol', key: '' },
    { type: 'anilist', url: '', key: '' },
  ],
};

function loadConfig(): ConfigShape {
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
      cfg.apiSources = sources.length > 0 ? sources : DEFAULT_CONFIG.apiSources;
      delete cfg.scrapers;
      saveConfig(cfg);
    }
    return { ...DEFAULT_CONFIG, ...cfg };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg: ConfigShape): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

function loadScannedTree(): unknown[] {
  try {
    const raw = fs.readFileSync(SCANNED_TREE_PATH, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

async function saveScannedTree(tree: unknown[]): Promise<void> {
  try {
    await fs.promises.writeFile(SCANNED_TREE_PATH, JSON.stringify(tree, null, 2), 'utf-8');
  } catch (e: any) {
    console.error(`[Config] saveScannedTree: ${e.message}`);
  }
}

export {
  BOOT_LOG, bootLog,
  DATA_DIR, ASSET_DIR, CONFIG_PATH, SCANNED_TREE_PATH,
  PORT, MAX_PLAY_SESSIONS,
  DEFAULT_CONFIG,
  loadConfig, saveConfig,
  loadScannedTree, saveScannedTree,
};
