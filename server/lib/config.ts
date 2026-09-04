// server/lib/config.ts — 路径、配置管理
import * as path from 'path';
import * as fs from 'fs';
import crypto from 'crypto';
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

// ── qB 密码落盘加密（AES-256-GCM，密钥内置源码）──
// 威胁模型：单机本地 + LAN 私用，防配置文件意外外传/误读为明文；不防本机恶意软件。
// 内存中 qbPassword 始终为明文（供 qB 鉴权），仅写盘时加密、读盘时解密。
const QB_ENC_KEY = crypto.scryptSync('my-anime-dock::qb-password', 'my-anime-dock::static-salt', 32);
const QB_ENC_PREFIX = 'enc:';

function encryptQbPassword(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', QB_ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return QB_ENC_PREFIX + iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decryptQbPassword(stored: string): string {
  if (!stored || !stored.startsWith(QB_ENC_PREFIX)) return stored; // 空或旧明文：原样返回
  const parts = stored.slice(QB_ENC_PREFIX.length).split(':');
  if (parts.length !== 3) return stored; // 格式异常兜底
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', QB_ENC_KEY, Buffer.from(parts[0], 'hex'));
    decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return stored; // 解密失败兜底（避免启动崩溃）
  }
}

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
  // 启动时窗口默认全屏（仅 Tauri 桌面端生效；浏览器 dev 模式无窗口可全屏）
  startupFullscreen: boolean;
  // 关闭窗口行为（仅 Tauri 桌面端生效）：tray = 最小化到系统托盘（默认），exit = 直接退出软件
  closeBehavior: 'tray' | 'exit';
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
  startupFullscreen: false,
  closeBehavior: 'tray',
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
    let needPersist = false;
    // qB 密码：磁盘密文 → 内存明文；旧明文保留明文并标记迁移
    if (typeof cfg.qbPassword === 'string' && cfg.qbPassword) {
      if (cfg.qbPassword.startsWith(QB_ENC_PREFIX)) {
        cfg.qbPassword = decryptQbPassword(cfg.qbPassword);
      } else {
        needPersist = true;
      }
    }
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
    const merged = { ...DEFAULT_CONFIG, ...cfg };
    if (needPersist) saveConfig(merged);
    return merged;
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg: ConfigShape): void {
  const out: ConfigShape = { ...cfg };
  // 仅加密内存中的明文密码；已加密或空值原样写盘（幂等，避免重复加密）
  if (typeof out.qbPassword === 'string' && out.qbPassword && !out.qbPassword.startsWith(QB_ENC_PREFIX)) {
    out.qbPassword = encryptQbPassword(out.qbPassword);
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2), 'utf-8');
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
