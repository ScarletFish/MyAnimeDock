// server/__tests__/routes/meta-match.test.js
// Route handler tests for meta-match.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const mm = require('../../dist/routes/meta-match');

const ep = (number) => ({
  number,
  filePath: `/media/a/ep${number}.mkv`,
  fileName: `ep${number}.mkv`,
  fileSize: 1000,
  duration: null,
  watched: false,
  progress: null,
});

// AniList tags 形状对齐 scrapers/anilist.ts 的 tags 映射
const anilistTags = [{ name: 'Comedy', rank: 90, isGeneralSpoiler: false, isMediaSpoiler: false }];

// 超集条目：模拟 animeToLegacy + metadata spread + enrichAnime 后的内存态（/api/library 同源对象）
const richSource = {
  id: 'a1',
  folderPath: '/media/a1',
  folderName: '[Group] Anime A [bgm123]',
  title: 'Anime A',
  season: 1,
  importedAt: '2026-01-01T00:00:00.000Z',
  downloaded: true,
  bangumiId: 123,
  bangumiTitle: 'アニメA',
  bangumiTitleJp: 'アニメA',
  summary: 'A long summary',
  localCover: '/covers/a1.jpg',
  rating: 8.5,
  source: 'bangumi',
  pinyinTitle: 'anime-a',
  matchedSeason: 1,
  anilistId: 111,
  anilistBanner: '/banners/a1.jpg',
  anilistTitleEn: 'Anime A EN',
  characters: [{ id: 1 }],
  persons: [{ id: 1 }],
  tags: [{ name: 'x' }],
  infobox: [],
  collection: { foo: 1 },
  date: '2026-01-01',
  platform: 'TV',
  ratingRank: 5,
  ratingTotal: 100,
  eps: [{}],
  totalEpisodes: 12,
  specialSuffix: null,
  anilistTags,
  myListStatus: 'watching',
  lastPlayedAt: '2026-08-01T10:00:00.000Z',
  episodes: [ep(1), ep(2)],
};

const expected = {
  id: 'a1',
  title: 'Anime A',
  folderName: '[Group] Anime A [bgm123]',
  bangumiTitle: 'アニメA',
  bangumiId: 123,
  pinyinTitle: 'anime-a',
  season: 1,
  matchedSeason: 1,
  specialSuffix: null,
  episodeCount: 2,
  summary: 'A long summary',
  localCover: '/covers/a1.jpg',
  rating: 8.5,
  bangumiTitleJp: 'アニメA',
  anilistId: 111,
  anilistBanner: '/banners/a1.jpg',
  anilistTags,
};

describe('meta-match route handlers', () => {
  describe('handleGetMetaMatchItems', () => {
    it('returns 200 with empty array for empty library', () => {
      const state = mockState({ data: { library: [] } });
      const req = mockReq({ url: '/api/meta-match' });
      const res = mockRes();
      mm.handleGetMetaMatchItems(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body, []);
    });

    it('returns exactly the 17 slim fields with correct values and episodeCount', () => {
      const state = mockState({ data: { library: [richSource] } });
      const req = mockReq({ url: '/api/meta-match' });
      const res = mockRes();
      mm.handleGetMetaMatchItems(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 1);
      assert.deepStrictEqual(res._body[0], expected);
      assert.strictEqual(res._body[0].episodeCount, richSource.episodes.length);
    });

    it('excludes episodes, enrich-injected fields and metadata extra fields', () => {
      const state = mockState({ data: { library: [richSource] } });
      const req = mockReq({ url: '/api/meta-match' });
      const res = mockRes();
      mm.handleGetMetaMatchItems(req, res, state);
      const item = res._body[0];
      const forbidden = [
        'episodes', 'myListStatus', 'userRating', 'progress', 'startedAt', 'completedAt',
        'lastPlayedAt', 'lastPlayedEp', 'firstPlayedAt',
        'characters', 'persons', 'tags', 'infobox', 'collection',
        'date', 'platform', 'ratingRank', 'ratingTotal', 'eps', 'totalEpisodes',
        'folderPath', 'downloaded', 'importedAt', 'source', 'anilistTitleEn',
      ];
      for (const key of forbidden) {
        assert.ok(!Object.hasOwn(item, key), `response should not contain ${key}`);
      }
      assert.deepStrictEqual(Object.keys(item).sort(), Object.keys(expected).sort());
    });

    it('preserves the original library order (no sorting)', () => {
      const state = mockState({
        data: {
          library: [
            { id: 'c', title: 'C', folderName: 'C', episodes: [ep(1)] },
            { id: 'a', title: 'A', folderName: 'A', episodes: [ep(1)] },
            { id: 'b', title: 'B', folderName: 'B', episodes: [ep(1)] },
          ],
        },
      });
      const req = mockReq({ url: '/api/meta-match' });
      const res = mockRes();
      mm.handleGetMetaMatchItems(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.deepStrictEqual(res._body.map((i) => i.id), ['c', 'a', 'b']);
    });

    it('returns episodeCount 0 when episodes is missing', () => {
      const state = mockState({ data: { library: [{ id: 'a1', title: 'Anime A', folderName: 'A' }] } });
      const req = mockReq({ url: '/api/meta-match' });
      const res = mockRes();
      mm.handleGetMetaMatchItems(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.length, 1);
      assert.strictEqual(res._body[0].episodeCount, 0);
      assert.ok(!Object.hasOwn(res._body[0], 'episodes'));
    });

    it('passes through season/matchedSeason/specialSuffix semantics like /api/library', () => {
      const state = mockState({
        data: {
          library: [
            { id: 'a1', title: 'Anime A', folderName: 'A', season: 2, matchedSeason: null, specialSuffix: '~OVA~' },
            { id: 'a2', title: 'Anime B', folderName: 'B' },
          ],
        },
      });
      const req = mockReq({ url: '/api/meta-match' });
      const res = mockRes();
      mm.handleGetMetaMatchItems(req, res, state);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body[0].season, 2);
      assert.strictEqual(res._body[0].matchedSeason, null);
      assert.strictEqual(res._body[0].specialSuffix, '~OVA~');
      // 源对象无这些键 → JSON 序列化同 /api/library 一样省略键
      assert.ok(!Object.hasOwn(res._body[1], 'season'));
      assert.ok(!Object.hasOwn(res._body[1], 'matchedSeason'));
      assert.ok(!Object.hasOwn(res._body[1], 'specialSuffix'));
    });
  });
});