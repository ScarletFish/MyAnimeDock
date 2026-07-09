// server/routes/playback.js — 播放、进度、缩略图、mpv 状态
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { jsonResp, readBody, serveImage, getFfmpegPath } = require('../lib/utils');
const { DATA_DIR, MAX_PLAY_SESSIONS } = require('../lib/config');

module.exports = {
  async handlePlay(req, res, state) {
    const { data, config, db, activePlays, bangumiSync, logger } = state;
    try {
      const body = await readBody(req);
      const { filePath, position } = JSON.parse(body);
      if (!filePath) { jsonResp(res, 400, { error: 'filePath is required' }); return; }
      if (!fs.existsSync(filePath)) { jsonResp(res, 404, { error: 'File not found' }); return; }
      const mpvPath = config.mpvPath || 'mpv';
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
      }
      const { startMpv } = require('../mpv-controller');
      try {
        let settled = false;
        let spawnError = null;
        const spawnResult = await new Promise((resolve) => {
          startMpv(mpvPath, filePath, startSeconds || 0, {
            onProgress: ({ sessionId: cbSid, filePath: fp, progress, peakPos, watched, duration, final }) => {
              if (cbSid !== sessionId) return;
              const active = activePlays.get(fp);
              if (!active) return;
              const ep = active.episode;
              ep.progress = progress;
              if (duration > 0) ep.duration = duration;
              if (watched) ep.watched = true;
              db.updateEpisodeProgress(active.anime.id, ep.number, { progress, duration: duration > 0 ? duration : undefined, watched });
              if (active.sessionId) {
                const session = data.playSessions.find(s => s.sessionId === active.sessionId);
                if (session) {
                  session.duration = Math.max(0, (peakPos || progress) - (session.progressStart || 0));
                  session.endTime = new Date().toISOString();
                  const startMs = new Date(session.startTime).getTime();
                  const endMs = new Date(session.endTime).getTime();
                  session.clockTime = Math.round((endMs - startMs) / 1000);
                  db.updatePlaySession(active.sessionId, { endTime: session.endTime, duration: session.duration, clockTime: session.clockTime });
                }
              }
              if (final) {
                if (active.anime) {
                  const myEntry = (data.myList || []).find(m => m.animeId === active.anime.id);
                  if (myEntry && myEntry.status !== 'watching') {
                    myEntry.status = 'watching';
                    db.saveMyList(data);
                  }
                }
                if (active.anime?.bangumiId) {
                  bangumiSync.pushStatusChange(active.anime.id, data);
                }
                activePlays.delete(fp);
              }
            },
            onError: (msg) => {
              const active = activePlays.get(filePath);
              if (active && active.sessionId) {
                const idx = data.playSessions.findIndex(s => s.sessionId === active.sessionId);
                if (idx !== -1) data.playSessions.splice(idx, 1);
                activePlays.delete(filePath);
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
    jsonResp(res, 200, { active: activePlays.size > 0 });
  },

  handleThumbnail(req, res, state) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const videoPath = params.get('path');
    const time = parseFloat(params.get('time')) || 60;
    if (!videoPath || !fs.existsSync(videoPath)) { jsonResp(res, 404, { error: 'File not found' }); return; }
    const hash = crypto.createHash('md5').update(videoPath + time).digest('hex');
    const thumbDir = path.join(DATA_DIR, 'thumbs');
    const thumbPath = path.join(thumbDir, hash + '.jpg');
    if (fs.existsSync(thumbPath)) { serveImage(thumbPath, req.url, res); return; }
    let responded = false;
    try {
      if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
      const ffmpegPath = getFfmpegPath();
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
      ff.on('error', (err) => {
        clearTimeout(timeout);
        if (responded) return;
        responded = true;
        jsonResp(res, 500, { error: 'ffmpeg not available' });
      });
    } catch (e) {
      if (!responded) { responded = true; jsonResp(res, 500, { error: e.message }); }
    }
  },
};
