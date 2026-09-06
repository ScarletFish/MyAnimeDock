// server/__tests__/list-item.test.js
// Unit tests for lib/list-item.ts (dist/lib/list-item) — ListItem 统一投影（单数据源）
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildListItems } = require('../dist/lib/list-item');

describe('buildListItems', () => {
  it('merges mylist row with library row by animeId', () => {
    const data = {
      library: [{ id: 'a1', title: 'Anime', bangumiTitle: 'BG Title', downloaded: true, episodes: [{ number: 1, watched: false }, { number: 2, watched: true }], rating: 7.5, source: 'bangumi' }],
      myList: [{ id: 'm1', animeId: 'a1', status: 'watching', rating: 9, thoughts: '', notes: 'x' }],
      playSessions: [],
    };
    const items = buildListItems(data);
    assert.strictEqual(items.length, 1);
    const item = items[0];
    assert.strictEqual(item.id, 'm1');
    assert.strictEqual(item.animeId, 'a1');
    assert.strictEqual(item.bangumiTitle, 'BG Title');
    assert.strictEqual(item.status, 'watching');
    assert.strictEqual(item.userRating, 9);
    assert.strictEqual(item.rating, 7.5);
    assert.strictEqual(item.hasLocalFiles, true);
    assert.strictEqual(item.episodeCount, 2);
    assert.strictEqual(item.episodesWatched, 1);
    assert.strictEqual(item.source, 'bangumi');
    assert.strictEqual(item.notes, 'x');
    assert.ok(!('episodes' in item), 'episodes[] must not be present');
  });

  it('synthesizes library-only rows with null mylist-side fields', () => {
    const data = {
      library: [{ id: 'a1', title: 'Anime', downloaded: true, episodes: [] }],
      myList: [],
      playSessions: [],
    };
    const items = buildListItems(data);
    assert.strictEqual(items.length, 1);
    const item = items[0];
    assert.strictEqual(item.animeId, 'a1');
    assert.strictEqual(item.status, null);
    assert.strictEqual(item.userRating, null);
    assert.strictEqual(item.thoughts, '');
    assert.strictEqual(item.notes, '');
    assert.strictEqual(item.coverUrl, null);
    assert.strictEqual(item.localCover, null);
  });

  it('dedupes by animeId when the same anime has a mylist row', () => {
    const data = {
      library: [{ id: 'a1', title: 'Anime', downloaded: true, episodes: [] }],
      myList: [{ id: 'm1', animeId: 'a1', status: 'wish' }],
      playSessions: [],
    };
    assert.strictEqual(buildListItems(data).length, 1);
  });

  it('drops mylist rows without animeId (ghost / wish-only gate)', () => {
    const data = {
      library: [],
      myList: [{ id: 'm1', animeId: null, status: 'wish' }],
      playSessions: [],
    };
    assert.deepStrictEqual(buildListItems(data), []);
  });

  it('keeps mylist-only ghost rows with animeId when no library row exists', () => {
    const data = {
      library: [],
      myList: [{ id: 'm1', animeId: 'a9', status: 'wish', title: '', thoughts: 'watched trailer' }],
      playSessions: [],
    };
    const items = buildListItems(data);
    assert.strictEqual(items.length, 1);
    const item = items[0];
    assert.strictEqual(item.animeId, 'a9');
    assert.strictEqual(item.status, 'wish');
    assert.strictEqual(item.hasLocalFiles, false);
    assert.strictEqual(item.episodeCount, 0);
    assert.strictEqual(item.thoughts, 'watched trailer');
  });

  it('localOnly filters to animeId non-null && hasLocalFiles', () => {
    const data = {
      library: [
        { id: 'a1', title: 'Local', downloaded: true, episodes: [] },
        { id: 'a2', title: 'No File', downloaded: false, episodes: [] },
        { id: 'a3', title: 'Legacy Undefined', episodes: [] },
      ],
      myList: [],
      playSessions: [],
    };
    const items = buildListItems(data, { localOnly: true });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].animeId, 'a1');
  });

  it('computes firstPlayedAt/lastPlayedAt from playSessions (earliest/latest)', () => {
    const data = {
      library: [{ id: 'a1', title: 'Anime', downloaded: true, episodes: [] }],
      myList: [{ id: 'm1', animeId: 'a1', status: 'completed' }],
      playSessions: [
        { animeId: 'a1', episodeNumber: 2, startTime: '2026-07-20T10:00:00.000Z' },
        { animeId: 'a1', episodeNumber: 1, startTime: '2026-07-01T10:00:00.000Z' },
        { animeId: 'a2', episodeNumber: 1, startTime: '2026-08-01T10:00:00.000Z' },
      ],
    };
    const [item] = buildListItems(data);
    assert.strictEqual(item.firstPlayedAt, '2026-07-01T10:00:00.000Z');
    assert.strictEqual(item.lastPlayedAt, '2026-07-20T10:00:00.000Z');
  });

  it('ids restrict results by animeId or list item id', () => {
    const data = {
      library: [
        { id: 'a1', title: 'One', downloaded: true, episodes: [] },
        { id: 'a2', title: 'Two', downloaded: true, episodes: [] },
      ],
      myList: [],
      playSessions: [],
    };
    const single = buildListItems(data, { ids: new Set(['a2']) });
    assert.strictEqual(single.length, 1);
    assert.strictEqual(single[0].animeId, 'a2');
    const byListId = buildListItems(data, { ids: new Set(['a1', 'whatever']) });
    assert.strictEqual(byListId.length, 1);
    assert.strictEqual(byListId[0].animeId, 'a1');
  });
});
