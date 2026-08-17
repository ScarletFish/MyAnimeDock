// server.ts — HTTP server + REST API 入口（精简版，路由已拆分到 routes/）
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { Logger } from './logger';
import type { ServerState } from './types';
const logger: Logger = require('./logger').child('[SERVER]');

import BangumiPersonal = require('./scrapers/bangumi-personal');
import BangumiSync = require('./bangumi-sync');

import {
  bootLog, DATA_DIR, ASSET_DIR, CONFIG_PATH, SCANNED_TREE_PATH,
  PORT, MAX_PLAY_SESSIONS, DEFAULT_CONFIG,
  loadConfig, saveConfig, loadScannedTree, saveScannedTree,
} from './lib/config';
import { SERVER_ROOT } from './lib/paths';
import {
  mime, setFfmpegPath, serveImage, serveRaw, readBody, jsonResp, cleanupOldCache,
} from './lib/utils';
import ThumbnailQueue = require('./thumbnail-queue');

// ── 播放器策略注册（加载即自注册到 registry）──
import './players/mpv-strategy';

// ── 引导日志 ──
bootLog('=== BOOT: server.js init ===');
bootLog(`PKG=${!!process.pkg} EXE=${process.execPath} CWD=${process.cwd()}`);
bootLog(`APPDATA=${process.env.APPDATA} TEMP=${process.env.TEMP}`);
bootLog(`DATA_DIR=${DATA_DIR}`);

// ── 诊断：ASSET_DIR 实际内容 ──
bootLog(`ASSET_DIR=${ASSET_DIR}`);
try {
  const assetRoot = path.join(ASSET_DIR, 'frontend', 'dist');
  if (fs.existsSync(assetRoot)) {
    bootLog(`ASSET_DIR/frontend/dist EXISTS, contents: ${fs.readdirSync(assetRoot).join(', ')}`);
  } else {
    bootLog(`ASSET_DIR/frontend/dist MISSING`);
    // 向上找，看哪一层不存在
    for (const part of ['frontend', 'frontend/dist']) {
      const p = path.join(ASSET_DIR, part);
      bootLog(`  check ${p}: ${fs.existsSync(p)}`);
    }
  }
} catch (e: any) {
  bootLog(`ASSET_DIR scan error: ${e.message}`);
}

// ── pkg 模式：重定向 console.log/error 到日志文件 ──
if (process.pkg) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const logFile = path.join(DATA_DIR, 'server.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const log = (msg: string) => logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
    console.log = (...args: any[]) => log(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    console.error = (...args: any[]) => log('ERROR: ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    console.log('=== MyAnimeDock Sidecar started ===');
    bootLog('Log redirect OK');
  } catch (e: any) {
    bootLog('Log redirect FAILED: ' + (e?.message || e));
  }
}

// ── 业务模块加载 ──
bootLog('Loading db...');
let db: any;
try {
  db = require('./db') as any;
  if (process.env.FFMPEG_BIN) setFfmpegPath(process.env.FFMPEG_BIN);
  bootLog('db loaded OK');
} catch (e: any) {
  bootLog('db FAILED: ' + (e?.message || e));
  bootLog('STACK: ' + (e?.stack || ''));
  throw e;
}
bootLog('Loading scanner...');
const { scanMediaDirFlat, extractBgmId, isExtraVideo, parseFolderName } = require('./scanner');
bootLog('All modules loaded OK');

// ── 全局错误处理 ──
process.on('unhandledRejection', (reason: any, promise: any) => {
  logger.warn('Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err: any) => {
  logger.error('Uncaught Exception:', err?.message || err);
});

// ── 运行时状态 ──
let pendingNotifications: any[] = [];
const activePlays = new Map();
const cancelledSyncSessions = new Map();
const thumbnailQueue = new ThumbnailQueue(activePlays);
const sseClients = new Set(); // SSE 连接池，用于推送 mpv-status 等事件
let config: any = loadConfig();
let data: any;
let startupTime: any;

// ── Bangumi 个人 API（OAuth + 终态推送）──
const bgmApiUrl = (config.apiSources || []).find((s: any) => s.type === 'bangumi')?.url || 'https://api.bgm.tv';
const bangumiPersonal: any = new BangumiPersonal({ apiBase: bgmApiUrl });
bangumiPersonal.loadFromConfig(config);
bangumiPersonal.onTokenChange = (payload: any) => {
  if (payload) {
    Object.assign(config, payload);
  } else {
    config.bangumiAccessToken = undefined;
    config.bangumiUsername = undefined;
  }
  saveConfig(config);
};
const bangumiSync = new BangumiSync(bangumiPersonal);

// ── 数据持久化函数 ──
async function saveData(data: any) {
  await Promise.all([
    db.saveAll(data),
    data.scannedTree !== undefined ? saveScannedTree(data.scannedTree) : Promise.resolve(),
  ]);
}

// ── 路由 handler 导入 ──
const H: any = Object.assign(
  {},
  require('./routes/config'),
  require('./routes/discovery'),
  require('./routes/library'),
  require('./routes/playback'),
  require('./routes/mylist'),
  require('./routes/stats'),
  require('./routes/bangumi'),
  require('./routes/db-manager'),
  require('./routes/relations')
);

// ── 内联 handler（封面、静态文件、CORS）──
function handleCoverImage(req: any, res: any, _state: any) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const coverPath = path.join(DATA_DIR, decodeURIComponent(urlPath));
  serveImage(coverPath, req.url, res);
}

function handleBannerImage(req: any, res: any, _state: any) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const bannerPath = path.join(DATA_DIR, decodeURIComponent(urlPath));
  fs.stat(bannerPath, (err, stats) => {
    if (err) { serveImage(bannerPath, req.url, res, true); return; }
    const etag = `"${stats.size}-${stats.mtimeMs}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.setHeader('ETag', etag);
    serveImage(bannerPath, req.url, res, true);
  });
}

// ── SSE: mpv-status 事件推送 ──
function handleMpvStatusSSE(req: any, res: any, _state: any) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  // 立即发送当前状态
  res.write(`data: ${JSON.stringify(buildMpvStatusPayload())}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

function buildMpvStatusPayload() {
  if (activePlays.size > 0) {
    const first = activePlays.values().next().value;
    return {
      active: true,
      animeId: first.anime.id,
      episodeNumber: first.episode.number,
      progress: first.episode.progress,
      duration: first.episode.duration,
    };
  }
  return { active: false };
}

function broadcastMpvStatus() {
  const data = JSON.stringify(buildMpvStatusPayload());
  for (const client of sseClients) {
    (client as any).write(`data: ${data}\n\n`);
  }
}

function handleCorsPreflight(req: any, res: any) {
  res.writeHead(204, {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  });
  res.end();
}

function handleStaticFiles(req: any, res: any, _state: any) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  let filePath = path.join(ASSET_DIR, 'frontend', 'dist', decodeURIComponent(urlPath));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (e: any, d: any) => {
    if (e) {
      bootLog(`STATIC 404: ${filePath} (ASSET_DIR=${ASSET_DIR}, url=${req.url})`);
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const cacheCtrl = ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': cacheCtrl,
    });
    res.end(d);
  });
}

// ── 路由表 ──
const routeTable = [
  // Config
  { method: 'GET', path: '/api/config', handler: H.handleGetConfig },
  { method: 'POST', path: '/api/config', handler: H.handlePostConfig },
  { method: 'GET', path: '/api/health', handler: H.handleHealth },
  { method: 'GET', path: '/api/notifications', handler: H.handleGetNotifications },
  // Discovery
  { method: 'GET', path: '/api/browse', handler: H.handleBrowse },
  { method: 'GET', path: '/api/scan', handler: H.handleScan },
  { method: 'POST', path: '/api/import', handler: H.handleImport },
  { method: 'POST', path: '/api/discovery/unlink', handler: H.handleDiscoveryUnlink },
  { method: 'POST', path: '/api/discovery/exclude', handler: H.handleDiscoveryExclude },
  { method: 'POST', path: '/api/discovery/include', handler: H.handleDiscoveryInclude },
  // Library
  { method: 'GET', path: '/api/library', handler: H.handleGetLibrary },
  { method: 'GET', path: '/api/library/sync/stream', handler: H.handleLibrarySyncStream },
  { method: 'OPTIONS', path: '/api/library/sync/stream', handler: handleCorsPreflight },
  // Anime detail (order matters: /sessions before /:id)
  { method: 'GET', pattern: /^\/api\/anime\/(.+?)\/sessions$/, handler: H.handleAnimeSessions },
  { method: 'GET', pattern: /^\/api\/anime\/(.+?)\/relations$/, handler: H.handleAnimeRelations },
  { method: 'GET', pattern: /^\/api\/anime\/(.+?)\/recommendations$/, handler: H.handleAnimeRecommendations },
  { method: 'GET', pattern: /^\/api\/anime\/(.+)$/, handler: H.handleGetAnimeDetail },
  { method: 'DELETE', pattern: /^\/api\/anime\/(.+)$/, handler: H.handleDeleteAnime },
  // Playback
  { method: 'POST', path: '/api/play', handler: H.handlePlay },
  { method: 'POST', path: '/api/progress', handler: H.handleProgress },
  { method: 'GET', path: '/api/mpv-status', handler: H.handleMpvStatus },
  { method: 'GET', path: '/api/thumbnail', handler: H.handleThumbnail },
  // MyList
  { method: 'GET', path: '/api/mylist', handler: H.handleGetMyList },
  { method: 'PUT', pattern: /^\/api\/mylist\/([^/]+)\/status$/, handler: H.handleUpdateMyListStatus },
  { method: 'PUT', pattern: /^\/api\/mylist\/([^/]+)$/, handler: H.handleUpdateMyListItem },
  { method: 'DELETE', pattern: /^\/api\/mylist\/([^/]+)$/, handler: H.handleDeleteMyListItem },
  // Wishlist
  { method: 'GET', path: '/api/wishlist', handler: H.handleGetWishlist },
  { method: 'POST', path: '/api/wishlist', handler: H.handlePostWishlist },
  { method: 'DELETE', pattern: /^\/api\/wishlist\/([^/]+)$/, handler: H.handleDeleteWishlistItem },
  // Stats
  { method: 'GET', path: '/api/stats', handler: H.handleStats },
  { method: 'GET', path: '/api/stats/tags', handler: H.handleStatsTags },
  { method: 'GET', path: '/api/stats/tag-cooccurrence', handler: H.handleStatsTagCooccurrence },
  { method: 'GET', path: '/api/stats/seasons', handler: H.handleStatsSeasons },
  { method: 'GET', path: '/api/stats/ratings', handler: H.handleStatsRatings },
  { method: 'GET', path: '/api/stats/watch-activity', handler: H.handleStatsWatchActivity },
  // Bangumi
  { method: 'POST', path: '/api/bangumi/search', handler: H.handleBangumiSearch },
  { method: 'POST', path: '/api/bangumi/fetch', handler: H.handleBangumiFetch },
  { method: 'POST', path: '/api/bangumi/sync', handler: H.handleBangumiSync },
  { method: 'GET', path: '/api/bangumi/auth/status', handler: H.handleBangumiAuthStatus },
  { method: 'GET', path: '/api/bangumi/auth/url', handler: H.handleBangumiAuthUrl },
  { method: 'GET', path: '/api/bangumi/auth/callback', handler: H.handleBangumiAuthCallback },
  { method: 'POST', path: '/api/bangumi/auth/logout', handler: H.handleBangumiAuthLogout },
  { method: 'POST', path: '/api/bangumi/auth/creds', handler: H.handleBangumiAuthCreds },
  { method: 'GET', path: '/api/bangumi/me', handler: H.handleBangumiMe },
  // DB Management
  { method: 'GET', path: '/api/db/info', handler: H.handleDbInfo },
  { method: 'GET', path: '/api/db/backup', handler: H.handleDbBackup },
  { method: 'POST', path: '/api/db/backup/download-all', handler: H.handleDbBackupAll },
  { method: 'POST', path: '/api/db/restore', handler: H.handleDbRestore },
  { method: 'POST', path: '/api/db/clear-sessions', handler: H.handleDbClearSessions },
  { method: 'POST', path: '/api/db/vacuum', handler: H.handleDbVacuum },
  { method: 'POST', path: '/api/db/clear-cache', handler: H.handleDbClearCache },
  { method: 'POST', path: '/api/db/reset', handler: H.handleDbReset },
  // Covers
  { method: 'GET', prefix: '/covers/', handler: handleCoverImage },
  // Banners
  { method: 'GET', prefix: '/banners/', handler: handleBannerImage },
  // SSE: mpv-status 事件流
  { method: 'GET', path: '/api/events/mpv-status', handler: handleMpvStatusSSE },
];

// ── HTTP 服务器 ──
let server: any;

function makeState(): ServerState {
  return {
    data, config, db, logger, activePlays, cancelledSyncSessions, thumbnailQueue,
    bangumiPersonal, bangumiSync, pendingNotifications,
    server, startupTime, saveData, loadScannedTree,
    broadcastMpvStatus,
  };
}

server = http.createServer((req: any, res: any) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;

  for (const route of routeTable) {
    if (req.method !== route.method) continue;
    let matched = false;
    if (route.path) {
      matched = (urlPath === route.path);
    } else if (route.pattern) {
      const m = urlPath.match(route.pattern);
      if (m) matched = true;
    } else if (route.prefix) {
      matched = urlPath.startsWith(route.prefix);
    } else {
      // catch-all static (last route)
      matched = true;
    }
    if (matched) {
      route.handler(req, res, makeState());
      return;
    }
  }

  // No API match → try static files
  handleStaticFiles(req, res, makeState());
});



async function validateCovers(data: any) {
  const coverDir = path.join(DATA_DIR, 'covers');
  for (const item of data.library) {
    if (item.localCover) {
      const coverPath = path.join(coverDir, path.basename(item.localCover));
      if (!fs.existsSync(coverPath)) item.localCover = undefined;
    }
  }
  for (const item of data.myList || []) {
    if (!item.animeId && item.coverUrl && item.coverUrl.startsWith(DATA_DIR)) {
      const coverPath = path.join(coverDir, path.basename(item.coverUrl));
      if (!fs.existsSync(coverPath)) item.coverUrl = null;
    }
  }
}

// 启动时校验 banner 本地文件是否存在，缺失则置 null（避免前端引用已删除文件）
async function validateBanners(data: any) {
  const bannerDir = path.join(DATA_DIR, 'banners');
  for (const item of data.library || []) {
    if (item.anilistBanner && item.anilistBanner !== '__none__') {
      const bannerPath = path.join(bannerDir, path.basename(item.anilistBanner));
      if (!fs.existsSync(bannerPath)) item.anilistBanner = null;
    }
  }
}

// ── 结构整改迁移：dev 运行时数据 server/ → data/（一次性，幂等）──
// 旧 dev DATA_DIR = SERVER_ROOT（server/），DB 中存的 localCover/anilistBanner 等
// 是旧绝对路径。文件已物理迁移到 data/，这里把 DB 中的旧前缀重写到新 DATA_DIR。
// 幂等：路径已以 DATA_DIR 开头则跳过；pkg 模式不执行（生产路径从未是 server/）。
function migrateLegacyDataPaths(data: any): boolean {
  if (process.pkg || !data) return false;
  if (DATA_DIR === SERVER_ROOT) return false; // 理论上不会发生，防御
  const oldPrefix = SERVER_ROOT + path.sep;
  let changed = false;

  const rewrite = (p: string | null | undefined): string | null | undefined => {
    if (!p || !p.startsWith(oldPrefix)) return p;
    return path.join(DATA_DIR, p.slice(oldPrefix.length));
  };

  for (const a of data.library || []) {
    for (const key of ['localCover', 'anilistBanner']) {
      if (a[key]) {
        const nv = rewrite(a[key]);
        if (nv !== a[key]) { a[key] = nv; changed = true; }
      }
    }
  }
  for (const m of data.myList || []) {
    if (m.coverUrl) {
      const nv = rewrite(m.coverUrl);
      if (nv !== m.coverUrl) { m.coverUrl = nv; changed = true; }
    }
  }
  return changed;
}

// ── 初始化 ──
async function init() {
  const startTime = Date.now();
  startupTime = startTime;

  // Phase 1: Parallel init
  cleanupOldCache(DATA_DIR).then(total => {
    if (total > 0) logger.info(`Cleaned ${total} expired cache files (>14d)`);
  }).catch(e => logger.warn('Cache cleanup error:', e.message));
  await db.ensureSchema().catch((e: any) => logger.warn('Schema ensure skipped:', e.message));

  // Phase 2: Hydrate data
  data = (await db.loadData()) || { discovered: [], library: [], myList: [], playSessions: [] };

  // 结构整改迁移：DB 中旧 server/ 前缀的本地路径 → data/（幂等，一次性）
  try {
    if (migrateLegacyDataPaths(data)) {
      await db.saveAll(data).catch((e: any) => logger.warn('Legacy path migration save error:', e.message));
      logger.info(`Migrated legacy data paths: ${SERVER_ROOT} → ${DATA_DIR}`);
    }
  } catch (e: any) {
    logger.warn('Legacy path migration error:', e.message);
  }

  // Migrate scannedTree from old anime-data.json
  const OLD_DATA_PATH = path.join(DATA_DIR, 'anime-data.json');
  let scannedTree = loadScannedTree();
  if ((!scannedTree || scannedTree.length === 0) && fs.existsSync(OLD_DATA_PATH)) {
    try {
      const oldRaw = fs.readFileSync(OLD_DATA_PATH, 'utf-8');
      const oldData = JSON.parse(oldRaw);
      if (oldData.scannedTree && Array.isArray(oldData.scannedTree) && oldData.scannedTree.length > 0) {
        scannedTree = oldData.scannedTree;
        await saveScannedTree(scannedTree);
        logger.info(`Migrated scannedTree from anime-data.json (${scannedTree.length} nodes)`);
      }
    } catch (e: any) {
      logger.warn('ScannedTree migration skipped:', e.message);
    }
  }
  data.scannedTree = scannedTree;

  // Auto-create MyList for existing library
  if (!data.myList) data.myList = [];
  let myListDirty = false;
  for (const anime of data.library) {
    if (!data.myList.find((m: any) => m.animeId === anime.id)) {
      data.myList.push({ animeId: anime.id, status: 'wish', rating: null, thoughts: '', notes: '' });
      myListDirty = true;
    }
  }
  if (myListDirty) {
    db.saveMyList(data).catch((e: any) => logger.warn('MyList migration save error:', e.message));
    logger.info(`Auto-created MyList entries for ${data.library.length} library items`);
  }

  // Phase 3: Cover validation
  validateCovers(data).catch(e => logger.warn('Cover validation error:', e.message));
  validateBanners(data).catch(e => logger.warn('Banner validation error:', e.message));

  // Phase 3.5: Thumbnail self-heal — 队列不持久化，重启后重建缺失缩略图的待生成清单
  // （背景队列空闲时生成；已缓存的跳过，md5(filePath+v1) 命中即不重复入队）
  try {
    thumbnailQueue.enqueueMissingForLibrary(data.library || []);
  } catch (e: any) {
    logger.warn('Thumbnail startup enqueue error:', e?.message || e);
  }

  // Phase 4: Start serving (try ports 3456→3460, fallback on EADDRINUSE)
  // BASE_PORT can be overridden via env (e.g. Vite dev on 3456 → backend on 3457)
  const PORT_RANGE = 5;
  const BASE_PORT = parseInt(process.env.BASE_PORT || '', 10) || 3456;
  let actualPort: any = null;
  for (let i = 0; i < PORT_RANGE; i++) {
    const candidate = BASE_PORT + i;
    try {
      await new Promise<void>((resolve, reject) => {
        const s = server.listen(candidate, '127.0.0.1', () => { actualPort = candidate; resolve(); });
        s.on('error', (e: any) => { if (e.code === 'EADDRINUSE') reject(e); else reject(e); });
      });
      break;
    } catch (e: any) {
      if (e.code === 'EADDRINUSE' && i < PORT_RANGE - 1) {
        logger.warn(`Port ${candidate} in use, trying ${candidate + 1}...`);
      } else {
        throw e;
      }
    }
  }
  if (actualPort === null) {
    throw new Error(`Ports ${BASE_PORT}-${BASE_PORT + PORT_RANGE - 1} all in use, cannot start server`);
  }

  // Write actual port for Rust sidecar consumption
  const portFile = path.join(DATA_DIR, '.port');
  try { fs.writeFileSync(portFile, String(actualPort), 'utf-8'); } catch (e: any) {
    logger.error(`Failed to write .port file: ${e.message}`);
  }
  console.log(`PORT=${actualPort}`);  // stdout for sidecar stdout capture
  bootLog(`Server listening on port ${actualPort}`);

  const elapsed = Date.now() - startTime;
  logger.info(`Ready in ${elapsed}ms — ${data.library.length} anime, port ${actualPort}`);
  if (config.mediaDir) {
    logger.info(`Media directory: ${config.mediaDir}`);
  }

}

init().catch(e => {
  logger.error('Failed to initialize server:', e);
  process.exit(1);
});

export { server, server as app };
