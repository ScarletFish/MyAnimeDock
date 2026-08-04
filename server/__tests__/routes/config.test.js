// server/__tests__/routes/config.test.js
// Route handler integration tests for config.js
// Tests that handlers respond with correct status codes and body shapes.
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const config = require('../../dist/routes/config');

describe('config route handlers', () => {
  describe('handleGetConfig', () => {
    it('returns 200 with dirValid=false and firstRun=true when no mediaDir and empty library', () => {
      const state = mockState({
        config: { mediaDir: '' },
        data: { library: [] },
      });
      const req = mockReq({ url: '/api/config' });
      const res = mockRes();
      config.handleGetConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.dirValid, false);
      assert.strictEqual(res._body.firstRun, true);
      assert.ok(res._body.autoImport);
      assert.strictEqual(res._body.autoImport.count, 0);
      assert.strictEqual(res._body.autoImport.message, '');
    });

    it('returns 200 with firstRun=false when library has items', () => {
      const state = mockState({
        config: { mediaDir: '' },
        data: { library: [{ id: 'anime-1', title: 'Test' }] },
      });
      const req = mockReq({ url: '/api/config' });
      const res = mockRes();
      config.handleGetConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.firstRun, false);
    });

    it('returns 200 with all config fields merged', () => {
      const state = mockState({
        config: {
          mediaDir: '',
          mpvPath: '/custom/mpv',
          theme: 'dark',
          themeMode: 'light',
          autoMarkWatched: false,
          uiScale: 1.5,
        },
        data: { library: [] },
      });
      const req = mockReq({ url: '/api/config' });
      const res = mockRes();
      config.handleGetConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.mpvPath, '/custom/mpv');
      assert.strictEqual(res._body.theme, 'dark');
      assert.strictEqual(res._body.themeMode, 'light');
      assert.strictEqual(res._body.autoMarkWatched, false);
      assert.strictEqual(res._body.uiScale, 1.5);
    });
  });

  describe('handleGetNotifications', () => {
    it('returns 200 with empty notifications array when none pending', () => {
      const state = mockState({
        pendingNotifications: [],
      });
      const req = mockReq({ url: '/api/notifications' });
      const res = mockRes();
      config.handleGetNotifications(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.notifications, []);
    });

    it('returns 200 with notifications and clears them', () => {
      const notifications = [
        { id: '1', type: 'info', message: 'Test 1' },
        { id: '2', type: 'error', message: 'Test 2' },
      ];
      const state = mockState({
        pendingNotifications: [...notifications],
      });
      const req = mockReq({ url: '/api/notifications' });
      const res = mockRes();
      config.handleGetNotifications(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.notifications, notifications);
      // Verify array was cleared
      assert.strictEqual(state.pendingNotifications.length, 0);
    });
  });

  describe('handleHealth', () => {
    it('returns 200 with ready:true and correct library count', () => {
      const state = mockState({
        data: { library: [{ id: '1' }, { id: '2' }, { id: '3' }] },
        startupTime: Date.now() - 10000,
      });
      const req = mockReq({ url: '/api/health' });
      const res = mockRes();
      config.handleHealth(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.ready, true);
      assert.strictEqual(res._body.library, 3);
    });

    it('returns 200 with correct uptime calculation', () => {
      const startupTime = Date.now() - 5000;
      const state = mockState({
        data: { library: [] },
        startupTime,
      });
      const req = mockReq({ url: '/api/health' });
      const res = mockRes();
      config.handleHealth(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.uptime >= 4900 && res._body.uptime <= 5100);
    });

    it('returns 200 with library:0 when data is missing', () => {
      const state = mockState({
        data: undefined,
        startupTime: Date.now(),
      });
      const req = mockReq({ url: '/api/health' });
      const res = mockRes();
      config.handleHealth(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.library, 0);
    });
  });

  describe('handlePostConfig', () => {
    it('returns 200 and updates mpvPath', async () => {
      const state = mockState({
        config: { mpvPath: 'mpv' },
        bangumiPersonal: {},
      });
      const req = mockReq({
        url: '/api/config',
        method: 'POST',
        body: JSON.stringify({ mpvPath: '/custom/mpv' }),
      });
      const res = mockRes();
      await config.handlePostConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.strictEqual(res._body.mpvPath, '/custom/mpv');
    });

    it('returns 200 and clamps uiScale to [0.5, 2]', async () => {
      const state = mockState({
        config: { uiScale: 1.0 },
        bangumiPersonal: {},
      });
      // Test upper clamp
      let req = mockReq({
        url: '/api/config',
        method: 'POST',
        body: JSON.stringify({ uiScale: 5 }),
      });
      let res = mockRes();
      await config.handlePostConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.uiScale, 2);

      // Test lower clamp
      req = mockReq({
        url: '/api/config',
        method: 'POST',
        body: JSON.stringify({ uiScale: 0.1 }),
      });
      res = mockRes();
      await config.handlePostConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.uiScale, 0.5);

      // Test valid value
      req = mockReq({
        url: '/api/config',
        method: 'POST',
        body: JSON.stringify({ uiScale: 1.75 }),
      });
      res = mockRes();
      await config.handlePostConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.uiScale, 1.75);
    });

    it('returns 400 for invalid JSON body', async () => {
      const state = mockState({
        config: {},
        bangumiPersonal: {},
      });
      const req = mockReq({
        url: '/api/config',
        method: 'POST',
        body: 'not valid json',
      });
      const res = mockRes();
      await config.handlePostConfig(req, res, state);
      assert.strictEqual(res._status, 400);
      assert.ok(res._body.error);
      assert.strictEqual(res._body.error, 'Invalid request body');
    });

    it('returns 200 and updates theme and themeMode', async () => {
      const state = mockState({
        config: { theme: 'default', themeMode: 'dark' },
        bangumiPersonal: {},
      });
      const req = mockReq({
        url: '/api/config',
        method: 'POST',
        body: JSON.stringify({ theme: 'custom', themeMode: 'light' }),
      });
      const res = mockRes();
      await config.handlePostConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.strictEqual(res._body.theme, 'custom');
      assert.strictEqual(res._body.themeMode, 'light');
    });

    it('returns 200 and updates autoMarkWatched and reduceMotion', async () => {
      const state = mockState({
        config: { autoMarkWatched: true, reduceMotion: false },
        bangumiPersonal: {},
      });
      const req = mockReq({
        url: '/api/config',
        method: 'POST',
        body: JSON.stringify({ autoMarkWatched: false, reduceMotion: true }),
      });
      const res = mockRes();
      await config.handlePostConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.strictEqual(res._body.autoMarkWatched, false);
      assert.strictEqual(res._body.reduceMotion, true);
    });

    it('returns 200 and updates bangumi credentials', async () => {
      const state = mockState({
        config: { bangumiClientId: '', bangumiClientSecret: '' },
        bangumiPersonal: { clientId: '', clientSecret: '' },
      });
      const req = mockReq({
        url: '/api/config',
        method: 'POST',
        body: JSON.stringify({
          bangumiClientId: 'test-client-id',
          bangumiClientSecret: 'test-client-secret',
        }),
      });
      const res = mockRes();
      await config.handlePostConfig(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.strictEqual(res._body.bangumiClientId, 'test-client-id');
      assert.strictEqual(res._body.bangumiClientSecret, 'test-client-secret');
      assert.strictEqual(state.bangumiPersonal.clientId, 'test-client-id');
      assert.strictEqual(state.bangumiPersonal.clientSecret, 'test-client-secret');
    });
  });
});