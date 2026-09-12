// server/__tests__/routes/mylist.test.js
// Route handler integration tests for mylist.js
// Tests that handlers respond with correct status codes and body shapes,
// and that db save functions are called where expected.
// 契约：GET 返回 ListItem[]（lib/list-item.ts 统一投影），mutation 返回 { ok, item }。
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const mylist = require('../../dist/routes/mylist');

describe('mylist route handlers', () => {
  describe('handleGetMyList', () => {
    it('returns 200 with merged ListItem when library and myList both exist', () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', title: 'Test Anime', bangumiId: 123, downloaded: true, episodes: [{ number: 1, watched: false }, { number: 2, watched: true }] }],
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
      assert.strictEqual(res._body[0].userRating, 8);
      assert.strictEqual(res._body[0].episodeCount, 2);
      assert.strictEqual(res._body[0].episodesWatched, 1);
      assert.strictEqual(res._body[0].hasLocalFiles, true);
      assert.ok(!('episodes' in res._body[0]), 'episodes[] must not be sent in list items');
      assert.ok(!('myListStatus' in res._body[0]), 'myListStatus must not be sent in list items');
    });

    it('includes library-only rows in the full set with null status', () => {
      const state = mockState({
        data: {
          library: [
            { id: 'anime-1', title: 'Has List', downloaded: true, episodes: [] },
            { id: 'anime-2', title: 'No List', downloaded: false, episodes: [] },
          ],
          myList: [{ animeId: 'anime-1', status: 'watching' }],
        },
      });
      const req = mockReq({ url: '/api/mylist' });
      const res = mockRes();
      mylist.handleGetMyList(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 2);
      const noList = res._body.find((it) => it.animeId === 'anime-2');
      assert.ok(noList, 'library-only row must appear in full set');
      assert.strictEqual(noList.status, null);
      assert.strictEqual(noList.hasLocalFiles, false);
    });

    it('returns only local items when ?filter=local', () => {
      const state = mockState({
        data: {
          library: [
            { id: 'anime-1', title: 'Local', downloaded: true, episodes: [] },
            { id: 'anime-2', title: 'Not Downloaded', downloaded: false, episodes: [] },
          ],
          myList: [],
        },
      });
      const req = mockReq({ url: '/api/mylist?filter=local' });
      const res = mockRes();
      mylist.handleGetMyList(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 1);
      assert.strictEqual(res._body[0].animeId, 'anime-1');
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
      assert.strictEqual(res._body[0].lastPlayedAt, '2026-07-20T10:00:00.000Z');
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

    it('returns only the item matching ?ids= (playback-end single refresh)', () => {
      const state = mockState({
        data: {
          library: [
            { id: 'anime-1', title: 'A', downloaded: true, episodes: [{ number: 1, watched: false }] },
            { id: 'anime-2', title: 'B', downloaded: true, episodes: [{ number: 1, watched: false }] },
          ],
          myList: [],
        },
      });
      const req = mockReq({ url: '/api/mylist?ids=anime-1' });
      const res = mockRes();
      mylist.handleGetMyList(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(Array.isArray(res._body));
      assert.strictEqual(res._body.length, 1);
      assert.strictEqual(res._body[0].animeId, 'anime-1');
      assert.strictEqual(res._body[0].status, null);
      assert.strictEqual(res._body[0].hasLocalFiles, true);
    });

    it('returns multiple items when ?ids= is comma-separated', () => {
      const state = mockState({
        data: {
          library: [
            { id: 'anime-1', title: 'A', downloaded: true, episodes: [] },
            { id: 'anime-2', title: 'B', downloaded: true, episodes: [] },
          ],
          myList: [],
        },
      });
      const req = mockReq({ url: '/api/mylist?ids=anime-1,anime-2' });
      const res = mockRes();
      mylist.handleGetMyList(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 2);
    });
  });

  describe('handleUpdateMyListStatus', () => {
    it('returns 200 with updated ListItem and calls saveMyList on valid status update', async () => {
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
      assert.strictEqual(res._body.item.status, 'completed');
      assert.strictEqual(res._body.item.animeId, 'anime-1');
      assert.ok(saved, 'saveMyList was called');
    });

    it('returns ListItem with updated status for frontend in-place patch', async () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', title: 'Test Anime', downloaded: true, episodes: [{ number: 1, watched: false }, { number: 2, watched: true }] }],
          myList: [{ id: 'item-1', animeId: 'anime-1', status: 'watching', rating: 8 }],
        },
        db: { saveMyList: async () => {} },
      });
      const req = mockReq({ url: '/api/mylist/anime-1/status', method: 'PUT', body: JSON.stringify({ status: 'completed' }) });
      const res = mockRes();
      await mylist.handleUpdateMyListStatus(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.item, 'response includes ListItem for in-place patch');
      assert.strictEqual(res._body.item.id, 'item-1');
      assert.strictEqual(res._body.item.animeId, 'anime-1');
      assert.strictEqual(res._body.item.status, 'completed');
      assert.strictEqual(res._body.item.userRating, 8, 'myList fields are projected onto ListItem');
    });

    it('returns synthesized ListItem when anime not in library (ghost mylist row)', async () => {
      const state = mockState({
        data: { myList: [{ animeId: 'ghost', status: 'watching' }] },
        db: { saveMyList: async () => {} },
      });
      const req = mockReq({ url: '/api/mylist/ghost/status', method: 'PUT', body: JSON.stringify({ status: 'wish' }) });
      const res = mockRes();
      await mylist.handleUpdateMyListStatus(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.item, 'ghost mylist rows are part of the full set and return an item');
      assert.strictEqual(res._body.item.animeId, 'ghost');
      assert.strictEqual(res._body.item.status, 'wish');
      assert.strictEqual(res._body.item.hasLocalFiles, false);
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

  describe('handleUpdateMyListItem', () => {
    it('returns 200 and updates allowed fields', async () => {
      let saved = false;
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', title: 'Test Anime', episodes: [] }],
          myList: [{ id: 'item-1', animeId: 'anime-1', rating: 5, status: 'watching' }],
        },
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

    it('returns ListItem with updated fields for frontend in-place patch', async () => {
      const state = mockState({
        data: {
          library: [{ id: 'anime-1', title: 'Test Anime', episodes: [{ number: 1, watched: true }] }],
          myList: [{ id: 'item-1', animeId: 'anime-1', rating: 5, status: 'watching', progress: 1 }],
        },
        db: { updateMyListItem: async () => {} },
      });
      const req = mockReq({ url: '/api/mylist/item-1', method: 'PUT', body: JSON.stringify({ rating: 9 }) });
      const res = mockRes();
      await mylist.handleUpdateMyListItem(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.ok(res._body.item, 'response includes ListItem for in-place patch');
      assert.strictEqual(res._body.item.id, 'item-1');
      assert.strictEqual(res._body.item.animeId, 'anime-1');
      assert.strictEqual(res._body.item.userRating, 9, 'updated rating is projected onto ListItem');
      assert.strictEqual(res._body.item.status, 'watching');
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
