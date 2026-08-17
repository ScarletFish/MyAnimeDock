// server/routes/playback.ts — 播放、进度、缩略图、mpv 状态
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { jsonResp, readBody, serveImage, getFfmpegPath, THUMB_HASH_SEED } from '../lib/utils';
import { DATA_DIR, MAX_PLAY_SESSIONS } from '../lib/config';
import { Logger } from '../logger';
import type { ServerState } from '../types';
const logger: Logger = require('../logger').child('[Playback]');

type State = ServerState;

// ─── Thumbnail helpers (module-scoped, not on exports — avoids `this` issues) ───

const _durCache = new Map();

function _probeDuration(videoPath: string, cb: (dur: number | null) => void) {
  const cached = _durCache.get(videoPath);
  if (cached !== undefined) { cb(cached); return; }
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) { cb(null); return; }
  // Use ffmpeg itself (not ffprobe — only ffmpeg binary is bundled)
  const ff = spawn(ffmpegPath, ['-i', videoPath]);
  let stderr = '';
  let done = false;
  ff.stderr.on('data', d => { stderr += d.toString(); });
  const finish = () => {
    if (done) return; done = true;
    // Parse "Duration: HH:MM:SS.ml" from ffmpeg stderr
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) {
      const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
      _durCache.set(videoPath, secs);
      cb(secs);
    } else {
      cb(null);
    }
  };
  ff.on('close', finish);
  ff.on('error', () => { if (!done) { done = true; cb(null); } });
  setTimeout(() => { if (!done) { done = true; ff.kill(); cb(null); } }, 10000);
}

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
      if (config.autoMarkWatched && targetEp.number >= 2) {
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
            const active = activePlays.get(fp);
            if (!active) return;
            if (active.sessionId !== cbSid) return; // 旧 session 异步清理时避免操作新 session 的数据
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
              const allWatched = active.anime.episodes && active.anime.episodes.length > 0
                && active.anime.episodes.every(e => e.watched);
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

function handleThumbnail(req: any, res: any, state: State) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const videoPath = params.get('path');
  const timeRaw = params.get('time');
  logger.info(`[THUMB-DEBUG] req.url=${req.url}`);
  logger.info(`[THUMB-DEBUG] videoPath=${videoPath} timeRaw=${timeRaw}`);
  logger.info(`[THUMB-DEBUG] exists=${videoPath ? fs.existsSync(videoPath) : 'n/a'}`);
  if (!videoPath || !fs.existsSync(videoPath)) { jsonResp(res, 404, { error: 'File not found' }); return; }

  if (timeRaw === 'mid') {
    // 与缩略图队列共享缓存键：命中直接返回，避免重复跑 ffmpeg + 时长探测
    const cached = _thumbPath(videoPath, THUMB_HASH_SEED);
    logger.info(`[THUMB-DEBUG] mid cached=${fs.existsSync(cached)} path=${cached}`);
    if (fs.existsSync(cached)) { serveImage(cached, req.url, res); return; }
    // cache miss → 走统一队列（single-flight + 并发闸门），不再直连 spawn
    _probeDuration(videoPath, (dur) => {
      logger.info(`[THUMB-DEBUG] mid probed dur=${dur}`);
      if (!dur) { jsonResp(res, 500, { error: 'thumbnail generation failed' }); return; }
      const time = Math.floor(dur / 2);
      if (!state.thumbnailQueue) { jsonResp(res, 500, { error: 'thumbnail generation failed' }); return; }
      state.thumbnailQueue.ensureGenerated(videoPath, time, THUMB_HASH_SEED, 30000)
        .then((thumbPath: string) => {
          serveImage(thumbPath, req.url, res);
        })
        .catch(() => {
          jsonResp(res, 500, { error: 'thumbnail generation failed' });
        });
    });
  } else {
    const time = parseFloat(timeRaw ?? '');
    if (Number.isNaN(time)) { jsonResp(res, 400, { error: 'invalid time' }); return; }
    logger.info(`[THUMB-DEBUG] exit time=${time} cacheKey=${String(time)}`);
    // 自定义 time 也走统一队列（single-flight + 并发闸门），不再直连 spawn
    if (!state.thumbnailQueue) { jsonResp(res, 500, { error: 'thumbnail generation failed' }); return; }
    state.thumbnailQueue.ensureGenerated(videoPath, time, String(time), 30000)
      .then((thumbPath: string) => serveImage(thumbPath, req.url, res))
      .catch(() => jsonResp(res, 500, { error: 'thumbnail generation failed' }));
  }
}

export {
  handlePlay,
  handleProgress,
  handleMpvStatus,
  handleThumbnail,
};
