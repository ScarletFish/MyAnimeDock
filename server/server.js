// server.js — HTTP server + REST API 入口（精简版，路由已拆分到 routes/）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const logger = require('./logger').child('[SERVER]');
const BangumiPersonal = require('./scrapers/bangumi-personal');
const BangumiSync = require('./bangumi-sync');

const {
  bootLog, DATA_DIR, ASSET_DIR, CONFIG_PATH, SCANNED_TREE_PATH,
  PORT, MAX_PLAY_SESSIONS, DEFAULT_CONFIG,
  loadConfig, saveConfig, loadScannedTree, saveScannedTree,
} = require('./lib/config');
const {
  mime, setFfmpegPath, preGenerateCovers, serveImage, serveRaw, readBody, jsonResp, cleanupOldCache,
} = require('./lib/utils');

// ── 引导日志 ──
bootLog('=== BOOT: server.js init ===');
bootLog(`PKG=${!!process.pkg} EXE=${process.execPath} CWD=${process.cwd()}`);
bootLog(`APPDATA=${process.env.APPDATA} TEMP=${process.env.TEMP}`);
bootLog(`DATA_DIR=${DATA_DIR}`);

// ── pkg 模式：重定向 console.log/error 到日志文件 ──
if (process.pkg) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const logFile = path.join(DATA_DIR, 'server.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const log = (msg) => logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
    console.log = (...args) => log(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    console.error = (...args) => log('ERROR: ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    console.log('=== MyAnimeDocker Sidecar started ===');
    bootLog('Log redirect OK');
  } catch (e) {
    bootLog('Log redirect FAILED: ' + (e?.message || e));
  }
}

// ── pkg 模式：NODE_PATH 让 require() 能找到原生模块 ──
if (process.pkg) {
  const nativeDirs = [
    path.join(path.dirname(process.execPath), 'resources', 'sidecar-modules'),
    path.join(path.dirname(process.execPath), 'sidecar-modules'),
  ];
  for (const dir of nativeDirs) {
    if (fs.existsSync(dir)) {
      bootLog(`NODE_PATH candidate found: ${dir}`);
      if (!process.env.NODE_PATH) process.env.NODE_PATH = '';
      if (!process.env.NODE_PATH.includes(dir)) {
        process.env.NODE_PATH += ';' + dir;
      }
    } else {
      bootLog(`NODE_PATH candidate missing: ${dir}`);
    }
  }
  require('module').Module._initPaths();
  bootLog('NODE_PATH setup done');
}

// ── 业务模块加载 ──
bootLog('Loading db...');
let db;
try {
  db = require('./db');
  if (process.env.FFMPEG_BIN) setFfmpegPath(process.env.FFMPEG_BIN);
  bootLog('db loaded OK');
} catch (e) {
  bootLog('db FAILED: ' + (e?.message || e));
  bootLog('STACK: ' + (e?.stack || ''));
  throw e;
}
bootLog('Loading scanner...');
const { scanMediaDirFlat, extractBgmId, isExtraVideo, parseFolderName } = require('./scanner');
bootLog('Loading pinyin...');
const pinyinModule = require('pinyin');
const pinyinFn = pinyinModule.pinyin || pinyinModule.default || pinyinModule;
bootLog('All modules loaded OK');

// ── 全局错误处理 ──
process.on('unhandledRejection', (reason, promise) => {
  logger.warn('Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err?.message || err);
});

// ── 运行时状态 ──
let autoImportResult = { count: 0, message: '' };
let pendingNotifications = [];
const activePlays = new Map();
const cancelledSyncSessions = new Map();
let config = loadConfig();
let data;
let startupTime;

// ── Bangumi 个人 API（OAuth + 终态推送）──
const bgmApiUrl = (config.apiSources || []).find(s => s.type === 'bangumi')?.url || 'https://api.bgm.tv';
const bangumiPersonal = new BangumiPersonal({ apiBase: bgmApiUrl });
bangumiPersonal.loadFromConfig(config);
bangumiPersonal.onTokenChange = (payload) => {
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
function saveData(data) {
  const p1 = db.saveAll(data);
  if (data.scannedTree !== undefined) {
    saveScannedTree(data.scannedTree);
  }
  return p1;
}

async function flushSaves() {
  // saveAll is synchronous, just await current
}

// ── 路由 handler 导入 ──
const H = Object.assign(
  {},
  require('./routes/config'),
  require('./routes/discovery'),
  require('./routes/library'),
  require('./routes/playback'),
  require('./routes/mylist'),
  require('./routes/stats'),
  require('./routes/bangumi')
);

// ── 内联 handler（关闭、封面、静态文件）──
function handleQuit(req, res, state) {
  const { db, logger } = state;
  jsonResp(res, 200, { ok: true, shutdown: true });
  logger.info('Shutdown requested via web UI.');
  db.shutdown().catch(() => {});
  setTimeout(() => process.exit(0), 1500);
}

function handleCoverImage(req, res, _state) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const coverPath = path.join(DATA_DIR, decodeURIComponent(urlPath));
  serveImage(coverPath, req.url, res);
}

function handleStaticFiles(req, res, _state) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  let filePath = path.join(ASSET_DIR, 'public', decodeURIComponent(urlPath));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (e, d) => {
    if (e) { res.writeHead(404); res.end('Not found'); return; }
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
  { method: 'POST', path: '/api/discovery/fetch-meta', handler: H.handleDiscoveryFetchMeta },
  // Library
  { method: 'GET', path: '/api/library', handler: H.handleGetLibrary },
  { method: 'POST', path: '/api/library/sync', handler: H.handleLibrarySync },
  { method: 'GET', path: '/api/library/sync/stream', handler: H.handleLibrarySyncStream },
  { method: 'OPTIONS', path: '/api/library/sync/stream', handler: (req, res) => {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Origin': '*',
    });
    res.end();
  }},
  // Anime detail (order matters: /sessions before /:id)
  { method: 'GET', pattern: /^\/api\/anime\/(.+?)\/sessions$/, handler: H.handleAnimeSessions },
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
  // Quit
  { method: 'POST', path: '/api/quit', handler: handleQuit },
  // Covers
  { method: 'GET', prefix: '/covers/', handler: handleCoverImage },
];

// ── HTTP 服务器 ──
let server;

function makeState() {
  return {
    data, config, db, logger, activePlays, cancelledSyncSessions,
    bangumiPersonal, bangumiSync, pendingNotifications, autoImportResult,
    server, startupTime, saveData, loadScannedTree,
  };
}

server = http.createServer((req, res) => {
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

// ── 启动自动导入（async，post-init）──
async function autoImportNewFolders(data, config) {
  if (!config.mediaDir || !fs.existsSync(config.mediaDir)) return;
  const aiLog = logger.child('[AUTOIMPORT]');
  const { registry } = require('./scrapers');
  const coverDir = path.join(DATA_DIR, 'covers');

  const importedPaths = new Set(data.library.map(a => a.folderPath));
  const candidates = scanMediaDirFlat(config.mediaDir);
  let imported = 0;

  for (const item of candidates) {
    if (importedPaths.has(item.path)) continue;
    const bgmId = item.bangumiId || extractBgmId(item.name) || extractBgmId(item.path);
    if (!bgmId) continue;

    aiLog.info(`Auto-importing: ${item.name} (bgmId=${bgmId})`);
    try {
      const meta = await registry.fetchMetadata('bangumi', item.parsedTitle, coverDir, bgmId, config);
      const anime = {
        id: String(bgmId),
        folderPath: item.path,
        folderName: item.name,
        title: meta?.bangumiTitle || item.parsedTitle,
        season: item.parsedSeason || null,
        specialSuffix: item.specialSuffix || null,
        importedAt: new Date().toISOString(),
        downloaded: true,
        bangumiId: bgmId,
        bangumiTitle: meta?.bangumiTitle || item.parsedTitle,
        bangumiTitleJp: meta?.bangumiTitleJp || null,
        bangumiTitleEn: null,
        summary: meta?.summary || null,
        coverUrl: meta?.coverUrl || null,
        localCover: meta?.localCover || null,
        rating: meta?.rating || null,
        metadataSource: meta?.source || 'bangumi',
        matchedSeason: item.parsedSeason || null,
        totalSeasons: null,
        episodes: item.videos.map((v, i) => ({
          number: i + 1,
          filePath: path.join(item.path, v.name) || v.path,
          fileName: v.name,
          fileSize: v.size || 0,
          duration: null,
          watched: false,
          progress: 0,
        })),
      };
      if (meta) {
        anime.characters = meta.characters || [];
        anime.persons = meta.persons || [];
        anime.tags = meta.tags || [];
        anime.date = meta.date || null;
        anime.platform = meta.platform || null;
        anime.ratingRank = meta.ratingRank || null;
        anime.ratingTotal = meta.ratingTotal || null;
        anime.infobox = meta.infobox || [];
        anime.collection = meta.collection || null;
        anime.eps = meta.eps || null;
        anime.totalEpisodes = meta.totalEpisodes || null;
      }
      if (meta?.localCover) preGenerateCovers(meta.localCover);

      data.library.push(anime);
      if (!data.myList) data.myList = [];
      if (!data.myList.find(m => m.animeId === anime.id)) {
        data.myList.push({ animeId: anime.id, status: 'wish', rating: null, thoughts: '', notes: '' });
      }
      if (anime.bangumiId) {
        const wishIdx = data.myList.findIndex(m => !m.animeId && m.bangumiId === anime.bangumiId);
        if (wishIdx !== -1) data.myList.splice(wishIdx, 1);
      }

      await db.saveLibrary(data);
      await db.saveMyList(data);
      imported++;

      try {
        BangumiSync.pushStatusChange(anime.id, data);
      } catch (_) {}
    } catch (e) {
      aiLog.warn(`Failed to import ${item.folderName}: ${e.message}`);
    }
  }

  aiLog.info(`Auto-imported ${imported} new anime`);
  autoImportResult = { count: imported, message: imported > 0 ? `自动导入了 ${imported} 部新番` : '', done: true };
  if (imported > 0) {
    pendingNotifications.push({ type: 'auto_import', count: imported, message: autoImportResult.message });
  }
}

async function validateCovers(data) {
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

// ── 初始化 ──
async function init() {
  // Kill stale port 3456 process
  try {
    const out = require('child_process').execSync(
      `netstat -ano | findstr ":${PORT} " | findstr LISTENING`,
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    for (const line of out.split('\n').filter(Boolean)) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && pid !== '0' && !isNaN(pid)) {
        require('child_process').execSync(`taskkill /F /PID ${pid}`, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
        bootLog(`Killed stale process on port ${PORT} (PID ${pid})`);
        await new Promise(r => setTimeout(r, 200));
      }
    }
  } catch (_) {}

  const startTime = Date.now();
  startupTime = startTime;

  // Phase 1: Parallel init
  cleanupOldCache(DATA_DIR).then(total => {
    if (total > 0) logger.info(`Cleaned ${total} expired cache files (>14d)`);
  }).catch(e => logger.warn('Cache cleanup error:', e.message));
  await db.ensureSchema().catch(e => logger.warn('Schema ensure skipped:', e.message));

  // Phase 2: Hydrate data
  data = (await db.loadData()) || { discovered: [], library: [], myList: [], playSessions: [] };

  // Migrate scannedTree from old anime-data.json
  const OLD_DATA_PATH = path.join(DATA_DIR, 'anime-data.json');
  let scannedTree = loadScannedTree();
  if ((!scannedTree || scannedTree.length === 0) && fs.existsSync(OLD_DATA_PATH)) {
    try {
      const oldRaw = fs.readFileSync(OLD_DATA_PATH, 'utf-8');
      const oldData = JSON.parse(oldRaw);
      if (oldData.scannedTree && Array.isArray(oldData.scannedTree) && oldData.scannedTree.length > 0) {
        scannedTree = oldData.scannedTree;
        saveScannedTree(scannedTree);
        logger.info(`Migrated scannedTree from anime-data.json (${scannedTree.length} nodes)`);
      }
    } catch (e) {
      logger.warn('ScannedTree migration skipped:', e.message);
    }
  }
  data.scannedTree = scannedTree;

  // Auto-create MyList for existing library
  if (!data.myList) data.myList = [];
  let myListDirty = false;
  for (const anime of data.library) {
    if (!data.myList.find(m => m.animeId === anime.id)) {
      data.myList.push({ animeId: anime.id, status: 'wish', rating: null, thoughts: '', notes: '' });
      myListDirty = true;
    }
  }
  if (myListDirty) {
    db.saveMyList(data).catch(e => logger.warn('MyList migration save error:', e.message));
    logger.info(`Auto-created MyList entries for ${data.library.length} library items`);
  }

  // Phase 3: Cover validation
  validateCovers(data).catch(e => logger.warn('Cover validation error:', e.message));

  // Phase 4: Start serving
  await new Promise(resolve => server.listen(PORT, resolve));
  server._ready = true;

  const elapsed = Date.now() - startTime;
  logger.info(`Ready in ${elapsed}ms — ${data.library.length} anime, port ${PORT}`);
  if (config.mediaDir) {
    logger.info(`Media directory: ${config.mediaDir}`);
  }

  // Phase 5: Auto-import
  if (config.mediaDir) {
    autoImportNewFolders(data, config).catch(e =>
      logger.warn('[AUTOIMPORT] Error:', e.message)
    );
  }
}

init().catch(e => {
  logger.error('Failed to initialize server:', e);
  process.exit(1);
});

module.exports = { server, app: server };
