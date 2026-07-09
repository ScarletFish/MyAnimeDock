// server/lib/utils.js — 工具函数
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
let ffmpegPath = (() => {
  try { return require('ffmpeg-static') || 'ffmpeg'; } catch { return 'ffmpeg'; }
})();

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

// --- Cover pre-generation sizes ---
const COVER_PRE_SIZES = [
  { w: 400, q: 75 },
  { w: 540, q: 80 },
];

function setFfmpegPath(p) {
  if (p) ffmpegPath = p;
}
function getFfmpegPath() {
  return ffmpegPath;
}

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
  if (w && ffmpegPath && fs.existsSync(ffmpegPath) && fs.existsSync(filePath)) {
    const ext = path.extname(filePath) || '.jpg';
    const cacheDir = path.join(path.dirname(filePath), '.resized');
    const cacheName = `thumb_${w}_q${q}_${path.basename(filePath)}`;
    const cachePath = path.join(cacheDir, cacheName);

    if (fs.existsSync(cachePath)) {
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

    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
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

// --- 启动时清理超过 14 天的缩略图和封面缩放缓存 ---
async function cleanupOldCache(dataDir) {
  const dirs = [
    path.join(dataDir, 'thumbs'),
    path.join(dataDir, 'covers', '.resized'),
  ];
  const maxAge = 14 * 24 * 60 * 60 * 1000; // 14 days
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
        } catch (_) {}
      }
    } catch (_) {}
  }
  return total;
}

module.exports = {
  mime,
  COVER_PRE_SIZES,
  setFfmpegPath, getFfmpegPath,
  preGenerateCovers,
  serveImage, serveRaw,
  readBody, jsonResp,
  cleanupOldCache,
};
