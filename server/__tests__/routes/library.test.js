// server/__tests__/routes/library.test.js
// Route handler tests for library.js
//   Simple: handleDeleteAnime
//   Complex: handleGetAnimeDetail (fs + lazy requires)
//   Skipped: handleLibrarySyncStream (heavy SSE)
// GET /api/library 已删除：列表读取统一走 /api/mylist（lib/list-item.ts），见 mylist.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const fs = require('fs');
const path = require('path');
const lib = require('../../dist/routes/library');

describe('library route handlers', () => {
  describe('handleDeleteAnime', () => {
    it('returns 404 when anime not found', async () => {
      const state = mockState({ data: { library: [], myList: [] } });
      const req = mockReq({ url: '/api/anime/nonexistent', method: 'DELETE' });
      const res = mockRes();
      // handleDeleteAnime uses a callback pattern (Promise then/catch, not async)
      await new Promise(resolve => {
        lib.handleDeleteAnime(req, res, state);
        setImmediate(resolve);
      });
      assert.strictEqual(res._status, 404);
    });

    it('returns 200 and removes anime from library and myList', async () => {
      let savedLib = false, savedMyList = false;
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', folderPath: '/media/anime1' }],
          myList: [{ id: 'm1', animeId: 'anime-1' }],
          scannedTree: [{ path: '/media/anime1', alreadyImported: true, bangumiId: '123' }],
        },
        db: {
          saveLibrary: async () => { savedLib = true; },
          saveMyList: async () => { savedMyList = true; },
        },
      });
      const req = mockReq({ url: '/api/anime/anime-1', method: 'DELETE' });
      const res = mockRes();
      // handleDeleteAnime is NOT async — it chains .then() on Promise.all()
      // So we wait for the promise chain to settle by polling res._status
      // (fixed setTimeout is flaky under full-suite load).
      lib.handleDeleteAnime(req, res, state);
      const deadline = Date.now() + 2000;
      while (res._status === null && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5));
      }
      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.library.length, 0);
      assert.strictEqual(state.data.myList.length, 0);
      assert.strictEqual(state.data.scannedTree[0].alreadyImported, false);
      assert.strictEqual(state.data.scannedTree[0].bangumiId, null);
      assert.ok(savedLib, 'saveLibrary should be called');
      assert.ok(savedMyList, 'saveMyList should be called');
    });
  });

  describe('handleGetAnimeDetail', () => {
    it('returns 404 when anime not found', async () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/anime/nonexistent' });
      const res = mockRes();
      await lib.handleGetAnimeDetail(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 200 with anime detail and downloaded flag', async () => {
      // Use a real temp path so fs.existsSync returns true
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'test-'));
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', title: 'Test Anime', folderPath: tmpDir, summary: 'A long summary that needs truncating...' }],
        },
        thumbnailQueue: { enqueue: () => {} },
      });
      const req = mockReq({ url: '/api/anime/anime-1' });
      const res = mockRes();
      await lib.handleGetAnimeDetail(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.title, 'Test Anime');
      assert.strictEqual(res._body.downloaded, true);
      // Clean up
      fs.rmdirSync(tmpDir);
    });

    it('returns 200 with downloaded=false when folder does not exist', async () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-2', title: 'Missing Anime', folderPath: '/nonexistent/path' }],
        },
        thumbnailQueue: { enqueue: () => {} },
      });
      const req = mockReq({ url: '/api/anime/anime-2' });
      const res = mockRes();
      await lib.handleGetAnimeDetail(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.downloaded, false);
    });

    it('attaches reconciled ListItem projection (item) used to sync the library page', async () => {
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'test-'));
      const state = mockState({
        data: {
          library: [{
            id: 'anime-3',
            title: 'Test Anime',
            folderPath: tmpDir,
            episodes: [
              { number: 1, filePath: path.join(tmpDir, 'ep1.mkv'), fileName: 'ep1.mkv', fileSize: 1, watched: true, progress: 0.5 },
              { number: 2, filePath: path.join(tmpDir, 'ep2.mkv'), fileName: 'ep2.mkv', fileSize: 1, watched: false, progress: 0 },
            ],
          }],
          myList: [{ id: 'm1', animeId: 'anime-3', status: 'watching', progress: 30 }],
        },
        thumbnailQueue: { enqueue: () => {} },
      });
      const req = mockReq({ url: '/api/anime/anime-3' });
      const res = mockRes();
      await lib.handleGetAnimeDetail(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.item, 'detail response should carry item projection');
      assert.strictEqual(res._body.item.id, 'm1', 'item uses mylist row id');
      assert.strictEqual(res._body.item.animeId, 'anime-3');
      assert.strictEqual(res._body.item.hasLocalFiles, true);
      assert.strictEqual(res._body.item.status, 'watching');
      assert.strictEqual(res._body.item.episodeCount, 2);
      assert.strictEqual(res._body.item.episodesWatched, 1);
      // 原有详情字段保持（spread 兼容既有消费方）
      assert.strictEqual(res._body.title, 'Test Anime');
      assert.strictEqual(res._body.downloaded, true);
      assert.strictEqual(res._body.episodes.length, 2);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
