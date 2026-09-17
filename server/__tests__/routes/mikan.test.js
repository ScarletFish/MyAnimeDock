// server/__tests__/routes/mikan.test.js
// Route handler tests for mikan.js — focused on subscription listing.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const mikan = require('../../dist/routes/mikan');

describe('mikan route handlers', () => {
  describe('handleMikanSubscriptions', () => {
    it('returns 200 with empty array when there are no subscriptions', async () => {
      const state = mockState();
      const req = mockReq({ url: '/api/mikan/subscriptions' });
      const res = mockRes();
      await mikan.handleMikanSubscriptions(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body, []);
    });

    it('returns 200 with all subscriptions (deep equal)', async () => {
      const subs = [
        { id: '1', animeId: 'a', name: 'Z Anime', subgroupId: 10, subgroupName: 'SG1', rssUrl: 'https://x/rss1', savePath: '/media/Z Anime' },
        { id: '2', animeId: 'b', name: 'A Anime', subgroupId: 20, subgroupName: 'SG2', rssUrl: 'https://x/rss2', savePath: '/media/A Anime' },
      ];
      const state = mockState({
        db: {
          ...mockState().db,
          getAllMikanSubscriptions: () => subs,
        },
      });
      const req = mockReq({ url: '/api/mikan/subscriptions' });
      const res = mockRes();
      await mikan.handleMikanSubscriptions(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body, subs);
    });

    it('returns 500 with error when db throws', async () => {
      const state = mockState({
        db: {
          ...mockState().db,
          getAllMikanSubscriptions: () => { throw new Error('db exploded'); },
        },
      });
      const req = mockReq({ url: '/api/mikan/subscriptions' });
      const res = mockRes();
      await mikan.handleMikanSubscriptions(req, res, state);
      assert.strictEqual(res._status, 500);
      assert.ok(res._body.error);
    });
  });
});