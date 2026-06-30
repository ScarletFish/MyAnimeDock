const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
let ffmpegPath = require('ffmpeg-static') || 'ffmpeg';
const logger = require('./logger').child('[SERVER]');
const BangumiPersonal = require('./scrapers/bangumi-personal');
const BangumiSync = require('./bangumi-sync');

// ── 启动引导日志（写入 %TEMP%，早于一切模块加载，崩溃也不丢）──
const BOOT_LOG = path.join(process.env.TEMP || process.env.TMP || '.', 'myanimedocker-bootstrap.log');
const bootLog = (msg) => { try { fs.appendFileSync(BOOT_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {} };
bootLog('=== BOOT: server.js init ===');
bootLog(`PKG=${!!process.pkg} EXE=${process.execPath} CWD=${process.cwd()}`);
bootLog(`APPDATA=${process.env.APPDATA} TEMP=${process.env.TEMP}`);

// ── 用户数据目录 ──
// pkg 模式：%APPDATA%/com.myanimedocker.app（可写），开发模式：脚本同级
const DATA_DIR = process.pkg
  ? path.join(process.env.APPDATA || process.env.HOME || '.', 'com.myanimedocker.app')
  : __dirname;
bootLog(`DATA_DIR=${DATA_DIR}`);

// pkg 模式：写入日志到 DATA_DIR + console 重定向
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

// pkg 模式：NODE_PATH 让 require() 能找到原生模块
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

// ── 业务模块（放在日志重定向和 NODE_PATH 之后，确保崩溃可追踪）──
bootLog('Loading db...');
let db;
try {
  db = require('./db');
  // db.js 可能设置了 FFMPEG_BIN（pkg 模式），更新 ffmpegPath
  if (process.env.FFMPEG_BIN) ffmpegPath = process.env.FFMPEG_BIN;
  bootLog('db loaded OK');
} catch (e) {
  bootLog('db FAILED: ' + (e?.message || e));
  bootLog('STACK: ' + (e?.stack || ''));
  throw e;
}
bootLog('Loading scanner...');
const { scanMediaDirFlat, isExtraVideo } = require('./scanner');
bootLog('Loading pinyin...');
const pinyinModule = require('pinyin');
const pinyinFn = pinyinModule.pinyin || pinyinModule.default || pinyinModule;
bootLog('All modules loaded OK');

// ── 全局 Promise 拒绝处理，防止未捕获拒绝导致进程退出 ──
process.on('unhandledRejection', (reason, promise) => {
  logger.warn('Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err?.message || err);
});

// 前端静态资源目录：pkg 打包后在临时解压目录（__dirname），开发模式在脚本上级目录（public/ 在项目根）
const ASSET_DIR = path.join(__dirname, '..');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SCANNED_TREE_PATH = path.join(DATA_DIR, 'scanned-tree.json');
const PORT = 3456;

// In-memory active mpv sessions: filePath -> { sessionId, episode, anime }
const activePlays = new Map();
const MAX_PLAY_SESSIONS = 5000;

// Track active sync sessions for cancellation: sessionId -> boolean
const cancelledSyncSessions = new Map();

// --- Config ---
const DEFAULT_CONFIG = { 
  mediaDir: '', 
  playerMode: 'mpv', 
  mpvPath: 'mpv', 
  theme: 'default',
  themeMode: 'dark',
  autoMarkWatched: true,
  uiScale: 1.25,
  apiSources: [
    { type: 'bangumi', url: 'https://api.bangumi.one', key: '' },
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
          url: cfg.scrapers.bangumi?.apiBase || 'https://api.bangumi.one',
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

let config = loadConfig();

// ─── Bangumi 个人 API（OAuth + 终态推送）───
// 从 apiSources 读取 bangumi API 基地址（支持镜像站），用于 OAuth 后的 API 调用
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

// --- Data ---
// SQLite 是 library / memories / playSessions 的主存储
// scannedTree 独立写 JSON 文件
// config.json 独立管理

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
    logger.error('ScannedTree save error:', e.message);
  }
}

/** 持久化保存（全量，用于多类型数据同时变更）。 */
function saveData(data) {
  const p1 = db.saveAll(data);
  if (data.scannedTree !== undefined) {
    saveScannedTree(data.scannedTree);
  }
  return p1;
}

/** 等待所有未完成的保存操作完成（用于优雅关闭前） */
async function flushSaves() {
  // saveAll 是串行的，直接 await 当前即可
}

let data;
let startupTime;

// --- MIME ---
const mime = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.mkv': 'video/x-matroska',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

// --- Pre-generate common cover sizes after download ---
const COVER_PRE_SIZES = [
  { w: 400, q: 75 },
  { w: 540, q: 80 },
];

function preGenerateCovers(coverPath) {
  if (!coverPath || !ffmpegPath || !fs.existsSync(ffmpegPath) || !fs.existsSync(coverPath)) return;
  const cacheDir = path.join(path.dirname(coverPath), '.resized');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  for (const { w, q } of COVER_PRE_SIZES) {
    const cacheName = `thumb_${w}_q${q}_${path.basename(coverPath)}`;
    const cachePath = path.join(cacheDir, cacheName);
    if (fs.existsSync(cachePath)) continue;
    const ffq = Math.max(2, Math.min(31, Math.round(2 + (31 - 2) * (100 - q) / 100)));
    try {
      const ff = spawn(ffmpegPath, [
        '-i', coverPath,
        '-vf', `scale=${w}:-1`,
        '-q:v', String(ffq),
        '-y', cachePath,
        '-loglevel', 'error',
      ]);
      ff.on('error', () => {});
    } catch (_) {}
  }
}

// --- Image serving (with ffmpeg resize when ?w= param present) ---
function serveImage(filePath, url, res) {
  const params = new URL(url, 'http://localhost').searchParams;
  const w = parseInt(params.get('w'));
  const q = parseInt(params.get('q')) || 75;
  // 有宽度参数 + ffmpeg 可用 → 生成缩放缓存（消除原图过大导致的锯齿）
  if (w && ffmpegPath && fs.existsSync(ffmpegPath) && fs.existsSync(filePath)) {
    const ext = path.extname(filePath) || '.jpg';
    const cacheDir = path.join(path.dirname(filePath), '.resized');
    const cacheName = `thumb_${w}_q${q}_${path.basename(filePath)}`;
    const cachePath = path.join(cacheDir, cacheName);

    if (fs.existsSync(cachePath)) {
      // 缓存命中 → 直接返回
      fs.readFile(cachePath, (e2, d2) => {
        if (e2) { serveRaw(filePath, res); return; }
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(d2);
      });
      return;
    }

    // 缓存未命中 → ffmpeg 生成
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    // 映射 q (1-100) 到 ffmpeg -q:v (31-2, 越低越好)
    const ffq = Math.max(2, Math.min(31, Math.round(2 + (31 - 2) * (100 - q) / 100)));
    let done = false;
    try {
      const ff = spawn(ffmpegPath, [
        '-i', filePath,
        '-vf', `scale=${w}:-1`,
        '-q:v', String(ffq),
        '-y', cachePath,
        '-loglevel', 'error',
      ]);
      ff.on('close', (code) => {
        if (done) return; done = true;
        if (code === 0 && fs.existsSync(cachePath)) {
          fs.readFile(cachePath, (e2, d2) => {
            if (e2) { serveRaw(filePath, res); return; }
            res.writeHead(200, {
              'Content-Type': mime[ext] || 'application/octet-stream',
              'Cache-Control': 'public, max-age=86400',
            });
            res.end(d2);
          });
        } else {
          serveRaw(filePath, res);
        }
      });
      ff.on('error', () => {
        if (done) return; done = true;
        serveRaw(filePath, res);
      });
    } catch (e) {
      if (done) return; done = true;
      serveRaw(filePath, res);
    }
    return;
  }

  // 无宽度参数或无 ffmpeg → 原始文件
  serveRaw(filePath, res);
}

function serveRaw(filePath, res) {
  fs.readFile(filePath, (e, d) => {
    if (e) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(d);
  });
}

// --- JSON body parser ---
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// --- API helpers ---
function jsonResp(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

// --- Server ---
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // Root: redirect to index.html
  if (urlPath === '/') {
    res.writeHead(302, { 'Location': '/index.html' });
    res.end();
    return;
  }

  // --- API: config ---
  if (urlPath === '/api/config' && req.method === 'GET') {
    const dirValid = config.mediaDir
      ? fs.existsSync(config.mediaDir) && fs.statSync(config.mediaDir).isDirectory()
      : false;
    jsonResp(res, 200, { ...config, dirValid });
    return;
  }

  // --- API: health (for Tauri readiness polling) ---
  if (urlPath === '/api/health' && req.method === 'GET') {
    jsonResp(res, 200, {
      ready: !!server._ready,
      library: data ? data.library.length : 0,
      uptime: server._ready ? Date.now() - startupTime : 0,
    });
    return;
  }

  if (urlPath === '/api/config' && req.method === 'POST') {
    readBody(req).then(body => {
      const parsed = JSON.parse(body);
      if (parsed.mediaDir !== undefined) {
        const resolved = path.resolve(parsed.mediaDir);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          jsonResp(res, 400, { error: 'Directory does not exist: ' + resolved });
          return;
        }
        config.mediaDir = resolved;
      }
      config.playerMode = 'mpv'; // 系统播放器模式已移除，固定 mpv
      if (parsed.mpvPath !== undefined) config.mpvPath = parsed.mpvPath;
      if (parsed.theme !== undefined) config.theme = parsed.theme;
      if (parsed.themeMode !== undefined) config.themeMode = parsed.themeMode;
      if (parsed.autoMarkWatched !== undefined) config.autoMarkWatched = !!parsed.autoMarkWatched;
      if (parsed.uiScale !== undefined) config.uiScale = Math.max(0.5, Math.min(2, parsed.uiScale));
      if (parsed.reduceMotion !== undefined) config.reduceMotion = !!parsed.reduceMotion;
      if (parsed.apiSources !== undefined) config.apiSources = parsed.apiSources;
      // Bangumi OAuth 凭据
      if (parsed.bangumiClientId !== undefined) {
        config.bangumiClientId = parsed.bangumiClientId;
        bangumiPersonal.clientId = parsed.bangumiClientId;
      }
      if (parsed.bangumiClientSecret !== undefined) {
        config.bangumiClientSecret = parsed.bangumiClientSecret;
        bangumiPersonal.clientSecret = parsed.bangumiClientSecret;
      }
      // Legacy fields — silently accept and convert
      if (parsed.apiSources === undefined && parsed.scrapers !== undefined) {
        const sources = [];
        if (parsed.scrapers.bangumi?.enabled !== false) {
          sources.push({
            type: 'bangumi',
            url: parsed.scrapers.bangumi?.apiBase || 'https://api.bangumi.one',
            key: '',
          });
        }
        if (parsed.scrapers.tmdb?.enabled !== false && parsed.tmdbApiKey) {
          sources.push({ type: 'tmdb', url: 'https://api.themoviedb.org/3', key: parsed.tmdbApiKey });
        }
        config.apiSources = sources.length > 0 ? sources : DEFAULT_CONFIG.apiSources;
      }
      saveConfig(config);
      jsonResp(res, 200, { ok: true, ...config });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: browse (return cached flat tree) ---
  if (urlPath.startsWith('/api/browse') && req.method === 'GET') {
    if (!config.mediaDir) {
      jsonResp(res, 200, { tree: [], mediaDir: '' });
      return;
    }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const showExcluded = params.get('showExcluded') === 'true';
    try {
      let tree = JSON.parse(JSON.stringify(data.scannedTree || []));
      // Migrate old tree format: flatten branch nodes to leaves in-place
      if (tree.some(n => n.type === 'branch')) {
        const flatten = (nodes) => {
          const result = [];
          for (const n of nodes) {
            if (n.type === 'leaf') result.push(n);
            else if (n.type === 'branch' && n.children) result.push(...flatten(n.children));
          }
          return result;
        };
        tree = flatten(tree);
        data.scannedTree = tree;
        saveScannedTree(data.scannedTree);
      }
      // Normalize season 1 → null (implicit default; only S2+ worth annotating)
      for (const n of tree) {
        if (n.type === 'leaf' && n.parsedSeason === 1) {
          n.parsedSeason = null;
        }
      }
      // Migrate existing scannedTree titles: strip S\d+ from parsedTitle, compute specialSuffix
      for (const n of tree) {
        if (n.type === 'leaf') {
          if (n.parsedTitle) {
            n.parsedTitle = n.parsedTitle.replace(/\s*S\d+\s*$/i, '').trim();
          }
          if (!n.specialSuffix && n.parsedTitle) {
            const suffixMatch = n.parsedTitle.match(/([~～][^~～]*[~～])\s*$/);
            if (suffixMatch) n.specialSuffix = suffixMatch[1].trim();
          }
        }
      }
      const libraryPaths = new Set(data.library.map(a => a.folderPath));
      for (const n of tree) {
        if (n.type === 'leaf') {
          n.alreadyImported = libraryPaths.has(n.path);
          if (n.excluded === undefined) n.excluded = false;
          if (n.bangumiMatched === undefined) n.bangumiMatched = false;
        }
      }
      const filteredTree = showExcluded ? tree : tree.filter(n => !n.excluded);
      jsonResp(res, 200, { tree: filteredTree, mediaDir: config.mediaDir });
    } catch (e) {
      jsonResp(res, 500, { error: e.message });
    }
    return;
  }

  // --- API: scan (SSE) — persists flat leaf array to data ---
  if (urlPath === '/api/scan' && req.method === 'GET') {
    if (!config.mediaDir) {
      jsonResp(res, 400, { error: 'Media directory not configured' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      const { scanTopDir } = require('./scanner');
      const entries = fs.readdirSync(config.mediaDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && e.name !== 'covers');
      const total = dirs.length;
      const tree = [];
      const libraryPaths = new Set(data.library.map(a => a.folderPath));
      const existingNodes = new Map((data.scannedTree || []).map(n => [n.path, n]));

      for (let i = 0; i < dirs.length; i++) {
        const entry = dirs[i];
        send({ type: 'progress', current: i + 1, total, folder: entry.name });
        const node = scanTopDir(config.mediaDir, entry.name);
        if (node) {
          (function flatten(n) {
            if (n.type === 'leaf') {
              n.alreadyImported = libraryPaths.has(n.path);
              // Preserve excluded, bangumiMatched from previous scan
              const existing = existingNodes.get(n.path);
              if (existing) {
                n.excluded = existing.excluded || false;
                n.bangumiMatched = existing.bangumiMatched || false;
                n.bangumiId = existing.bangumiId;
                n.bangumiTitle = existing.bangumiTitle;
                n.bangumiTitleJp = existing.bangumiTitleJp;
                n.summary = existing.summary;
                n.coverUrl = existing.coverUrl;
                n.localCover = existing.localCover;
                n.rating = existing.rating;
              } else {
                n.excluded = false;
                n.bangumiMatched = false;
              }
              tree.push(n);
            } else if (n.type === 'branch' && n.children) {
              n.children.forEach(flatten);
            }
          })(node);
        }
      }
      data.scannedTree = tree;
      saveScannedTree(data.scannedTree);
      send({ type: 'done', tree });

      // Background prefetch AniList data for romaji titles
      if (config.apiSources?.some(s => s.type === 'anilist')) {
        const { registry, isPrimarilyRomaji } = require('./scrapers');
        const { parseFolderName } = require('./scanner');
        const anilist = registry.get('anilist');
        if (anilist) {
          const romajiKeywords = tree
            .filter(n => n.type === 'leaf' && !n.alreadyImported)
            .map(n => parseFolderName(n.name))
            .filter(p => isPrimarilyRomaji(p.cleanTitle || p.title))
            .map(p => p.cleanTitle)
            .filter(Boolean)
            .slice(0, 20); // Limit to 20 to avoid rate limits

          if (romajiKeywords.length > 0) {
            // Don't await - run in background
            anilist.prefetch(romajiKeywords, registry, config).catch(() => {});
          }
        }
      }
    } catch (e) {
      send({ type: 'error', message: e.message });
    }
    res.end();
    return;
  }

  // --- API: import selected anime ---
  if (urlPath === '/api/import' && req.method === 'POST') {
    readBody(req).then(body => {
      const { items } = JSON.parse(body);
      if (!Array.isArray(items) || items.length === 0) {
        jsonResp(res, 400, { error: 'items array is required' });
        return;
      }
      const { findVideos, isExtraVideo } = require('./scanner');
      const imported = [];
      for (const item of items) {
        const { folderPath, folderName, parsedTitle, parsedSeason, specialSuffix } = item;
        if (!folderPath || !folderName) continue;

        const videos = findVideos(folderPath);
        const episodeFiles = videos.filter(v => !isExtraVideo(v.name));
        const scannedNode = data.scannedTree.find(n => n.path === folderPath);

        // Allow re-import of previously deleted (downloaded=false) items
        const existing = data.library.find(a => a.folderPath === folderPath);
        if (existing) {
          if (existing.downloaded !== false) continue;
          // Reactivate: just flip downloaded flag and refresh episodes
          existing.downloaded = true;
          existing.importedAt = new Date().toISOString();
          existing.episodes = episodeFiles.map((v, i) => ({
            number: i + 1,
            filePath: v.path,
            fileName: v.name,
            fileSize: v.size,
            duration: null,
            watched: false,
            progress: 0,
          }));
          imported.push(existing.id);
          if (scannedNode) scannedNode.excluded = false;
          continue;
        }

        const anime = {
          id: parsedTitle + (parsedSeason ? `-Season ${parsedSeason}` : ''),
          folderPath,
          folderName,
          title: parsedTitle,
          season: parsedSeason || null,
          specialSuffix: specialSuffix || null,
          importedAt: new Date().toISOString(),
          downloaded: true,
          bangumiId: scannedNode?.bangumiId || null,
          bangumiTitle: scannedNode?.bangumiTitle || null,
          bangumiTitleJp: scannedNode?.bangumiTitleJp || null,
          summary: scannedNode?.summary || null,
          coverUrl: scannedNode?.coverUrl || null,
          localCover: scannedNode?.localCover || null,
          rating: scannedNode?.rating || null,
          episodes: episodeFiles.map((v, i) => ({
            number: i + 1,
            filePath: v.path,
            fileName: v.name,
            fileSize: v.size,
            duration: null,
            watched: false,
            progress: 0,
          })),
        };
        data.library.push(anime);
        imported.push(anime.id);
        // Auto-create MyList entry so imported items appear in MyList immediately
        if (!data.myList) data.myList = [];
        if (!data.myList.find(m => m.animeId === anime.id)) {
          data.myList.push({ animeId: anime.id, status: 'watching', rating: null, thoughts: '', notes: '' });
        }
        // 若有同 bangumiId 的 wish 条目，清理（已转为 watching）
        if (anime.bangumiId) {
          const wishIdx = data.myList.findIndex(m => !m.animeId && m.bangumiId === anime.bangumiId);
          if (wishIdx !== -1) {
            data.myList.splice(wishIdx, 1);
          }
        }
        // Clear excluded flag if it was excluded
        if (scannedNode) {
          scannedNode.excluded = false;
        }
        // 有 bangumiId → 自动推送到 Bangumi（异步，不阻塞响应）
        if (anime.bangumiId) {
          bangumiSync.pushStatusChange(anime.id, data);
        }
      }
      Promise.all([db.saveLibrary(data), db.saveMyList(data), saveScannedTree(data.scannedTree)]);
      jsonResp(res, 200, { ok: true, imported });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: discovery unlink (remove from library, keep in scannedTree) ---
  if (urlPath === '/api/discovery/unlink' && req.method === 'POST') {
    readBody(req).then(body => {
      const { path } = JSON.parse(body);
      if (!path) {
        jsonResp(res, 400, { error: 'path is required' });
        return;
      }
      const idx = data.library.findIndex(a => a.folderPath === path);
      if (idx === -1) {
        jsonResp(res, 404, { error: 'Anime not found in library' });
        return;
      }
      data.library.splice(idx, 1);
      // Clear scannedTree metadata so Discovery view reflects the change
      const scannedNode = data.scannedTree && data.scannedTree.find(n => n.path === path);
      if (scannedNode) {
        scannedNode.alreadyImported = false;
        scannedNode.bangumiMatched = false;
        scannedNode.bangumiId = null;
        scannedNode.bangumiTitle = null;
        scannedNode.bangumiTitleJp = null;
        scannedNode.bangumiTitleEn = null;
        scannedNode.bangumiTitleRomaji = null;
        scannedNode.summary = null;
        scannedNode.coverUrl = null;
        scannedNode.localCover = null;
        scannedNode.rating = null;
        scannedNode.metadataSource = null;
      }
      saveScannedTree(data.scannedTree);
      jsonResp(res, 200, { ok: true });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: discovery exclude (mark as excluded from scan) ---
  if (urlPath === '/api/discovery/exclude' && req.method === 'POST') {
    readBody(req).then(body => {
      const { path } = JSON.parse(body);
      if (!path) {
        jsonResp(res, 400, { error: 'path is required' });
        return;
      }
      const node = data.scannedTree.find(n => n.path === path);
      if (!node) {
        jsonResp(res, 404, { error: 'Node not found in scanned tree' });
        return;
      }
      node.excluded = true;
      saveScannedTree(data.scannedTree);
      jsonResp(res, 200, { ok: true });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: discovery include (remove excluded mark) ---
  if (urlPath === '/api/discovery/include' && req.method === 'POST') {
    readBody(req).then(body => {
      const { path } = JSON.parse(body);
      if (!path) {
        jsonResp(res, 400, { error: 'path is required' });
        return;
      }
      const node = data.scannedTree.find(n => n.path === path);
      if (!node) {
        jsonResp(res, 404, { error: 'Node not found in scanned tree' });
        return;
      }
      node.excluded = false;
      saveScannedTree(data.scannedTree);
      jsonResp(res, 200, { ok: true });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: discovery fetch metadata (multi-source) ---
  if (urlPath === '/api/discovery/fetch-meta' && req.method === 'POST') {
    readBody(req).then(async body => {
      try {
        const { path: folderPath, subjectId, source = 'bangumi' } = JSON.parse(body);
        if (!folderPath) {
          jsonResp(res, 400, { error: 'path is required' });
          return;
        }
        const node = data.scannedTree.find(n => n.path === folderPath);
        if (!node) {
          jsonResp(res, 404, { error: 'Node not found in scanned tree' });
          return;
        }
        const { registry, matchSeason } = require('./scrapers');
        const { parseFolderName } = require('./scanner');
        const coverDir = path.join(DATA_DIR, 'covers');

        let subjectIdToUse = subjectId;
        let sourceToUse = source;

        if (!subjectIdToUse) {
          // Parse folder name for structured matching
          const folderParsed = parseFolderName(node.name);
          if (!folderParsed.cjkTitle && node.cjkTitle) folderParsed.cjkTitle = node.cjkTitle;
          const videoCount = node.videoCount || 0;

          // Use new season-aware matching
          const match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
          if (!match) {
            jsonResp(res, 404, { error: '未找到匹配结果' });
            return;
          }
          subjectIdToUse = match.id;
          sourceToUse = match.source;
        }

        const meta = await registry.fetchMetadata(sourceToUse, node.parsedTitle, coverDir, subjectIdToUse, config);
        if (!meta) {
          jsonResp(res, 404, { error: '获取元数据失败' });
          return;
        }
        node.bangumiMatched = true;
        node.bangumiId = meta.bangumiId || meta.tmdbId || null;
        node.bangumiTitle = meta.bangumiTitle;
        node.bangumiTitleJp = meta.bangumiTitleJp;
        node.summary = meta.summary;
        node.coverUrl = meta.coverUrl;
        node.localCover = meta.localCover;
        node.rating = meta.rating;
        node.metadataSource = meta.source;
        if (meta.localCover) preGenerateCovers(meta.localCover);
        saveScannedTree(data.scannedTree);
        jsonResp(res, 200, { ok: true, meta, node });
      } catch (e) {
        jsonResp(res, 500, { error: e.message });
      }
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: library list ---
  if (urlPath === '/api/library' && req.method === 'GET') {
    data.library.forEach(a => {
      // 防御：episodes 可能存为数字（旧数据），统一转为数组
      if (a.episodes != null && !Array.isArray(a.episodes)) a.episodes = [];
      // Migrate existing titles: compute specialSuffix from title (which has ~...~ at end), strip S\d+ from title
      if (a.specialSuffix == null && a.title) {
        const suffixMatch = a.title.match(/([~～][^~～]*[~～])\s*$/);
        if (suffixMatch) a.specialSuffix = suffixMatch[1].trim();
      }
      if (a.title) {
        a.title = a.title.replace(/\s*S\d+\s*$/i, '').trim();
      }
      const name = a.bangumiTitle || a.title || '';
      try {
        a.pinyinTitle = pinyinFn(name).map(p => (p[0] || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')).join('');
      } catch (_) {
        a.pinyinTitle = '';
      }
      // Merge MyList status so library cards can display it
      const myItem = (data.myList || []).find(m => m.animeId === a.id);
      a.myListStatus = myItem ? myItem.status : null;
    });
    jsonResp(res, 200, data.library.filter(a => a.downloaded !== false));
    return;
  }

  // --- API: play sessions for anime ---
  if (urlPath.startsWith('/api/anime/') && urlPath.endsWith('/sessions') && req.method === 'GET') {
    const id = decodeURIComponent(urlPath.slice('/api/anime/'.length, -'/sessions'.length));
    const sessions = data.playSessions.filter(s => s.animeId === id && s.endTime);
    // Aggregate by date
    const byDate = {};
    for (const s of sessions) {
      const dateKey = s.startTime.slice(0, 10);
      byDate[dateKey] = (byDate[dateKey] || 0) + Math.max(0, s.duration || 0);
    }
    // Fill last 90 days
    const result = {};
    const now = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result[key] = Math.round((byDate[key] || 0) / 60);
    }
    jsonResp(res, 200, result);
    return;
  }

  // --- API: anime detail ---
  if (urlPath.startsWith('/api/anime/') && req.method === 'GET') {
    const id = decodeURIComponent(urlPath.slice('/api/anime/'.length));
    const anime = data.library.find(a => a.id === id);
    if (!anime) {
      jsonResp(res, 404, { error: 'Anime not found' });
      return;
    }
    // Update downloaded status
    anime.downloaded = fs.existsSync(anime.folderPath);
    jsonResp(res, 200, anime);
    return;
  }

  // --- API: delete anime (remove from library permanently) ---
  if (urlPath.startsWith('/api/anime/') && req.method === 'DELETE') {
    const id = decodeURIComponent(urlPath.slice('/api/anime/'.length));
    const idx = data.library.findIndex(a => a.id === id);
    if (idx === -1) {
      jsonResp(res, 404, { error: 'Anime not found' });
      return;
    }
    const removed = data.library[idx];
    removed.downloaded = false;
    // Ensure MyList entry persists (delete = archive in MyList)
    const existingMyItem = (data.myList || []).find(m => m.animeId === id);
    if (existingMyItem) {
      // keep existing status/thoughts/rating — user's manual data preserved
    } else {
      // auto-create MyList record with completed status
      if (!data.myList) data.myList = [];
      data.myList.push({
        animeId: id,
        status: 'completed',
        rating: removed.rating || null,
        thoughts: '',
        notes: '',
      });
    }
    // Clear metadata in scannedTree so Discovery view reflects the removal
    const scannedNode = data.scannedTree && data.scannedTree.find(n => n.path === removed.folderPath);
    if (scannedNode) {
      scannedNode.alreadyImported = false;
      scannedNode.bangumiMatched = false;
      scannedNode.bangumiId = null;
      scannedNode.bangumiTitle = null;
      scannedNode.bangumiTitleJp = null;
      scannedNode.bangumiTitleEn = null;
      scannedNode.summary = null;
      scannedNode.coverUrl = null;
      scannedNode.localCover = null;
      scannedNode.rating = null;
      scannedNode.metadataSource = null;
    }
    // await persistence so data survives restart
    Promise.all([db.saveLibrary(data), db.saveMyList(data), saveScannedTree(data.scannedTree)]).then(() => jsonResp(res, 200, { ok: true })).catch(e => {
      logger.error('Delete save error:', e);
      jsonResp(res, 500, { error: 'Failed to persist' });
    });
    return;
  }

  // --- API: MyList (统一列表) ---
  if (urlPath === '/api/mylist' && req.method === 'GET') {
    // 统一 MyList（Library 条目 + Wish 条目合并）
    const merged = [];
    const animeMap = new Map(data.library.map(a => [a.id, a]));
    for (const item of data.myList || []) {
      if (item.animeId) {
        const anime = animeMap.get(item.animeId);
        merged.push({
          id: item.id || item.animeId,
          animeId: item.animeId,
          bangumiId: anime ? anime.bangumiId : item.bangumiId,
          title: anime ? anime.title : item.title,
          bangumiTitle: anime ? anime.bangumiTitle : item.bangumiTitle,
          coverUrl: anime ? anime.coverUrl : item.coverUrl,
          localCover: anime ? anime.localCover : null,
          season: anime ? anime.season : null,
          rating: item.rating,
          thoughts: item.thoughts,
          status: item.status,
          episodeCount: anime ? anime.episodes.length : 0,
          episodesWatched: anime ? anime.episodes.filter(e => e.watched).length : 0,
          hasLocalFiles: !!anime,
          source: 'library',
          summary: anime ? anime.summary : item.summary,
        });
      } else {
        merged.push({
          id: item.id,
          bangumiId: item.bangumiId,
          title: item.title,
          bangumiTitle: item.bangumiTitle,
          coverUrl: item.coverUrl,
          rating: item.rating,
          status: 'wish',
          hasLocalFiles: false,
          source: 'wishlist',
          summary: item.summary,
        });
      }
    }
    jsonResp(res, 200, merged);
    return;
  }

  // PUT /api/mylist/:id/status — manually set status
  const mylistStatusMatch = urlPath.match(/^\/api\/mylist\/([^/]+)\/status$/);
  if (mylistStatusMatch && req.method === 'PUT') {
    readBody(req).then(body => {
      const { status } = JSON.parse(body);
      const id = decodeURIComponent(mylistStatusMatch[1]);
      if (!status || !['watching', 'wish', 'completed', 'on_hold', 'dropped'].includes(status)) {
        jsonResp(res, 400, { error: 'Invalid status' });
        return;
      }
      // Update in-memory data
      if (!data.myList) data.myList = [];
      let existing;
      if (id.startsWith('wish-')) {
        existing = data.myList.find(m => m.id === id);
      } else {
        existing = data.myList.find(m => m.animeId === id);
      }
      if (existing) {
        existing.status = status;
      } else if (id.startsWith('wish-')) {
        data.myList.push({ id, bangumiId: parseInt(id.replace('wish-', '')), title: '', status, rating: null, thoughts: '', notes: '' });
      } else {
        data.myList.push({ animeId: id, status, rating: null, thoughts: '', notes: '' });
      }
      db.saveMyList(data).then(() => {
        jsonResp(res, 200, { ok: true });
        // 异步推送状态变更到 Bangumi（不阻塞响应）
        if (existing && existing.animeId) bangumiSync.pushStatusChange(existing.animeId, data);
      }).catch(e => {
        logger.error('MyList status save error:', e);
        jsonResp(res, 500, { error: 'Failed to save status' });
      });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // DELETE /api/mylist/:id — remove item from MyList
  const mylistDeleteMatch = urlPath.match(/^\/api\/mylist\/([^/]+)$/);
  if (mylistDeleteMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(mylistDeleteMatch[1]);
    if (data.myList) {
      const idx = data.myList.findIndex(m => m.id === id || m.animeId === id);
      if (idx !== -1) {
        data.myList.splice(idx, 1);
      }
    }
    db.saveMyList(data).then(() => {
      jsonResp(res, 200, { ok: true });
    }).catch(e => {
      logger.error('MyList delete save error:', e);
      jsonResp(res, 500, { error: 'Failed to persist' });
    });
    return;
  }

  // --- API: memories (backward compat, read from myList) ---
  if (urlPath === '/api/memories' && req.method === 'GET') {
    jsonResp(res, 200, data.memories);
    return;
  }

  if (urlPath === '/api/memories' && req.method === 'POST') {
    readBody(req).then(body => {
      const { animeId, rating, thoughts, notes } = JSON.parse(body);
      if (!animeId) {
        jsonResp(res, 400, { error: 'animeId is required' });
        return;
      }
      // Write to myList backend with completed status (archive)
      if (!data.myList) data.myList = [];
      let existing = data.myList.find(m => m.animeId === animeId);
      if (existing) {
        if (rating !== undefined) existing.rating = rating;
        if (thoughts !== undefined) existing.thoughts = thoughts;
        if (notes !== undefined) existing.notes = notes;
        if (!existing.status) existing.status = 'completed';
      } else {
        data.myList.push({
          animeId,
          status: 'completed',
          rating: rating || null,
          thoughts: thoughts || '',
          notes: notes || '',
        });
      }
      db.saveMyList(data);
      // 异步推送终态（completed + 评分）到 Bangumi
      if (rating !== undefined || status === 'completed') {
        bangumiSync.pushStatusChange(animeId, data);
      }
      // Build legacy response
      const anime = data.library.find(a => a.id === animeId);
      const legacy = {
        animeId,
        title: anime ? anime.title : animeId,
        bangumiId: anime ? anime.bangumiId : null,
        bangumiTitle: anime ? anime.bangumiTitle : null,
        rating: rating || null,
        thoughts: thoughts || '',
        notes: notes || '',
        watchedAt: new Date().toISOString(),
        coverLocal: anime ? anime.localCover : null,
      };
      jsonResp(res, 200, { ok: true, memory: legacy });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: Wishlist (兼容旧路由，统一使用 MyList) ---
  if (urlPath === '/api/wishlist' && req.method === 'GET') {
    const wishItems = (data.myList || []).filter(m => !m.animeId);
    jsonResp(res, 200, wishItems);
    return;
  }

  if (urlPath === '/api/wishlist' && req.method === 'POST') {
    readBody(req).then(body => {
      const item = JSON.parse(body);
      if (!item.bangumiId || !item.title) {
        jsonResp(res, 400, { error: 'bangumiId and title required' });
        return;
      }
      if (!data.myList) data.myList = [];
      const existing = data.myList.find(m => !m.animeId && m.bangumiId === item.bangumiId);
      if (existing) {
        jsonResp(res, 200, { ok: true, myList: existing });
        return;
      }
      const entry = {
        id: 'wish-' + item.bangumiId,
        bangumiId: item.bangumiId,
        title: item.title,
        bangumiTitle: item.bangumiTitle || null,
        coverUrl: item.coverUrl || null,
        summary: item.summary || null,
        rating: item.rating || null,
        status: 'wish',
      };
      data.myList.push(entry);
      db.saveMyList(data);
      jsonResp(res, 200, { ok: true, myList: entry });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // DELETE /api/wishlist/:id (兼容旧路由)
  const wishlistDeleteMatch = urlPath.match(/^\/api\/wishlist\/([^/]+)$/);
  if (wishlistDeleteMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(wishlistDeleteMatch[1]);
    const idx = (data.myList || []).findIndex(m => m.id === id);
    if (idx === -1) {
      jsonResp(res, 404, { error: 'Wishlist item not found' });
      return;
    }
    data.myList.splice(idx, 1);
    db.saveMyList(data).then(() => jsonResp(res, 200, { ok: true })).catch(e => {
      logger.error('Wishlist delete save error:', e);
      jsonResp(res, 500, { error: 'Failed to persist' });
    });
    return;
  }

  // --- API: play video ---
  if (urlPath === '/api/play' && req.method === 'POST') {
    readBody(req).then(async body => {
      const { filePath, position } = JSON.parse(body);
      if (!filePath) {
        jsonResp(res, 400, { error: 'filePath is required' });
        return;
      }
      if (!fs.existsSync(filePath)) {
        jsonResp(res, 404, { error: 'File not found' });
        return;
      }
      const mpvPath = config.mpvPath || 'mpv';
      // Find anime/episode for session tracking
      let targetAnime, targetEp;
      for (const a of data.library) {
        const ep = a.episodes.find(e => e.filePath === filePath);
        if (ep) { targetAnime = a; targetEp = ep; break; }
      }
      let sessionId = null;
      if (targetAnime && targetEp) {
        // Auto-mark all previous episodes as watched when starting a new episode
        if (config.autoMarkWatched && targetEp.number >= 2) {
          for (const ep of targetAnime.episodes) {
            if (ep.number < targetEp.number && !ep.watched) {
              ep.watched = true;
            }
          }
        }
        sessionId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        data.playSessions.push({
          animeId: targetAnime.id,
          episodeNumber: targetEp.number,
          sessionId,
          startTime: new Date().toISOString(),
          endTime: null,
          duration: 0,
          clockTime: 0,
          progressStart: position || 0,
        });
        if (data.playSessions.length > MAX_PLAY_SESSIONS) {
          data.playSessions.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
          data.playSessions.splice(0, data.playSessions.length - MAX_PLAY_SESSIONS);
        }
        activePlays.set(filePath, { sessionId, episode: targetEp, anime: targetAnime });
        db.savePlaySessions(data);
      }
      const { startMpv } = require('./mpv-controller');
      try {
        let settled = false;
        let spawnError = null;
        const spawnResult = await new Promise((resolve) => {
          startMpv(mpvPath, filePath, position || 0, {
            onProgress: ({ sessionId: cbSid, filePath: fp, progress, peakPos, watched, duration, final }) => {
              if (cbSid !== sessionId) return;
              const active = activePlays.get(fp);
              if (!active) return;
              const ep = active.episode;
              ep.progress = progress;
              if (duration > 0) ep.duration = duration;
              if (watched) ep.watched = true;
              db.updateEpisodeProgress(active.anime.id, ep.number, { progress, duration: duration > 0 ? duration : undefined, watched });
              if (active.sessionId) {
                const session = data.playSessions.find(s => s.sessionId === active.sessionId);
                if (session) {
                  session.duration = Math.max(0, (peakPos || progress) - (session.progressStart || 0));
                  session.endTime = new Date().toISOString();
                  const startMs = new Date(session.startTime).getTime();
                  const endMs = new Date(session.endTime).getTime();
                  session.clockTime = Math.round((endMs - startMs) / 1000);
                  db.updatePlaySession(active.sessionId, {
                    endTime: session.endTime,
                    duration: session.duration,
                    clockTime: session.clockTime,
                  });
                }
              }
              if (final) {
                // 播放结束 → 自动推送已看集数到 Bangumi
                if (active.anime?.bangumiId) {
                  bangumiSync.pushStatusChange(active.anime.id, data);
                }
                activePlays.delete(fp);
              }
            },
            onError: (msg) => {
              const active = activePlays.get(filePath);
              if (active && active.sessionId) {
                const idx = data.playSessions.findIndex(s => s.sessionId === active.sessionId);
                if (idx !== -1) data.playSessions.splice(idx, 1);
                activePlays.delete(filePath);
                db.deletePlaySession(active.sessionId);
              }
              spawnError = msg;
              logger.error('mpv error:', msg);
              if (!settled) { settled = true; resolve({ error: msg }); }
            },
          }, sessionId);
          // Timeout: if no error within 2s, assume mpv launched successfully
          setTimeout(() => {
            if (!settled) { settled = true; resolve(null); }
          }, 2000);
        });
        if (spawnResult?.error) {
          jsonResp(res, 500, { error: spawnResult.error });
        } else {
          jsonResp(res, 200, { ok: true });
        }
      } catch (e) {
        jsonResp(res, 500, { error: e.message });
      }
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: update episode progress ---
  if (urlPath === '/api/progress' && req.method === 'POST') {
    readBody(req).then(body => {
      const { animeId, episodeNumber, progress, watched, duration } = JSON.parse(body);
      if (!animeId || episodeNumber === undefined) {
        jsonResp(res, 400, { error: 'animeId and episodeNumber are required' });
        return;
      }
      const anime = data.library.find(a => a.id === animeId);
      if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }
      const ep = anime.episodes.find(e => e.number === episodeNumber);
      if (!ep) { jsonResp(res, 404, { error: 'Episode not found' }); return; }
      if (progress !== undefined) ep.progress = progress;
      if (duration !== undefined) ep.duration = duration;
      if (watched !== undefined) ep.watched = watched;
      db.updateEpisodeProgress(animeId, episodeNumber, { progress, duration, watched });
      jsonResp(res, 200, { ok: true, episode: ep });
    }).catch(e => jsonResp(res, 400, { error: 'Invalid request body' }));
    return;
  }

  // --- API: Bangumi search ---
  if (urlPath === '/api/bangumi/search' && req.method === 'POST') {
    readBody(req).then(async body => {
      try {
        let { keyword } = JSON.parse(body);
        if (!keyword) { jsonResp(res, 400, { error: 'keyword is required' }); return; }
        // Strip ~ from manual search keyword
        keyword = keyword.replace(/[~～]/g, '').trim();

        const { registry } = require('./scrapers');
        const results = await registry.searchAll(keyword, config);
        jsonResp(res, 200, { results });
      } catch (e) {
        jsonResp(res, 500, { error: e.message });
      }
    }).catch(e => jsonResp(res, 400, { error: 'Invalid request body' }));
    return;
  }

  // --- API: Bangumi metadata fetch ---
  if (urlPath === '/api/bangumi/fetch' && req.method === 'POST') {
    readBody(req).then(async body => {
      try {
        let { animeId, subjectId, source = 'bangumi' } = JSON.parse(body);
        if (!animeId) { jsonResp(res, 400, { error: 'animeId is required' }); return; }

        const anime = data.library.find(a => a.id === animeId);
        if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }

        const { registry, matchSeason } = require('./scrapers');
        const { parseFolderName } = require('./scanner');
        const coverDir = path.join(DATA_DIR, 'covers');

        // If no subjectId provided, use season-aware matching
        let matchInfo = null;
        if (!subjectId) {
          const folderParsed = parseFolderName(anime.folderName);
          const videoCount = anime.episodes?.length || 0;

          const match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
          if (!match) {
            const results = await registry.searchAll(anime.title, config);
            if (results.length === 0) {
              jsonResp(res, 404, { error: '未找到匹配结果' });
              return;
            }
            jsonResp(res, 200, { results, animeId: anime.id });
            return;
          }
          subjectId = match.id;
          source = match.source;
          matchInfo = match;
        }

        const meta = await registry.fetchMetadata(source, anime.title, coverDir, subjectId, config);

        if (!meta) { jsonResp(res, 404, { error: '获取元数据失败' }); return; }

        const hadBangumiId = !!anime.bangumiId;
        Object.assign(anime, meta);
        if (anime.localCover) preGenerateCovers(anime.localCover);
        if (matchInfo) {
          if (matchInfo.matchedSeason != null) anime.matchedSeason = matchInfo.matchedSeason;
          if (matchInfo.totalSeasons != null) anime.totalSeasons = matchInfo.totalSeasons;
        }
        // 元数据匹配成功得到 bangumiId → 自动推送到 Bangumi（异步，不阻塞响应）
        if (!hadBangumiId && anime.bangumiId) {
          bangumiSync.pushStatusChange(anime.id, data);
        }
        Promise.all([db.saveLibrary(data), saveScannedTree(data.scannedTree)]);
        jsonResp(res, 200, { ok: true, anime });
      } catch (e) {
        jsonResp(res, 500, { error: e.message });
      }
    }).catch(e => jsonResp(res, 400, { error: 'Invalid request body' }));
    return;
  }

  // --- Shared: resolve folder parsed for structural folders ---
  function resolveFolderParsed(anime) {
    const { parseFolderName } = require('./scanner');
    let fp = parseFolderName(anime.folderName);
    const isStructural = !fp.cjkTitle && (!fp.title || /^(?:Season\s*\d+|S\d+|第\d+季)$/i.test(fp.title.trim()));
    if (isStructural) {
      const leafSeason = fp.season;
      if (anime.folderPath) {
        const parentDir = path.basename(path.dirname(anime.folderPath));
        if (parentDir && parentDir !== '.') {
          const parentParsed = parseFolderName(parentDir);
          if (parentParsed.cjkTitle || parentParsed.cleanTitle) {
            fp = { ...parentParsed, season: leafSeason || parentParsed.season };
          }
        }
      }
      if (!fp.cjkTitle && !fp.cleanTitle) {
        const titleParsed = parseFolderName(anime.title);
        if (titleParsed.cjkTitle || titleParsed.cleanTitle) {
          fp = { ...titleParsed, season: leafSeason || titleParsed.season };
        }
      }
    }
    return fp;
  }

  // --- API: Library batch sync metadata ---
  if (urlPath === '/api/library/sync' && req.method === 'POST') {
    readBody(req).then(async body => {
      try {
        const { animeIds } = JSON.parse(body);
        if (!Array.isArray(animeIds) || animeIds.length === 0) {
          jsonResp(res, 400, { error: 'animeIds array is required' });
          return;
        }

        const { registry, matchSeason, parallelMap } = require('./scrapers');
        const coverDir = path.join(DATA_DIR, 'covers');

        // Pre-validate and separate items needing sync
        const toSync = [];
        const results = [];
        for (const animeId of animeIds) {
          const anime = data.library.find(a => a.id === animeId);
          if (!anime) {
            results.push({ animeId, success: false, error: 'Anime not found' });
            continue;
          }
          if (anime.bangumiId) {
            results.push({ animeId, success: true, skipped: true, message: '已有元数据' });
            continue;
          }
          toSync.push({ animeId, anime });
        }

        // Process items concurrently (batch size 3 to respect rate limits)
        const syncResults = await parallelMap(toSync, async ({ animeId, anime }) => {
          try {
            const folderParsed = resolveFolderParsed(anime);
            const videoCount = anime.episodes?.length || 0;

            const match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
            if (!match) {
              return { animeId, success: false, error: '未找到匹配结果' };
            }

            const meta = await registry.fetchMetadata(match.source, folderParsed.cleanTitle, coverDir, match.id, config, match._detail);
            if (!meta) {
              return { animeId, success: false, error: '获取元数据失败' };
            }

            Object.assign(anime, meta);
            if (anime.localCover) preGenerateCovers(anime.localCover);
            if (match.matchedSeason != null) anime.matchedSeason = match.matchedSeason;
            if (match.totalSeasons != null) anime.totalSeasons = match.totalSeasons;
            return { animeId, success: true, meta, matchedSeason: match.matchedSeason, totalSeasons: match.totalSeasons };
          } catch (e) {
            return { animeId, success: false, error: e.message };
          }
        }, 3);

        results.push(...syncResults);
        Promise.all([db.saveLibrary(data), saveScannedTree(data.scannedTree)]);
        registry.clearSearchCache();
        jsonResp(res, 200, { ok: true, results });
      } catch (e) {
        jsonResp(res, 500, { error: e.message });
      }
    }).catch(e => jsonResp(res, 400, { error: 'Invalid request body' }));
    return;
  }

  // --- API: Library batch sync metadata (SSE stream) ---
  if (urlPath === '/api/library/sync/stream') {
    // OPTIONS for mmCanStream probe
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Origin': '*',
      });
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      jsonResp(res, 405, { error: 'Method not allowed' });
      return;
    }

    const params = new URL(req.url, 'http://localhost').searchParams;
    let animeIds;
    try {
      animeIds = JSON.parse(params.get('ids') || '[]');
    } catch {
      jsonResp(res, 400, { error: 'Invalid ids parameter' });
      return;
    }

    if (!Array.isArray(animeIds) || animeIds.length === 0) {
      jsonResp(res, 400, { error: 'animeIds array is required' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (event, obj) => res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
    const sessionId = crypto.randomUUID();
    cancelledSyncSessions.set(sessionId, false);

    res.on('close', () => {
      cancelledSyncSessions.set(sessionId, true);
    });

    (async () => {
      const { registry, matchSeason, parallelMap } = require('./scrapers');
      const coverDir = path.join(DATA_DIR, 'covers');

      // Pre-filter: skip not-found and already-imported
      const toSync = [];
      for (const animeId of animeIds) {
        if (cancelledSyncSessions.get(sessionId) || res.writableEnded) {
          send('cancelled', { ok: true });
          break;
        }
        const anime = data.library.find(a => a.id === animeId);
        if (!anime) {
          send('progress', { animeId, success: false, error: 'Anime not found' });
          continue;
        }
        if (anime.bangumiId) {
          send('progress', { animeId, success: true, skipped: true, message: '已有元数据' });
          continue;
        }
        toSync.push({ animeId, anime });
      }

      // Process concurrently
      let processed = 0;
      await parallelMap(toSync, async ({ animeId, anime }) => {
        if (cancelledSyncSessions.get(sessionId) || res.writableEnded) return;

        try {
          const folderParsed = resolveFolderParsed(anime);
          const videoCount = anime.episodes?.length || 0;

          let timedOut = false;
          const itemPromise = (async () => {
            const match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
            if (timedOut) return;
            if (!match) {
              send('progress', { animeId, success: false, error: '未找到匹配结果' });
              return;
            }

            const meta = await registry.fetchMetadata(match.source, folderParsed.cleanTitle, coverDir, match.id, config, match._detail);
            if (timedOut) return;
            if (!meta) {
              send('progress', { animeId, success: false, error: '获取元数据失败' });
              return;
            }

            Object.assign(anime, meta);
            if (anime.localCover) preGenerateCovers(anime.localCover);
            if (match.matchedSeason != null) anime.matchedSeason = match.matchedSeason;
            if (match.totalSeasons != null) anime.totalSeasons = match.totalSeasons;
            send('progress', { animeId, success: true, meta, matchedSeason: match.matchedSeason, totalSeasons: match.totalSeasons });
          })();

          const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('处理超时')), 60000)
          );

          await Promise.race([itemPromise, timeout]);
          timedOut = true;
        } catch (e) {
          send('progress', { animeId, success: false, error: e.message });
        }

        processed++;
        if (processed % 5 === 0) Promise.all([db.saveLibrary(data), saveScannedTree(data.scannedTree)]);
      }, 3);

      Promise.all([db.saveLibrary(data), saveScannedTree(data.scannedTree)]);
      registry.clearSearchCache();
      cancelledSyncSessions.delete(sessionId);
      send('done', { ok: true });
      res.end();
    })();
    return;
  }

  // --- API: mpv status ---
  if (urlPath === '/api/mpv-status' && req.method === 'GET') {
    jsonResp(res, 200, { active: activePlays.size > 0 });
    return;
  }

  // --- API: quit server ---
  if (urlPath === '/api/quit' && req.method === 'POST') {
    jsonResp(res, 200, { ok: true, shutdown: true });
    logger.info('Shutdown requested via web UI.');
    // 注意：不调用 server.close() — 它会等待所有活跃 HTTP 连接关闭，
    // 导致响应无法刷新到客户端（keep-alive 连接阻塞），前端 fetch 卡死。
    // 直接延迟后退出，让已调用的 res.end() 有足够时间刷出。
    db.shutdown().catch(() => {});
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  // --- API: video thumbnail ---
  if (urlPath === '/api/thumbnail' && req.method === 'GET') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const videoPath = params.get('path');
    const time = parseFloat(params.get('time')) || 60;
    if (!videoPath || !fs.existsSync(videoPath)) {
      jsonResp(res, 404, { error: 'File not found' });
      return;
    }
    const hash = crypto.createHash('md5').update(videoPath + time).digest('hex');
    const thumbDir = path.join(DATA_DIR, 'thumbs');
    const thumbPath = path.join(thumbDir, hash + '.jpg');
    if (fs.existsSync(thumbPath)) {
      serveImage(thumbPath, req.url, res);
      return;
    }
    let responded = false;
    try {
      if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
      const ff = spawn(ffmpegPath, [
        '-ss', String(time),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '5',
        '-y', thumbPath,
        '-loglevel', 'error'
      ]);
      const timeout = setTimeout(() => {
        if (responded) return;
        responded = true;
        ff.kill();
        logger.warn(`Thumbnail timeout (>60s) for: ${videoPath} @${time}s`);
        jsonResp(res, 500, { error: 'timeout' });
      }, 60000);
      ff.on('close', (code) => {
        clearTimeout(timeout);
        if (responded) return;
        responded = true;
        if (code === 0 && fs.existsSync(thumbPath)) {
          serveImage(thumbPath, req.url, res);
        } else {
          logger.warn(`Thumbnail ffmpeg exited with code ${code} for: ${videoPath} @${time}s`);
          jsonResp(res, 500, { error: 'ffmpeg failed' });
        }
      });
      ff.on('error', (err) => {
        clearTimeout(timeout);
        if (responded) return;
        responded = true;
        logger.warn(`Thumbnail ffmpeg spawn error: ${err.message}`);
        jsonResp(res, 500, { error: 'ffmpeg not available' });
      });
    } catch (e) {
      if (!responded) { responded = true; jsonResp(res, 500, { error: e.message }); }
    }
    return;
  }

  // --- API: Bangumi MyList 同步 ---
  if (urlPath === '/api/bangumi/sync' && req.method === 'POST') {
    readBody(req).then(async body => {
      const parsed = JSON.parse(body);
      const result = await bangumiSync.syncMyList(data, { dryRun: parsed.dryRun });
      if (result.lastSyncTime) {
        config.bangumiLastSync = result.lastSyncTime;
        saveConfig(config);
      }
      // 如有新建 MyList/Wishlist，落盘
      if (result.created > 0 || result.wishlistAdded > 0) db.saveMyList(data);
      jsonResp(res, 200, result);
    }).catch(e => jsonResp(res, 400, { error: e.message }));
    return;
  }

  // --- API: Bangumi 个人 API OAuth / 状态 ---
  if (urlPath === '/api/bangumi/auth/status' && req.method === 'GET') {
    jsonResp(res, 200, { ...bangumiPersonal.getState(), lastSyncTime: config.bangumiLastSync || null });
    return;
  }
  if (urlPath === '/api/bangumi/auth/url' && req.method === 'GET') {
    const url = bangumiPersonal.generateAuthUrl();
    jsonResp(res, 200, { url });
    return;
  }
  if (urlPath === '/api/bangumi/auth/callback' && req.method === 'GET') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const code = params.get('code');
    if (!code) {
      // 用户拒绝授权或被重定向到错误页
      res.writeHead(302, { 'Location': '/index.html?bangumi_auth=denied' });
      res.end();
      return;
    }
    bangumiPersonal.exchangeCode(code).then(state => {
      saveConfig(config);
      // 重定向回前端（通过 URL hash 传递状态）
      res.writeHead(302, { 'Location': '/index.html?bangumi_auth=success' });
      res.end();
    }).catch(e => {
      logger.error('Bangumi OAuth callback error:', e.message);
      res.writeHead(302, { 'Location': '/index.html?bangumi_auth=error' });
      res.end();
    });
    return;
  }
  if (urlPath === '/api/bangumi/auth/logout' && req.method === 'POST') {
    bangumiPersonal.clearAuth();
    jsonResp(res, 200, { ok: true });
    return;
  }
  if (urlPath === '/api/bangumi/auth/creds' && req.method === 'POST') {
    readBody(req).then(body => {
      const parsed = JSON.parse(body);
      if (parsed.clientId !== undefined && parsed.clientSecret !== undefined) {
        bangumiPersonal.setCredentials(parsed.clientId, parsed.clientSecret);
        config.bangumiClientId = parsed.clientId;
        config.bangumiClientSecret = parsed.clientSecret;
        saveConfig(config);
      }
      jsonResp(res, 200, bangumiPersonal.getState());
    }).catch(e => jsonResp(res, 400, { error: e.message }));
    return;
  }
  if (urlPath === '/api/bangumi/me' && req.method === 'GET') {
    if (!bangumiPersonal.isAuthed()) {
      jsonResp(res, 401, { error: 'Not authenticated' });
      return;
    }
    bangumiPersonal.getMe().then(me => jsonResp(res, 200, me)).catch(e => jsonResp(res, 500, { error: e.message }));
    return;
  }

  // --- Cover images ---
  if (urlPath.startsWith('/covers/')) {
    const coverPath = path.join(DATA_DIR, decodeURIComponent(urlPath));
    serveImage(coverPath, req.url, res);
    return;
  }

  // --- Static files ---
  let filePath = path.join(ASSET_DIR, 'public', decodeURIComponent(urlPath));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (e, d) => {
    if (e) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const cacheCtrl = ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': cacheCtrl });
    res.end(d);
  });
});

// ─── Async startup ───
// --- 启动时清理超过 14 天的缩略图和封面缩放缓存（async，不阻塞启动） ---
async function cleanupOldCache() {
  const dirs = [
    path.join(DATA_DIR, 'thumbs'),
    path.join(DATA_DIR, 'covers', '.resized'),
  ];
  const maxAge = 14 * 24 * 60 * 60 * 1000; // 14 天
  const now = Date.now();
  let total = 0;
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const fp = path.join(dir, f);
        try {
          const stat = fs.statSync(fp);
          if (stat.isFile() && (now - stat.mtimeMs) > maxAge) {
            fs.unlinkSync(fp);
            total++;
          }
        } catch (_) { /* 跳过无法访问的文件 */ }
      }
    } catch (_) { /* 跳过不可读目录 */ }
  }
  if (total > 0) logger.info(`Cleaned ${total} expired cache files (>14d)`);
}

async function validateCovers(data) {
  const coverDir = path.join(DATA_DIR, 'covers');
  for (const item of data.library) {
    if (item.localCover) {
      const coverPath = path.join(coverDir, path.basename(item.localCover));
      if (!fs.existsSync(coverPath)) item.localCover = undefined;
    }
  }
  for (const mem of data.memories || []) {
    if (mem.coverLocal) {
      const coverPath = path.join(coverDir, path.basename(mem.coverLocal));
      if (!fs.existsSync(coverPath)) mem.coverLocal = undefined;
    }
  }
  for (const item of data.myList || []) {
    if (!item.animeId && item.coverUrl && item.coverUrl.startsWith(DATA_DIR)) {
      const coverPath = path.join(coverDir, path.basename(item.coverUrl));
      if (!fs.existsSync(coverPath)) item.coverUrl = null;
    }
  }
}

async function init() {
  // ── 端口清理：如果有旧进程占着 3456，强制关闭（sidecar 重启时旧进程未完全退出）──
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
        await new Promise(r => setTimeout(r, 200)); // 等端口释放
      }
    }
  } catch (_) { /* 端口未被占用或查找失败，直接继续 */ }

  const startTime = Date.now();
  startupTime = startTime;

  // Phase 1: Parallel independent init
  cleanupOldCache().catch(e => logger.warn('Cache cleanup error:', e.message)); // fire-and-forget
  await db.ensureSchema().catch(e => logger.warn('Schema ensure skipped:', e.message));

  // Phase 2: Hydrate data — SQLite 主存储，scannedTree 从 JSON
  data = (await db.loadData()) || { discovered: [], library: [], memories: [], myList: [], playSessions: [] };

  // 迁移：从旧的 anime-data.json 提取 scannedTree（如存在）
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

  // 迁移：已有库项目自动创建 MyList 记录（无状态则默认为 watching）
  if (!data.myList) data.myList = [];
  let myListDirty = false;
  for (const anime of data.library) {
    if (!data.myList.find(m => m.animeId === anime.id)) {
      data.myList.push({ animeId: anime.id, status: 'watching', rating: null, thoughts: '', notes: '' });
      myListDirty = true;
    }
  }
  if (myListDirty) {
    db.saveMyList(data).catch(e => logger.warn('MyList migration save error:', e.message));
    logger.info(`Auto-created MyList entries for ${data.library.length} library items`);
  }

  // Phase 3: Post-load validation (async, non-blocking)
  validateCovers(data).catch(e => logger.warn('Cover validation error:', e.message));

  // Phase 4: Start serving
  await new Promise(resolve => server.listen(PORT, resolve));
  server._ready = true;

  const elapsed = Date.now() - startTime;
  logger.info(`Ready in ${elapsed}ms — ${data.library.length} anime, port ${PORT}`);
  if (config.mediaDir) {
    logger.info(`Media directory: ${config.mediaDir}`);
  }
}

init().catch(e => {
  logger.error('Failed to initialize server:', e);
  process.exit(1);
});
