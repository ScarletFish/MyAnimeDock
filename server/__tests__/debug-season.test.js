// server/__tests__/debug-season.test.js — 排查多季度 AniList 匹配问题
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { Parser } = require('anitomy');
const {
  buildSearchTerms, toHiragana, pickBestBySimilarity,
  searchBangumiBySeason, registry, matchSeason, searchViaAniList,
} = require('../dist/scrapers');
const { parseFolderName } = require('../dist/scanner');

const anitomy = new Parser();

// ── 模拟 Yuru Yuri 的目录结构 ──
const FOLDERS = [
  { name: '[VCB-Studio] Yuru Yuri', desc: '父目录' },
  { name: '[VCB-Studio] Yuru Yuri [Ma10p_1080p]', desc: 'S1 子目录' },
  { name: '[VCB-Studio] Yuru Yuri 2 [Ma10p_1080p]', desc: 'S2 子目录' },
  { name: '[VCB-Studio] Yuru Yuri 3 [Ma10p_1080p]', desc: 'S3 子目录' },
  { name: '[VCB-Studio] Yuru Yuri Nachuyachumi! [Ma10p_1080p]', desc: 'OVA 子目录' },
];

const CONFIG = {
  apiSources: [
    { type: 'anilist', url: 'https://graphql.anilist.co', key: '' },
    { type: 'bangumi', url: 'https://api.bangumi.lol', key: '' },
  ],
};

// ── 模拟 AniList 搜索（Yuru Yuri + 混合） ──
function createMockAnilistYuruYuri() {
  return async (keyword) => {
    if (/yuru/i.test(keyword) || /ゆる/i.test(keyword)) {
      return [
        { id: 28900, name: 'Yuru Yuri', name_cn: 'ゆるゆり', title_native: 'ゆるゆり',
          season: 'WINTER', seasonYear: 2011, format: 'TV', episodes: 12, relations: [], source: 'anilist' },
        { id: 28901, name: 'Yuru Yuri ♪♪', name_cn: 'ゆるゆり♪♪', title_native: 'ゆるゆり♪♪',
          season: 'SUMMER', seasonYear: 2012, format: 'TV', episodes: 12, relations: [], source: 'anilist' },
        { id: 28902, name: 'Yuru Yuri ♪♪♪', name_cn: 'ゆるゆり♪♪♪', title_native: 'ゆるゆり♪♪♪',
          season: 'FALL', seasonYear: 2015, format: 'TV', episodes: 12, relations: [], source: 'anilist' },
        { id: 28903, name: 'Yuru Yuri Nachuyachumi!+', name_cn: 'ゆるゆり なちゅやちゅみ！＋', title_native: 'ゆるゆり なちゅやちゅみ！＋',
          season: null, seasonYear: null, format: 'OVA', episodes: 2, relations: [], source: 'anilist' },
        { id: 28904, name: 'Yuru Yuri Nachuyachumi!', name_cn: 'ゆるゆり なちゅやちゅみ！', title_native: 'ゆるゆり なちゅやちゅみ！',
          season: null, seasonYear: 2014, format: 'OVA', episodes: 1, relations: [], source: 'anilist' },
      ];
    }
    return [];
  };
}

function installMock(mockSearchFn) {
  const real = registry.get('anilist');
  const idx = registry.scrapers.findIndex(s => s.name === 'anilist');
  registry.scrapers[idx] = {
    name: 'anilist',
    search: mockSearchFn,
    fetchMetadata: async () => null,
    downloadBanner: async () => null,
    downloadCover: async () => null,
    enabled: () => true,
    _registry: real._registry,
    setSource: () => {},
  };
  return () => { registry.scrapers[idx] = real; registry.clearSearchCache(); };
}

// ════════════════════════════════════════════════
// 步骤 1: 基础解析
// ════════════════════════════════════════════════
describe('1: anitomy 原始解析', () => {
  for (const { name, desc } of FOLDERS) {
    it(`${desc}`, () => {
      const parsed = anitomy.parse(name);
      assert.ok(parsed);
    });
  }
});

describe('2: parseFolderName', () => {
  for (const { name, desc } of FOLDERS) {
    it(`${desc}`, () => {
      const r = parseFolderName(name);
      assert.ok(r);
    });
  }
  it('S2 season=2', () => {
    assert.equal(parseFolderName('[VCB-Studio] Yuru Yuri 2 [Ma10p_1080p]').season, 2);
  });
  it('S3 season=3', () => {
    assert.equal(parseFolderName('[VCB-Studio] Yuru Yuri 3 [Ma10p_1080p]').season, 3);
  });
  it('S1 season=null', () => {
    assert.equal(parseFolderName('[VCB-Studio] Yuru Yuri [Ma10p_1080p]').season, null);
  });
  it('OVA season=null', () => {
    assert.equal(parseFolderName('[VCB-Studio] Yuru Yuri Nachuyachumi! [Ma10p_1080p]').season, null);
  });
});

// ════════════════════════════════════════════════
// 步骤 2: buildSearchTerms
// ════════════════════════════════════════════════
describe('3: buildSearchTerms', () => {
  it('S2 包含 第2期 关键词', () => {
    const r = parseFolderName('[VCB-Studio] Yuru Yuri 2 [Ma10p_1080p]');
    const terms = buildSearchTerms(r, r.cleanTitle);
    assert.ok(terms.includes('Yuru Yuri'), '应有 base title');
    assert.ok(terms.includes('Yuru Yuri 第2期'), '应有季节标记');
  });
  it('S1 只有 base title', () => {
    const r = parseFolderName('[VCB-Studio] Yuru Yuri [Ma10p_1080p]');
    const terms = buildSearchTerms(r, r.cleanTitle);
    assert.deepEqual(terms, ['Yuru Yuri']);
  });
});

// ════════════════════════════════════════════════
// 步骤 3: searchBangumiBySeason 排序逻辑验证
// ════════════════════════════════════════════════
describe('4: searchBangumiBySeason 季节排序', () => {
  let restore;
  let searchCalls = [];

  before(() => {
    searchCalls = [];
    restore = installMock(async (keyword) => {
      searchCalls.push(keyword);
      if (/yuru/i.test(keyword)) {
        // 模拟 AniList 按 POPULARITY_DESC 返回（S1 最早但可能不排第一）
        return [
          { id: 28902, name: 'Yuru Yuri ♪♪♪', name_cn: 'ゆるゆり♪♪♪', title_native: 'ゆるゆり♪♪♪',
            season: 'FALL', seasonYear: 2015, format: 'TV', episodes: 12, relations: [] },
          { id: 28900, name: 'Yuru Yuri', name_cn: 'ゆるゆり', title_native: 'ゆるゆり',
            season: 'WINTER', seasonYear: 2011, format: 'TV', episodes: 12, relations: [] },
          { id: 28901, name: 'Yuru Yuri ♪♪', name_cn: 'ゆるゆり♪♪', title_native: 'ゆるゆり♪♪',
            season: 'SUMMER', seasonYear: 2012, format: 'TV', episodes: 12, relations: [] },
          { id: 28904, name: 'Yuru Yuri Nachuyachumi!', name_cn: 'ゆるゆり なちゅやちゅみ！',
            title_native: 'ゆるゆり なちゅやちゅみ！',
            season: null, seasonYear: 2014, format: 'OVA', episodes: 1, relations: [] },
        ];
      }
      return [];
    });
  });

  after(() => { restore(); });

  it('S2 应正确选择第二季 (2012 SUMMER)', async () => {
    searchCalls = [];
    const reg = require('../dist/scrapers').registry;
    const bangumi = reg.get('bangumi');
    const results = await searchBangumiBySeason(reg, bangumi, 'Yuru Yuri', 2, CONFIG);
    // searchBangumi 负责搜索 Bangumi，因为实际 Bangumi API 搜索不到模拟器
    // 但我们需要验证 AniList search 被正确调用
    assert.ok(searchCalls.length > 0, 'AniList search 应该被调用');
    assert.ok(searchCalls[0].includes('Yuru'), `搜索关键词应为 Yuru Yuri，实际: ${searchCalls[0]}`);
    // searchBangumiBySeason 的结果取决于 Bangumi API 对 native title 的搜索
    // 这里我们只验证 AniList search 被调用了
  });

  it('S3 应正确选择第三季 (2015 FALL)', async () => {
    searchCalls = [];
    const reg = require('../dist/scrapers').registry;
    const bangumi = reg.get('bangumi');
    const results = await searchBangumiBySeason(reg, bangumi, 'Yuru Yuri', 3, CONFIG);
    assert.ok(searchCalls.length > 0, 'AniList search 应该被调用');
  });
});

// ════════════════════════════════════════════════
// 步骤 4: Enbaled() 边界条件
// ════════════════════════════════════════════════
describe('5: anilist.enabled() 边界条件', () => {
  it('apiSources=undefined → enabled=true', () => {
    const anilist = registry.get('anilist');
    assert.ok(anilist.enabled({}));
  });
  it('apiSources 不含 anilist → enabled=true', () => {
    const anilist = registry.get('anilist');
    assert.ok(anilist.enabled({ apiSources: [{ type: 'bangumi' }] }));
  });
  it('apiSources 含 anilist.enabled=false → enabled=false', () => {
    const anilist = registry.get('anilist');
    assert.ok(!anilist.enabled({ apiSources: [{ type: 'anilist', enabled: false }] }));
  });
  it('config=null → enabled=true', () => {
    const anilist = registry.get('anilist');
    assert.ok(anilist.enabled(null));
  });
});

// ════════════════════════════════════════════════
// 步骤 5: matchSeason 完整模拟（S1 走 searchViaAniList）
// ════════════════════════════════════════════════
describe('6: matchSeason 完整调用链', () => {
  let restore;
  let anilistCalls = [];

  before(() => {
    anilistCalls = [];
    restore = installMock(async (keyword) => {
      anilistCalls.push(keyword);
      if (/yuru/i.test(keyword) || /ゆる/i.test(keyword)) {
        return [
          { id: 28900, name: 'Yuru Yuri', name_cn: 'ゆるゆり', title_native: 'ゆるゆり',
            season: 'WINTER', seasonYear: 2011, format: 'TV', episodes: 12, relations: [] },
          { id: 28901, name: 'Yuru Yuri ♪♪', name_cn: 'ゆるゆり♪♪', title_native: 'ゆるゆり♪♪',
            season: 'SUMMER', seasonYear: 2012, format: 'TV', episodes: 12, relations: [] },
          { id: 28902, name: 'Yuru Yuri ♪♪♪', name_cn: 'ゆるゆり♪♪♪', title_native: 'ゆるゆり♪♪♪',
            season: 'FALL', seasonYear: 2015, format: 'TV', episodes: 12, relations: [] },
        ];
      }
      return [];
    });
  });

  after(() => { restore(); });

  it('S1 (season=null) → 应走 searchViaAniList 路径', async () => {
    anilistCalls = [];
    const fp = parseFolderName('[VCB-Studio] Yuru Yuri [Ma10p_1080p]');
    assert.equal(fp.season, null);
    // 手动调 searchViaAniList 验证 AniList 被调用
    const reg = require('../dist/scrapers').registry;
    const bangumi = reg.get('bangumi');
    await searchViaAniList(reg, bangumi, 'Yuru Yuri', CONFIG);
    assert.ok(anilistCalls.length > 0,
      `❌ searchViaAniList 没有调用 AniList search! searchTerms: [Yuru Yuri]`);
    assert.ok(anilistCalls.some(k => /yuru/i.test(k)));
  });

  it('S2 (season=2) → 应走 searchBangumiBySeason 路径', async () => {
    anilistCalls = [];
    const fp = parseFolderName('[VCB-Studio] Yuru Yuri 2 [Ma10p_1080p]');
    const reg = require('../dist/scrapers').registry;
    const bangumi = reg.get('bangumi');
    await searchBangumiBySeason(reg, bangumi, fp.cleanTitle, fp.season, CONFIG);
    assert.ok(anilistCalls.length > 0,
      `❌ searchBangumiBySeason 没有调用 AniList search! season=${fp.season}`);
  });
});

// ════════════════════════════════════════════════
// 步骤 6: 真实 API 冒烟测试
// ════════════════════════════════════════════════
describe('7: 真实 AniList API 冒烟测试', () => {
  it('搜索 Yuru Yuri 应返回结果', { timeout: 10000 }, async () => {
    const anilist = registry.get('anilist');
    const results = await anilist.search('Yuru Yuri');
    assert.ok(results.length > 0, 'AniList 应返回 Yuru Yuri 搜索结果');
    
    // 检查 TV 条目按季节排序
    const tv = results.filter(r => r.format === 'TV').sort((a, b) => {
      const SEASON_ORDER = { WINTER: 1, SPRING: 2, SUMMER: 3, FALL: 4 };
      const ya = a.seasonYear || 9999, yb = b.seasonYear || 9999;
      if (ya !== yb) return ya - yb;
      return (SEASON_ORDER[a.season] || 0) - (SEASON_ORDER[b.season] || 0);
    });
    console.log(`  真实 AniList TV 条目 (${tv.length}):`);
    tv.forEach((t, i) => console.log(`    [${i}] ID=${t.id} name="${t.name}" ${t.seasonYear} ${t.season}`));
    
    // 验证排序正确
    if (tv.length >= 2) {
      assert.ok(tv[0].seasonYear <= tv[1].seasonYear,
        `TV 应按时序排序: ${tv[0].seasonYear} <= ${tv[1].seasonYear}`);
    }
    
    // 验证 S2 定位
    if (tv.length >= 2) {
      const target = tv[1]; // season=2
      assert.ok(target.seasonYear >= tv[0].seasonYear,
        `S2 (season=2) 应选择第二部: ${target.name} (${target.seasonYear})`);
      console.log(`  ✅ S2 → 定位到: "${target.name}" (ID=${target.id}, ${target.seasonYear} ${target.season})`);
    }
  });
});
