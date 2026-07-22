// server/__tests__/routes/playback.test.js
// Route handler tests for playback.js
//   Simple: handleMpvStatus, handleProgress
//   Complex: handlePlay (mock mpv-controller lazy require)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const playback = require('../../routes/playback');

describe('playback route handlers', () => {
  describe('handleMpvStatus', () => {
    it('returns active:false when no active plays', () => {
      const state = mockState({ activePlays: new Map() });
      const req = mockReq({ url: '/api/mpv-status' });
      const res = mockRes();
      playback.handleMpvStatus(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.active, false);
    });

    it('returns active:true when active plays exist', () => {
      const activePlays = new Map();
      activePlays.set('/media/video.mp4', { sessionId: 's1' });
      const state = mockState({ activePlays });
      const req = mockReq({ url: '/api/mpv-status' });
      const res = mockRes();
      playback.handleMpvStatus(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.active, true);
    });
  });

  describe('handleProgress', () => {
    it('returns 400 when animeId is missing', async () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({
        url: '/api/progress',
        method: 'POST',
        body: JSON.stringify({ episodeNumber: 1, progress: 0.5 }),
      });
      const res = mockRes();
      await playback.handleProgress(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 400 when episodeNumber is missing', async () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({
        url: '/api/progress',
        method: 'POST',
        body: JSON.stringify({ animeId: 'a1' }),
      });
      const res = mockRes();
      await playback.handleProgress(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 404 when anime not found', async () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({
        url: '/api/progress',
        method: 'POST',
        body: JSON.stringify({ animeId: 'nonexistent', episodeNumber: 1 }),
      });
      const res = mockRes();
      await playback.handleProgress(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 404 when episode not found', async () => {
      const state = mockState({
        data: {
          library: [{ id: 'a1', episodes: [{ number: 1 }] }],
        },
      });
      const req = mockReq({
        url: '/api/progress',
        method: 'POST',
        body: JSON.stringify({ animeId: 'a1', episodeNumber: 99 }),
      });
      const res = mockRes();
      await playback.handleProgress(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 200 and updates episode progress', async () => {
      let updated = false;
      let updatedArgs = null;
      const state = mockState({
        data: {
          library: [{
            id: 'a1',
            episodes: [{ number: 1, progress: 0, duration: null, watched: false }],
          }],
        },
        db: {
          updateEpisodeProgress: async (animeId, epNum, data) => {
            updated = true;
            updatedArgs = { animeId, epNum, data };
          },
        },
      });
      const req = mockReq({
        url: '/api/progress',
        method: 'POST',
        body: JSON.stringify({ animeId: 'a1', episodeNumber: 1, progress: 0.75, watched: true, duration: 1200 }),
      });
      const res = mockRes();
      await playback.handleProgress(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.strictEqual(res._body.episode.progress, 0.75);
      assert.strictEqual(res._body.episode.watched, true);
      assert.strictEqual(res._body.episode.duration, 1200);
      // Check in-memory state
      assert.strictEqual(state.data.library[0].episodes[0].progress, 0.75);
      assert.strictEqual(state.data.library[0].episodes[0].watched, true);
      assert.strictEqual(state.data.library[0].episodes[0].duration, 1200);
      // Check db was called
      assert.ok(updated);
      assert.strictEqual(updatedArgs.animeId, 'a1');
      assert.strictEqual(updatedArgs.epNum, 1);
    });

    it('returns 200 with partial update (only progress)', async () => {
      let updated = false;
      const state = mockState({
        data: {
          library: [{
            id: 'a1',
            episodes: [{ number: 1, progress: 0, duration: null, watched: false }],
          }],
        },
        db: {
          updateEpisodeProgress: async () => { updated = true; },
        },
      });
      const req = mockReq({
        url: '/api/progress',
        method: 'POST',
        body: JSON.stringify({ animeId: 'a1', episodeNumber: 1, progress: 0.5 }),
      });
      const res = mockRes();
      await playback.handleProgress(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.library[0].episodes[0].progress, 0.5);
      // These should be unchanged
      assert.strictEqual(state.data.library[0].episodes[0].watched, false);
      assert.ok(updated);
    });

    it('returns 400 for invalid JSON body', async () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/progress', method: 'POST', body: 'not json' });
      const res = mockRes();
      await playback.handleProgress(req, res, state);
      assert.strictEqual(res._status, 400);
    });
  });

  describe('handlePlay', () => {
    // Lazy requires: const { checkMpvAvailable } = require('../mpv-controller');
    //               const { startMpv } = require('../mpv-controller');
    let origMpvController;
    let tmpFile;

    before(() => {
      const mp = require.resolve('../../mpv-controller');
      origMpvController = require.cache[mp]?.exports;
      require.cache[mp] = {
        id: mp, filename: mp, loaded: true,
        exports: {
          checkMpvAvailable: () => true,
          startMpv: (mpvPath, filePath, startSeconds, callbacks) => {
            // Simulate successful mpv spawn
            process.nextTick(() => {
              // onProgress with final=true to signal completion
              callbacks.onProgress?.({
                sessionId: null, filePath, progress: 0.5,
                peakPos: 0.5, watched: false, duration: 1200, final: true,
              });
            });
            return Promise.resolve(null);
          },
        },
      };
      tmpFile = path.join(os.tmpdir(), 'test-play-' + Date.now() + '.mp4');
      fs.writeFileSync(tmpFile, '');
    });

    after(() => {
      const mp = require.resolve('../../mpv-controller');
      require.cache[mp] = origMpvController;
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    });

    it('returns 400 when filePath is missing', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/play', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await playback.handlePlay(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 404 when file does not exist', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/play', method: 'POST', body: JSON.stringify({ filePath: '/nonexistent.mp4' }) });
      const res = mockRes();
      await playback.handlePlay(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 200 and creates play session for valid file', async () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', episodes: [{ number: 1, filePath: tmpFile, watched: false }] }],
          playSessions: [],
        },
        activePlays: new Map(),
        config: { mpvPath: 'mpv', autoMarkWatched: true },
        db: {
          savePlaySessions: async () => {},
          updateEpisodeProgress: async () => {},
          updatePlaySession: async () => {},
          saveMyList: async () => {},
        },
      });
      const req = mockReq({ url: '/api/play', method: 'POST', body: JSON.stringify({ filePath: tmpFile, position: 0 }) });
      const res = mockRes();
      await playback.handlePlay(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      // Should have created a play session
      assert.strictEqual(state.data.playSessions.length, 1);
    });
  });
});
