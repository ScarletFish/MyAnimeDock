// server/__tests__/routes/continue-watching.test.js
// Route handler tests for continue-watching.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const cw = require('../../dist/routes/continue-watching');

const ep = (number, over = {}) => ({
  number,
  watched: false,
  progress: 0,
  duration: null,
  filePath: `/media/a/ep${number}.mkv`,
  ...over,
});

describe('continue-watching route handlers', () => {
  describe('handleGetContinueWatching', () => {
    it('returns 200 with empty array for empty library', () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/continue-watching' });
      const res = mockRes();
      cw.handleGetContinueWatching(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body, []);
    });

    it('excludes fully watched anime', () => {
      const state = mockState({
        data: {
          library: [{
            id: 'a1', title: 'Anime A', downloaded: true,
            episodes: [ep(1, { watched: true }), ep(2, { watched: true })],
          }],
        },
      });
      const req = mockReq({ url: '/api/continue-watching' });
      const res = mockRes();
      cw.handleGetContinueWatching(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body, []);
    });

    it('excludes anime with unwatched episodes but no progress (watchedCount=0, no in-progress)', () => {
      const state = mockState({
        data: {
          library: [{
            id: 'a1', title: 'Anime A', downloaded: true,
            episodes: [ep(1), ep(2)],
          }],
        },
      });
      const req = mockReq({ url: '/api/continue-watching' });
      const res = mockRes();
      cw.handleGetContinueWatching(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body, []);
    });

    it('includes anime with an in-progress episode and points continueEpisode at it', () => {
      const state = mockState({
        data: {
          library: [{
            id: 'a1', title: 'Anime A', bangumiTitle: 'アニメA', localCover: '/covers/a1.jpg', downloaded: true,
            episodes: [ep(1, { progress: 35, duration: 1450 }), ep(2)],
          }],
          playSessions: [{ animeId: 'a1', episodeNumber: 1, startTime: '2026-08-01T10:00:00.000Z' }],
        },
      });
      const req = mockReq({ url: '/api/continue-watching' });
      const res = mockRes();
      cw.handleGetContinueWatching(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 1);
      assert.strictEqual(res._body[0].id, 'a1');
      assert.strictEqual(res._body[0].title, 'Anime A');
      assert.strictEqual(res._body[0].bangumiTitle, 'アニメA');
      assert.strictEqual(res._body[0].localCover, '/covers/a1.jpg');
      assert.strictEqual(res._body[0].episodeCount, 2);
      assert.deepStrictEqual(res._body[0].continueEpisode, { number: 1, filePath: '/media/a/ep1.mkv', progress: 35, duration: 1450 });
    });

    it('points continueEpisode at lastPlayedEp for partially-watched anime and sorts by lastPlayedAt desc', () => {
      const state = mockState({
        data: {
          library: [
            {
              id: 'a1', title: 'Anime A', downloaded: true,
              episodes: [ep(1, { watched: true }), ep(2, { watched: true }), ep(3)],
            },
            {
              id: 'a2', title: 'Anime B', downloaded: true,
              episodes: [ep(1, { watched: true }), ep(2)],
            },
          ],
          playSessions: [
            { animeId: 'a2', episodeNumber: 1, startTime: '2026-07-01T10:00:00.000Z' },
            { animeId: 'a1', episodeNumber: 3, startTime: '2026-08-01T10:00:00.000Z' },
          ],
        },
      });
      const req = mockReq({ url: '/api/continue-watching' });
      const res = mockRes();
      cw.handleGetContinueWatching(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 2);
      assert.strictEqual(res._body[0].id, 'a1');
      assert.strictEqual(res._body[0].continueEpisode.number, 3);
      assert.strictEqual(res._body[1].id, 'a2');
      assert.strictEqual(res._body[1].continueEpisode.number, 2);
    });

    it('excludes anime when downloaded is missing or false, includes when true', () => {
      const state = mockState({
        data: {
          library: [
            { id: 'a1', title: 'Anime A', downloaded: true, episodes: [ep(1, { watched: true }), ep(2)] },
            { id: 'a2', title: 'Anime B', downloaded: false, episodes: [ep(1, { watched: true }), ep(2)] },
            { id: 'a3', title: 'Anime C', episodes: [ep(1, { watched: true }), ep(2)] },
          ],
        },
      });
      const req = mockReq({ url: '/api/continue-watching' });
      const res = mockRes();
      cw.handleGetContinueWatching(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 1);
      assert.strictEqual(res._body[0].id, 'a1');
    });

    it('falls back to first unwatched episode when lastPlayedEp is already watched', () => {
      const state = mockState({
        data: {
          library: [{
            id: 'a1', title: 'Anime A', downloaded: true,
            episodes: [ep(1, { watched: true }), ep(2, { watched: true }), ep(3)],
          }],
          playSessions: [{ animeId: 'a1', episodeNumber: 2, startTime: '2026-08-01T10:00:00.000Z' }],
        },
      });
      const req = mockReq({ url: '/api/continue-watching' });
      const res = mockRes();
      cw.handleGetContinueWatching(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 1);
      assert.strictEqual(res._body[0].continueEpisode.number, 3);
    });

    it('caps the response at 10 items when more than 10 candidates qualify', () => {
      const library = Array.from({ length: 12 }, (_, i) => ({
        id: `a${i}`, title: `Anime ${i}`, downloaded: true,
        episodes: [ep(1, { progress: 5 })],
      }));
      const state = mockState({ data: { library } });
      const req = mockReq({ url: '/api/continue-watching' });
      const res = mockRes();
      cw.handleGetContinueWatching(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 10);
      assert.strictEqual(res._body[0].id, 'a0');
      assert.strictEqual(res._body[9].id, 'a9');
    });
  });
});