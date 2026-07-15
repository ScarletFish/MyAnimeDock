// server/lib/utils.js — 工具函数
const path = require('path');
const fs = require('fs');
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

function setFfmpegPath(p) {
  if (p) ffmpegPath = p;
}
function getFfmpegPath() {
  return ffmpegPath;
}

// --- Image serving (no server-side resize; browser handles display scaling) ---
function serveImage(filePath, url, res) {
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

// --- 启动时清理超过 14 天的视频缩略图 ---
async function cleanupOldCache(dataDir) {
  const dirs = [
    path.join(dataDir, 'thumbs'),
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
  setFfmpegPath, getFfmpegPath,
  serveImage, serveRaw,
  readBody, jsonResp,
  cleanupOldCache,
};
