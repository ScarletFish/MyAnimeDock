// server/__tests__/scrapers.test.js — 元数据匹配逻辑测试
// 数据集: E:\Videos\Anime 的 16 个文件夹
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  normalizeTitle, sorensenDice, toHiragana, isPrimarilyRomaji,
  pickBestBySimilarity, extractRomajiTitle,
  ensureMetadata, ensureMetadataBatch, registry,
} = require('../dist/scrapers');
const { parseFolderName } = require('../dist/scanner');

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

function mockBangumi(overrides) {
  const real = registry.get('bangumi');
  const mock = {
    name: 'bangumi',
    search: async () => [],
    fetchMetadata: async () => null,
    downloadCover: async () => null,
    enabled: () => true,
    ...overrides,
  };
  const idx = registry.scrapers.findIndex(s => s.name === 'bangumi');
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
    const { item: best } = pickBestBySimilarity('Oshi no Ko', results);
    assert.equal(best.id, 1);
  });
  it('picks by name_cn when available', () => {
    const results = [
      { id: 1, name_cn: 'ゆるゆり', name: 'Yuru Yuri' },
      { id: 2, name_cn: '别的', name: 'Other' },
    ];
    const { item: best } = pickBestBySimilarity('Yuru Yuri', results);
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

// ── ensureMetadata (mocked) ──
describe('ensureMetadata — mocked', () => {
  it('returns empty set for anime without anilistId', async () => {
    const anime = { id: 'a1', anilistId: null, title: 'Test' };
    const changed = await ensureMetadata(anime, {}, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
    assert.equal(changed.size, 0);
  });

  it('returns empty set for anilistId = -1', async () => {
    const anime = { id: 'a1', anilistId: -1, title: 'Test' };
    const changed = await ensureMetadata(anime, {}, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
    assert.equal(changed.size, 0);
  });

  it('returns empty set for null anime', async () => {
    const changed = await ensureMetadata(null, {}, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
    assert.equal(changed.size, 0);
  });
});



// ── ensureMetadata (mock API) ──
describe('ensureMetadata — mock API', () => {
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
      const anime = { id: 'a1', anilistId: 28900, title: 'Yuru Yuri' };
      const changed = await ensureMetadata(anime, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.ok(changed.has('a1'));
      assert.equal(anime.anilistBanner, '/banners/al-28900.jpg'); // downloadBanner 返回本地路径
      assert.equal(anime.anilistTitleEn, 'Yuru Yuri');
    } finally { restore(); }
  });

  it('handles fetchMetadata failure gracefully', async () => {
    const { restore } = mockAnilist({
      fetchMetadata: async () => { throw new Error('API down'); },
    });
    try {
      const anime = { id: 'a1', anilistId: 28900, title: 'Yuru Yuri' };
      const changed = await ensureMetadata(anime, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.equal(changed.size, 0);
    } finally { restore(); }
  });

  it('handles banner download failure gracefully → banner = null (no remote URL fallback)', async () => {
    const { restore } = mockAnilist({
      fetchMetadata: async (title, coverDir, id) => ({
        anilistId: id,
        bannerImage: 'https://example.com/banner.jpg',
      }),
      downloadBanner: async () => { throw new Error('Download failed'); },
    });
    try {
      const anime = { id: 'a1', anilistId: 28900, title: 'Yuru Yuri' };
      const changed = await ensureMetadata(anime, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.ok(changed.has('a1'));
      assert.equal(anime.anilistBanner, null); // 下载失败 → null，不保留远程 URL
    } finally { restore(); }
  });

  it('sets __none__ when bannerImage is null', async () => {
    const { restore } = mockAnilist({
      fetchMetadata: async (title, coverDir, id) => ({
        anilistId: id,
        bannerImage: null,
      }),
      downloadBanner: async () => '/banners/al-test.jpg',
    });
    try {
      const anime = { id: 'a1', anilistId: 28900, title: 'Yuru Yuri' };
      const changed = await ensureMetadata(anime, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.ok(changed.has('a1'));
      assert.equal(anime.anilistBanner, '__none__');
    } finally { restore(); }
  });
});

// ── ensureMetadataBatch (双源批量补全) ──
describe('ensureMetadataBatch', () => {
  it('AniList: 补全缺 banner/tags 的条目并返回 changed', async () => {
    const { restore } = mockAnilist({
      batchGetDetails: async (ids) => ids.map(id => ({
        id,
        bannerImage: 'https://example.com/banner.jpg',
        title: { english: 'Yuru Yuri' },
        tags: [{ name: 'Cute Girls Doing Cute Things', rank: 90, isGeneralSpoiler: false, isMediaSpoiler: false }],
        studios: { edges: [{ isMain: true, node: { name: 'Doga Kobo' } }] },
      })),
      downloadBanner: async (url, dir, id) => `/banners/al-${id}.jpg`,
    });
    try {
      const library = [{ id: 'a1', anilistId: 28900, title: 'Yuru Yuri' }];
      const changed = await ensureMetadataBatch(library, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.equal(changed.size, 1);
      assert.ok(changed.has('a1'));
      const a = library[0];
      assert.equal(a.anilistBanner, '/banners/al-28900.jpg');
      assert.equal(a.anilistTitleEn, 'Yuru Yuri');
      assert.equal(a.anilistTags.length, 1);
      assert.deepEqual(a.anilistStudios, ['Doga Kobo']);
    } finally { restore(); }
  });

  it('AniList: 无 banner → 标 __none__ 防重复查询', async () => {
    const { restore } = mockAnilist({
      batchGetDetails: async (ids) => ids.map(id => ({ id, bannerImage: null })),
      downloadBanner: async () => '/banners/al-x.jpg',
    });
    try {
      const library = [{ id: 'a1', anilistId: 28900, title: 'Yuru Yuri' }];
      const changed = await ensureMetadataBatch(library, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.equal(changed.size, 1);
      assert.equal(library[0].anilistBanner, '__none__');
    } finally { restore(); }
  });

  it('AniList: 数据完整 / anilistId 为 -1 或 null 的条目跳过', async () => {
    const { restore } = mockAnilist({
      batchGetDetails: async () => { throw new Error('should not be called'); },
    });
    try {
      const library = [
        { id: 'a1', anilistId: 28900, anilistBanner: '/banners/al-1.jpg', anilistTags: [{ name: 'x' }] },
        { id: 'a2', anilistId: -1, title: 'No match' },
        { id: 'a3', anilistId: null, title: 'No id' },
      ];
      const changed = await ensureMetadataBatch(library, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.equal(changed.size, 0);
    } finally { restore(); }
  });

  it('Bangumi: 缺核心字段 → fetchMetadata 全量补', async () => {
    const { restore } = mockBangumi({
      fetchMetadata: async (title, coverDir, id) => ({
        source: 'bangumi', bangumiId: id, summary: '简介', rating: 8.5,
        characters: [{ id: 1, name: '主角' }],
      }),
    });
    try {
      const library = [{ id: 'b1', bangumiId: 525565, title: '正反対な君と僕' }];
      const changed = await ensureMetadataBatch(library, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.equal(changed.size, 1);
      assert.ok(changed.has('b1'));
      assert.equal(library[0].summary, '简介');
      assert.equal(library[0].rating, 8.5);
      assert.equal(library[0].characters.length, 1);
    } finally { restore(); }
  });

  it('Bangumi: 数据完整（summary/rating/characters 齐全）跳过', async () => {
    const { restore } = mockBangumi({
      fetchMetadata: async () => { throw new Error('should not be called'); },
    });
    try {
      const library = [{ id: 'b1', bangumiId: 525565, summary: 'x', rating: 8, characters: [{ id: 1 }] }];
      const changed = await ensureMetadataBatch(library, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.equal(changed.size, 0);
    } finally { restore(); }
  });

  it('双源同时补全', async () => {
    const { restore: ra } = mockAnilist({
      batchGetDetails: async (ids) => ids.map(id => ({ id, bannerImage: 'https://x/b.jpg' })),
      downloadBanner: async (url, dir, id) => `/banners/al-${id}.jpg`,
    });
    const { restore: rb } = mockBangumi({
      fetchMetadata: async (title, coverDir, id) => ({ source: 'bangumi', bangumiId: id, summary: 's', rating: 9 }),
    });
    try {
      const library = [
        { id: 'a1', anilistId: 28900, title: 'Yuru Yuri' },
        { id: 'b1', bangumiId: 525565, title: '正反対な君と僕' },
      ];
      const changed = await ensureMetadataBatch(library, MATCHING_CONFIG, { coverDir: '/tmp/covers', bannerDir: '/tmp/banners' });
      assert.equal(changed.size, 2);
      assert.ok(changed.has('a1'));
      assert.ok(changed.has('b1'));
    } finally { ra(); rb(); }
  });
});


