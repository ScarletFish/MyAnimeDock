// server/routes/playback.js — 播放、进度、缩略图、mpv 状态
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { jsonResp, readBody, serveImage, getFfmpegPath } = require('../lib/utils');
const { DATA_DIR, MAX_PLAY_SESSIONS } = require('../lib/config');

// ─── Thumbnail helpers (module-scoped, not on exports — avoids `this` issues) ───

const _durCache = new Map();

function _probeDuration(videoPath, cb) {
  const cached = _durCache.get(videoPath);
  if (cached !== undefined) { cb(cached); return; }
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) { cb(null); return; }
  // Use ffmpeg itself (not ffprobe — ffmpeg-static ships only ffmpeg)
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

function _generateThumb(videoPath, time, cacheKey, req, res) {
  const hash = crypto.createHash('md5').update(videoPath + cacheKey).digest('hex');
  const thumbDir = path.join(DATA_DIR, 'thumbs');
  const thumbPath = path.join(thumbDir, hash + '.jpg');
  if (fs.existsSync(thumbPath)) { serveImage(thumbPath, req.url, res); return; }
  let responded = false;
  try {
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) { jsonResp(res, 500, { error: 'ffmpeg not available' }); return; }
    const ff = spawn(ffmpegPath, [
      '-ss', String(time), '-i', videoPath,
      '-vframes', '1', '-q:v', '5', '-y', thumbPath, '-loglevel', 'error',
    ]);
    const timeout = setTimeout(() => {
      if (responded) return;
      responded = true; ff.kill();
      jsonResp(res, 500, { error: 'timeout' });
    }, 60000);
    ff.on('close', (code) => {
      clearTimeout(timeout);
      if (responded) return;
      responded = true;
      if (code === 0 && fs.existsSync(thumbPath)) { serveImage(thumbPath, req.url, res); }
      else { jsonResp(res, 500, { error: 'ffmpeg failed' }); }
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
}

module.exports = {
  async handlePlay(req, res, state) {
    const { data, config, db, activePlays, bangumiSync, logger, broadcastMpvStatus } = state;
    try {
      const body = await readBody(req);
      const { filePath, position } = JSON.parse(body);
      if (!filePath) { jsonResp(res, 400, { error: 'filePath is required' }); return; }
      if (!fs.existsSync(filePath)) { jsonResp(res, 404, { error: 'File not found' }); return; }
      const mpvPath = config.mpvPath || 'mpv';
      const MpvPlayerStrategy = require('../players/registry').getStrategy('mpv');
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
          data.playSessions.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
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
        const spawnResult = await new Promise((resolve) => {
          strategy.start(mpvPath, filePath, startSeconds || 0, {
            onProgress: ({ sessionId: cbSid, filePath: fp, progress, peakPos, watched, duration, final }) => {
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
            onError: (msg) => {
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
      } catch (e) {
        jsonResp(res, 500, { error: e.message });
      }
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },

  async handleProgress(req, res, state) {
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
  },

  handleMpvStatus(req, res, state) {
    const { activePlays } = state;
    if (activePlays.size > 0) {
      const first = activePlays.values().next().value;
      jsonResp(res, 200, {
        active: true,
        animeId: first.anime.id,
        episodeNumber: first.episode.number,
        progress: first.episode.progress,
        duration: first.episode.duration,
      });
    } else {
      jsonResp(res, 200, { active: false });
    }
  },

  handleThumbnail(req, res, state) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const videoPath = params.get('path');
    const timeRaw = params.get('time');
    if (!videoPath || !fs.existsSync(videoPath)) { jsonResp(res, 404, { error: 'File not found' }); return; }

    if (timeRaw === 'mid') {
      _probeDuration(videoPath, (dur) => {
        const time = dur ? Math.floor(dur / 2) : 60;
        _generateThumb(videoPath, time, 'mid', req, res);
      });
    } else {
      const time = parseFloat(timeRaw) || 60;
      _generateThumb(videoPath, time, String(time), req, res);
    }
  },
};
