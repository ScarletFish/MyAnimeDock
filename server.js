const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { scanMediaDir, parseFolderName } = require('./scanner');

// pkg 打包后 __dirname 指向临时解压目录，需要使用 exe 所在目录
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(APP_DIR, 'config.json');
const DATA_PATH = path.join(APP_DIR, 'anime-data.json');
const PORT = 3456;

// --- Config ---
const DEFAULT_CONFIG = { mediaDir: '', playerMode: 'system', mpvPath: 'mpv', theme: 'dark' };

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
const DEFAULT_DATA = { discovered: [], library: [], memories: [] };

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
      saveConfig(config);
      jsonResp(res, 200, { ok: true, ...config });
    }).catch(e => {
      jsonResp(res, 400, { error: 'Invalid request body' });
    });
    return;
  }

  // --- API: refresh (scan media dir + auto-import) ---
  if (urlPath === '/api/refresh' && req.method === 'GET') {
    if (!config.mediaDir) {
      jsonResp(res, 400, { error: 'Media directory not configured' });
      return;
    }
    try {
      const scanResult = scanMediaDir(config.mediaDir);
      // Auto-import: add new anime to library
      for (const item of scanResult) {
        const existing = data.library.find(a => a.folderPath === item.folderPath);
        if (!existing) {
          const anime = {
            id: item.parsedTitle + (item.parsedSeason ? `-Season ${item.parsedSeason}` : ''),
            folderPath: item.folderPath,
            folderName: item.folderName,
            title: item.parsedTitle,
            season: item.parsedSeason || null,
            importedAt: new Date().toISOString(),
            downloaded: true,
            bangumiId: null,
            bangumiTitle: null,
            bangumiTitleJp: null,
            summary: null,
            coverUrl: null,
            localCover: null,
            rating: null,
            episodes: [],
          };
          data.library.push(anime);
        }
      }
      // Update downloaded status and refresh episodes from disk
      for (const item of data.library) {
        item.downloaded = fs.existsSync(item.folderPath);
        if (item.downloaded) {
          const { findVideos } = require('./scanner');
          const videos = findVideos(item.folderPath);
          const oldEpisodes = item.episodes || [];
          item.episodes = videos.map((v, i) => {
            const existing = oldEpisodes.find(e => e.filePath === v.path);
            return existing || {
              number: i + 1,
              filePath: v.path,
              fileName: v.name,
              fileSize: v.size,
              duration: null,
              watched: false,
              progress: 0,
            };
          });
        }
      }
      saveData(data);
      jsonResp(res, 200, { library: data.library });
    } catch (e) {
      jsonResp(res, 500, { error: e.message });
    }
    return;
  }

  // --- API: import anime to library ---
  if (urlPath === '/api/import' && req.method === 'POST') {
    readBody(req).then(body => {
      const { folderPath, folderName, parsedTitle, parsedSeason, videoCount } = JSON.parse(body);
      if (!folderPath || !folderName) {
        jsonResp(res, 400, { error: 'folderPath and folderName are required' });
        return;
      }
      // Check if already in library
      const existing = data.library.find(a => a.folderPath === folderPath);
      if (existing) {
        jsonResp(res, 200, { ok: true, anime: existing, message: 'Already imported' });
        return;
      }
      // Create library entry
      const anime = {
        id: parsedTitle + (parsedSeason ? `-Season ${parsedSeason}` : ''),
        folderPath,
        folderName,
        title: parsedTitle,
        season: parsedSeason || null,
        importedAt: new Date().toISOString(),
        downloaded: true,
        bangumiId: null,
        bangumiTitle: null,
        bangumiTitleJp: null,
        summary: null,
        coverUrl: null,
        localCover: null,
        rating: null,
        episodes: [],
      };
      data.library.push(anime);
      // Remove from discovered
      data.discovered = data.discovered.filter(d => d.folderPath !== folderPath);
      saveData(data);
      jsonResp(res, 200, { ok: true, anime });
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
      let cmd;
      if (config.playerMode === 'mpv') {
        const mpvPath = config.mpvPath || 'mpv';
        cmd = `"${mpvPath}" "${filePath}"`;
        if (position > 0) {
          const h = Math.floor(position / 3600);
          const m = Math.floor((position % 3600) / 60);
          const s = Math.floor(position % 60);
          cmd += ` --start=${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }
      } else {
        cmd = process.platform === 'win32' ? `start "" "${filePath}"`
          : process.platform === 'darwin' ? `open "${filePath}"`
          : `xdg-open "${filePath}"`;
      }
      exec(cmd, (err) => {
        if (err) {
          jsonResp(res, 500, { error: err.message });
        } else {
          jsonResp(res, 200, { ok: true });
        }
      });
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

        const { searchSubjects } = require('./bangumi');
        const results = await searchSubjects(keyword);
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
        const { animeId, subjectId } = JSON.parse(body);
        if (!animeId) { jsonResp(res, 400, { error: 'animeId is required' }); return; }

        const anime = data.library.find(a => a.id === animeId);
        if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }

        const { searchSubjects, fetchMetadata } = require('./bangumi');
        const coverDir = path.join(APP_DIR, 'covers');
        // If no subjectId provided, search first and return results for user to pick
        if (!subjectId) {
          const results = await searchSubjects(anime.title);
          if (results.length === 0) {
            jsonResp(res, 404, { error: '在 Bangumi 未找到匹配结果' });
            return;
          }
          jsonResp(res, 200, { results, animeId: anime.id });
          return;
        }
        const meta = await fetchMetadata(anime.title, coverDir, subjectId);

        if (!meta) { jsonResp(res, 404, { error: '在 Bangumi 未找到匹配结果' }); return; }

        Object.assign(anime, meta);
        saveData(data);
        jsonResp(res, 200, { ok: true, anime });
      } catch (e) {
        jsonResp(res, 500, { error: e.message });
      }
    }).catch(e => jsonResp(res, 400, { error: 'Invalid request body' }));
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
