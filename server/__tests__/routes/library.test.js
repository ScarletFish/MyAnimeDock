// server/__tests__/routes/library.test.js
// Route handler tests for library.js
//   Simple: handleGetLibrary, handleDeleteAnime
//   Complex: handleGetAnimeDetail (fs + lazy requires)
//   Skipped: handleLibrarySyncStream (heavy SSE)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const fs = require('fs');
const path = require('path');
const lib = require('../../dist/routes/library');

describe('library route handlers', () => {
  describe('handleGetLibrary', () => {
    it('returns 200 with filtered library (downloaded !== false)', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', title: 'Anime A', downloaded: true },
            { id: '2', title: 'Anime B', downloaded: false },
            { id: '3', title: 'Anime C' }, // undefined downloaded
          ],
          myList: [
            { animeId: '1', status: 'watching' },
            { animeId: '3', status: 'completed' },
          ],
        },
      });
      const req = mockReq({ url: '/api/library' });
      const res = mockRes();
      lib.handleGetLibrary(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 2);
      assert.strictEqual(res._body[0].id, '1');
      assert.strictEqual(res._body[0].myListStatus, 'watching');
      assert.strictEqual(res._body[1].id, '3');
      assert.strictEqual(res._body[1].myListStatus, 'completed');
    });

    it('returns 200 with empty array for empty library', () => {
      const state = mockState({ data: { library: [], myList: [] } });
      const req = mockReq({ url: '/api/library' });
      const res = mockRes();
      lib.handleGetLibrary(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body, []);
    });

    it('returns 200 and sets myListStatus from myList data', () => {
      const state = mockState({
        data: {
          library: [{ id: '1', title: 'Test', downloaded: true }],
          myList: [{ animeId: '1', status: 'wish' }],
        },
      });
      const req = mockReq({ url: '/api/library' });
      const res = mockRes();
      lib.handleGetLibrary(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body[0].myListStatus, 'wish');
    });

    it('returns 200 with null myListStatus when no matching myList entry', () => {
      const state = mockState({
        data: {
          library: [{ id: '1', title: 'Test', downloaded: true }],
          myList: [],
        },
      });
      const req = mockReq({ url: '/api/library' });
      const res = mockRes();
      lib.handleGetLibrary(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body[0].myListStatus, null);
    });
  });

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
      // So we wait for the promise chain via a small delay
      lib.handleDeleteAnime(req, res, state);
      await new Promise(r => setTimeout(r, 10));
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
    it('returns 404 when anime not found', () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/anime/nonexistent' });
      const res = mockRes();
      lib.handleGetAnimeDetail(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 200 with anime detail and downloaded flag', () => {
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
      lib.handleGetAnimeDetail(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.title, 'Test Anime');
      assert.strictEqual(res._body.downloaded, true);
      // Clean up
      fs.rmdirSync(tmpDir);
    });

    it('returns 200 with downloaded=false when folder does not exist', () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-2', title: 'Missing Anime', folderPath: '/nonexistent/path' }],
        },
        thumbnailQueue: { enqueue: () => {} },
      });
      const req = mockReq({ url: '/api/anime/anime-2' });
      const res = mockRes();
      lib.handleGetAnimeDetail(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.downloaded, false);
    });
  });
});
