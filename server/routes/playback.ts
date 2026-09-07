// server/routes/playback.ts — 播放、进度、缩略图、mpv 状态
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { jsonResp, readBody, serveImage, THUMB_HASH_SEED } from '../lib/utils';
import { DATA_DIR, MAX_PLAY_SESSIONS } from '../lib/config';
import { isChasing } from '../lib/anime-meta';
import { Logger } from '../logger';
import type { ServerState } from '../types';
const logger: Logger = require('../logger').child('[Playback]');

type State = ServerState;

// ─── 语义常量 ───
const AUTO_MARK_THRESHOLD_EP = 2; // 自动标记已看：从第 2 集起

// ─── Thumbnail helpers (module-scoped, not on exports — avoids `this` issues) ───

/** 缩略图缓存文件路径 — 与 thumbnail-queue.ts 共享同一缓存键（THUMB_HASH_SEED） */
function _thumbPath(videoPath: string, cacheKey: string): string {
  const hash = crypto.createHash('md5').update(videoPath + cacheKey).digest('hex');
  return path.join(DATA_DIR, 'thumbs', hash + '.jpg');
}

async function handlePlay(req: any, res: any, state: State) {
  const { data, config, db, activePlays, bangumiSync, logger, broadcastMpvStatus } = state;
  try {
    const body = await readBody(req);
    const { filePath, position } = JSON.parse(body);
    if (!filePath) { jsonResp(res, 400, { error: 'filePath is required' }); return; }
    if (!fs.existsSync(filePath)) { jsonResp(res, 404, { error: 'File not found' }); return; }
    const mpvPath = config.mpvPath || 'mpv';
    const MpvPlayerStrategy: any = require('../players/registry').getStrategy('mpv');
    if (!MpvPlayerStrategy || !MpvPlayerStrategy.checkAvailable(mpvPath)) {
      jsonResp(res, 400, { error: '未检测到 mpv 播放器。请安装 mpv 后在设置 → 播放 中配置路径。' });
      return;
    }
    let targetAnime, targetEp;
    for (const a of data.library) {
      const ep = a.episodes.find(e => e.filePath === filePath);
      if (ep) { targetAnime = a; targetEp = ep; break; }
    }
    let startSeconds = Math.round(position || 0);
    if (targetEp && targetEp.duration && position > 0 && position < 1) {
      startSeconds = Math.round(position * targetEp.duration);
    }
    let sessionId = null;
    if (targetAnime && targetEp) {
      if (config.autoMarkWatched && targetEp.number >= AUTO_MARK_THRESHOLD_EP) {
        const autoMarked = [];
        for (const ep of targetAnime.episodes) {
          if (ep.number < targetEp.number && !ep.watched) {
            ep.watched = true;
            autoMarked.push(ep.number);
          }
        }
        if (autoMarked.length > 0) {
          db.updateEpisodesWatched(targetAnime.id, autoMarked);
        }
      }
      sessionId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      data.playSessions.push({
        animeId: targetAnime.id, episodeNumber: targetEp.number, sessionId,
        startTime: new Date().toISOString(), endTime: null,
        duration: 0, clockTime: 0, progressStart: startSeconds,
      });
      if (data.playSessions.length > MAX_PLAY_SESSIONS) {
        data.playSessions.sort((a: any, b: any) => (new Date(a.startTime) as any) - (new Date(b.startTime) as any));
        data.playSessions.splice(0, data.playSessions.length - MAX_PLAY_SESSIONS);
      }
      activePlays.set(filePath, { sessionId, episode: targetEp, anime: targetAnime });
      db.savePlaySessions(data);
      broadcastMpvStatus?.();
    }
    const strategy = new MpvPlayerStrategy();
    try {
      let settled = false;
      let spawnError = null;
      const spawnResult = await new Promise<any>((resolve) => {
        strategy.start(mpvPath, filePath, startSeconds || 0, {
          onProgress: ({ sessionId: cbSid, filePath: fp, progress, peakPos, watched, duration, final }: any) => {
            if (cbSid !== sessionId) return;
            // mpv 内切换文件（跨集播放）后 fp 已不是启动时的 key：先按路径查，再用 sessionId 兜底
            let active = activePlays.get(fp);
            if (active && active.sessionId !== cbSid) active = undefined;
            let activeKey: string | null = active ? fp : null;
            if (!active) {
              for (const [key, play] of activePlays) {
                if (play.sessionId === cbSid) { active = play; activeKey = key; break; }
              }
            }
            if (!active) return;
            if (active.sessionId !== cbSid) return; // 旧 session 异步清理时避免操作新 session 的数据

            // ── mpv 内跨集播放：文件在会话中途切换，把进度/会话重新归属到新文件对应的集 ──
            if (fp !== activeKey) {
              let newAnime: any = null;
              let newEp: any = null;
              for (const a of data.library) {
                const e = a.episodes.find((ep2: any) => ep2.filePath === fp);
                if (e) { newAnime = a; newEp = e; break; }
              }
              if (!newAnime || !newEp) {
                // 换到了库外文件：无法归属任何集，仅清理会话，不写进度
                activePlays.delete(activeKey as string);
                broadcastMpvStatus?.();
                return;
              }
              // 与 /api/play 启动语义一致：autoMarkWatched 开启时把新集的前序集标记为已看
              if (config.autoMarkWatched && newEp.number >= AUTO_MARK_THRESHOLD_EP) {
                const autoMarked: number[] = [];
                for (const ep2 of newAnime.episodes) {
                  if (ep2.number < newEp.number && !ep2.watched) {
                    ep2.watched = true;
                    autoMarked.push(ep2.number);
                  }
                }
                if (autoMarked.length > 0) db.updateEpisodesWatched(newAnime.id, autoMarked);
              }
              active.episode = newEp;
              active.anime = newAnime;
              activePlays.delete(activeKey as string);
              activePlays.set(fp, active);
              const session = data.playSessions.find((s: any) => s.sessionId === active.sessionId);
              if (session && session.episodeNumber !== newEp.number) {
                session.episodeNumber = newEp.number;
                db.updatePlaySession(session.sessionId, { episodeNumber: newEp.number });
              }
            }

            const ep = active.episode;
            ep.progress = progress;
            if (duration > 0) ep.duration = duration;
            if (active.sessionId) {
              const session = data.playSessions.find(s => s.sessionId === active.sessionId);
              if (session) {
                session.duration = Math.max(0, (peakPos || progress) - (session.progressStart || 0));
                session.endTime = new Date().toISOString();
                const startMs = new Date(session.startTime).getTime();
                const endMs = new Date(session.endTime).getTime();
                session.clockTime = Math.round((endMs - startMs) / 1000);
              }
            }
            // ── 一次性落盘（watched 不由 mpv 自动决定，由前端弹窗确认） ──
            db.updateEpisodeProgress(active.anime.id, ep.number, { progress, duration: duration > 0 ? duration : undefined });
            if (active.sessionId) {
              const session = data.playSessions.find(s => s.sessionId === active.sessionId);
              if (session) {
                db.updatePlaySession(active.sessionId, { endTime: session.endTime, duration: session.duration, clockTime: session.clockTime });
              }
            }
            if (active.anime) {
              const myEntry = (data.myList || []).find(m => m.animeId === active.anime.id);
              const eps = active.anime.episodes;
              // 追番中（预计总集数已知但本地集数不足）：看完本地最后一集不算完结，等下一集
              const allWatched = !!eps && eps.length > 0 && eps.every(e => e.watched) && !isChasing(active.anime);
              if (allWatched && myEntry) {
                myEntry.status = 'completed';
                myEntry.completedAt = new Date().toISOString();
                db.saveMyList(data);
              } else if (myEntry && myEntry.status !== 'watching') {
                myEntry.status = 'watching';
                db.saveMyList(data);
              }
            }
            if (active.anime?.bangumiId) {
              bangumiSync.pushStatusChange(active.anime.id, data);
            }
            activePlays.delete(fp);
            broadcastMpvStatus?.();
          },
          onError: (msg: any) => {
            const active = activePlays.get(filePath);
            if (active && active.sessionId) {
              const idx = data.playSessions.findIndex(s => s.sessionId === active.sessionId);
              if (idx !== -1) data.playSessions.splice(idx, 1);
              activePlays.delete(filePath);
              broadcastMpvStatus?.();
              db.deletePlaySession(active.sessionId);
            }
            spawnError = msg;
            logger.error('mpv error:', msg);
            if (!settled) { settled = true; resolve({ error: msg }); }
          },
        }, sessionId);
        setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 2000);
      });
      if (spawnResult?.error) { jsonResp(res, 500, { error: spawnResult.error }); }
      else { jsonResp(res, 200, { ok: true }); }
    } catch (e: any) {
      jsonResp(res, 500, { error: e.message });
    }
  } catch (e) {
    jsonResp(res, 400, { error: 'Invalid request body' });
  }
}

async function handleProgress(req: any, res: any, state: State) {
  const { data, db } = state;
  try {
    const body = await readBody(req);
    const { animeId, episodeNumber, progress, watched, duration } = JSON.parse(body);
    if (!animeId || episodeNumber === undefined) { jsonResp(res, 400, { error: 'animeId and episodeNumber are required' }); return; }
    const anime = data.library.find(a => a.id === animeId);
    if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }
    const ep = anime.episodes.find(e => e.number === episodeNumber);
    if (!ep) { jsonResp(res, 404, { error: 'Episode not found' }); return; }
    if (progress !== undefined) ep.progress = progress;
    if (duration !== undefined) ep.duration = duration;
    if (watched !== undefined) ep.watched = watched;
    db.updateEpisodeProgress(animeId, episodeNumber, { progress, duration, watched });
    jsonResp(res, 200, { ok: true, episode: ep });
  } catch (e) {
    jsonResp(res, 400, { error: 'Invalid request body' });
  }
}

function handleMpvStatus(req: any, res: any, state: State) {
  const { activePlays } = state;
  const first = activePlays.size > 0 ? activePlays.values().next().value : undefined;
  if (!first) { jsonResp(res, 200, { active: false }); return; }
  jsonResp(res, 200, {
    active: true,
    animeId: first.anime.id,
    episodeNumber: first.episode.number,
    progress: first.episode.progress,
    duration: first.episode.duration,
  });
}

// ETag + no-cache 重新验证缩略图：磁盘上的缩略图可能被重新生成（如黑屏重试），
// 若用 max-age 强缓存，浏览器会缓存旧图（旧黑图）长达 24h 且无法更新（WebView2 持久化）。
// 参考 handleBannerImage 的 banner 模式：文件变了返回新图，没变返回 304。
function serveThumbWithRevalidate(req: any, res: any, filePath: string, url: string): void {
  fs.stat(filePath, (err, stats) => {
    if (err) { serveImage(filePath, url, res, true); return; }
    const etag = `"${stats.size}-${stats.mtimeMs}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.setHeader('ETag', etag);
    serveImage(filePath, url, res, true);
  });
}

function handleThumbnail(req: any, res: any, state: State) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const videoPath = params.get('path');
  const timeRaw = params.get('time');
  logger.debug(`[THUMB-DEBUG] req.url=${req.url}`);
  logger.debug(`[THUMB-DEBUG] videoPath=${videoPath} timeRaw=${timeRaw}`);
  logger.debug(`[THUMB-DEBUG] exists=${videoPath ? fs.existsSync(videoPath) : 'n/a'}`);
  if (!videoPath || !fs.existsSync(videoPath)) { jsonResp(res, 404, { error: 'File not found' }); return; }

  if (timeRaw === 'mid') {
    // 与缩略图队列共享缓存键：命中直接返回，避免重复跑 ffmpeg + 时长探测
    const cached = _thumbPath(videoPath, THUMB_HASH_SEED);
    logger.debug(`[THUMB-DEBUG] mid cached=${fs.existsSync(cached)} path=${cached}`);
    if (fs.existsSync(cached)) { serveThumbWithRevalidate(req, res, cached, req.url); return; }
    // 冷缓存：绝不等待生成。立即 202，由队列闸门后台生成（status 端点可查询进度）。
    // 不传 time → 队列内部探测时长取中点（mid 语义），缓存键沿用 THUMB_HASH_SEED。
    if (state.thumbnailQueue) {
      res.setHeader('Cache-Control', 'no-store');
      state.thumbnailQueue.scheduleGeneration(videoPath, { priority: 'ondemand' });
    } else {
      logger.warn('thumbnailQueue unavailable — mid thumbnail request accepted without scheduling');
    }
    jsonResp(res, 202, { status: 'pending' });
  } else {
    const time = parseFloat(timeRaw ?? '');
    if (Number.isNaN(time)) { jsonResp(res, 400, { error: 'invalid time' }); return; }
    logger.debug(`[THUMB-DEBUG] exit time=${time} cacheKey=${String(time)}`);
    const cached = _thumbPath(videoPath, String(time));
    if (fs.existsSync(cached)) { serveThumbWithRevalidate(req, res, cached, req.url); return; }
    // 自定义 time 也走统一队列（single-flight + 并发闸门）；冷缓存立即 202，不挂等。
    if (state.thumbnailQueue) {
      res.setHeader('Cache-Control', 'no-store');
      state.thumbnailQueue.scheduleGeneration(videoPath, { time, cacheKey: String(time), priority: 'ondemand' });
    } else {
      logger.warn('thumbnailQueue unavailable — thumbnail request accepted without scheduling');
    }
    jsonResp(res, 202, { status: 'pending' });
  }
}

/**
 * 缩略图生成状态查询端点（GET /api/thumbnail/status?path=...&time=mid|数值）。
 * 纯只读：绝不触发生成、不 spawn、不探测。供前端轮询判断该图是否已就绪。
 * - 文件不存在 / 无效 time / 无缓存且未在生成 → 200 { status: 'missing' }
 * - 缓存文件存在 → 200 { status: 'ready' }
 * - 已在队列（_enqueuedThumbs）或生成中（_ongoing）→ 200 { status: 'generating' }
 */
function handleThumbnailStatus(req: any, res: any, state: State) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const videoPath = params.get('path');
  const timeRaw = params.get('time');
  if (!videoPath || !fs.existsSync(videoPath)) { jsonResp(res, 200, { status: 'missing' }); return; }

  let cacheKey: string;
  if (timeRaw === 'mid') {
    cacheKey = THUMB_HASH_SEED;
  } else {
    const time = parseFloat(timeRaw ?? '');
    if (Number.isNaN(time)) { jsonResp(res, 200, { status: 'missing' }); return; }
    cacheKey = String(time);
  }
  const thumbPath = _thumbPath(videoPath, cacheKey);
  if (fs.existsSync(thumbPath)) { jsonResp(res, 200, { status: 'ready' }); return; }
  const queue: any = state.thumbnailQueue;
  if (queue && (queue._enqueuedThumbs?.has(thumbPath) || queue._ongoing?.has(thumbPath))) {
    jsonResp(res, 200, { status: 'generating' });
    return;
  }
  jsonResp(res, 200, { status: 'missing' });
}

export {
  handlePlay,
  handleProgress,
  handleMpvStatus,
  handleThumbnail,
  handleThumbnailStatus,
};
