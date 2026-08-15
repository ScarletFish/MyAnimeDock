// server/lib/utils.ts — 工具函数
import path from 'path';
import fs from 'fs';
import { PROJECT_ROOT } from './paths';
import { spawn } from 'child_process';
import { Logger } from '../logger';
const logger: Logger = require('../logger');
let ffmpegPath = (() => {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  const upx = path.join(PROJECT_ROOT, 'scripts', 'ffmpeg-upx.exe');
  if (fs.existsSync(upx)) return upx;
  return 'ffmpeg';
})();

// --- MIME ---
const mime: Record<string, string> = {
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
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function setFfmpegPath(p: string | undefined): void {
  if (p) ffmpegPath = p;
}
function getFfmpegPath(): string {
  return ffmpegPath;
}

// --- Thumbnail cache key seed ---
// 缩略图队列（thumbnail-queue.ts）与按需端点（routes/playback.ts time=mid）
// 共用同一缓存键：md5(filePath + THUMB_HASH_SEED).jpg。
// 修改此值会使全部缩略图缓存失效并重新生成。
const THUMB_HASH_SEED = 'v1';

// --- Cover pre-generation sizes ---
const COVER_PRE_SIZES = [
  { w: 400, q: 75 },
  { w: 540, q: 80 },
];

function preGenerateCovers(coverPath: string): void {
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
      ff.on('close', (code) => {
        if (code !== 0) {
          logger.warn(`preGenerateCovers exit code ${code} for ${coverPath} (${w}w)`);
        }
      });
      ff.on('error', (err) => {
        logger.warn(`preGenerateCovers spawn error: ${err.message}`);
      });
    } catch (_) {}
  }
}

// --- Image serving (with ffmpeg resize when ?w= param present) ---
function serveImage(filePath: string, url: string, res: any, noCache = false): void {
  const params = new URL(url, 'http://localhost').searchParams;
  const w = parseInt(params.get('w') ?? '');
  const q = parseInt(params.get('q') ?? '') || 75;
  const cacheCtrl = noCache ? 'no-cache' : 'public, max-age=86400';
  if (w && ffmpegPath && fs.existsSync(ffmpegPath)) {
    const ext = path.extname(filePath) || '.jpg';
    const cacheDir = path.join(path.dirname(filePath), '.resized');
    const cacheName = `thumb_${w}_q${q}_${path.basename(filePath)}`;
    const cachePath = path.join(cacheDir, cacheName);

    const onCacheHit = () => {
      const stream = fs.createReadStream(cachePath);
      stream.on('error', () => serveRaw(filePath, res, noCache));
      stream.on('open', () => {
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Cache-Control': cacheCtrl,
        });
      });
      stream.on('data', (chunk: Buffer) => { res.write(chunk); });
      stream.on('end', () => { res.end(); });
    };

    fs.stat(cachePath, (statErr) => {
      if (!statErr) { onCacheHit(); return; }

      fs.mkdir(cacheDir, { recursive: true }, () => {
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
            if (code === 0) {
              onCacheHit();
            } else {
              serveRaw(filePath, res, noCache);
            }
          });
          ff.on('error', () => {
            if (done) return; done = true;
            serveRaw(filePath, res, noCache);
          });
        } catch (e) {
          if (done) return; done = true;
          serveRaw(filePath, res, noCache);
        }
      });
    });
    return;
  }

  serveRaw(filePath, res, noCache);
}

function serveRaw(filePath: string, res: any, noCache = false): void {
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(404);
    res.end('Not found');
  });
  stream.on('open', () => {
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=86400',
    });
  });
  stream.on('data', (chunk: Buffer) => { res.write(chunk); });
  stream.on('end', () => { res.end(); });
}

// --- JSON body parser ---
function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// --- API helpers ---
function jsonResp(res: any, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

// --- 启动时清理超过 14 天的视频缩略图和封面缩放缓存 ---
async function cleanupOldCache(dataDir: string): Promise<number> {
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
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fp = path.join(dir, entry.name);
        try {
          const stat = await fs.promises.stat(fp);
          if ((now - stat.mtimeMs) > maxAge) {
            await fs.promises.unlink(fp);
            total++;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  return total;
}

// --- TTL Cache (in-memory) ---
function createTimedCache<T>(ttlMs: number): { get(): T | null; set(v: T): void; clear(): void } {
  let data: T | null = null, ts = 0;
  return {
    get() { return (Date.now() - ts < ttlMs) ? data : null; },
    set(v: T) { data = v; ts = Date.now(); },
    clear() { data = null; ts = 0; },
  };
}

// --- Persistent TTL Cache (disk-backed, survives restart) ---
// Saves cache to filePath as JSON. On load, checks mtime against TTL.
// If file is stale or corrupted, starts fresh.
function createPersistentCache<T>(ttlMs: number, filePath?: string): { get(): T | null; set(v: T): void; clear(): void } {
  let data: T | null = null;

  // Try loading from disk
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const age = Date.now() - stat.mtimeMs;
        if (age < ttlMs) {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(raw);
          data = parsed;
          logger.info('Cache loaded: ' + path.basename(filePath) + ' (' + Math.round(age / 1000) + 's old)');
        }
      }
    } catch (e) {
      logger.warn('Cache load failed, starting fresh: ' + path.basename(filePath));
    }
  }

  return {
    get() { return data; },
    set(v: T) {
      data = v;
      if (filePath) {
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, JSON.stringify(v), 'utf-8');
        } catch (e) {
          logger.warn('Cache write failed: ' + (e as Error).message);
        }
      }
    },
    clear() {
      data = null;
      if (filePath) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
      }
    },
  };
}

export {
  mime,
  THUMB_HASH_SEED,
  COVER_PRE_SIZES,
  setFfmpegPath, getFfmpegPath,
  preGenerateCovers,
  serveImage, serveRaw,
  readBody, jsonResp,
  cleanupOldCache,
  createTimedCache,
  createPersistentCache,
};
