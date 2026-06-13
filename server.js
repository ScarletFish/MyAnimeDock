const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const { scanMediaDirFlat } = require('./scanner');

// pkg 打包后 __dirname 指向临时解压目录，需要使用 exe 所在目录
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(APP_DIR, 'config.json');
const DATA_PATH = path.join(APP_DIR, 'anime-data.json');
const PORT = 3456;

// In-memory active mpv sessions: filePath -> { sessionId, episode, anime }
const activePlays = new Map();

// --- Config ---
const DEFAULT_CONFIG = { 
  mediaDir: '', 
  playerMode: 'system', 
  mpvPath: 'mpv', 
  theme: 'dark',
  scrapers: {
    bangumi: { enabled: true, priority: 1 },
    tmdb: { enabled: false, priority: 2 }
  },
  tmdbApiKey: '',
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

let config = loadConfig();

// --- Data ---
const DEFAULT_DATA = { discovered: [], library: [], memories: [], playSessions: [], scannedTree: [] };

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    return { ...DEFAULT_DATA, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_DATA };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

let data = loadData();

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

// --- Image resize ---
let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* sharp not installed */ }

function serveImage(filePath, url, res) {
  const params = new URL(url, 'http://localhost').searchParams;
  const w = parseInt(params.get('w'));
  const q = parseInt(params.get('q')) || 75;

  if (!sharp || !w) {
    fs.readFile(filePath, (e, d) => {
      if (e) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(d);
    });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  let pipeline = sharp(filePath).resize(w);
  if (ext === '.png') {
    pipeline = pipeline.png({ quality: q });
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality: q });
  } else {
    pipeline = pipeline.jpeg({ quality: q });
  }

  pipeline.toBuffer((err, buf, info) => {
    if (err) {
      fs.readFile(filePath, (e, d) => {
        if (e) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(d);
      });
      return;
    }
    const ct = mime[`.${info.format}`] || mime[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(buf);
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
      if (parsed.playerMode !== undefined) config.playerMode = parsed.playerMode;
      if (parsed.mpvPath !== undefined) config.mpvPath = parsed.mpvPath;
      if (parsed.theme !== undefined) config.theme = parsed.theme;
      if (parsed.tmdbApiKey !== undefined) config.tmdbApiKey = parsed.tmdbApiKey;
      if (parsed.scrapers !== undefined) config.scrapers = parsed.scrapers;
      saveConfig(config);
      jsonResp(res, 200, { ok: true, ...config });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: browse (return cached flat tree, auto-scan if empty or old format) ---
  if (urlPath.startsWith('/api/browse') && req.method === 'GET') {
    if (!config.mediaDir) {
      jsonResp(res, 200, { tree: [], mediaDir: '' });
      return;
    }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const showExcluded = params.get('showExcluded') === 'true';
    try {
      let tree = data.scannedTree || [];
      // Re-scan if empty or old tree format (has branch nodes)
      if (tree.length === 0 || tree.some(n => n.type === 'branch')) {
        tree = scanMediaDirFlat(config.mediaDir);
        data.scannedTree = tree;
        saveData(data);
      } else {
        tree = JSON.parse(JSON.stringify(data.scannedTree));
      }
      const libraryPaths = new Set(data.library.map(a => a.folderPath));
      for (const n of tree) {
        if (n.type === 'leaf') {
          n.alreadyImported = libraryPaths.has(n.path);
          // Ensure new fields exist for backward compatibility
          if (n.excluded === undefined) n.excluded = false;
          if (n.bangumiMatched === undefined) n.bangumiMatched = false;
        }
      }
      // Filter excluded by default
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
      saveData(data);
      send({ type: 'done', tree });
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
      const { findVideos } = require('./scanner');
      const imported = [];
      for (const item of items) {
        const { folderPath, folderName, parsedTitle, parsedSeason } = item;
        if (!folderPath || !folderName) continue;
        if (data.library.some(a => a.folderPath === folderPath)) continue;

        const videos = findVideos(folderPath);
        // Check scannedTree for existing metadata
        const scannedNode = data.scannedTree.find(n => n.path === folderPath);
        const anime = {
          id: parsedTitle + (parsedSeason ? `-Season ${parsedSeason}` : ''),
          folderPath,
          folderName,
          title: parsedTitle,
          season: parsedSeason || null,
          importedAt: new Date().toISOString(),
          downloaded: true,
          bangumiId: scannedNode?.bangumiId || null,
          bangumiTitle: scannedNode?.bangumiTitle || null,
          bangumiTitleJp: scannedNode?.bangumiTitleJp || null,
          summary: scannedNode?.summary || null,
          coverUrl: scannedNode?.coverUrl || null,
          localCover: scannedNode?.localCover || null,
          rating: scannedNode?.rating || null,
          episodes: videos.map((v, i) => ({
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
        // Clear excluded flag if it was excluded
        if (scannedNode) {
          scannedNode.excluded = false;
        }
      }
      saveData(data);
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
      const removed = data.library.splice(idx, 1)[0];
      if (!data.memories.find(m => m.animeId === removed.id)) {
        data.memories.push({
          animeId: removed.id,
          title: removed.title,
          bangumiId: removed.bangumiId,
          bangumiTitle: removed.bangumiTitle,
          rating: null,
          thoughts: '',
          notes: '',
          watchedAt: new Date().toISOString(),
          coverLocal: removed.localCover,
        });
      }
      saveData(data);
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
      saveData(data);
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
      saveData(data);
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
        const { registry } = require('./scrapers');
        const coverDir = path.join(APP_DIR, 'covers');

        let subjectIdToUse = subjectId;
        let sourceToUse = source;

        if (!subjectIdToUse) {
          const results = await registry.searchAll(node.parsedTitle, config);
          if (results.length === 0) {
            jsonResp(res, 404, { error: '未找到匹配结果' });
            return;
          }
          // Prefer results from the requested source
          const preferred = results.find(r => r.source === sourceToUse) || results[0];
          subjectIdToUse = preferred.id;
          sourceToUse = preferred.source;
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
        saveData(data);
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
    jsonResp(res, 200, data.library);
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

  // --- API: delete anime (remove from library, keep memory) ---
  if (urlPath.startsWith('/api/anime/') && req.method === 'DELETE') {
    const id = decodeURIComponent(urlPath.slice('/api/anime/'.length));
    const idx = data.library.findIndex(a => a.id === id);
    if (idx === -1) {
      jsonResp(res, 404, { error: 'Anime not found' });
      return;
    }
    const removed = data.library.splice(idx, 1)[0];
    // Auto-archive to memory if not exists
    if (!data.memories.find(m => m.animeId === removed.id)) {
      data.memories.push({
        animeId: removed.id,
        title: removed.title,
        bangumiId: removed.bangumiId,
        bangumiTitle: removed.bangumiTitle,
        rating: null,
        thoughts: '',
        notes: '',
        watchedAt: new Date().toISOString(),
        coverLocal: removed.localCover,
      });
    }
    saveData(data);
    jsonResp(res, 200, { ok: true });
    return;
  }

  // --- API: memories ---
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
      const anime = data.library.find(a => a.id === animeId);
      let existing = data.memories.find(m => m.animeId === animeId);
      if (existing) {
        if (rating !== undefined) existing.rating = rating;
        if (thoughts !== undefined) existing.thoughts = thoughts;
        if (notes !== undefined) existing.notes = notes;
      } else {
        existing = {
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
        data.memories.push(existing);
      }
      saveData(data);
      jsonResp(res, 200, { ok: true, memory: existing });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: play video ---
  if (urlPath === '/api/play' && req.method === 'POST') {
    readBody(req).then(body => {
      const { filePath, position } = JSON.parse(body);
      if (!filePath) {
        jsonResp(res, 400, { error: 'filePath is required' });
        return;
      }
      if (!fs.existsSync(filePath)) {
        jsonResp(res, 404, { error: 'File not found' });
        return;
      }
      if (config.playerMode === 'mpv') {
        const mpvPath = config.mpvPath || 'mpv';
        // Find anime/episode for session tracking
        let targetAnime, targetEp;
        for (const a of data.library) {
          const ep = a.episodes.find(e => e.filePath === filePath);
          if (ep) { targetAnime = a; targetEp = ep; break; }
        }
        let sessionId = null;
        if (targetAnime && targetEp) {
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
          activePlays.set(filePath, { sessionId, episode: targetEp, anime: targetAnime });
          saveData(data);
        }
        const { startMpv } = require('./mpv-controller');
        try {
          startMpv(mpvPath, filePath, position || 0, {
            onProgress: ({ filePath: fp, progress, watched, duration, final }) => {
              const active = activePlays.get(fp);
              if (active) {
                const ep = active.episode;
                ep.progress = progress;
                if (duration > 0) ep.duration = duration;
                if (watched) ep.watched = true;
                if (active.sessionId) {
                  const session = data.playSessions.find(s => s.sessionId === active.sessionId);
                  if (session) {
                    session.duration = Math.max(0, progress - (session.progressStart || 0));
                    session.endTime = new Date().toISOString();
                    if (final) {
                      const startMs = new Date(session.startTime).getTime();
                      session.clockTime = Math.round((Date.now() - startMs) / 1000);
                    }
                  }
                }
                saveData(data);
                if (final) activePlays.delete(fp);
              }
            },
            onError: (msg) => {
              const active = activePlays.get(filePath);
              if (active && active.sessionId) {
                const idx = data.playSessions.findIndex(s => s.sessionId === active.sessionId);
                if (idx !== -1) data.playSessions.splice(idx, 1);
                activePlays.delete(filePath);
                saveData(data);
              }
              console.error('mpv error:', msg);
            },
          });
          jsonResp(res, 200, { ok: true });
        } catch (e) {
          jsonResp(res, 500, { error: e.message });
        }
      } else {
        const cmd = process.platform === 'win32' ? `start "" "${filePath}"`
          : process.platform === 'darwin' ? `open "${filePath}"`
          : `xdg-open "${filePath}"`;
        exec(cmd, (err) => {
          if (err) {
            jsonResp(res, 500, { error: err.message });
          } else {
            jsonResp(res, 200, { ok: true });
          }
        });
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
      saveData(data);
      jsonResp(res, 200, { ok: true, episode: ep });
    }).catch(e => jsonResp(res, 400, { error: 'Invalid request body' }));
    return;
  }

  // --- API: Bangumi search ---
  if (urlPath === '/api/bangumi/search' && req.method === 'POST') {
    readBody(req).then(async body => {
      try {
        const { keyword } = JSON.parse(body);
        if (!keyword) { jsonResp(res, 400, { error: 'keyword is required' }); return; }

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
        const { animeId, subjectId, source = 'bangumi' } = JSON.parse(body);
        if (!animeId) { jsonResp(res, 400, { error: 'animeId is required' }); return; }

        const anime = data.library.find(a => a.id === animeId);
        if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }

        const { registry } = require('./scrapers');
        const coverDir = path.join(APP_DIR, 'covers');
        // If no subjectId provided, search first and return results for user to pick
        if (!subjectId) {
          const results = await registry.searchAll(anime.title, config);
          if (results.length === 0) {
            jsonResp(res, 404, { error: '未找到匹配结果' });
            return;
          }
          jsonResp(res, 200, { results, animeId: anime.id });
          return;
        }
        const meta = await registry.fetchMetadata(source, anime.title, coverDir, subjectId, config);

        if (!meta) { jsonResp(res, 404, { error: '获取元数据失败' }); return; }

        Object.assign(anime, meta);
        saveData(data);
        jsonResp(res, 200, { ok: true, anime });
      } catch (e) {
        jsonResp(res, 500, { error: e.message });
      }
    }).catch(e => jsonResp(res, 400, { error: 'Invalid request body' }));
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
    console.log('Shutdown requested via web UI.');
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000);
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
    const thumbDir = path.join(APP_DIR, 'thumbs');
    const thumbPath = path.join(thumbDir, hash + '.jpg');
    if (fs.existsSync(thumbPath)) {
      serveImage(thumbPath, req.url, res);
      return;
    }
    let responded = false;
    try {
      if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
      const ff = spawn('ffmpeg', [
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
        jsonResp(res, 500, { error: 'timeout' });
      }, 30000);
      ff.on('close', (code) => {
        clearTimeout(timeout);
        if (responded) return;
        responded = true;
        if (code === 0 && fs.existsSync(thumbPath)) {
          serveImage(thumbPath, req.url, res);
        } else {
          jsonResp(res, 500, { error: 'ffmpeg failed' });
        }
      });
      ff.on('error', () => {
        clearTimeout(timeout);
        if (responded) return;
        responded = true;
        jsonResp(res, 500, { error: 'ffmpeg not available' });
      });
    } catch (e) {
      if (!responded) { responded = true; jsonResp(res, 500, { error: e.message }); }
    }
    return;
  }

  // --- Cover images ---
  if (urlPath.startsWith('/covers/')) {
    const coverPath = path.join(APP_DIR, decodeURIComponent(urlPath));
    serveImage(coverPath, req.url, res);
    return;
  }

  // --- Static files ---
  let filePath = path.join(APP_DIR, 'public', decodeURIComponent(urlPath));
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

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Media directory: ${config.mediaDir || '(not configured)'}`);

  // Auto-open browser
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log(`[INFO] Could not auto-open browser. Visit: ${url}`);
  });
});
