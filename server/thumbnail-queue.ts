// server/thumbnail-queue.ts — 后台缩略图生成队列
// 空闲时自动排队生成，mpv 播放时暂停（仅后台项），按需惰性生成兜底（single-flight）
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
  duration?: number | null;
  /** 显式目标时间（ondemand 项用，直接作为 ffmpeg -ss 值） */
  time?: number;
  animeId?: string;
  episodeNumber?: number;
  /** 缓存键：mid 用 THUMB_HASH_SEED，自定义 time 用 String(time) */
  cacheKey?: string;
  /** 队列项类型：ondemand=按需（高优先级，mpv 播放时照常处理），background=后台预生成 */
  type: 'ondemand' | 'background';
  /** 等待方回调（仅 ondemand 项有） */
  resolve?: (thumbPath: string) => void;
  reject?: (err: Error) => void;
}

class ThumbnailQueue {
  _queue: ThumbItem[] = [];
  _processing = false;
  _activePlays: Map<unknown, unknown>;
  _drainTimer: NodeJS.Timeout | null = null;
  _concurrency = 4;
  /** single-flight：thumbPath -> 进行中的 Promise，同 thumbPath 并发请求共享一次生成 */
  _ongoing: Map<string, Promise<string>> = new Map();
  /** 已入队（含生成中）的 thumbPath，用于入队去重 */
  _enqueuedThumbs: Set<string> = new Set();
  /** 时长探测缓存：filePath -> 秒，避免重复探测 */
  _durCache: Map<string, number> = new Map();

  /**
   * @param activePlays — server.js 的 activePlays Map，用于空闲检测
   */
  constructor(activePlays: Map<unknown, unknown>) {
    this._activePlays = activePlays;
  }

  /**
   * 把动画的所有 episode 加入缩略图队列（后台预生成/详情页插队）
   * @param anime - anime 对象（含 episodes 数组）
   * @param prepend - 是否插队（详情页查看时插到最前）
   */
  enqueue(anime: any, prepend = false): void {
    if (!anime?.episodes) return;
    const items: ThumbItem[] = [];
    for (const ep of anime.episodes) {
      if (!ep.filePath || !fs.existsSync(ep.filePath)) continue;
      const thumbPath = this._thumbPathFor(ep.filePath, THUMB_HASH_SEED);
      // 已缓存 / 已在队列 / 已在生成中 → 跳过
      if (fs.existsSync(thumbPath)) continue;
      if (this._enqueuedThumbs.has(thumbPath)) continue;
      if (this._ongoing.has(thumbPath)) continue;
      this._enqueuedThumbs.add(thumbPath);
      items.push({
        filePath: ep.filePath,
        duration: ep.duration || null,
        animeId: anime.id,
        episodeNumber: ep.number,
        cacheKey: THUMB_HASH_SEED,
        type: 'background',
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
   * 按需生成缩略图（供按需端点调用）。缓存命中立即返回；否则 single-flight 去重后
   * 以 ondemand 高优先级入队并立即 drain，返回带超时的 Promise。
   * @param time - 显式目标时间（直接作为 ffmpeg -ss 值，不再做 mid 换算）
   * @param cacheKey - mid 用 THUMB_HASH_SEED，自定义 time 用 String(time)
   */
  ensureGenerated(filePath: string, time: number, cacheKey: string, timeoutMs: number): Promise<string> {
    const thumbPath = this._thumbPathFor(filePath, cacheKey);
    if (fs.existsSync(thumbPath)) return Promise.resolve(thumbPath);

    const existing = this._ongoing.get(thumbPath);
    if (existing) return existing;

    let resolveFn!: (thumbPath: string) => void;
    let rejectFn!: (err: Error) => void;
    const p = new Promise<string>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    this._ongoing.set(thumbPath, p);
    this._enqueuedThumbs.add(thumbPath);

    this._queue.unshift({
      filePath,
      time,
      cacheKey,
      type: 'ondemand',
      resolve: resolveFn,
      reject: rejectFn,
    });
    // 按需请求不走 200ms 延迟，立即 drain
    this._drain();

    const timer = setTimeout(() => {
      this._ongoing.delete(thumbPath);
      this._enqueuedThumbs.delete(thumbPath);
      rejectFn(new Error('thumbnail generation timeout'));
    }, timeoutMs);
    p.then(() => clearTimeout(timer), () => clearTimeout(timer));
    return p;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this._queue = [];
    this._enqueuedThumbs.clear();
    if (this._drainTimer) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
  }

  /** 队列长度 */
  get length(): number {
    return this._queue.length;
  }

  /**
   * 启动时全量校验：扫描整个 library，把缺失缩略图的剧集全部入后台队列补全。
   * 队列本身不持久化（内存结构），服务重启后依赖此校验重建"待生成清单"，
   * 保证缩略图缓存覆盖率随时间收敛到 100%，避免滚动到未缓存集时触发慢速按需生成。
   * @param library - data.library 数组
   * @returns 本次入队的缩略图数量
   */
  enqueueMissingForLibrary(library: any[]): number {
    if (!Array.isArray(library)) return 0;
    let enqueued = 0;
    for (const anime of library) {
      if (!anime?.episodes) continue;
      const before = this._queue.length;
      this.enqueue(anime);
      enqueued += this._queue.length - before;
    }
    if (enqueued > 0) {
      logger.info(`Startup thumb check: enqueued ${enqueued} missing thumbnails across ${library.length} anime`);
    }
    return enqueued;
  }

  /** 是否正在处理 */
  get busy(): boolean {
    return this._processing;
  }

  // ── 内部 ──

  _thumbHash(filePath: string): string {
    return crypto.createHash('md5').update(filePath + THUMB_HASH_SEED).digest('hex');
  }

  _thumbPathFor(filePath: string, cacheKey: string): string {
    const hash = crypto.createHash('md5').update(filePath + cacheKey).digest('hex');
    return path.join(DATA_DIR, 'thumbs', hash + '.jpg');
  }

  /** 探测视频时长（秒）。失败返回 null。结果缓存避免重复探测。 */
  _probeDuration(filePath: string): Promise<number | null> {
    const cached = this._durCache.get(filePath);
    if (cached !== undefined) return Promise.resolve(cached);
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) return Promise.resolve(null);
    return new Promise((resolve) => {
      const ff = spawn(ffmpegPath, ['-i', filePath]);
      let stderr = '';
      let done = false;
      ff.stderr.on('data', d => { stderr += d.toString(); });
      const finish = () => {
        if (done) return; done = true;
        const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          this._durCache.set(filePath, secs);
          resolve(secs);
        } else {
          resolve(null);
        }
      };
      ff.on('close', finish);
      ff.on('error', () => { if (!done) { done = true; resolve(null); } });
      setTimeout(() => { if (!done) { done = true; ff.kill(); resolve(null); } }, 10000);
    });
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
        const mpvActive = this._activePlays.size > 0;
        let batch = this._queue.splice(0, this._concurrency);

        if (mpvActive) {
          const ondemand = batch.filter(i => i.type === 'ondemand');
          if (ondemand.length === 0) {
            // 批次全为后台项且 mpv 活跃 → 放回队列，30s 后重试
            this._queue.unshift(...batch);
            logger.info('mpv active, pausing background thumbnail queue');
            this._drainTimer = setTimeout(() => this._drain(), 30000);
            return;
          }
          // 保留 ondemand 项继续处理，后台项放回队列
          this._queue.unshift(...batch.filter(i => i.type === 'background'));
          batch = ondemand;
        }

        for (const item of batch) {
          this._enqueuedThumbs.delete(this._thumbPathFor(item.filePath, item.cacheKey ?? THUMB_HASH_SEED));
        }
        await Promise.all(batch.map(item => this._generate(item)));
      }
    } finally {
      this._processing = false;
    }
    logger.info('Thumbnail queue drained');
  }

  /** 生成完成/失败后统一结算：resolve/reject 等待方并清理去重集合 */
  _settle(item: ThumbItem, thumbPath: string | null, err: Error | null): void {
    const tp = thumbPath ?? this._thumbPathFor(item.filePath, item.cacheKey ?? THUMB_HASH_SEED);
    this._ongoing.delete(tp);
    this._enqueuedThumbs.delete(tp);
    if (thumbPath) {
      item.resolve?.(thumbPath);
    } else {
      const reason = err ?? new Error('thumbnail generation failed');
      // background 项没有 reject 等待方，失败曾静默丢弃（仅详情页 ondemand 项有 reject）。
      // 这里统一打 warn，保证任何生成失败都在日志可见，不再无声吞掉。
      logger.warn(`Thumbnail generation failed: ${item.filePath} — ${reason.message}`);
      item.reject?.(reason);
    }
  }

  async _generate(item: ThumbItem): Promise<void> {
    const { filePath } = item;
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) {
      this._settle(item, null, new Error('ffmpeg not available'));
      return;
    }

    // 源文件可能在入队后被删除/移动
    if (!fs.existsSync(filePath)) {
      logger.warn(`Source file gone, skipping thumbnail: ${filePath}`);
      this._settle(item, null, new Error('source file gone'));
      return;
    }

    // ondemand 项用显式 time；background 项从 duration 取 50% 中点（与按需端点 time=mid 一致）。
    // duration 缺失时探测真实时长；探测失败直接报错，不兜底 60s。
    let time = item.time;
    if (time === undefined) {
      let duration = item.duration && item.duration > 0 ? item.duration : null;
      if (duration === null) {
        duration = await this._probeDuration(filePath);
      }
      if (!duration || duration <= 0) {
        this._settle(item, null, new Error('duration unknown'));
        return;
      }
      time = Math.floor(duration / 2);
    }

    const thumbPath = this._thumbPathFor(filePath, item.cacheKey ?? THUMB_HASH_SEED);
    const thumbDir = path.join(DATA_DIR, 'thumbs');

    if (fs.existsSync(thumbPath)) {
      this._settle(item, thumbPath, null);
      return;
    }
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

    return new Promise<void>((resolve) => {
      const ff = spawn(ffmpegPath, [
        '-ss', String(time), '-i', filePath,
        '-skip_frame', 'nokey', '-threads', '2',
        '-vf', 'scale=480:-2',
        '-frames:v', '1', '-q:v', '5', '-y', thumbPath, '-loglevel', 'error',
      ]);
      let resolved = false;
      const timeout = setTimeout(() => {
        ff.kill();
        resolved = true;
        this._settle(item, null, new Error('ffmpeg timeout'));
        resolve();
      }, 60000);
      ff.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        if (code !== 0) {
          logger.warn(`ffmpeg exit code ${code} for ${filePath}`);
          _cleanupZeroByte(thumbPath);
          this._settle(item, null, new Error(`ffmpeg exit code ${code}`));
          return resolve();
        }
        // 验证输出文件可用（非 0 字节）
        _cleanupZeroByte(thumbPath);
        this._settle(item, thumbPath, null);
        resolve();
      });
      ff.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        logger.warn(`ffmpeg spawn error for ${filePath}: ${err.message}`);
        this._settle(item, null, err);
        resolve();
      });
    });
  }
}

export = ThumbnailQueue;