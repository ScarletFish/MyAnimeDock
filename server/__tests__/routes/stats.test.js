// server/__tests__/routes/stats.test.js
// Route handler tests for stats.js — 6 synchronous read-only handlers.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const stats = require('../../dist/routes/stats');

describe('stats route handlers', () => {
  describe('handleStats', () => {
    it('returns zeros for empty library', () => {
      const state = mockState({ data: { library: [], playSessions: [] } });
      const req = mockReq({ url: '/api/stats' });
      const res = mockRes();
      stats.handleStats(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.watching, 0);
      assert.strictEqual(res._body.completed, 0);
      assert.strictEqual(res._body.total, 0);
      assert.strictEqual(res._body.totalEpWatched, 0);
      assert.strictEqual(res._body.totalWatchSeconds, 0);
      assert.strictEqual(res._body.totalFileSize, 0);
      assert.strictEqual(res._body.totalFileCount, 0);
    });

    it('returns correct counts with mixed library', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', myListStatus: 'watching', downloaded: true, episodes: [{ number: 1, watched: true, fileSize: 100 }, { number: 2, watched: false, fileSize: 200 }] },
            { id: '2', myListStatus: 'completed', downloaded: true, episodes: [{ number: 1, watched: true, fileSize: 300 }] },
            { id: '3', downloaded: false, episodes: [{ number: 1 }] },
          ],
          playSessions: [{ duration: 600 }, { clockTime: 300 }],
        },
      });
      const req = mockReq({ url: '/api/stats' });
      const res = mockRes();
      stats.handleStats(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.watching, 1);
      assert.strictEqual(res._body.completed, 1);
      assert.strictEqual(res._body.total, 2);
      assert.strictEqual(res._body.totalEpWatched, 2);
      assert.strictEqual(res._body.totalFileSize, 600);
      assert.strictEqual(res._body.totalFileCount, 3);
      assert.strictEqual(res._body.totalWatchSeconds, 900);
    });

    it('handles playSessions with negative duration gracefully', () => {
      const state = mockState({
        data: {
          library: [],
          playSessions: [{ duration: -100 }, { clockTime: 50 }],
        },
      });
      const req = mockReq({ url: '/api/stats' });
      const res = mockRes();
      stats.handleStats(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.totalWatchSeconds, 50);
    });
  });

  describe('handleStatsTags', () => {
    it('returns empty tags for empty library', () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/stats/tags' });
      const res = mockRes();
      stats.handleStatsTags(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.tags, {});
    });

    it('filters out noise tags (numbers, TVA, date patterns)', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', tags: ['action', '123', 'TVA', '2024年'], platform: 'bangumi' },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/tags' });
      const res = mockRes();
      stats.handleStatsTags(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.tags, { action: 1 });
    });

    it('accumulates tag counts across multiple anime', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', tags: ['action', 'comedy'], platform: 'bangumi' },
            { id: '2', tags: ['action', 'drama'], platform: 'bangumi' },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/tags' });
      const res = mockRes();
      stats.handleStatsTags(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.tags.action, 2);
      assert.strictEqual(res._body.tags.comedy, 1);
      assert.strictEqual(res._body.tags.drama, 1);
    });

    it('handles anime without tags', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', title: 'No tags' },
            { id: '2', tags: null, platform: 'bangumi' },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/tags' });
      const res = mockRes();
      stats.handleStatsTags(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.tags, {});
    });
  });

  describe('handleStatsSeasons', () => {
    it('returns all zeros for empty library', () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/stats/seasons' });
      const res = mockRes();
      stats.handleStatsSeasons(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.seasons, { spring: 0, summer: 0, autumn: 0, winter: 0, unknown: 0 });
    });

    it('correctly distributes seasons', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', date: '2024-04-01' },  // spring
            { id: '2', date: '2024-07-15' },  // summer
            { id: '3', date: '2024-10-01' },  // autumn
            { id: '4', date: '2024-01-01' },  // winter
            { id: '5' },                       // unknown (no date)
            { id: '6', date: 'invalid' },      // unknown
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/seasons' });
      const res = mockRes();
      stats.handleStatsSeasons(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.seasons.spring, 1);
      assert.strictEqual(res._body.seasons.summer, 1);
      assert.strictEqual(res._body.seasons.autumn, 1);
      assert.strictEqual(res._body.seasons.winter, 1);
      assert.strictEqual(res._body.seasons.unknown, 2);
    });

    it('falls back to importedAt when date is missing', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', importedAt: '2024-07-01T00:00:00.000Z' },  // summer via importedAt
            { id: '2', date: '2024-01-15' },                      // winter via date
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/seasons' });
      const res = mockRes();
      stats.handleStatsSeasons(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.seasons.summer, 1);
      assert.strictEqual(res._body.seasons.winter, 1);
    });
  });

  describe('handleStatsRatings', () => {
    it('returns all zeros for empty library', () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/stats/ratings' });
      const res = mockRes();
      stats.handleStatsRatings(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.bins, [0, 0, 0, 0, 0, 0, 0]);
    });

    it('correctly bins ratings', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', rating: 1.5 },  // 0-2
            { id: '2', rating: 3.0 },  // 2-4
            { id: '3', rating: 5.5 },  // 4-6
            { id: '4', rating: 6.5 },  // 6-7
            { id: '5', rating: 7.5 },  // 7-8
            { id: '6', rating: 8.5 },  // 8-9
            { id: '7', rating: 9.5 },  // 9-10
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/ratings' });
      const res = mockRes();
      stats.handleStatsRatings(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.bins, [1, 1, 1, 1, 1, 1, 1]);
    });

    it('skips items without ratings', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', rating: 7.5 },
            { id: '2' },            // no rating
            { id: '3', rating: null },
            { id: '4', rating: NaN },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/ratings' });
      const res = mockRes();
      stats.handleStatsRatings(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.bins[4], 1); // 7-8 bin
      assert.strictEqual(res._body.bins.reduce((a, b) => a + b, 0), 1);
    });
  });

  describe('handleStatsWatchActivity', () => {
    it('returns zeros for all months when no sessions', () => {
      const state = mockState({ data: { playSessions: [] } });
      const req = mockReq({ url: '/api/stats/watch-activity' });
      const res = mockRes();
      stats.handleStatsWatchActivity(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.months.length, 6);
      for (const m of res._body.months) {
        assert.strictEqual(m.minutes, 0);
      }
    });

    it('counts session minutes within current month', () => {
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const startTime = `${thisMonth}-01T10:00:00.000Z`;
      const state = mockState({
        data: {
          playSessions: [{
            startTime, endTime: `${thisMonth}-01T11:00:00.000Z`,
            duration: 3600, clockTime: 3600,
          }],
        },
      });
      const req = mockReq({ url: '/api/stats/watch-activity' });
      const res = mockRes();
      stats.handleStatsWatchActivity(req, res, state);
      assert.strictEqual(res._status, 200);
      const thisMonthEntry = res._body.months[5];
      assert.strictEqual(thisMonthEntry.minutes, 60);
    });

    it('uses max of duration and clockTime', () => {
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const state = mockState({
        data: {
          playSessions: [{
            startTime: `${thisMonth}-01T10:00:00.000Z`,
            endTime: `${thisMonth}-01T11:00:00.000Z`,
            duration: 1800, clockTime: 3600,
          }],
        },
      });
      const req = mockReq({ url: '/api/stats/watch-activity' });
      const res = mockRes();
      stats.handleStatsWatchActivity(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.months[5].minutes, 60); // 3600s = 60min
    });
  });

  describe('handleAnimeSessions', () => {
    it('returns empty object when no matching sessions', () => {
      const state = mockState({ data: { playSessions: [] } });
      const req = mockReq({ url: '/api/anime/nonexistent-id/sessions' });
      const res = mockRes();
      stats.handleAnimeSessions(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(Object.keys(res._body).length, 90);
      for (const val of Object.values(res._body)) {
        assert.strictEqual(val, 0);
      }
    });

    it('returns correct daily minutes for matching sessions', () => {
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const state = mockState({
        data: {
          playSessions: [{
            animeId: 'anime-1',
            startTime: `${ymd}T10:00:00.000Z`,
            endTime: `${ymd}T11:00:00.000Z`,
            duration: 3600,
          }],
        },
      });
      const req = mockReq({ url: '/api/anime/anime-1/sessions' });
      const res = mockRes();
      stats.handleAnimeSessions(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body[ymd], 60);
    });

    it('filters sessions by anime ID from URL', () => {
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const state = mockState({
        data: {
            playSessions: [
                { animeId: 'other', startTime: `${ymd}T10:00:00.000Z`, endTime: `${ymd}T11:00:00.000Z`, duration: 3600 },
                { animeId: 'target', startTime: `${ymd}T12:00:00.000Z`, endTime: `${ymd}T12:30:00.000Z`, duration: 1800 },
            ],
        },
      });
      const req = mockReq({ url: '/api/anime/target/sessions' });
      const res = mockRes();
      stats.handleAnimeSessions(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body[ymd], 30);
    });
  });
});
