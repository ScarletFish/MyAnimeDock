const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseFolderName, extractBgmId, isExtraVideo } = require('../scanner');

describe('extractBgmId', () => {
  it('extracts numeric ID from [bgm12345]', () => {
    assert.equal(extractBgmId('[bgm12345] 动漫标题'), 12345);
  });

  it('extracts ID from middle of string', () => {
    assert.equal(extractBgmId('标题 [bgm525565] S02'), 525565);
  });

  it('returns null when no bgm tag', () => {
    assert.equal(extractBgmId('普通动漫标题'), null);
  });

  it('returns null for empty/null input', () => {
    assert.equal(extractBgmId(''), null);
    assert.equal(extractBgmId(null), null);
  });

  it('handles uppercase BGM tag', () => {
    assert.equal(extractBgmId('[BGM12345]'), 12345);
  });

  it('extracts ID from a file path', () => {
    assert.equal(extractBgmId('D:/media/[bgm99999] Show/ep01.mkv'), 99999);
  });
});

describe('isExtraVideo', () => {
  it('detects NCOP (trailing \\b requires word boundary)', () => {
    // Regex: \bNCOP\b — "NCOP01" has no boundary between P→0, but "NCOP " does
    assert.equal(isExtraVideo('[SubGroup] Title NCOP.mkv'), true);
  });

  it('detects NCOP with space before number', () => {
    assert.equal(isExtraVideo('[SubGroup] Title NCOP 01.mkv'), true);
  });

  it('detects NCED at word boundary', () => {
    assert.equal(isExtraVideo('[SubGroup] Title NCED.mkv'), true);
  });

  it('does not match NCOP followed directly by digit', () => {
    // P→0 is not a word boundary, so \bNCOP\b fails for "NCOP01"
    assert.equal(isExtraVideo('[SubGroup] Title NCOP01.mkv'), false);
  });

  it('does not match NCED followed directly by digit', () => {
    assert.equal(isExtraVideo('[SubGroup] Title NCED02.mkv'), false);
  });

  it('detects PV', () => {
    assert.equal(isExtraVideo('[SubGroup] Title PV.mkv'), true);
  });

  it('detects PV with number', () => {
    assert.equal(isExtraVideo('[SubGroup] Title PV03.mkv'), true);
  });

  it('detects Trailer', () => {
    assert.equal(isExtraVideo('[SubGroup] Title Trailer.mp4'), true);
  });

  it('detects CM', () => {
    assert.equal(isExtraVideo('[SubGroup] Title CM01.mkv'), true);
  });

  it('detects Preview', () => {
    assert.equal(isExtraVideo('[SubGroup] Title Preview.mkv'), true);
  });

  it('returns false for regular episode', () => {
    assert.equal(isExtraVideo('[SubGroup] Title - 01 [1080p].mkv'), false);
  });

  it('returns false for NCOP/NCED inside brackets (stripped before matching)', () => {
    assert.equal(isExtraVideo('[NCOP][SubGroup] Title 01.mkv'), false);
  });
});

describe('parseFolderName', () => {
  it('extracts title from bracket-wrapped folder', () => {
    const result = parseFolderName('[SubGroup] 动漫标题 [BDRip 1080p]');
    assert.ok(result.title, 'title should be defined');
    assert.ok(typeof result.title === 'string');
  });

  it('extracts season from Season marker', () => {
    const result = parseFolderName('[SubGroup] 动漫标题 Season 2');
    assert.equal(result.season, 2);
  });

  it('extracts season from S02 marker', () => {
    const result = parseFolderName('[SubGroup] 动漫标题 S02');
    assert.equal(result.season, 2);
  });

  it('extracts year from 4-digit pattern', () => {
    const result = parseFolderName('[SubGroup] 动漫标题 2024');
    assert.equal(result.year, 2024);
  });

  it('handles minimal input gracefully', () => {
    // parseFolderName calls anitomy.parse which may throw on empty string;
    // verify it returns a result object for a minimal valid input
    const result = parseFolderName('Test');
    assert.ok(result);
    assert.ok(typeof result.title === 'string');
  });

  it('strips trailing slash', () => {
    const result = parseFolderName('[SubGroup] 动漫标题/');
    assert.ok(result.title, 'title should be defined after slash strip');
  });

  it('extracts bangumiId when [bgmN] present', () => {
    const result = parseFolderName('[bgm12345] [SubGroup] 动漫标题');
    assert.equal(result.bangumiId, 12345);
  });

  it('returns null bangumiId when no [bgmN]', () => {
    const result = parseFolderName('[SubGroup] 动漫标题');
    assert.equal(result.bangumiId, null);
  });

  it('extracts season from symbol markers', () => {
    const result = parseFolderName('[SubGroup] 动漫标题♪♪');
    assert.equal(result.season, 2);
  });

  it('preserves cjkTitle for CJK folder names', () => {
    const result = parseFolderName('[SubGroup] 葬送的芙莉莲');
    assert.ok(result.cjkTitle, 'cjkTitle should be set for CJK names');
    assert.ok(/[\u4e00-\u9fff]/.test(result.cjkTitle));
  });
});
