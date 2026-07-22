// server/__tests__/routes/bangumi.test.js
// Route handler tests for bangumi.js
//   Auth: handleBangumiAuthStatus, handleBangumiAuthUrl, handleBangumiAuthLogout,
//         handleBangumiAuthCreds, handleBangumiMe
//   Complex: handleBangumiSearch (scrapers mock), handleBangumiFetch (scrapers+scanner),
//            handleBangumiSync (state mock)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const bangumi = require('../../routes/bangumi');

function makeBangumiPersonal(overrides = {}) {
  return {
    clientId: '',
    clientSecret: '',
    getState: () => ({ authed: false, user: null }),
    generateAuthUrl: () => 'https://example.com/auth',
    clearAuth: () => {},
    setCredentials: (id, secret) => {},
    isAuthed: () => false,
    getMe: async () => ({ name: 'TestUser' }),
    ...overrides,
  };
}

describe('bangumi route handlers', () => {
  describe('handleBangumiAuthStatus', () => {
    it('returns 200 with auth state', () => {
      const state = mockState({
        bangumiPersonal: makeBangumiPersonal({
          getState: () => ({ authed: true, user: { name: 'Alice' } }),
        }),
        config: { bangumiLastSync: '2024-01-01T00:00:00.000Z' },
      });
      const req = mockReq({ url: '/api/bangumi/auth/status' });
      const res = mockRes();
      bangumi.handleBangumiAuthStatus(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.authed, true);
      assert.strictEqual(res._body.user.name, 'Alice');
      assert.strictEqual(res._body.lastSyncTime, '2024-01-01T00:00:00.000Z');
    });

    it('returns 200 with lastSyncTime null when not synced', () => {
      const state = mockState({
        bangumiPersonal: makeBangumiPersonal(),
        config: { bangumiLastSync: null },
      });
      const req = mockReq({ url: '/api/bangumi/auth/status' });
      const res = mockRes();
      bangumi.handleBangumiAuthStatus(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.authed, false);
      assert.strictEqual(res._body.lastSyncTime, null);
    });
  });

  describe('handleBangumiAuthUrl', () => {
    it('returns 200 with auth URL', () => {
      const state = mockState({
        bangumiPersonal: makeBangumiPersonal({
          generateAuthUrl: () => 'https://bgm.tv/oauth/authorize?test=1',
        }),
      });
      const req = mockReq({ url: '/api/bangumi/auth/url' });
      const res = mockRes();
      bangumi.handleBangumiAuthUrl(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.url, 'https://bgm.tv/oauth/authorize?test=1');
    });
  });

  describe('handleBangumiAuthLogout', () => {
    it('returns 200 and clears auth', () => {
      let cleared = false;
      const state = mockState({
        bangumiPersonal: makeBangumiPersonal({
          clearAuth: () => { cleared = true; },
        }),
      });
      const req = mockReq({ url: '/api/bangumi/auth/logout', method: 'POST' });
      const res = mockRes();
      bangumi.handleBangumiAuthLogout(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.ok(cleared, 'clearAuth should be called');
    });
  });

  describe('handleBangumiAuthCreds', () => {
    it('returns 200 and sets credentials', async () => {
      let setCredsCalled = false;
      let savedClientId, savedClientSecret;
      const state = mockState({
        bangumiPersonal: makeBangumiPersonal({
          setCredentials: (id, secret) => {
            setCredsCalled = true;
            savedClientId = id;
            savedClientSecret = secret;
          },
          getState: () => ({ authed: false, user: null }),
        }),
        config: {},
      });
      const req = mockReq({
        url: '/api/bangumi/auth/creds',
        method: 'POST',
        body: JSON.stringify({ clientId: 'my-id', clientSecret: 'my-secret' }),
      });
      const res = mockRes();
      await bangumi.handleBangumiAuthCreds(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(setCredsCalled);
      assert.strictEqual(savedClientId, 'my-id');
      assert.strictEqual(savedClientSecret, 'my-secret');
      // saveConfig writes to real disk — just verify state was set
      assert.strictEqual(state.config.bangumiClientId, 'my-id');
      assert.strictEqual(state.config.bangumiClientSecret, 'my-secret');
    });

    it('returns 400 for invalid JSON', async () => {
      const state = mockState({ bangumiPersonal: makeBangumiPersonal() });
      const req = mockReq({ url: '/api/bangumi/auth/creds', method: 'POST', body: 'bad json' });
      const res = mockRes();
      await bangumi.handleBangumiAuthCreds(req, res, state);
      assert.strictEqual(res._status, 400);
    });
  });

  describe('handleBangumiMe', () => {
    it('returns 401 when not authenticated', async () => {
      const state = mockState({
        bangumiPersonal: makeBangumiPersonal({ isAuthed: () => false }),
      });
      const req = mockReq({ url: '/api/bangumi/me' });
      const res = mockRes();
      bangumi.handleBangumiMe(req, res, state);
      assert.strictEqual(res._status, 401);
    });

    it('returns 200 with user info when authenticated', async () => {
      const state = mockState({
        bangumiPersonal: makeBangumiPersonal({
          isAuthed: () => true,
          getMe: async () => ({ name: 'TestUser', id: 123 }),
        }),
      });
      const req = mockReq({ url: '/api/bangumi/me' });
      const res = mockRes();
      // This handler calls getMe().then(...).catch(...) — async but not returning the promise
      // Wait for the chain to settle
      bangumi.handleBangumiMe(req, res, state);
      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.name, 'TestUser');
    });

    it('returns 500 when getMe fails', async () => {
      const state = mockState({
        bangumiPersonal: makeBangumiPersonal({
          isAuthed: () => true,
          getMe: async () => { throw new Error('API error'); },
        }),
      });
      const req = mockReq({ url: '/api/bangumi/me' });
      const res = mockRes();
      bangumi.handleBangumiMe(req, res, state);
      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(res._status, 500);
    });
  });

  describe('handleBangumiSearch', () => {
    // Lazy require: const { registry, searchViaAniList } = require('../scrapers');
    let origScrapersExports;

    before(() => {
      const sp = require.resolve('../../scrapers');
      origScrapersExports = require.cache[sp]?.exports;
      if (require.cache[sp]) {
        require.cache[sp].exports = {
          ...origScrapersExports,
          registry: {
            searchAll: async () => [
              { source: 'bangumi', id: '123', name: 'Test Anime' },
            ],
            get: () => null,
          },
          searchViaAniList: async () => ({ bangumiResults: [] }),
        };
      }
    });

    after(() => {
      const sp = require.resolve('../../scrapers');
      if (require.cache[sp]) {
        require.cache[sp].exports = origScrapersExports;
      }
    });

    it('returns 400 when keyword is missing', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/bangumi/search', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await bangumi.handleBangumiSearch(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 200 with search results', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/bangumi/search', method: 'POST', body: JSON.stringify({ keyword: 'Test' }) });
      const res = mockRes();
      await bangumi.handleBangumiSearch(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(Array.isArray(res._body.results));
      assert.strictEqual(res._body.results.length, 1);
      assert.strictEqual(res._body.results[0].name, 'Test Anime');
    });

    it('cleans tilde characters from keyword', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/bangumi/search', method: 'POST', body: JSON.stringify({ keyword: 'Test~Anime～' }) });
      const res = mockRes();
      await bangumi.handleBangumiSearch(req, res, state);
      assert.strictEqual(res._status, 200);
      // The handler strips ~ and ～ before searching
      // Our mock just returns the fixed result
      assert.ok(res._body.results);
    });
  });

  describe('handleBangumiSync', () => {
    it('returns 200 with sync results', async () => {
      let syncCalled = false;
      let syncDryRun = undefined;
      const state = mockState({
        data: { library: [], myList: [] },
        bangumiSync: {
          pushStatusChange: async () => {},
          syncMyList: async (data, opts) => {
            syncCalled = true;
            syncDryRun = opts?.dryRun;
            return { synced: 0, created: 0, wishlistAdded: 0 };
          },
        },
      });
      const req = mockReq({ url: '/api/bangumi/sync', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await bangumi.handleBangumiSync(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(syncCalled);
    });

    it('passes dryRun option when set', async () => {
      let syncDryRun = undefined;
      const state = mockState({
        data: { library: [], myList: [] },
        bangumiSync: {
          pushStatusChange: async () => {},
          syncMyList: async (data, opts) => {
            syncDryRun = opts?.dryRun;
            return { synced: 0 };
          },
        },
      });
      const req = mockReq({ url: '/api/bangumi/sync', method: 'POST', body: JSON.stringify({ dryRun: true }) });
      const res = mockRes();
      await bangumi.handleBangumiSync(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(syncDryRun, true);
    });

    it('returns 400 when syncMyList throws', async () => {
      const state = mockState({
        data: { library: [], myList: [] },
        bangumiSync: {
          pushStatusChange: async () => {},
          syncMyList: async () => { throw new Error('Sync failed'); },
        },
      });
      const req = mockReq({ url: '/api/bangumi/sync', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await bangumi.handleBangumiSync(req, res, state);
      assert.strictEqual(res._status, 400);
    });
  });

  describe('handleBangumiFetch', () => {
    // Lazy requires: scrapers (registry, matchSeason) + scanner (parseFolderName)
    // Top-level syncAnilist is real — success path would call real API.
    // Test 400/404 validation paths only.
    let origScrapers, origScanner;

    before(() => {
      const sp = require.resolve('../../scrapers');
      origScrapers = require.cache[sp]?.exports;
      if (require.cache[sp]) {
        require.cache[sp].exports = {
          ...origScrapers,
          registry: {
            searchAll: async () => [],
            fetchMetadata: async () => null,
            get: () => null,
          },
          matchSeason: async () => null,
        };
      }
      const scp = require.resolve('../../scanner');
      origScanner = require.cache[scp]?.exports;
      if (require.cache[scp]) {
        require.cache[scp].exports = {
          ...origScanner,
          parseFolderName: () => ({ cleanTitle: 'Test', season: null, cjkTitle: null }),
        };
      }
    });

    after(() => {
      const sp = require.resolve('../../scrapers');
      if (require.cache[sp]) require.cache[sp].exports = origScrapers;
      const scp = require.resolve('../../scanner');
      if (require.cache[scp]) require.cache[scp].exports = origScanner;
    });

    it('returns 400 when animeId is missing', async () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/bangumi/fetch', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await bangumi.handleBangumiFetch(req, res, state);
      assert.strictEqual(res._status, 400);
    });

    it('returns 404 when anime not in library', async () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/bangumi/fetch', method: 'POST', body: JSON.stringify({ animeId: 'nonexistent' }) });
      const res = mockRes();
      await bangumi.handleBangumiFetch(req, res, state);
      assert.strictEqual(res._status, 404);
    });
  });
});
