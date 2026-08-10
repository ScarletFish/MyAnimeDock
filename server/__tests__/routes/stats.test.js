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

    it('filters out spoiler tags (isGeneralSpoiler)', () => {
      const state = mockState({
        data: {
          library: [
            {
              id: '1',
              anilistTags: [
                { name: 'Action', rank: 90, isGeneralSpoiler: false },
                { name: 'Plot Twist', rank: 80, isGeneralSpoiler: true },
              ],
            },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/tags' });
      const res = mockRes();
      stats.handleStatsTags(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.tags, { Action: 1 });
    });

    it('accumulates tag counts across multiple anime', () => {
      const state = mockState({
        data: {
          library: [
            {
              id: '1',
              anilistTags: [
                { name: 'Action', rank: 90, isGeneralSpoiler: false },
                { name: 'Comedy', rank: 80, isGeneralSpoiler: false },
              ],
            },
            {
              id: '2',
              anilistTags: [
                { name: 'Action', rank: 85, isGeneralSpoiler: false },
                { name: 'Drama', rank: 70, isGeneralSpoiler: false },
              ],
            },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/tags' });
      const res = mockRes();
      stats.handleStatsTags(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.tags.Action, 2);
      assert.strictEqual(res._body.tags.Comedy, 1);
      assert.strictEqual(res._body.tags.Drama, 1);
    });

    it('handles anime without anilistTags', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', title: 'No tags' },
            { id: '2', anilistTags: null },
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

  describe('handleStatsTagCooccurrence', () => {
    it('returns empty tags/matrix for empty library', () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/stats/tag-cooccurrence' });
      const res = mockRes();
      stats.handleStatsTagCooccurrence(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.tags, []);
      assert.deepStrictEqual(res._body.matrix, []);
    });

    it('excludes spoiler tags and generalized categories', () => {
      const state = mockState({
        data: {
          library: [
            {
              id: '1',
              anilistTags: [
                { name: 'Action', rank: 90, isGeneralSpoiler: false },
                { name: 'Plot Twist', rank: 80, isGeneralSpoiler: true },   // spoiler → excluded
                { name: 'Female Protagonist', rank: 70, isGeneralSpoiler: false }, // Cast-Main Cast → excluded
                { name: 'Seinen', rank: 60, isGeneralSpoiler: false },       // Demographic → excluded
              ],
            },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/tag-cooccurrence' });
      const res = mockRes();
      stats.handleStatsTagCooccurrence(req, res, state);
      assert.strictEqual(res._status, 200);
      // Action 单独出现、无交叉共现 → 被过滤
      assert.deepStrictEqual(res._body.tags, []);
      assert.deepStrictEqual(res._body.matrix, []);
    });

    it('builds symmetric co-occurrence matrix with zero diagonal (no self-ribbon)', () => {
      const state = mockState({
        data: {
          library: [
            {
              id: '1',
              anilistTags: [
                { name: 'Action', rank: 90, isGeneralSpoiler: false },
                { name: 'Comedy', rank: 80, isGeneralSpoiler: false },
              ],
            },
            {
              id: '2',
              anilistTags: [
                { name: 'Action', rank: 85, isGeneralSpoiler: false },
                { name: 'Drama', rank: 70, isGeneralSpoiler: false },
              ],
            },
            {
              id: '3',
              anilistTags: [
                { name: 'Comedy', rank: 75, isGeneralSpoiler: false },
                { name: 'Drama', rank: 65, isGeneralSpoiler: false },
              ],
            },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/tag-cooccurrence' });
      const res = mockRes();
      stats.handleStatsTagCooccurrence(req, res, state);
      assert.strictEqual(res._status, 200);
      const { tags, matrix } = res._body;
      assert.deepStrictEqual(tags, ['Action', 'Comedy', 'Drama']);
      // Action×Comedy=1, Action×Drama=1, Comedy×Drama=1
      assert.strictEqual(matrix[0][1], 1);
      assert.strictEqual(matrix[1][0], 1);
      assert.strictEqual(matrix[0][2], 1);
      assert.strictEqual(matrix[2][0], 1);
      assert.strictEqual(matrix[1][2], 1);
      assert.strictEqual(matrix[2][1], 1);
      // 对角线为 0，不产生 self-ribbon
      assert.strictEqual(matrix[0][0], 0);
      assert.strictEqual(matrix[1][1], 0);
      assert.strictEqual(matrix[2][2], 0);
    });

    it('caps at CHORD_MAX_TAGS (12) by frequency', () => {
      const tags = [];
      for (let i = 0; i < 20; i++) tags.push({ name: `Tag${i}`, rank: 100 - i, isGeneralSpoiler: false });
      const state = mockState({
        data: {
          library: [
            { id: '1', anilistTags: tags },
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/tag-cooccurrence' });
      const res = mockRes();
      stats.handleStatsTagCooccurrence(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.tags.length, 12);
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
      assert.deepStrictEqual(res._body.bins, [0, 0, 0, 0, 0]);
    });

    it('correctly bins ratings', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', rating: 0.5 },  // round=1 → 桶0(★1)
            { id: '2', rating: 1.6 },  // round=2 → 桶0(★1)
            { id: '3', rating: 2.5 },  // round=3 → 桶1(★2)
            { id: '4', rating: 3.5 },  // round=4 → 桶1(★2)
            { id: '5', rating: 4.5 },  // round=5 → 桶2(★3)
            { id: '6', rating: 5.5 },  // round=6 → 桶2(★3)
            { id: '7', rating: 6.5 },  // round=7 → 桶3(★4)
            { id: '8', rating: 7.5 },  // round=8 → 桶3(★4)
            { id: '9', rating: 8.5 },  // round=9 → 桶4(★5)
            { id: '10', rating: 9.6 }, // round=10 → 桶4(★5)
          ],
        },
      });
      const req = mockReq({ url: '/api/stats/ratings' });
      const res = mockRes();
      stats.handleStatsRatings(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.bins, [2, 2, 2, 2, 2]);
      assert.deepStrictEqual(res._body.labels, ['1', '2', '3', '4', '5']);
    });

    it('skips items without ratings', () => {
      const state = mockState({
        data: {
          library: [
            { id: '1', rating: 8.4 },  // round=8 → 桶3(★4)
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
      assert.strictEqual(res._body.bins[3], 1); // ★4 bin
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
