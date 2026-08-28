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
// 测试隔离：MYANIMEDOCK_DATA_DIR 优先，避免测试写真实 data/ 目录
const DATA_DIR = process.env.MYANIMEDOCK_DATA_DIR
  ? process.env.MYANIMEDOCK_DATA_DIR
  : process.pkg
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
export interface MikanTagEntry {
  key: string;   // 唯一 id（种子项沿用旧 key，用户新增用 uuid）
  name: string;  // 展示名
  regex: string; // 用于筛选的正则
}
export interface MikanTagLibrary {
  include: MikanTagEntry[]; // 必需项 → mustContain
  exclude: MikanTagEntry[]; // 排除项 → mustNotContain
}
export interface MikanLangOption {
  key: string;
  label: string;   // 显示名，可为 i18n key 或纯文本（面板用 tr() 解析）
  bit: number;     // 位掩码标识，唯一；新增时取下一个 2 的幂
  regex: string;   // 订阅筛选时注入 mustContain/mustNotContain 的正则
}
export interface ConfigShape {
  mediaDir: string;
  playerMode: string;
  mpvPath: string;
  theme: string;
  themeMode: string;
  autoMarkWatched: boolean;
  uiScale: number;
  apiSources: { type: string; url: string; key: string }[];
  // qBittorrent
  qbPort: number;
  qbUsername: string;
  qbPassword: string;
  // 蜜柑计划镜像
  mikanMirror: string;
  // 蜜柑正则 Tag 库（订阅筛选用）
  mikanTagLibrary: MikanTagLibrary;
  // 蜜柑语言选项（字幕语言筛选用）
  mikanLangOptions: MikanLangOption[];
  // 蜜柑订阅默认必选项 / 排除项（key 列表）
  mikanDefaultRequired: string[];
  mikanDefaultExcluded: string[];
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
  qbPort: 8080,
  qbUsername: 'admin',
  qbPassword: '',
  mikanMirror: 'https://mikanime.tv',
  // 种子：沿用原 MikanSubscribePanel 写死的 INCLUDE_TAGS / EXCLUDE_TAGS
  mikanTagLibrary: {
    include: [
      { key: '1080p', name: '1080p', regex: '1080p' },
      { key: '720p', name: '720p', regex: '720p' },
      { key: '4k', name: '4K', regex: '4K' },
      { key: 'mkv', name: 'mkv', regex: 'mkv' },
      { key: 'mp4', name: 'mp4', regex: 'mp4' },
      { key: 'internalSub', name: '内封字幕', regex: '内封' },
      { key: 'embeddedSub', name: '内嵌字幕', regex: '内嵌' },
    ],
    exclude: [
      { key: 'halfEpisode', name: '半集', regex: '\\.5' },
      { key: 'episodeRange', name: '多集合集', regex: '\\d+[~-]\\d+' },
      { key: 'collection', name: '合集', regex: '合集' },
    ],
  },
  mikanLangOptions: [
    { key: 'simplified', label: 'mikan.simplified', bit: 1, regex: '简' },
    { key: 'traditional', label: 'mikan.traditional', bit: 2, regex: '繁' },
    { key: 'japanese', label: 'mikan.japanese', bit: 4, regex: '日' },
  ],
  mikanDefaultRequired: ['simplified'],
  mikanDefaultExcluded: ['halfEpisode', 'collection'],
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
