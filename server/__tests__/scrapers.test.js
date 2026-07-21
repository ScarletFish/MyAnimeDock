// server/__tests__/scrapers.test.js — 元数据匹配逻辑测试
// 数据集: E:\Videos\Anime 的 16 个文件夹
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  normalizeTitle, sorensenDice, toHiragana, isPrimarilyRomaji,
  pickBestBySimilarity, extractRomajiTitle,
  syncAnilistDetail, registry,
} = require('../scrapers');
const { parseFolderName } = require('../scanner');

// ── Mock helpers ──
function mockAnilist(overrides) {
  const real = registry.get('anilist');
  const mock = {
    name: 'anilist',
    search: async () => [],
    fetchMetadata: async () => null,
    downloadBanner: async () => null,
    downloadCover: async () => null,
    enabled: () => true,
    ...overrides,
  };
  // 替换 registry 中的 anilist
  const idx = registry.scrapers.findIndex(s => s.name === 'anilist');
  registry.scrapers[idx] = mock;
  return { real, restore: () => { registry.scrapers[idx] = real; } };
}

const MATCHING_CONFIG = { apiSources: [{ type: 'anilist' }] };

// ── 真实数据集（bgmId 仅标注文件夹名含 [bgmN] 的条目）──
const DATASET = [
  { folder: '[喵萌奶茶屋&LoliHouse] 琉璃的宝石  Ruri no Houseki' },
  { folder: '[Kamigami] 宮崎駿 Miyazaki Hayao All Movies [BD x264 1080p DTS-HD Audio×N Sub×N]' },
  { folder: '[LoliHouse] Nukitashi The Animation  住在拔作岛上的贫乳该如何是好？' },
  { folder: '[LoliHouse] Oshi no Ko [12-24][WebRip 1080p HEVC-10bit AAC SRTx2]' },
  { folder: '[NEST] Smoking Behind the Supermarket with You S01 [CR WEB-DL 1080p AVC AAC][SC_TC]' },
  { folder: '[SAIO-Raws] Monogatari Series [BD 1920x1080 HEVC-10bit OPUSx2]' },
  { folder: '[VCB-Studio] Denpa Onna to Seishun Otoko [Ma10p_1080p]' },
  { folder: '[VCB-Studio] Gochiusa' },
  { folder: '[VCB-Studio] THE IDOLM@STER CINDERELLA GIRLS [Ma10p_1080p]' },
  { folder: '[VCB-Studio] Yuru Yuri' },
  { folder: '女神"异世界转生想成为什么"我"勇者的肋骨"' },
  { folder: '上伊那牡丹，酒醉身姿似百合花般' },
  { folder: '正反対な君と僕 [bgm525565]' },
  { folder: '主播女孩重度依赖' },
  { folder: 'カナン様はあくまでチョロい [bgm552589]' },
];

// ── normalizeTitle ──
describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    assert.equal(normalizeTitle('Hello! World?'), 'helloworld');
  });
  it('strips CJK punctuation', () => {
    assert.equal(normalizeTitle('测试。标题！'), '测试标题');
  });
  it('handles null', () => {
    assert.equal(normalizeTitle(null), '');
  });
  it('handles empty string', () => {
    assert.equal(normalizeTitle(''), '');
  });
  it('collapses whitespace', () => {
    assert.equal(normalizeTitle('a  b   c'), 'abc');
  });
});

// ── sorensenDice ──
describe('sorensenDice', () => {
  it('returns 1 for identical strings', () => {
    assert.equal(sorensenDice('hello', 'hello'), 1);
  });
  it('returns 0 for null inputs', () => {
    assert.equal(sorensenDice(null, 'hello'), 0);
    assert.equal(sorensenDice('hello', null), 0);
  });
  it('returns 0 for very short strings', () => {
    assert.equal(sorensenDice('a', 'b'), 0);
  });
  it('scores high for similar Latin titles', () => {
    const score = sorensenDice('Yuru Yuri', 'YuruYuri');
    assert.ok(score > 0.5, `expected > 0.5, got ${score}`);
  });
  it('scores higher for closer matches', () => {
    const high = sorensenDice('Oshi no Ko', 'Oshi no Ko');
    const low = sorensenDice('Oshi no Ko', 'Something Else');
    assert.ok(high > low);
  });
  it('is case-insensitive via normalizeTitle', () => {
    assert.equal(sorensenDice('ABC', 'abc'), 1);
  });
  it('handles CJK titles that normalize to same string', () => {
    // normalizeTitle keeps CJK chars, so identical CJK → score 1
    assert.equal(sorensenDice('推しの子', '推しの子'), 1);
  });
});

// ── toHiragana ──
describe('toHiragana', () => {
  it('converts katakana to hiragana', () => {
    assert.equal(toHiragana('カタカナ'), 'かたかな');
  });
  it('leaves hiragana unchanged', () => {
    assert.equal(toHiragana('ひらがな'), 'ひらがな');
  });
  it('leaves latin unchanged', () => {
    assert.equal(toHiragana('Hello'), 'Hello');
  });
  it('handles null', () => {
    assert.equal(toHiragana(null), null);
  });
  it('handles mixed scripts', () => {
    assert.equal(toHiragana('ハイプHello'), 'はいぷHello');
  });
});

// ── isPrimarilyRomaji ──
describe('isPrimarilyRomaji', () => {
  it('returns true for English titles', () => {
    assert.ok(isPrimarilyRomaji('Oshi no Ko'));
  });
  it('returns false for Japanese titles', () => {
    assert.ok(!isPrimarilyRomaji('推しの子'));
  });
  it('returns false for null', () => {
    assert.ok(!isPrimarilyRomaji(null));
  });
  it('returns true for mixed mostly-latin', () => {
    assert.ok(isPrimarilyRomaji('Denpa Onna to Seishun Otoko'));
  });
});

// ── extractRomajiTitle ──
describe('extractRomajiTitle', () => {
  it('extracts first Latin alias from infobox', () => {
    const infobox = [
      { key: '别名', value: ['Oshi no Ko', '推しの子'] },
    ];
    assert.equal(extractRomajiTitle(infobox), 'Oshi no Ko');
  });
  it('returns null for non-Latin aliases', () => {
    const infobox = [
      { key: '别名', value: ['推しの子'] },
    ];
    assert.equal(extractRomajiTitle(infobox), null);
  });
  it('returns null for null infobox', () => {
    assert.equal(extractRomajiTitle(null), null);
  });
  it('returns null for empty array', () => {
    assert.equal(extractRomajiTitle([]), null);
  });
  it('handles object-style alias values', () => {
    const infobox = [
      { key: '别名', value: [{ v: 'Yuru Yuri' }, { v: 'ゆるゆり' }] },
    ];
    assert.equal(extractRomajiTitle(infobox), 'Yuru Yuri');
  });
});

// ── pickBestBySimilarity ──
describe('pickBestBySimilarity', () => {
  it('picks the most similar result', () => {
    const results = [
      { id: 1, name_cn: '推しの子', name: 'Oshi no Ko' },
      { id: 2, name_cn: '别的作品', name: 'Something Else' },
    ];
    const best = pickBestBySimilarity('Oshi no Ko', results);
    assert.equal(best.id, 1);
  });
  it('picks by name_cn when available', () => {
    const results = [
      { id: 1, name_cn: 'ゆるゆり', name: 'Yuru Yuri' },
      { id: 2, name_cn: '别的', name: 'Other' },
    ];
    const best = pickBestBySimilarity('Yuru Yuri', results);
    assert.equal(best.id, 1);
  });
});

// ── parseFolderName with real dataset ──
describe('parseFolderName — real dataset', () => {
  for (const item of DATASET) {
    it(`parses: ${item.folder.substring(0, 40)}...`, () => {
      const r = parseFolderName(item.folder);
      assert.ok(r, 'should return a result');
      assert.ok(typeof r.title === 'string' || r.title === null);
    });
  }

  it('extracts [bgmN] from 正反対な君と僕 [bgm525565]', () => {
    const r = parseFolderName('正反対な君と僕 [bgm525565]');
    assert.equal(r.bangumiId, 525565);
  });

  it('extracts [bgmN] from カナン様はあくまでチョロい [bgm552589]', () => {
    const r = parseFolderName('カナン様はあくまでチョロい [bgm552589]');
    assert.equal(r.bangumiId, 552589);
  });

  it('parses Gochiusa and extracts cleanTitle', () => {
    const r = parseFolderName('[VCB-Studio] Gochiusa');
    assert.ok(r.cleanTitle || r.cjkTitle, 'should have a title');
  });

  it('parses Yuru Yuri and detects no season', () => {
    const r = parseFolderName('[VCB-Studio] Yuru Yuri');
    assert.equal(r.season, null);
  });

  it('parses 宮崎駿 collection and has no bangumiId', () => {
    const r = parseFolderName('[Kamigami] 宮崎駿 Miyazaki Hayao All Movies [BD x264 1080p DTS-HD Audio×N Sub×N]');
    assert.equal(r.bangumiId, null);
  });

  it('parses CJK-only title 女神"异世界转生想成为什么"我"勇者的肋骨"', () => {
    const r = parseFolderName('女神"异世界转生想成为什么"我"勇者的肋骨"');
    assert.ok(r.cjkTitle || r.cleanTitle, 'should extract title');
  });

  it('parses Monogatari Series and has no bangumiId', () => {
    const r = parseFolderName('[SAIO-Raws] Monogatari Series [BD 1920x1080 HEVC-10bit OPUSx2]');
    assert.equal(r.bangumiId, null);
  });

  it('parses Nukitashi and extracts cleanTitle', () => {
    const r = parseFolderName('[LoliHouse] Nukitashi The Animation  住在拔作岛上的贫乳该如何是好？');
    assert.ok(r.cleanTitle || r.cjkTitle, 'should extract title');
  });

  it('parses IDOLM@STER and extracts cleanTitle', () => {
    const r = parseFolderName('[VCB-Studio] THE IDOLM@STER CINDERELLA GIRLS [Ma10p_1080p]');
    assert.ok(r.cleanTitle || r.cjkTitle, 'should extract title');
  });
});

// ── syncAnilistDetail (mocked) ──
describe('syncAnilistDetail — mocked', () => {
  it('returns null for anime without anilistId', async () => {
    const anime = { anilistId: null, title: 'Test' };
    const result = await syncAnilistDetail(anime, {}, '/tmp/banners', '/tmp/covers');
    assert.equal(result, null);
  });

  it('returns null for anilistId = -1', async () => {
    const anime = { anilistId: -1, title: 'Test' };
    const result = await syncAnilistDetail(anime, {}, '/tmp/banners', '/tmp/covers');
    assert.equal(result, null);
  });

  it('returns null for null anime', async () => {
    const result = await syncAnilistDetail(null, {}, '/tmp/banners', '/tmp/covers');
    assert.equal(result, null);
  });
});



// ── syncAnilistDetail (mock API) ──
describe('syncAnilistDetail — mock API', () => {
  it('fetches metadata and downloads banner', async () => {
    const { restore } = mockAnilist({
      fetchMetadata: async (title, coverDir, id) => ({
        anilistId: id,
        bannerImage: 'https://example.com/banner.jpg',
        anilistTitleEn: 'Yuru Yuri',
      }),
      downloadBanner: async (url, dir, id) => `/banners/al-${id}.jpg`,
    });
    try {
      const anime = { anilistId: 28900, title: 'Yuru Yuri' };
      const result = await syncAnilistDetail(anime, MATCHING_CONFIG, '/tmp/banners', '/tmp/covers');
      assert.equal(result.anilistId, 28900);
      assert.equal(result.localBanner, 'https://example.com/banner.jpg');
      assert.equal(anime.anilistBanner, 'https://example.com/banner.jpg');
      assert.equal(anime.anilistTitleEn, 'Yuru Yuri');
    } finally { restore(); }
  });

  it('handles fetchMetadata failure gracefully', async () => {
    const { restore } = mockAnilist({
      fetchMetadata: async () => { throw new Error('API down'); },
    });
    try {
      const anime = { anilistId: 28900, title: 'Yuru Yuri' };
      const result = await syncAnilistDetail(anime, MATCHING_CONFIG, '/tmp/banners', '/tmp/covers');
      assert.equal(result, null);
    } finally { restore(); }
  });

  it('handles banner download failure gracefully', async () => {
    const { restore } = mockAnilist({
      fetchMetadata: async (title, coverDir, id) => ({
        anilistId: id,
        bannerImage: 'https://example.com/banner.jpg',
      }),
      downloadBanner: async () => { throw new Error('Download failed'); },
    });
    try {
      const anime = { anilistId: 28900, title: 'Yuru Yuri' };
      const result = await syncAnilistDetail(anime, MATCHING_CONFIG, '/tmp/banners', '/tmp/covers');
      assert.equal(result.anilistId, 28900);
      assert.equal(anime.anilistBanner, 'https://example.com/banner.jpg'); // URL set regardless of download
    } finally { restore(); }
  });
});


