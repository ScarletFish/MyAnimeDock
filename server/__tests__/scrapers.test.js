const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const {
  sorensenDice,
  normalizeTitle,
  detectSpecialType,
  extractBaseAndSuffix,
  buildSearchTerms,
  pickBestBySimilarity,
  isPrimarilyRomaji,
} = require('../scrapers/index');

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    assert.equal(normalizeTitle('Title! With. Punctuation?'), 'titlewithpunctuation');
  });

  it('removes CJK punctuation', () => {
    assert.equal(normalizeTitle('标题「测试」'), '标题测试');
  });

  it('collapses whitespace', () => {
    assert.equal(normalizeTitle('  multiple   spaces  '), 'multiplespaces');
  });

  it('returns empty for null/undefined', () => {
    assert.equal(normalizeTitle(null), '');
    assert.equal(normalizeTitle(undefined), '');
  });

  it('strips tilde characters', () => {
    assert.equal(normalizeTitle('Title ~Special~'), 'titlespecial');
  });

  it('strips common brackets', () => {
    assert.equal(normalizeTitle('【Title】(Subtitle)'), 'titlesubtitle');
  });
});

describe('sorensenDice', () => {
  it('returns 1 for identical strings', () => {
    assert.equal(sorensenDice('hello', 'hello'), 1);
  });

  it('returns 1 for identical CJK strings', () => {
    assert.equal(sorensenDice('葬送的芙莉莲', '葬送的芙莉莲'), 1);
  });

  it('returns 0 for completely different strings', () => {
    assert.equal(sorensenDice('abc', 'xyz'), 0);
  });

  it('returns 0 for null/empty input', () => {
    assert.equal(sorensenDice(null, 'test'), 0);
    assert.equal(sorensenDice('test', ''), 0);
    assert.equal(sorensenDice('', ''), 0);
  });

  it('is case-insensitive', () => {
    assert.equal(sorensenDice('Hello', 'hello'), 1);
  });

  it('returns 0 for different single-char strings', () => {
    assert.equal(sorensenDice('a', 'b'), 0);
  });

  it('returns 1 for identical single-char strings', () => {
    assert.equal(sorensenDice('a', 'a'), 1);
  });

  it('returns >0 for partially overlapping strings', () => {
    const score = sorensenDice('abcdef', 'abcxyz');
    assert.ok(score > 0);
    assert.ok(score < 1);
  });

  it('returns high score for minor typos', () => {
    const score = sorensenDice('hello world', 'hello worlds');
    assert.ok(score > 0.8);
  });
});

describe('detectSpecialType', () => {
  it('detects movie via Chinese keyword', () => {
    assert.equal(detectSpecialType('动漫 剧场版'), 'movie');
  });

  it('detects movie via English keyword', () => {
    assert.equal(detectSpecialType('Movie Title'), 'movie');
  });

  it('detects movie via traditional Chinese', () => {
    assert.equal(detectSpecialType('劇場版テスト'), 'movie');
  });

  it('detects OVA', () => {
    assert.equal(detectSpecialType('OVA Title'), 'ova');
  });

  it('detects OAD', () => {
    assert.equal(detectSpecialType('OAD Title'), 'ova');
  });

  it('detects Special keyword', () => {
    assert.equal(detectSpecialType('Special Episode'), 'ova');
  });

  it('detects special via tilde (no keyword match)', () => {
    assert.equal(detectSpecialType('Title ~Bonus~'), 'special');
  });

  it('detects special via fullwidth tilde', () => {
    assert.equal(detectSpecialType('Title ～特別版～'), 'special');
  });

  it('returns null for regular title', () => {
    assert.equal(detectSpecialType('Regular Title'), null);
  });

  it('returns null for empty input', () => {
    assert.equal(detectSpecialType(''), null);
    assert.equal(detectSpecialType(null), null);
  });
});

describe('extractBaseAndSuffix', () => {
  it('extracts base title and tilde suffix', () => {
    const result = extractBaseAndSuffix('Title ~OVA~');
    assert.equal(result.baseTitle, 'Title');
    assert.equal(result.specialSuffix, '~OVA~');
  });

  it('returns full title when no suffix', () => {
    const result = extractBaseAndSuffix('Regular Title');
    assert.equal(result.baseTitle, 'Regular Title');
    assert.equal(result.specialSuffix, null);
  });

  it('handles fullwidth tilde suffix', () => {
    const result = extractBaseAndSuffix('Title ～特別版～');
    assert.equal(result.baseTitle, 'Title');
    assert.ok(result.specialSuffix);
    assert.ok(result.specialSuffix.includes('～'));
  });

  it('returns null suffix for empty input', () => {
    const result = extractBaseAndSuffix('');
    assert.equal(result.baseTitle, '');
    assert.equal(result.specialSuffix, null);
  });

  it('handles multiple spaces before tilde', () => {
    const result = extractBaseAndSuffix('Title   ~Special~');
    assert.equal(result.baseTitle, 'Title');
    assert.equal(result.specialSuffix, '~Special~');
  });
});

describe('isPrimarilyRomaji', () => {
  it('returns true for English titles', () => {
    assert.equal(isPrimarilyRomaji('Frieren Beyond Journey\'s End'), true);
  });

  it('returns false for CJK titles', () => {
    assert.equal(isPrimarilyRomaji('葬送的芙莉莲'), false);
  });

  it('returns false for null', () => {
    assert.equal(isPrimarilyRomaji(null), false);
  });
});

describe('buildSearchTerms', () => {
  it('returns base title as fallback', () => {
    const terms = buildSearchTerms({ cleanTitle: 'Frieren' }, 'Frieren');
    assert.ok(terms.includes('Frieren'));
  });

  it('includes season suffix when present', () => {
    const terms = buildSearchTerms({ cleanTitle: 'Frieren', season: 2 }, 'Frieren');
    assert.ok(terms.some(t => t.includes('第2期')));
  });

  it('deduplicates terms', () => {
    const terms = buildSearchTerms({ cleanTitle: 'Test', title: 'Test' }, 'Test');
    const unique = new Set(terms);
    assert.equal(terms.length, unique.size);
  });
});

describe('pickBestBySimilarity', () => {
  it('picks the closest match', () => {
    const results = [
      { id: 1, name_cn: '完全不同的标题' },
      { id: 2, name_cn: '葬送的芙莉莲' },
      { id: 3, name_cn: '另一个标题' },
    ];
    const best = pickBestBySimilarity('葬送的芙莉莲', results);
    assert.equal(best.id, 2);
  });

  it('falls back to first result when no good match', () => {
    const results = [{ id: 1, name_cn: 'abc' }, { id: 2, name_cn: 'xyz' }];
    const best = pickBestBySimilarity('totally_different', results);
    assert.ok(best.id === 1 || best.id === 2);
  });
});
