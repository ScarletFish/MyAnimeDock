// server/__tests__/routes/playback.test.js
// Route handler tests for playback.js
//   Simple: handleMpvStatus, handleProgress
//   Complex: handlePlay (mock registry.getStrategy)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const playback = require('../../dist/routes/playback');
const ThumbnailQueue = require('../../dist/thumbnail-queue');
const { THUMB_HASH_SEED } = require('../../dist/lib/utils');
const { DATA_DIR } = require('../../dist/lib/config');

// 模拟 mpv 策略在会话中途切换文件（跨集播放）时的上报路径/进度
let mockFinalPath = null;
let mockProgress = 0.5;

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
      activePlays.set('/media/video.mp4', {
        sessionId: 's1',
        anime: { id: 'a1' },
        episode: { number: 3, progress: 500, duration: 1200 },
      });
      const state = mockState({ activePlays });
      const req = mockReq({ url: '/api/mpv-status' });
      const res = mockRes();
      playback.handleMpvStatus(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.active, true);
      assert.strictEqual(res._body.animeId, 'a1');
      assert.strictEqual(res._body.episodeNumber, 3);
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
    let origRegistry;
    let tmpFile;

    before(() => {
      // Mock registry.getStrategy to return a mock mpv strategy class
      class MockMpvStrategy {
        static checkAvailable() { return true; }
        start(mpvPath, filePath, startSeconds, callbacks, sessionId) {
          // Simulate successful mpv spawn; final reports current file (may differ from
          // the spawned one when playback switched files inside mpv).
          process.nextTick(() => {
            callbacks.onProgress?.({
              sessionId, filePath: mockFinalPath || filePath, progress: mockProgress,
              peakPos: mockProgress, watched: false, duration: 1200, final: true,
            });
          });
          return { stop: () => {} };
        }
        stop() {}
      }
      const regPath = require.resolve('../../dist/players/registry');
      origRegistry = require.cache[regPath]?.exports;
      require.cache[regPath] = {
        id: regPath, filename: regPath, loaded: true,
        exports: {
          getStrategy: (type) => type === 'mpv' ? MockMpvStrategy : null,
          register: () => {},
          getAvailable: () => [],
          getDefault: () => null,
          listTypes: () => ['mpv'],
          _setMock: () => {},
          _reset: () => {},
        },
      };
      tmpFile = path.join(os.tmpdir(), 'test-play-' + Date.now() + '.mp4');
      fs.writeFileSync(tmpFile, '');
      mockFinalPath = null;
      mockProgress = 0.5;
    });

    after(() => {
      const regPath = require.resolve('../../dist/players/registry');
      require.cache[regPath] = origRegistry;
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
      assert.strictEqual(state.data.playSessions.length, 1);
    });

    it('rebinds progress to the new episode when the file changes inside mpv (跨集播放)', async () => {
      // 播放 ep9 时 mpv 内切到 ep10（如 autoload 自动进下一集），final 上报的是 ep10 的路径与进度。
      // 修复前：进度/会话仍归属 ep9 → 继续播放卡片停在上一集；修复后应归属 ep10。
      const f9 = path.join(os.tmpdir(), 'test-ep9-' + Date.now() + '.mp4');
      const f10 = path.join(os.tmpdir(), 'test-ep10-' + Date.now() + '.mp4');
      fs.writeFileSync(f9, '');
      fs.writeFileSync(f10, '');
      const progressWrites = [];
      const sessionUpdates = [];
      let watchedMarked = null;
      try {
        mockFinalPath = f10;
        mockProgress = 42; // ep10 片头位置（秒）
        const state = mockState({
          data: {
            library: [{
              id: 'anime-1',
              episodes: [
                { number: 9, filePath: f9, progress: 0, duration: 1400, watched: false },
                { number: 10, filePath: f10, progress: 0, duration: 1400, watched: false },
              ],
            }],
            playSessions: [],
          },
          activePlays: new Map(),
          config: { mpvPath: 'mpv', autoMarkWatched: true },
          db: {
            savePlaySessions: async () => {},
            updateEpisodeProgress: async (animeId, epNum, data) => { progressWrites.push({ animeId, epNum, ...data }); },
            updateEpisodesWatched: async (animeId, nums) => { watchedMarked = { animeId, nums }; },
            updatePlaySession: async (sessionId, data) => { sessionUpdates.push({ sessionId, ...data }); },
            saveMyList: async () => {},
          },
        });
        const req = mockReq({ url: '/api/play', method: 'POST', body: JSON.stringify({ filePath: f9, position: 0 }) });
        const res = mockRes();
        await playback.handlePlay(req, res, state);
        assert.strictEqual(res._status, 200);

        const ep9 = state.data.library[0].episodes.find((e) => e.number === 9);
        const ep10 = state.data.library[0].episodes.find((e) => e.number === 10);
        // ep10 拿到进度，ep9 不被污染
        assert.strictEqual(ep10.progress, 42);
        assert.strictEqual(ep9.progress, 0);
        const write = progressWrites.find((w) => w.epNum === 10);
        assert.ok(write, 'progress should be written to ep10, got: ' + JSON.stringify(progressWrites));
        assert.strictEqual(write.progress, 42);
        // 会话归属到 ep10（详情页/卡片据此定位继续播放）
        assert.strictEqual(state.data.playSessions[0].episodeNumber, 10);
        assert.ok(sessionUpdates.some((u) => u.episodeNumber === 10), 'session episodeNumber should persist');
        // autoMarkWatched：第 9 集被标记为已看
        assert.deepStrictEqual(watchedMarked, { animeId: 'anime-1', nums: [9] });
        // 播放结束 activePlays 清理干净
        assert.strictEqual(state.activePlays.size, 0);
      } finally {
        try { fs.unlinkSync(f9); } catch (_) {}
        try { fs.unlinkSync(f10); } catch (_) {}
      }
    });

    it('does not write progress when mpv switches to a file outside the library', async () => {
      const f9 = path.join(os.tmpdir(), 'test-ep9b-' + Date.now() + '.mp4');
      const outside = path.join(os.tmpdir(), 'test-outside-' + Date.now() + '.mp4');
      fs.writeFileSync(f9, '');
      fs.writeFileSync(outside, '');
      const progressWrites = [];
      try {
        mockFinalPath = outside;
        mockProgress = 10;
        const state = mockState({
          data: {
            library: [{
              id: 'anime-1',
              episodes: [{ number: 9, filePath: f9, progress: 0, duration: 1400, watched: false }],
            }],
            playSessions: [],
          },
          activePlays: new Map(),
          config: { mpvPath: 'mpv', autoMarkWatched: true },
          db: {
            savePlaySessions: async () => {},
            updateEpisodeProgress: async (animeId, epNum, data) => { progressWrites.push({ animeId, epNum, ...data }); },
            updateEpisodesWatched: async () => {},
            updatePlaySession: async () => {},
            saveMyList: async () => {},
          },
        });
        const req = mockReq({ url: '/api/play', method: 'POST', body: JSON.stringify({ filePath: f9, position: 0 }) });
        const res = mockRes();
        await playback.handlePlay(req, res, state);
        assert.strictEqual(res._status, 200);
        // 库外文件不归属任何集：不写进度、不污染 ep9
        assert.strictEqual(progressWrites.length, 0, 'no progress write expected');
        assert.strictEqual(state.data.library[0].episodes[0].progress, 0);
        assert.strictEqual(state.activePlays.size, 0, 'active play should be cleaned up');
      } finally {
        try { fs.unlinkSync(f9); } catch (_) {}
        try { fs.unlinkSync(outside); } catch (_) {}
      }
    });
  });

  describe('handleThumbnail', () => {
    // Playback module destructures spawn at load time, so we can't mock
    // child_process.spawn externally. Instead test validation paths + error path
    // (system without ffmpeg — spawn errors → 500 'ffmpeg not available').
    let tmpFile;

    before(() => {
      tmpFile = path.join(os.tmpdir(), 'test-thumb-' + Date.now() + '.mp4');
      fs.writeFileSync(tmpFile, 'dummy');
    });

    after(() => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    });

    it('returns 404 when path param missing', () => {
      const state = mockState();
      const req = mockReq({ url: '/api/thumbnail' });
      const res = mockRes();
      playback.handleThumbnail(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 404 when video file does not exist', () => {
      const state = mockState();
      const req = mockReq({ url: '/api/thumbnail?path=/nonexistent.mp4&time=60' });
      const res = mockRes();
      playback.handleThumbnail(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 500 with ffmpeg error when ffmpeg is not available (time param)', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/thumbnail?path=' + encodeURIComponent(tmpFile) + '&time=60' });
      const res = mockRes();
      playback.handleThumbnail(req, res, state);
      // 机器上可能存在真实 ffmpeg（scripts/ffmpeg-upx.exe），对 dummy 文件解码失败退出较慢，
      // 轮询等待响应写入而非固定延时。
      const deadline = Date.now() + 3000;
      while (res._status === null && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      assert.strictEqual(res._status, 500);
      assert.ok(res._body?.error, 'should have error message: ' + JSON.stringify(res._body));
    });

    it('returns 500 with ffmpeg error for mid probe (async callback)', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/thumbnail?path=' + encodeURIComponent(tmpFile) + '&time=mid' });
      const res = mockRes();
      playback.handleThumbnail(req, res, state);
      // mid path: _probeDuration spawns ffmpeg -i → error → cb(null) → _generateThumb spawns again → error → 500
      const deadline = Date.now() + 3000;
      while (res._status === null && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      assert.strictEqual(res._status, 500);
      assert.ok(res._body?.error, 'should have error message: ' + JSON.stringify(res._body));
    });

    it('serves cached mid thumbnail from the shared queue key WITHOUT ffmpeg', async () => {
      // 队列预生成键 = md5(path + THUMB_HASH_SEED)，端点 time=mid 必须命中同一文件。
      // 无 ffmpeg 环境下任何缓存 miss 都会 500，因此 200 + 原字节返回即证明走了缓存。
      const hash = crypto.createHash('md5').update(tmpFile + THUMB_HASH_SEED).digest('hex');
      const thumbPath = path.join(DATA_DIR, 'thumbs', hash + '.jpg');
      const dummy = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
      fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
      fs.writeFileSync(thumbPath, dummy);
      try {
        const state = mockState();
        const req = mockReq({ url: '/api/thumbnail?path=' + encodeURIComponent(tmpFile) + '&time=mid' });
        const rawRes = { _status: null, _body: null, _chunks: [], writeHead(s) { this._status = s; }, write(c) { this._chunks.push(c); return true; }, end(b) { if (b !== undefined && b !== null) this._body = b; else if (this._chunks.length) this._body = Buffer.concat(this._chunks.map(c => typeof c === 'string' ? Buffer.from(c) : c)); } };
        playback.handleThumbnail(req, rawRes, state);
        await new Promise(r => setTimeout(r, 50));
        assert.strictEqual(rawRes._status, 200);
        assert.ok(Buffer.isBuffer(rawRes._body), 'body should be raw bytes');
        assert.strictEqual(Buffer.compare(rawRes._body, dummy), 0, 'should serve exact cached file bytes');
      } finally {
        try { fs.unlinkSync(thumbPath); } catch (_) {}
      }
    });

    it('queue enqueue dedupes episodes already cached under the shared key', () => {
      const hash = crypto.createHash('md5').update(tmpFile + THUMB_HASH_SEED).digest('hex');
      const thumbPath = path.join(DATA_DIR, 'thumbs', hash + '.jpg');
      fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
      fs.writeFileSync(thumbPath, 'x');
      try {
        const q = new ThumbnailQueue(new Map());
        q.enqueue({ id: 'a1', title: 'T', episodes: [{ filePath: tmpFile, number: 1 }] });
        assert.strictEqual(q.length, 0, 'queue should skip episodes whose shared-key thumb already exists');
        q.clear();
      } finally {
        try { fs.unlinkSync(thumbPath); } catch (_) {}
      }
    });
  });
});
