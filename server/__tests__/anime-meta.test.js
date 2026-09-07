// server/__tests__/anime-meta.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { expectedEpCount, isChasing } = require('../dist/lib/anime-meta');

const anime = (over = {}) => ({
  id: 'a1',
  folderPath: '/media/a1',
  downloaded: true,
  episodes: [{ number: 1, watched: true }],
  ...over,
});

describe('expectedEpCount', () => {
  it('returns totalEpisodes when present', () => {
    assert.strictEqual(expectedEpCount(anime({ totalEpisodes: 12 })), 12);
  });
  it('falls back to eps array length when totalEpisodes missing', () => {
    assert.strictEqual(expectedEpCount(anime({ eps: [{}, {}, {}] })), 3);
  });
  it('returns null when no metadata', () => {
    assert.strictEqual(expectedEpCount(anime()), null);
    assert.strictEqual(expectedEpCount(anime({ eps: null })), null);
  });
  it('returns null for falsy input', () => {
    assert.strictEqual(expectedEpCount(null), null);
    assert.strictEqual(expectedEpCount(undefined), null);
  });
});

describe('isChasing', () => {
  it('true when expected total higher than local episode count', () => {
    assert.strictEqual(isChasing(anime({ totalEpisodes: 12 })), true);
    assert.strictEqual(isChasing(anime({ eps: [{}, {}, {}] })), true);
  });
  it('false when expected total matches local count', () => {
    assert.strictEqual(isChasing(anime({ totalEpisodes: 1 })), false);
  });
  it('false when expected total is unknown', () => {
    assert.strictEqual(isChasing(anime()), false);
  });
  it('false for falsy input', () => {
    assert.strictEqual(isChasing(null), false);
  });
});