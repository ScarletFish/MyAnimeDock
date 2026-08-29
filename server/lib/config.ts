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
      { key: '1080p', name: '1080p', regex: '\\b1080p\\b|\\b1920x1080\\b' },
      { key: '720p', name: '720p', regex: '\\b720p\\b|\\b1280x720\\b' },
      { key: '2160p', name: '2160p (4K)', regex: '\\b2160p\\b|\\b3840x2160\\b|\\b4K\\b' },
      { key: 'mkv', name: 'MKV', regex: 'MKV' },
      { key: 'mp4', name: 'MP4', regex: 'MP4' },
      { key: 'web', name: 'WEB', regex: 'WEB' },
      { key: 'bdrip', name: 'BDRip', regex: 'BDRip' },
      { key: 'cr', name: 'CR', regex: 'CR' },
      { key: 'abema', name: 'ABEMA', regex: 'ABEMA' },
      { key: 'baha', name: 'BAHA', regex: 'BAHA' },
      { key: 'internalSub', name: '内封字幕', regex: '内封' },
      { key: 'embeddedSub', name: '内嵌字幕', regex: '内嵌' },
    ],
    exclude: [
      { key: 'halfEpisode', name: '半集', regex: '\\.5' },
      { key: 'episodeRange', name: '多集合集', regex: '\\d+[~-]\\d+' },
      { key: 'raw', name: 'RAW(生肉)', regex: 'RAW' },
      { key: 'lowRes480p', name: '480p', regex: '\\b480p\\b' },
    ],
  },
  mikanLangOptions: [
    { key: 'simplified', label: '简', bit: 1, regex: '简|CHS|GB|简体|简中' },
    { key: 'traditional', label: '繁', bit: 2, regex: '繁|CHT|BIG5|繁体|繁中' },
    { key: 'japanese', label: '日', bit: 4, regex: '日|JPN' },
  ],
  mikanDefaultRequired: ['simplified'],
  mikanDefaultExcluded: ['halfEpisode', 'raw', 'lowRes480p'],
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
