// server/__tests__/routes/db-manager.test.js
// Route handler tests for db-manager.js
// Tests non-destructive handlers that use mock db + state.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const { DATA_DIR } = require('../../lib/config');
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
    it('returns 200 and calls clearSessions + loadData', async () => {
      let clearSessionsCalled = false;
      let loadDataCalled = false;
      const state = mockState({
        data: { playSessions: [{ id: 'old' }] },
        db: {
          clearSessions: async () => { clearSessionsCalled = true; },
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
      assert.ok(clearSessionsCalled, 'clearSessions should be called');
      assert.ok(loadDataCalled, 'loadData should be called');
      assert.deepStrictEqual(state.data.playSessions, []);
    });

    it('returns 500 when db throws', async () => {
      const state = mockState({
        db: {
          clearSessions: async () => { throw new Error('DB error'); },
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
      const state = mockState({
        db: {
          vacuum: async () => { vacuumCalled = true; },
        },
      });
      const req = mockReq({ url: '/api/db/vacuum', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbVacuum(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(vacuumCalled, 'VACUUM should be called');
    });

    it('returns 500 when VACUUM fails', async () => {
      const state = mockState({
        db: {
          vacuum: async () => { throw new Error('VACUUM failed'); },
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

  describe('handleDbRestore', () => {
    it('returns 400 for invalid base64 data (SQLite header validation)', async () => {
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

    it('returns 200 for valid SQLite restore (fs monkey-patched to avoid real DB write)', async () => {
      // Compute DB_FILE path matching db-manager.js logic (dev mode = non-pkg)
      const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
      const DB_FILE = path.join(APP_ROOT, 'prisma', 'anime.db');
      const backupDir = path.join(DATA_DIR, 'backups');

      // Create a minimal buffer with valid SQLite header
      const sqliteBuf = Buffer.alloc(4096);
      sqliteBuf.write('SQLite format 3\0', 0, 16, 'utf8');
      sqliteBuf[16] = 0x10; sqliteBuf[17] = 0x00; // page size 4096 big-endian
      sqliteBuf[18] = 0x01; // write version
      sqliteBuf[19] = 0x01; // read version
      const validBase64 = sqliteBuf.toString('base64');

      // Monkey-patch fs to avoid touching the real DB file
      const origExistsSync = fs.existsSync;
      const origCopyFileSync = fs.copyFileSync;

      fs.existsSync = (p) => {
        if (p === DB_FILE) return false; // pretend no existing DB → skip auto-backup
        return origExistsSync(p);
      };
      fs.copyFileSync = (src, dest) => {
        if (dest === DB_FILE) return; // never overwrite the real DB
        return origCopyFileSync(src, dest);
      };

      let shutdownCalled = false;
      let ensureSchemaCalled = false;
      const mockLoadData = { library: [{ id: 'restored-1', title: 'Restored' }] };

      const state = mockState({
        data: { library: [] },
        db: {
          shutdown: async () => { shutdownCalled = true; },
          ensureSchema: async () => { ensureSchemaCalled = true; },
          loadData: async () => mockLoadData,
        },
      });

      const req = mockReq({
        url: '/api/db/restore',
        method: 'POST',
        body: JSON.stringify({ file: validBase64 }),
      });
      const res = mockRes();

      await dbmgr.handleDbRestore(req, res, state);

      // Restore fs
      fs.existsSync = origExistsSync;
      fs.copyFileSync = origCopyFileSync;

      // Cleanup backup dir
      try {
        const tempFile = path.join(backupDir, 'restore-temp.db');
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        if (fs.existsSync(backupDir)) {
          const remaining = fs.readdirSync(backupDir);
          if (remaining.length === 0) fs.rmdirSync(backupDir);
        }
      } catch (_) {}

      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.ok, true);
      assert.strictEqual(res._body.message, '数据库恢复成功');
      assert.ok(shutdownCalled, 'db.shutdown should be called');
      assert.ok(ensureSchemaCalled, 'db.ensureSchema should be called');
      assert.strictEqual(state.data.library.length, 1);
      assert.strictEqual(state.data.library[0].id, 'restored-1');
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

    it('nulls local-path banner refs (unlocking lazy re-download) when banners cache cleared', async () => {
      let savedIds = null;
      const state = mockState({
        data: {
          library: [
            { id: 'a1', anilistBanner: 'D:/data/banners/al-196187.jpg' },   // 本地路径 → 置 null
            { id: 'a2', anilistBanner: '__none__' },                        // 语义标记 → 不动
            { id: 'a3', anilistBanner: 'https://s4.anilist.co/banner.jpg' },// 远程 URL → 不动
            { id: 'a4', anilistBanner: null },                              // 本就无 → 不动
          ],
        },
        db: {
          saveLibrary: async (data, ids) => { savedIds = ids; },
        },
      });
      const req = mockReq({ url: '/api/db/clear-cache', method: 'POST', body: JSON.stringify({ target: 'banners' }) });
      const res = mockRes();
      await dbmgr.handleDbClearCache(req, res, state);

      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.results.banners.refsCleared, 1);
      assert.strictEqual(state.data.library[0].anilistBanner, null);
      assert.strictEqual(state.data.library[1].anilistBanner, '__none__');
      assert.strictEqual(state.data.library[2].anilistBanner, 'https://s4.anilist.co/banner.jpg');
      assert.strictEqual(state.data.library[3].anilistBanner, null);
      assert.ok(savedIds, 'saveLibrary should be called with cleared ids');
      assert.ok(savedIds.has('a1'));
    });

    it('does not null banner refs when only thumbs cleared', async () => {
      const state = mockState({
        data: {
          library: [{ id: 'a1', anilistBanner: 'D:/data/banners/al-196187.jpg' }],
        },
      });
      const req = mockReq({ url: '/api/db/clear-cache', method: 'POST', body: JSON.stringify({ target: 'thumbs' }) });
      const res = mockRes();
      await dbmgr.handleDbClearCache(req, res, state);

      assert.strictEqual(res._status, 200);
      assert.strictEqual(state.data.library[0].anilistBanner, 'D:/data/banners/al-196187.jpg');
      assert.strictEqual(res._body.results.banners, undefined);
    });
  });

  describe('handleDbReset', () => {
    it('returns 200 and clears library, myList, playSessions', async () => {
      let resetCalled = false;
      const state = mockState({
        data: { library: [{ id: '1' }], myList: [{ id: 'm1' }], playSessions: [{ id: 's1' }] },
        db: { reset: async () => { resetCalled = true; } },
      });
      const req = mockReq({ url: '/api/db/reset', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbReset(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(resetCalled, 'reset should be called');
      assert.strictEqual(state.data.library.length, 0);
      assert.strictEqual(state.data.myList.length, 0);
      assert.strictEqual(state.data.playSessions.length, 0);
    });

    it('returns 500 when db throws', async () => {
      const state = mockState({
        data: { library: [], myList: [], playSessions: [] },
        db: { reset: async () => { throw new Error('DB error'); } },
      });
      const req = mockReq({ url: '/api/db/reset', method: 'POST', body: '{}' });
      const res = mockRes();
      await dbmgr.handleDbReset(req, res, state);
      assert.strictEqual(res._status, 500);
    });
  });
});
