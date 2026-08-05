// server/thumbnail-queue.ts — 后台缩略图生成队列
// 空闲时自动排队生成，mpv 播放时暂停，按需惰性生成兜底
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getFfmpegPath, THUMB_HASH_SEED } from './lib/utils';
import { DATA_DIR } from './lib/config';
import { Logger } from './logger';
const logger: Logger = require('./logger').child('[THUMBQ]');

/** Remove a 0-byte thumbnail file so it gets regenerated next time */
function _cleanupZeroByte(thumbPath: string): void {
  try {
    if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size === 0) {
      logger.warn(`Thumbnail is 0 bytes, deleting: ${thumbPath}`);
      fs.unlinkSync(thumbPath);
    }
  } catch { /* best-effort cleanup */ }
}

interface ThumbItem {
  filePath: string;
  duration: number | null;
  animeId?: string;
  episodeNumber?: number;
}

class ThumbnailQueue {
  _queue: ThumbItem[] = [];
  _processing = false;
  _activePlays: Map<unknown, unknown>;
  _drainTimer: NodeJS.Timeout | null = null;
  _concurrency = 3;

  /**
   * @param activePlays — server.js 的 activePlays Map，用于空闲检测
   */
  constructor(activePlays: Map<unknown, unknown>) {
    this._activePlays = activePlays;
  }

  /**
   * 把动画的所有 episode 加入缩略图队列
   * @param anime - anime 对象（含 episodes 数组）
   * @param prepend - 是否插队（详情页查看时插到最前）
   */
  enqueue(anime: any, prepend = false): void {
    if (!anime?.episodes) return;
    const items: ThumbItem[] = [];
    for (const ep of anime.episodes) {
      if (!ep.filePath || !fs.existsSync(ep.filePath)) continue;
      // 已缓存则跳过
      const hash = this._thumbHash(ep.filePath);
      const thumbPath = path.join(DATA_DIR, 'thumbs', hash + '.jpg');
      if (fs.existsSync(thumbPath)) continue;
      items.push({
        filePath: ep.filePath,
        duration: ep.duration || null,
        animeId: anime.id,
        episodeNumber: ep.number,
      });
    }
    if (items.length === 0) return;

    if (prepend) {
      this._queue.unshift(...items);
    } else {
      this._queue.push(...items);
    }
    logger.info(`Enqueued ${items.length} thumbs for "${anime.title}"${prepend ? ' (high priority)' : ''}`);
    this._scheduleDrain();
  }

  /**
   * 清空队列
   */
  clear(): void {
    this._queue = [];
    if (this._drainTimer) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
  }

  /** 队列长度 */
  get length(): number {
    return this._queue.length;
  }

  /** 是否正在处理 */
  get busy(): boolean {
    return this._processing;
  }

  // ── 内部 ──

  _thumbHash(filePath: string): string {
    return crypto.createHash('md5').update(filePath + THUMB_HASH_SEED).digest('hex');
  }

  _scheduleDrain(): void {
    if (this._processing || this._drainTimer) return;
    // 小延迟让同一批 enqueue 调用合并
    this._drainTimer = setTimeout(() => this._drain(), 200);
  }

  async _drain(): Promise<void> {
    this._drainTimer = null;
    if (this._processing) return;
    this._processing = true;
    try {
      while (this._queue.length > 0) {
        // mpv 运行时暂停，30s 后重试
        if (this._activePlays.size > 0) {
          logger.info('mpv active, pausing thumbnail queue');
          this._drainTimer = setTimeout(() => this._drain(), 30000);
          return;
        }

        const batch = this._queue.splice(0, this._concurrency);
        await Promise.all(batch.map(item => this._generate(item)));
      }
    } finally {
      this._processing = false;
    }
    logger.info('Thumbnail queue drained');
  }

  _generate({ filePath, duration }: ThumbItem): Promise<void> {
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) return Promise.resolve();

    // 源文件可能在入队后被删除/移动
    if (!fs.existsSync(filePath)) {
      logger.warn(`Source file gone, skipping thumbnail: ${filePath}`);
      return Promise.resolve();
    }

    // 取 25% 位置，下限 30s 上限 120s
    let time = 60;
    if (duration && duration > 0) {
      time = Math.min(Math.max(Math.round(duration * 0.25), 30), 120);
    }

    const hash = this._thumbHash(filePath);
    const thumbDir = path.join(DATA_DIR, 'thumbs');
    const thumbPath = path.join(thumbDir, hash + '.jpg');

    if (fs.existsSync(thumbPath)) return Promise.resolve();
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

    return new Promise((resolve) => {
      const ff = spawn(ffmpegPath, [
        '-ss', String(time), '-i', filePath,
        '-vframes', '1', '-q:v', '5', '-y', thumbPath, '-loglevel', 'error',
      ]);
      let resolved = false;
      const timeout = setTimeout(() => { ff.kill(); resolve(); resolved = true; }, 60000);
      ff.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        if (code !== 0) {
          logger.warn(`ffmpeg exit code ${code} for ${filePath}`);
          _cleanupZeroByte(thumbPath);
          return resolve();
        }
        // 验证输出文件可用（非 0 字节）
        _cleanupZeroByte(thumbPath);
        resolve();
      });
      ff.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        logger.warn(`ffmpeg spawn error for ${filePath}: ${err.message}`);
        resolve();
      });
    });
  }
}

export = ThumbnailQueue;
