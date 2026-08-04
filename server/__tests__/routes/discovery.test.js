// server/__tests__/routes/discovery.test.js
// Route handler tests for discovery.js
//   Simple: handleDiscoveryUnlink, handleDiscoveryExclude, handleDiscoveryInclude
//   Complex: handleBrowse (no lazy require), handleImport (lazy require scanner)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const disc = require('../../dist/routes/discovery');

describe('discovery route handlers', () => {
  describe('handleDiscoveryUnlink', () => {
    it('returns 400 when path is missing', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/discovery/unlink', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await disc.handleDiscoveryUnlink(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 404 when anime not in library', async () => {
      const state = mockState({
        data: { library: [], scannedTree: [] },
      });
      const req = mockReq({ url: '/api/discovery/unlink', method: 'POST', body: JSON.stringify({ path: '/nonexistent' }) });
      const res = mockRes();
      await disc.handleDiscoveryUnlink(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 200 and removes from library and myList', async () => {
      let savedLib = false, savedMyList = false;
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', folderPath: '/media/anime1' }],
          myList: [{ id: 'm1', animeId: 'anime-1' }],
          scannedTree: [{ path: '/media/anime1', alreadyImported: true }],
        },
        db: {
          saveLibrary: async () => { savedLib = true; },
          saveMyList: async () => { savedMyList = true; },
        },
      });
      const req = mockReq({ url: '/api/discovery/unlink', method: 'POST', body: JSON.stringify({ path: '/media/anime1' }) });
      const res = mockRes();
      await disc.handleDiscoveryUnlink(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.library.length, 0);
      assert.strictEqual(state.data.myList.length, 0);
      assert.strictEqual(state.data.scannedTree[0].alreadyImported, false);
      assert.ok(savedLib);
      assert.ok(savedMyList);
    });
  });

  describe('handleDiscoveryExclude', () => {
    it('returns 400 when path is missing', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/discovery/exclude', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await disc.handleDiscoveryExclude(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 404 when node not in scanned tree', async () => {
      const state = mockState({ data: { scannedTree: [] } });
      const req = mockReq({ url: '/api/discovery/exclude', method: 'POST', body: JSON.stringify({ path: '/missing' }) });
      const res = mockRes();
      await disc.handleDiscoveryExclude(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 200 and sets excluded=true', async () => {
      const state = mockState({
        data: { scannedTree: [{ path: '/media/anime1', excluded: false }] },
      });
      const req = mockReq({ url: '/api/discovery/exclude', method: 'POST', body: JSON.stringify({ path: '/media/anime1' }) });
      const res = mockRes();
      await disc.handleDiscoveryExclude(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.scannedTree[0].excluded, true);
    });
  });

  describe('handleDiscoveryInclude', () => {
    it('returns 400 when path is missing', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/discovery/include', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await disc.handleDiscoveryInclude(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 404 when node not in scanned tree', async () => {
      const state = mockState({ data: { scannedTree: [] } });
      const req = mockReq({ url: '/api/discovery/include', method: 'POST', body: JSON.stringify({ path: '/missing' }) });
      const res = mockRes();
      await disc.handleDiscoveryInclude(req, res, state);
      assert.strictEqual(res._status, 404);
    });

    it('returns 200 and sets excluded=false', async () => {
      const state = mockState({
        data: { scannedTree: [{ path: '/media/anime1', excluded: true }] },
      });
      const req = mockReq({ url: '/api/discovery/include', method: 'POST', body: JSON.stringify({ path: '/media/anime1' }) });
      const res = mockRes();
      await disc.handleDiscoveryInclude(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.scannedTree[0].excluded, false);
    });
  });

  describe('handleBrowse', () => {
    it('returns empty tree when mediaDir is not set', async () => {
      const state = mockState({ config: { mediaDir: '' } });
      const req = mockReq({ url: '/api/discovery' });
      const res = mockRes();
      await disc.handleBrowse(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.tree, []);
      assert.strictEqual(res._body.mediaDir, '');
    });

    it('marks alreadyImported for items in library', async () => {
      const state = mockState({
        config: { mediaDir: '/media' },
        data: {
          scannedTree: [
            { type: 'leaf', path: '/media/anime1', name: 'anime1' },
            { type: 'leaf', path: '/media/anime2', name: 'anime2' },
          ],
          library: [{ folderPath: '/media/anime1' }],
        },
      });
      const req = mockReq({ url: '/api/discovery' });
      const res = mockRes();
      await disc.handleBrowse(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.tree[0].alreadyImported, true);
      assert.strictEqual(res._body.tree[1].alreadyImported, false);
    });

    it('migrates old branch/leaf tree format to flat', async () => {
      const state = mockState({
        config: { mediaDir: '/media' },
        data: {
          scannedTree: [
            { type: 'branch', children: [
              { type: 'leaf', path: '/media/parent/child', name: 'child' },
            ]},
          ],
          library: [],
        },
      });
      const req = mockReq({ url: '/api/discovery' });
      const res = mockRes();
      await disc.handleBrowse(req, res, state);
      assert.strictEqual(res._status, 200);
      // After migration, tree should be flat
      assert.strictEqual(res._body.tree.length, 1);
      assert.strictEqual(res._body.tree[0].path, '/media/parent/child');
      // Verify in-memory data was also migrated
      assert.strictEqual(state.data.scannedTree.length, 1);
      assert.strictEqual(state.data.scannedTree[0].type, 'leaf');
    });

    it('filters excluded items by default', async () => {
      const state = mockState({
        config: { mediaDir: '/media' },
        data: {
          scannedTree: [
            { type: 'leaf', path: '/media/include', name: 'include', excluded: false },
            { type: 'leaf', path: '/media/exclude', name: 'exclude', excluded: true },
          ],
          library: [],
        },
      });
      const req = mockReq({ url: '/api/discovery' });
      const res = mockRes();
      await disc.handleBrowse(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.tree.length, 1);
      assert.strictEqual(res._body.tree[0].path, '/media/include');
    });

    it('shows excluded items when showExcluded=true', async () => {
      const state = mockState({
        config: { mediaDir: '/media' },
        data: {
          scannedTree: [
            { type: 'leaf', path: '/media/excluded', name: 'excluded', excluded: true },
          ],
          library: [],
        },
      });
      const req = mockReq({ url: '/api/discovery?showExcluded=true' });
      const res = mockRes();
      await disc.handleBrowse(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.tree.length, 1);
    });

    it('handles empty scanned tree gracefully', async () => {
      const state = mockState({
        config: { mediaDir: '/media' },
        data: { scannedTree: null, library: [] },
      });
      const req = mockReq({ url: '/api/discovery' });
      const res = mockRes();
      await disc.handleBrowse(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.tree, []);
    });

    it('initializes excluded and bangumiMatched flags when missing', async () => {
      const state = mockState({
        config: { mediaDir: '/media' },
        data: {
          scannedTree: [{ type: 'leaf', path: '/media/anime1', name: 'anime1' }],
          library: [],
        },
      });
      const req = mockReq({ url: '/api/discovery' });
      const res = mockRes();
      await disc.handleBrowse(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.tree[0].excluded, false);
      assert.strictEqual(res._body.tree[0].bangumiMatched, false);
    });

    it('sets parsedSeason to null when it equals 1', async () => {
      const state = mockState({
        config: { mediaDir: '/media' },
        data: {
          scannedTree: [{ type: 'leaf', path: '/media/anime1', name: 'anime1', parsedSeason: 1 }],
          library: [],
        },
      });
      const req = mockReq({ url: '/api/discovery' });
      const res = mockRes();
      await disc.handleBrowse(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.tree[0].parsedSeason, null);
    });
  });

  describe('handleImport', () => {
    // handleImport lazy-requires: const { findVideos, isExtraVideo } = require('../scanner');
    // We need to mock scanner module in require.cache before calling the handler.
    let origScanner;

    before(() => {
      const scannerPath = require.resolve('../../scanner');
      origScanner = require.cache[scannerPath];
      require.cache[scannerPath] = {
        id: scannerPath, filename: scannerPath, loaded: true,
        exports: {
          findVideos: async (folderPath) => [
            { path: folderPath + '/ep1.mp4', name: 'ep1.mp4', size: 100 },
            { path: folderPath + '/ep2.mp4', name: 'ep2.mp4', size: 200 },
          ],
          isExtraVideo: () => false,
        },
      };
    });

    after(() => {
      const scannerPath = require.resolve('../../scanner');
      require.cache[scannerPath] = origScanner;
    });

    it('returns 400 when items is missing', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/discovery/import', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await disc.handleImport(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 400 when items is empty', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/discovery/import', method: 'POST', body: JSON.stringify({ items: [] }) });
      const res = mockRes();
      await disc.handleImport(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('imports new anime into library and myList', async () => {
      let savedLib = false, savedMyList = false, savedTree = false;
      const state = mockState({
        data: { library: [], myList: [], scannedTree: [] },
        db: {
          saveLibrary: async () => { savedLib = true; },
          saveMyList: async () => { savedMyList = true; },
        },
      });
      const req = mockReq({
        url: '/api/discovery/import',
        method: 'POST',
        body: JSON.stringify({
          items: [{ folderPath: '/media/anime1', folderName: 'Anime1', parsedTitle: 'Anime One', parsedSeason: null }],
        }),
      });
      const res = mockRes();
      await disc.handleImport(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.strictEqual(res._body.imported.length, 1);
      assert.strictEqual(state.data.library.length, 1);
      assert.strictEqual(state.data.library[0].title, 'Anime One');
      assert.strictEqual(state.data.myList.length, 1);
      assert.strictEqual(state.data.myList[0].status, 'wish');
      assert.ok(savedLib);
      assert.ok(savedMyList);
    });

    it('imports with season in id when parsedSeason is set', async () => {
      const state = mockState({
        data: { library: [], myList: [], scannedTree: [] },
        db: {
          saveLibrary: async () => {},
          saveMyList: async () => {},
        },
      });
      const req = mockReq({
        url: '/api/discovery/import',
        method: 'POST',
        body: JSON.stringify({
          items: [{ folderPath: '/media/anime2', folderName: 'Anime2 (S2)', parsedTitle: 'Anime Two', parsedSeason: 2 }],
        }),
      });
      const res = mockRes();
      await disc.handleImport(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.library[0].id, 'Anime Two-Season 2');
      assert.strictEqual(state.data.library[0].season, 2);
    });

    it('re-imports previously downloaded=false item', async () => {
      let savedLib = false;
      const state = mockState({
        data: {
          library: [{ id: 'existing', folderPath: '/media/existing', title: 'Existing', downloaded: false }],
          myList: [],
          scannedTree: [],
        },
        db: {
          saveLibrary: async () => { savedLib = true; },
          saveMyList: async () => {},
        },
      });
      const req = mockReq({
        url: '/api/discovery/import',
        method: 'POST',
        body: JSON.stringify({
          items: [{ folderPath: '/media/existing', folderName: 'Existing', parsedTitle: 'Existing', parsedSeason: null }],
        }),
      });
      const res = mockRes();
      await disc.handleImport(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.library[0].downloaded, true);
      assert.ok(state.data.library[0].episodes);
      assert.ok(savedLib);
    });

    it('skips already-imported items with downloaded=true', async () => {
      const state = mockState({
        data: {
          library: [{ id: 'existing', folderPath: '/media/existing', title: 'Existing', downloaded: true }],
          myList: [],
          scannedTree: [],
        },
        db: {
          saveLibrary: async () => {},
          saveMyList: async () => {},
        },
      });
      const req = mockReq({
        url: '/api/discovery/import',
        method: 'POST',
        body: JSON.stringify({
          items: [{ folderPath: '/media/existing', folderName: 'Existing', parsedTitle: 'Existing', parsedSeason: null }],
        }),
      });
      const res = mockRes();
      await disc.handleImport(req, res, state);
      assert.strictEqual(res._status, 200);
      // Should not add duplicate
      assert.strictEqual(state.data.library.length, 1);
    });
  });
});
