// server/__tests__/routes/mylist.test.js
// Route handler integration tests for mylist.js
// Tests that handlers respond with correct status codes and body shapes,
// and that db save functions are called where expected.
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const mylist = require('../../dist/routes/mylist');

describe('mylist route handlers', () => {
  describe('handleGetMyList', () => {
    it('returns 200 with merged data when library and myList both exist', () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', title: 'Test Anime', bangumiId: '123', episodes: [{ number: 1, watched: false }, { number: 2, watched: true }] }],
          myList: [{ animeId: 'anime-1', status: 'watching', rating: 8 }],
        },
      });
      const req = mockReq({ url: '/api/mylist' });
      const res = mockRes();
      mylist.handleGetMyList(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(Array.isArray(res._body));
      assert.strictEqual(res._body.length, 1);
      assert.strictEqual(res._body[0].title, 'Test Anime');
      assert.strictEqual(res._body[0].status, 'watching');
      assert.strictEqual(res._body[0].episodeCount, 2);
      assert.strictEqual(res._body[0].episodesWatched, 1);
    });

    it('returns firstPlayedAt as the earliest play session startTime for library items', () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', title: 'Test Anime', episodes: [{ number: 1, watched: false }] }],
          myList: [{ animeId: 'anime-1', status: 'watching' }],
          playSessions: [
            { animeId: 'anime-1', episodeNumber: 1, startTime: '2026-07-20T10:00:00.000Z' },
            { animeId: 'anime-1', episodeNumber: 2, startTime: '2026-07-01T10:00:00.000Z' },
            { animeId: 'anime-2', episodeNumber: 1, startTime: '2026-08-01T10:00:00.000Z' },
          ],
        },
      });
      const req = mockReq({ url: '/api/mylist' });
      const res = mockRes();
      mylist.handleGetMyList(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body[0].firstPlayedAt, '2026-07-01T10:00:00.000Z');
    });

    it('returns null firstPlayedAt when the anime has no play sessions', () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', title: 'Test Anime', episodes: [{ number: 1, watched: false }] }],
          myList: [{ animeId: 'anime-1', status: 'wish' }],
          playSessions: [{ animeId: 'anime-2', episodeNumber: 1, startTime: '2026-08-01T10:00:00.000Z' }],
        },
      });
      const req = mockReq({ url: '/api/mylist' });
      const res = mockRes();
      mylist.handleGetMyList(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body[0].firstPlayedAt, null);
    });
  });

  describe('handleUpdateMyListStatus', () => {
    it('returns 200 and calls saveMyList on valid status update', async () => {
      let saved = false;
      const state = mockState({
        data: { myList: [{ animeId: 'anime-1', status: 'watching' }] },
        db: { saveMyList: async () => { saved = true; } },
      });
      const req = mockReq({ url: '/api/mylist/anime-1/status', method: 'PUT', body: JSON.stringify({ status: 'completed' }) });
      const res = mockRes();
      await mylist.handleUpdateMyListStatus(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.ok);
      assert.ok(saved, 'saveMyList was called');
    });

    it('returns 400 for invalid status value', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/mylist/anime-1/status', method: 'PUT', body: JSON.stringify({ status: 'invalid' }) });
      const res = mockRes();
      await mylist.handleUpdateMyListStatus(req, res, state);
      assert.strictEqual(res._status, 400);
      assert.ok(res._body.error);
    });

    it('returns 400 for missing status field', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/mylist/anime-1/status', method: 'PUT', body: JSON.stringify({}) });
      const res = mockRes();
      await mylist.handleUpdateMyListStatus(req, res, state);
      assert.strictEqual(res._status, 400);
    });
  });

  describe('handleDeleteMyListItem', () => {
    it('returns 200 and removes item from myList', async () => {
      let saved = false;
      const state = mockState({
        data: { myList: [{ id: 'del-1', animeId: 'anime-1' }] },
        db: { saveMyList: async () => { saved = true; } },
      });
      const req = mockReq({ url: '/api/mylist/del-1', method: 'DELETE' });
      const res = mockRes();
      await mylist.handleDeleteMyListItem(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(saved, 'saveMyList was called');
      assert.strictEqual(state.data.myList.length, 0);
    });
  });

  describe('handleUpdateMyListItem', () => {
    it('returns 200 and updates allowed fields', async () => {
      let saved = false;
      const state = mockState({
        data: { myList: [{ id: 'item-1', animeId: 'anime-1', rating: 5, status: 'watching' }] },
        db: { updateMyListItem: async () => { saved = true; } },
      });
      const req = mockReq({ url: '/api/mylist/item-1', method: 'PUT', body: JSON.stringify({ rating: 9, notes: 'Great!' }) });
      const res = mockRes();
      await mylist.handleUpdateMyListItem(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(saved, 'updateMyListItem was called');
      assert.strictEqual(state.data.myList[0].rating, 9);
      assert.strictEqual(state.data.myList[0].notes, 'Great!');
    });

    it('returns 400 when no valid fields provided', async () => {
      const state = mockState({ data: { myList: [] } });
      const req = mockReq({ url: '/api/mylist/item-1', method: 'PUT', body: JSON.stringify({ invalidField: true }) });
      const res = mockRes();
      await mylist.handleUpdateMyListItem(req, res, state);
      assert.strictEqual(res._status, 400);
    });
  });
});
