// server/__tests__/routes/db-manager.test.js
// Route handler tests for db-manager.js
// Tests non-destructive handlers that use mock db + state.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const dbmgr = require('../../routes/db-manager');

describe('db-manager route handlers', () => {
  describe('handleDbInfo', () => {
    it('returns 200 with correct structure', () => {
      const state = mockState({
        data: {
          library: [{ id: '1', episodes: [{ number: 1 }] }],
          playSessions: [{ id: 's1' }, { id: 's2' }],
          myList: [{ id: 'm1' }],
        },
      });
      const req = mockReq({ url: '/api/db/info' });
      const res = mockRes();
      dbmgr.handleDbInfo(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(typeof res._body.dbPath === 'string');
      assert.ok(typeof res._body.dbExists === 'boolean');
      assert.ok(typeof res._body.dataDir === 'string');
      assert.ok(res._body.cache);
      assert.ok(res._body.cache.thumbs);
      assert.ok(res._body.cache.covers);
      assert.ok(res._body.cache.banners);
      assert.strictEqual(res._body.counts.anime, 1);
      assert.strictEqual(res._body.counts.episodes, 1);
      assert.strictEqual(res._body.counts.playSessions, 2);
      assert.strictEqual(res._body.counts.myList, 1);
    });

    it('returns 200 with zeros for empty data', () => {
      const state = mockState({ data: { library: [], playSessions: [], myList: [] } });
      const req = mockReq({ url: '/api/db/info' });
      const res = mockRes();
      dbmgr.handleDbInfo(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.counts.anime, 0);
      assert.strictEqual(res._body.counts.episodes, 0);
      assert.strictEqual(res._body.counts.playSessions, 0);
      assert.strictEqual(res._body.counts.myList, 0);
    });
  });

  describe('handleDbClearSessions', () => {
    it('returns 200 and calls deleteMany + loadData', async () => {
      let deleteManyCalled = false;
      let loadDataCalled = false;
      const mockPrisma = {
        playSession: {
          deleteMany: async () => { deleteManyCalled = true; },
        },
      };
      const state = mockState({
        data: { playSessions: [{ id: 'old' }] },
        db: {
          getPrisma: () => mockPrisma,
          loadData: async () => {
            loadDataCalled = true;
            return { playSessions: [] };
          },
        },
      });
      const req = mockReq({ url: '/api/db/clear-sessions', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbClearSessions(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(deleteManyCalled, 'deleteMany should be called');
      assert.ok(loadDataCalled, 'loadData should be called');
      assert.deepStrictEqual(state.data.playSessions, []);
    });

    it('returns 500 when db throws', async () => {
      const mockPrisma = {
        playSession: {
          deleteMany: async () => { throw new Error('DB error'); },
        },
      };
      const state = mockState({
        db: {
          getPrisma: () => mockPrisma,
        },
      });
      const req = mockReq({ url: '/api/db/clear-sessions', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbClearSessions(req, res, state);
      assert.strictEqual(res._status, 500);
    });
  });

  describe('handleDbVacuum', () => {
    it('returns 200 and calls VACUUM', async () => {
      let vacuumCalled = false;
      const mockPrisma = {
        $executeRawUnsafe: async (sql) => {
          if (sql === 'VACUUM') vacuumCalled = true;
        },
      };
      const state = mockState({
        db: {
          getPrisma: () => mockPrisma,
        },
      });
      const req = mockReq({ url: '/api/db/vacuum', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbVacuum(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(vacuumCalled, 'VACUUM should be called');
    });

    it('returns 500 when VACUUM fails', async () => {
      const mockPrisma = {
        $executeRawUnsafe: async () => { throw new Error('VACUUM failed'); },
      };
      const state = mockState({
        db: {
          getPrisma: () => mockPrisma,
        },
      });
      const req = mockReq({ url: '/api/db/vacuum', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbVacuum(req, res, state);
      assert.strictEqual(res._status, 500);
    });
  });

// handleDbBackup streams binary via fs.createReadStream.pipe(res) — skipped
// handleDbBackupAll reads real DB/config/scanned-tree files — skipped (destructive)
// handleDbRestore writes to real DB file — only test validation path

  describe('handleDbRestore', () => {
    it('returns 500 for invalid base64 data (SQLite header validation)', async () => {
      const state = mockState({
        db: { shutdown: async () => {} },
      });
      const req = mockReq({
        url: '/api/db/restore', method: 'POST',
        body: JSON.stringify({ file: Buffer.from('not-a-sqlite-file').toString('base64') }),
      });
      const res = mockRes();
      await dbmgr.handleDbRestore(req, res, state);
      // Should fail with 400 because 'not-a-sqlite-file' decoded starts with 'n' not 'SQLite format 3'
      assert.strictEqual(res._status, 400);
    });

    it('returns 400 when file field is missing', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/db/restore', method: 'POST', body: JSON.stringify({}) });
      const res = mockRes();
      await dbmgr.handleDbRestore(req, res, state);
      assert.strictEqual(res._status, 400);
    });
  });

// handleDbBackup streams binary via fs.createReadStream.pipe(res) — skipped

  describe('handleDbClearCache', () => {
    it('returns 200 with valid structure', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/db/clear-cache', method: 'POST', body: JSON.stringify({ target: 'thumbs' }) });
      const res = mockRes();
      await dbmgr.handleDbClearCache(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.ok(res._body.results);
    });

    it('returns 200 with all targets when no target specified', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/db/clear-cache', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbClearCache(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.results.thumbs);
      assert.ok(res._body.results.covers);
      assert.ok(res._body.results.banners);
    });
  });

  describe('handleDbReset', () => {
    it('returns 200 and clears library, myList, playSessions', async () => {
      const mockPrisma = {
        playSession: { deleteMany: async () => {} },
        episode: { deleteMany: async () => {} },
        anime: { deleteMany: async () => {} },
        myList: { deleteMany: async () => {} },
      };
      const state = mockState({
        data: { library: [{ id: '1' }], myList: [{ id: 'm1' }], playSessions: [{ id: 's1' }] },
        db: { getPrisma: () => mockPrisma },
      });
      const req = mockReq({ url: '/api/db/reset', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbReset(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.library.length, 0);
      assert.strictEqual(state.data.myList.length, 0);
      assert.strictEqual(state.data.playSessions.length, 0);
    });

    it('returns 500 when db throws', async () => {
      const mockPrisma = {
        playSession: { deleteMany: async () => { throw new Error('DB error'); } },
      };
      const state = mockState({
        data: { library: [], myList: [], playSessions: [] },
        db: { getPrisma: () => mockPrisma },
      });
      const req = mockReq({ url: '/api/db/reset', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbReset(req, res, state);
      assert.strictEqual(res._status, 500);
    });
  });
});
