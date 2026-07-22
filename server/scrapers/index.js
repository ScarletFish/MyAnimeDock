const BangumiScraper = require('./bangumi');
const AniListScraper = require('./anilist');
const logger = require('../logger').child('[SCRAPER]');

/**
 * Process items in parallel with concurrency limit
 */
async function parallelMap(items, fn, concurrency = 3) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * Normalize title for comparison: remove punctuation, whitespace, case-insensitive
 */
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .replace(/[？?！!。.、,，～~··・（ ）【】「」『』《》：；!@#$%^&*()_\-+=\[\]{}|\\;:'",.<>?/`~]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** Convert katakana to hiragana for AniList search normalization */
function toHiragana(s) {
  if (!s) return s;
  return s.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Sorensen-Dice coefficient for fuzzy string comparison
 * Returns 0-1, where 1 is identical
 */
function sorensenDice(a, b) {
  if (!a || !b) return 0;
  a = normalizeTitle(a);
  b = normalizeTitle(b);
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const getBigrams = s => {
    const bigrams = new Set();
    for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2));
    return bigrams;
  };
  const aBigrams = getBigrams(a);
  const bBigrams = getBigrams(b);
  let overlap = 0;
  for (const bg of aBigrams) if (bBigrams.has(bg)) overlap++;
  return (2 * overlap) / (aBigrams.size + bBigrams.size);
}

/**
 * Detect special type from folder title
 */
function detectSpecialType(title) {
  if (!title) return null;
  if (/剧场版|Movie|劇場版/.test(title)) return 'movie';
  if (/OVA|OAD|Special|特典/.test(title)) return 'ova';
  if (/[~～].*[~～]/.test(title)) return 'special';
  return null;
}

/**
 * Extract base title (without ~...~ suffix) and special suffix
 * Returns { baseTitle, specialSuffix }
 */
function extractBaseAndSuffix(title) {
  if (!title) return { baseTitle: title, specialSuffix: null };
  const match = title.match(/^(.+?)\s*([~～].*?[~～])\s*$/);
  if (match) {
    return { baseTitle: match[1].trim(), specialSuffix: match[2].trim() };
  }
  return { baseTitle: title.trim(), specialSuffix: null };
}

/**
 * Check if title is primarily romaji (Latin characters)
 */
function isPrimarilyRomaji(title) {
  if (!title) return false;
  const latinChars = (title.match(/[a-zA-Z]/g) || []).length;
  const totalChars = title.replace(/\s/g, '').length;
  return latinChars / totalChars > 0.6;
}

/**
 * Build search terms from folder parsed data (multiple variations)
 */
function buildSearchTerms(folderParsed, keyword) {
  const terms = [];
  const base = (folderParsed.cleanTitle || folderParsed.cjkTitle || keyword).replace(/[~～]/g, '').trim();
  const season = folderParsed.season;

  // Priority 1: suffix content (e.g., "Dear My Sister") — more precise for OVA/movie
  if (folderParsed.specialSuffix) {
    const content = folderParsed.specialSuffix.replace(/[~～]/g, '').trim();
    const generic = /^(OVA|OAD|Special|PV\d*|NCOP|NCED|CM[ \d]*|Menu\d*|Preview|Trailer|特典)$/i;
    if (content.length > 3 && !generic.test(content)) {
      terms.push(content);
      // Combined base + suffix: "Yuru Yuri dear my sister" has better Bangumi matching
      terms.push(`${base} ${content}`);
    }
  }

  // Priority 2: base + season suffix
  if (season) {
    terms.push(`${base} 第${season}期`);
  }
  terms.push(base);

  // Fallback: if base is too short, use title (with suffix)
  if (base.length < 4 && folderParsed.title && folderParsed.title !== base) {
    terms.push(folderParsed.title);
  }

  const result = [...new Set(terms)];
  logger.info(`buildSearchTerms: base="${base}" season=${season} suffix="${folderParsed.specialSuffix || ''}" → [${result.join(', ')}]`);
  return result;
}

/**
 * Search Bangumi directly (with 5-min TTL cache)
 */
const _bangumiSearchCache = new Map();
const _bangumiCacheTTL = 5 * 60 * 1000;
let _bangumiSearchFailLogged = false;

async function searchBangumi(bangumi, keyword, config) {
  const source = config.apiSources?.find(s => s.type === 'bangumi');
  if (!source) {
    logger.debug(`searchBangumi: "${keyword}" → 跳过（无 bangumi apiSources）`);
    return [];
  }

  const cached = _bangumiSearchCache.get(keyword);
  if (cached && Date.now() - cached.ts < _bangumiCacheTTL) {
    logger.debug(`searchBangumi: "${keyword}" → 返回缓存 (${cached.results.length} 条)`);
    return cached.results;
  }

  try {
    const results = await bangumi.search(keyword, source);
    const filtered = results.filter(r => r.type === 2);
    logger.debug(`searchBangumi: "${keyword}" → Bangumi 返回 ${results.length} 条，filter type=2 → ${filtered.length} 条`);
    _bangumiSearchCache.set(keyword, { results: filtered, ts: Date.now() });
    _bangumiSearchFailLogged = false;
    return filtered;
  } catch (e) {
    if (!_bangumiSearchFailLogged) {
      logger.error('Bangumi search failed:', e.message);
      _bangumiSearchFailLogged = true;
    }
    return [];
  }
}

/**
 * Search via AniList → get Japanese title → search Bangumi
 */
async function searchViaAniList(registry, bangumi, searchTerm, config) {
  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled(config)) {
    logger.debug(`searchViaAniList: "${searchTerm}" → AniList 不可用，直搜 Bangumi`);
    const fallbackResults = await searchBangumi(bangumi, searchTerm, config);
    return { bangumiResults: fallbackResults, anilistId: null };
  }

  try {
    const source = config.apiSources?.find(s => s.type === 'anilist');
    logger.debug(`searchViaAniList: "${searchTerm}" → 搜索 AniList...`);
    const anilistResults = await anilist.search(searchTerm, source);
    logger.debug(`searchViaAniList: "${searchTerm}" → AniList 返回 ${anilistResults.length} 条结果`);
    if (anilistResults.length === 0) {
      logger.warn(`searchViaAniList: "${searchTerm}" → 0 结果，降级直接搜 Bangumi`);
      const fallbackResults = await searchBangumi(bangumi, searchTerm, config);
      return { bangumiResults: fallbackResults, anilistId: null };
    }

    // AniList 只用于获取日文标题，搜索结果不直接使用
    const jpTitle = anilistResults[0].title_native || anilistResults[0].name;
    logger.debug(`searchViaAniList: "${searchTerm}" → AniList top: "${jpTitle}" (id=${anilistResults[0].id})`);
    if (jpTitle) {
      const bangumiResults = await searchBangumi(bangumi, jpTitle, config);
      if (bangumiResults.length > 0) {
        logger.debug(`searchViaAniList: "${searchTerm}" → 通过日文标题 "${jpTitle}" 找到 ${bangumiResults.length} 个 Bangumi 结果`);
        return { bangumiResults, anilistId: anilistResults[0].id };
      }
      logger.debug(`searchViaAniList: "${searchTerm}" → 日文标题 "${jpTitle}" 在 Bangumi 无结果`);
    }

    return { bangumiResults: [], anilistId: null };
  } catch (e) {
    logger.error('AniList search failed, fallback to Bangumi:', e.message);
    const errorResults = await searchBangumi(bangumi, searchTerm, config);
    return { bangumiResults: errorResults, anilistId: null };
  }
}

/**
 * Pick best match from search results using Sorensen-Dice
 * 根据搜索词脚本选择匹配字段：拉丁词对 name（罗马音），东亚词对 name_cn（本地名）
 */
function pickBestBySimilarity(cleanTitle, results) {
  const useName = isPrimarilyRomaji(cleanTitle);
  return results.reduce((best, r) => {
    const matchTitle = useName ? (r.name || r.name_cn || '') : (r.name_cn || r.name || '');
    const score = sorensenDice(cleanTitle, matchTitle);
    return score > best.score ? { item: r, score } : best;
  }, { item: results[0], score: 0 }).item;
}

/**
 * Search AniList for base title → find Nth season by temporal sort → native title → Bangumi
 * Bangumi search ignores "第3期" markers, so we use AniList's season metadata to
 * locate the correct entry, then use its exact native title for Bangumi lookup.
 */
async function searchBangumiBySeason(registry, bangumi, baseTitle, season, config) {
  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled(config)) {
    logger.debug(`searchBangumiBySeason: "${baseTitle}" S${season} → AniList 不可用`);
    return { bangumiResults: [], anilistId: null };
  }

  try {
    const source = config.apiSources?.find(s => s.type === 'anilist');
    logger.debug(`searchBangumiBySeason: "${baseTitle}" S${season} → 搜索 AniList...`);
    let alResults = await anilist.search(baseTitle, source);
    logger.debug(`searchBangumiBySeason: "${baseTitle}" S${season} → AniList 返回 ${alResults.length} 条原始结果`);
    if (alResults.length === 0) {
      // AniList 可能被限流或临时不可用，等待 3s 重试一次
      // 避免"API 挂了"和"真没结果"无法区分导致 season 匹配静默降级
      logger.warn(`searchBangumiBySeason: AniList 返回 0 结果（可能被限流），3s 后重试...`);
      await new Promise(r => setTimeout(r, 3000));
      alResults = await anilist.search(baseTitle, source);
      logger.debug(`searchBangumiBySeason: 重试后 AniList 返回 ${alResults.length} 条`);
      if (alResults.length === 0) {
        logger.warn(`searchBangumiBySeason: "${baseTitle}" S${season} → 重试仍无结果，放弃 season 路径`);
        return { bangumiResults: [], anilistId: null };
      }
      logger.info(`searchBangumiBySeason: 重试成功，进入 season 匹配`);
    }

    // Sort by season-year + season-order (not POPULARITY_DESC from AniList)
    const SEASON_ORDER = { WINTER: 1, SPRING: 2, SUMMER: 3, FALL: 4 };
    const sorted = [...alResults].sort((a, b) => {
      const ya = a.seasonYear || 9999, yb = b.seasonYear || 9999;
      if (ya !== yb) return ya - yb;
      return (SEASON_ORDER[a.season] || 0) - (SEASON_ORDER[b.season] || 0);
    });

    // Prefer TV entries, fall back to any format
    let candidates = sorted.filter(r => r.format === 'TV');
    if (candidates.length === 0) candidates = sorted;
    logger.debug(`searchBangumiBySeason: "${baseTitle}" S${season} → 排序后 TV=${sorted.filter(r=>r.format==='TV').length} 条, candidates=${candidates.length} 条`);
    candidates.forEach((c, i) => {
      logger.debug(`  candidates[${i}]: id=${c.id} name="${c.name}" ${c.seasonYear||'?'} ${c.season||'?'} format=${c.format}`);
    });

    const target = candidates[season - 1];
    if (!target) {
      logger.debug(`searchBangumiBySeason: "${baseTitle}" S${season} → candidates[${season-1}] 不存在（只有 ${candidates.length} 条 TV）`);
      return { bangumiResults: [], anilistId: null };
    }

    const nativeTitle = target.title_native || target.name;
    if (!nativeTitle) {
      logger.debug(`searchBangumiBySeason: "${baseTitle}" S${season} → target 无 nativeTitle`);
      return { bangumiResults: [], anilistId: null };
    }

    logger.info(`Season lookup: "${baseTitle}" S${season} → "${nativeTitle}" (${target.seasonYear || '?'} ${target.season || '?'}, ${target.format})`);
    const bgResults = await searchBangumi(bangumi, nativeTitle, config);
    return { bangumiResults: bgResults, anilistId: target.id };
  } catch (e) {
    logger.error('Season-specific AniList lookup failed:', e.message);
    return { bangumiResults: [], anilistId: null };
  }
}

/**
 * Given an anilistId, search AniList for the franchise's base title,
 * sort entries chronologically, and find this entry's season number.
 * Returns 1-indexed season number or null.
 */
async function findSeasonByAnilistId(registry, baseTitle, anilistId, config) {
  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled(config) || !baseTitle || !anilistId) return null;
  try {
    const source = config.apiSources?.find(s => s.type === 'anilist');
    const alResults = await anilist.search(baseTitle, source);
    if (alResults.length === 0) return null;

    const SEASON_ORDER = { WINTER: 1, SPRING: 2, SUMMER: 3, FALL: 4 };
    const sorted = [...alResults].sort((a, b) => {
      const ya = a.seasonYear || 9999, yb = b.seasonYear || 9999;
      if (ya !== yb) return ya - yb;
      return (SEASON_ORDER[a.season] || 0) - (SEASON_ORDER[b.season] || 0);
    });

    // Prefer TV entries, fall back to any format
    let candidates = sorted.filter(r => r.format === 'TV');
    if (candidates.length === 0) candidates = sorted;

    const idx = candidates.findIndex(c => c.id === anilistId);
    if (idx === -1) return null;
    const season = idx + 1;
    logger.info(`findSeasonByAnilistId: "${baseTitle}" anilistId=${anilistId} → S${season} (${candidates.length} candidates)`);
    return season;
  } catch (e) {
    logger.warn(`findSeasonByAnilistId: "${baseTitle}" anilistId=${anilistId} → ${e.message}`);
    return null;
  }
}

/**
 * Main entry: single-phase matching
 * Search by title → pick best → get detail
 */
async function matchSeason(registry, keyword, folderParsed, videoCount, config) {
  const bangumi = registry.get('bangumi');
  if (!bangumi) {
    logger.error('matchSeason: bangumi scraper not found in registry');
    return null;
  }

  logger.info(`=== matchSeason 入口 === keyword="${keyword}" cleanTitle="${folderParsed.cleanTitle}" season=${folderParsed.season} specialSuffix="${folderParsed.specialSuffix||''}"`);

  // 1. Build search terms (multiple variations)
  const searchTerms = buildSearchTerms(folderParsed, keyword);

  // 2. Season-aware lookup via AniList (both romaji and CJK titles)
  //    Bangumi search ignores "第3期" markers and always returns S1.
  //    AniList provides seasonYear/season metadata → sort temporally →
  //    find the N-th entry's native title → precise Bangumi match.
  let results = [];
  let matchedAnilistId = null;
  if (folderParsed.season) {
    logger.info(`matchSeason: 有 season=${folderParsed.season} → 进入 searchBangumiBySeason 路径`);
    const seasonResult = await searchBangumiBySeason(registry, bangumi, folderParsed.cleanTitle, folderParsed.season, config);
    results = seasonResult.bangumiResults;
    matchedAnilistId = seasonResult.anilistId;
    logger.info(`matchSeason: searchBangumiBySeason 返回 ${results.length} 条结果`);
  } else {
    logger.info(`matchSeason: 无 season → 跳过 searchBangumiBySeason，进入 fallback 路径`);
  }

  // 3. Fallback: normal search term loop
  if (results.length === 0) {
    logger.info(`matchSeason: fallback 路径开始，searchTerms=[${searchTerms.join(', ')}]`);
    for (const term of searchTerms) {
      // Base title → use AniList route (gets native JP/CJK title → Bangumi)
      // Other terms (season marker, suffix) → Bangumi directly
      const isBaseTitle = term === (folderParsed.cleanTitle || folderParsed.title);
      logger.info(`matchSeason: fallback 迭代 term="${term}" isBaseTitle=${isBaseTitle} isCJK=${!isPrimarilyRomaji(term)}`);
      if (isBaseTitle && isPrimarilyRomaji(term)) {
        // 罗马音/英文 → 走 AniList 桥拿日文原名再搜 Bangumi
        const alResult = await searchViaAniList(registry, bangumi, term, config);
        results = alResult.bangumiResults;
        if (alResult.anilistId) matchedAnilistId = alResult.anilistId;
      } else {
        results = await searchBangumi(bangumi, term, config);
      }
      logger.info(`matchSeason: fallback term="${term}" → ${results.length} 条结果`);
      if (results.length > 0) break;
    }
  }
  if (results.length === 0) {
    logger.info(`matchSeason: 全部路径无结果 → 返回 null`);
    return null;
  }
  logger.info(`matchSeason: 共 ${results.length} 条候选结果`);

  // 4. Pick best match using Sorensen-Dice
  const best = pickBestBySimilarity(folderParsed.cleanTitle, results);
  logger.info(`matchSeason: pickBestBySimilarity → id=${best.id} name="${best.name_cn || best.name}"`);

  // 5. Get full detail
  const detail = await bangumi.getSubjectDetail(best.id);
  if (!detail) {
    logger.info(`matchSeason: getSubjectDetail(${best.id}) 返回 null`);
    return null;
  }

  // 6. Resolve season from AniList if folder parsing didn't provide it
  let matchedSeason = folderParsed.season || null;
  if (!matchedSeason && matchedAnilistId) {
    const resolved = await findSeasonByAnilistId(registry, folderParsed.cleanTitle || folderParsed.title, matchedAnilistId, config);
    if (resolved) {
      matchedSeason = resolved;
      logger.info(`matchSeason: 从 AniList 解析 season=${resolved}`);
    }
  }

  logger.info(`matchSeason: ✅ 成功匹配 → id=${best.id} title="${detail.name_cn || detail.name}" season=${matchedSeason}`);
  return {
    ...detail,
    source: 'bangumi',
    matchedSeason,
    _detail: detail,
    anilistId: matchedAnilistId,
  };
}

class ScraperRegistry {
  constructor() {
    this.scrapers = [];
    this.defaultOrder = ['bangumi', 'anilist'];
    this._searchCache = new Map();
    this._cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  register(scraper) {
    if (!scraper.name || !scraper.search || !scraper.fetchMetadata || !scraper.downloadCover) {
      throw new Error('Scraper must implement: name, search, fetchMetadata, downloadCover');
    }
    scraper._registry = this; // Allow scraper to access search cache
    this.scrapers.push(scraper);
    this.scrapers.sort((a, b) => {
      const ai = this.defaultOrder.indexOf(a.name);
      const bi = this.defaultOrder.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }

  get(name) {
    return this.scrapers.find(s => s.name === name);
  }

  getAll() {
    return [...this.scrapers];
  }

  /**
   * Get list of active sources from config.apiSources
   */
  getSources(config) {
    if (!config) return [];
    if (config.apiSources && Array.isArray(config.apiSources)) {
      return [...config.apiSources];
    }
    // Legacy format fallback
    const sources = [];
    if (config.scrapers?.bangumi?.enabled !== false) {
      sources.push({
        type: 'bangumi',
        url: config.scrapers.bangumi?.apiBase || 'https://api.bangumi.lol',
        key: '',
      });
    }
    return sources;
  }

  getEnabled(config) {
    const sources = this.getSources(config);
    const available = new Set(sources.map(s => s.type));
    return this.scrapers.filter(s => available.has(s.name));
  }

  async searchAll(keyword, config) {
    // Check cache
    const cached = this._searchCache.get(keyword);
    if (cached && Date.now() - cached.timestamp < this._cacheTTL) {
      return cached.results;
    }

    const results = [];
    const sources = this.getSources(config);

    for (const source of sources) {
      const scraper = this.get(source.type);
      if (!scraper) continue;
      try {
        const res = await scraper.search(keyword, source);
        results.push(...res.map(r => ({ ...r, source: scraper.name, _sourceUrl: source.url })));
      } catch (e) {
        logger.error(source.type, '@', source.url, 'search failed:', e.message);
      }
    }

    // Cache results
    this._searchCache.set(keyword, { results, timestamp: Date.now() });
    return results;
  }

  /**
   * Clear search cache (call after batch operations)
   */
  clearSearchCache() {
    this._searchCache.clear();
    _bangumiSearchCache.clear();
    _bangumiSearchFailLogged = false;
  }

  /**
   * Find the first matching source for a scraper type and fetch metadata
   */
  async fetchMetadata(scraperName, title, coverDir, subjectId, config, preDetail) {
    const scraper = this.get(scraperName);
    if (!scraper) throw new Error(`Scraper not found: ${scraperName}`);

    const sources = this.getSources(config).filter(s => s.type === scraperName);
    const source = sources[0];
    if (!source) throw new Error(`No configured source for ${scraperName}`);

    if (typeof scraper.setSource === 'function') scraper.setSource(source);
    return scraper.fetchMetadata(title, coverDir, subjectId, preDetail);
  }
}

const registry = new ScraperRegistry();
registry.register(new BangumiScraper());
registry.register(new AniListScraper());

/**
 * Extract the first Latin/Romaji alias from Bangumi infobox.
 * Bangumi infobox entries have `key` + `value`, where aliases look like:
 *   { key: "别名", value: [{ v: "容易对付的恶魔大人" }, { v: "Kanan-sama wa Akumade Choroi" }] }
 */
function extractRomajiTitle(infobox) {
  if (!Array.isArray(infobox)) return null;
  const aliasEntry = infobox.find(e => e.key === '别名');
  if (!aliasEntry) return null;
  const values = Array.isArray(aliasEntry.value) ? aliasEntry.value : [];
  for (const v of values) {
    const t = typeof v === 'object' ? v.v || v.value : v;
    if (t && /^[\x20-\x7E]/.test(t)) return t; // first Latin-printable alias
  }
  return null;
}



/**
 * Fetch AniList metadata + download banner for an anime that already has anilistId.
 * Heavy — calls fetchMetadata + downloadBanner. Modifies anime in place.
 * Returns { anilistId, localBanner, anilistTitleEn } or null.
 */
async function syncAnilistDetail(anime, config, bannerDir, coverDir) {
  if (!anime || !anime.anilistId || anime.anilistId === -1) return null;

  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled(config)) return null;

  const anilistId = anime.anilistId;

  let meta;
  try {
    meta = await anilist.fetchMetadata(anime.title || '', coverDir, anilistId);
  } catch (e) {
    logger.error(`syncAnilistDetail: fetchMetadata failed for id=${anilistId}: ${e.message}`);
    return null;
  }
  if (!meta) return null;

  if (meta.bannerImage) {
    anime.anilistBanner = meta.bannerImage;
    // Download banner locally — on cache hit returns local path immediately
    try {
      const localPath = await anilist.downloadBanner(meta.bannerImage, bannerDir, anilistId);
      if (localPath) anime.anilistBanner = localPath;
    } catch (_) {
      // Remote URL remains as fallback
    }
  } else {
    anime.anilistBanner = '__none__'; // 标记为"已确认无横幅"，避免重复查询
  }
  if (meta.anilistTitleEn) anime.anilistTitleEn = meta.anilistTitleEn;

  logger.info(`syncAnilistDetail: done for id=${anime.id} → anilistId=${anilistId}${meta.bannerImage ? ' +banner' : ''}`);
  return { anilistId, localBanner: meta.bannerImage, anilistTitleEn: meta.anilistTitleEn };
}

/**
 * 用文件夹名搜 AniList 找 anilistId，顺便预提取 banner（避免 DETAIL_QUERY）。
 * 修改 anime.anilistId / .anilistBanner / .anilistTitleEn。
 * 返回 { anilistId, localBanner, anilistTitleEn } 或 null。
 */
async function syncAnilist(anime, config, bannerDir, coverDir) {
  if (!anime) return null;
  if (anime.anilistId === -1) return null;

  // 已有 anilistId → 直接下载 banner
  if (anime.anilistId) {
    return syncAnilistDetail(anime, config, bannerDir, coverDir);
  }

  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled(config)) return null;
  const source = config.apiSources?.find(s => s.type === 'anilist');

  const searchTerm = anime.bangumiTitleJp || anime.folderName || extractRomajiTitle(anime.infobox);
  if (!searchTerm) return null;

  const results = await anilist.search(searchTerm, source);
  if (!results || results.length === 0) {
    anime.anilistId = -1;
    return null;
  }

  const bestItem = pickBestBySimilarity(searchTerm, results);
  if (!bestItem) {
    anime.anilistId = -1;
    return null;
  }

  const matchField = isPrimarilyRomaji(searchTerm) ? 'name' : 'name_cn';
  const matchTitle = bestItem[matchField] || bestItem.name || bestItem.name_cn || '';
  const score = sorensenDice(searchTerm, matchTitle);
  if (score < 0.5) {
    anime.anilistId = -1;
    return null;
  }

  const anilistId = bestItem.id;
  anime.anilistId = anilistId;

  // 预提取 banner（搜索结果已含 bannerImage，跳过 DETAIL_QUERY）
  if (bestItem.bannerImage) {
    anime.anilistBanner = bestItem.bannerImage;
    if (bestItem.bannerImage.startsWith('http')) {
      try {
        const localPath = await anilist.downloadBanner(bestItem.bannerImage, bannerDir, anilistId);
        if (localPath) anime.anilistBanner = localPath;
      } catch (_) {}
    }
  }
  if (bestItem.title_english) {
    anime.anilistTitleEn = bestItem.title_english;
  }

  if (anime.anilistBanner) {
    return { anilistId, localBanner: anime.anilistBanner, anilistTitleEn: anime.anilistTitleEn };
  }

  // 搜索结果没 banner → 调 DETAIL_QUERY 拿
  return syncAnilistDetail(anime, config, bannerDir, coverDir);
}

module.exports = {
  registry,
  ScraperRegistry,
  matchSeason,
  findSeasonByAnilistId,
  searchViaAniList,
  searchBangumi,
  searchBangumiBySeason,
  pickBestBySimilarity,
  buildSearchTerms,

  sorensenDice,
  normalizeTitle,
  detectSpecialType,
  extractBaseAndSuffix,
  parallelMap,
  syncAnilistDetail,
  syncAnilist,
  extractRomajiTitle,
  toHiragana,
  isPrimarilyRomaji,
  truncateSummary: BangumiScraper.truncateSummary,
};
