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

  return [...new Set(terms)];
}

/**
 * Search Bangumi directly (with 5-min TTL cache)
 */
const _bangumiSearchCache = new Map();
const _bangumiCacheTTL = 5 * 60 * 1000;
let _bangumiSearchFailLogged = false;

async function searchBangumi(bangumi, keyword, config) {
  const source = config.apiSources?.find(s => s.type === 'bangumi');
  if (!source) return [];

  const cached = _bangumiSearchCache.get(keyword);
  if (cached && Date.now() - cached.ts < _bangumiCacheTTL) return cached.results;

  try {
    const results = await bangumi.search(keyword, source);
    const filtered = results.filter(r => r.type === 2);
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
    return searchBangumi(bangumi, searchTerm, config);
  }

  try {
    const source = config.apiSources?.find(s => s.type === 'anilist');
    const anilistResults = await anilist.search(searchTerm, source);
    if (anilistResults.length === 0) {
      return searchBangumi(bangumi, searchTerm, config);
    }

    // AniList 只用于获取日文标题，搜索结果不直接使用
    const jpTitle = anilistResults[0].title_native || anilistResults[0].name;
    if (jpTitle) {
      const bangumiResults = await searchBangumi(bangumi, jpTitle, config);
      if (bangumiResults.length > 0) return bangumiResults;
    }

    return [];
  } catch (e) {
    logger.error('AniList search failed, fallback to Bangumi:', e.message);
    return searchBangumi(bangumi, searchTerm, config);
  }
}

/**
 * Pick best match from search results using Sorensen-Dice
 */
function pickBestBySimilarity(cleanTitle, results) {
  return results.reduce((best, r) => {
    const matchTitle = r.name_cn || r.name || '';
    const score = sorensenDice(cleanTitle, matchTitle);
    return score > best.score ? { item: r, score } : best;
  }, { item: results[0], score: 0 }).item;
}

/**
 * Validate match quality (optional, does not block matching)
 * Returns confidence score 0-1
 */
function validateMatch(detail, folderParsed) {
  let confidence = 0.5;

  // Season match bonus
  if (folderParsed.season && detail.eps) {
    confidence += 0.1;
  }

  // Title similarity bonus
  const titleScore = sorensenDice(folderParsed.cleanTitle, detail.name_cn || detail.name || '');
  confidence += titleScore * 0.3;

  // Format match bonus
  const specialType = detectSpecialType(folderParsed.title);
  if (specialType) {
    confidence += 0.1;
  }

  return Math.min(1, confidence);
}

/**
 * Search AniList for base title → find Nth season by temporal sort → native title → Bangumi
 * Bangumi search ignores "第3期" markers, so we use AniList's season metadata to
 * locate the correct entry, then use its exact native title for Bangumi lookup.
 */
async function searchBangumiBySeason(registry, bangumi, baseTitle, season, config) {
  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled(config)) return [];

  try {
    const source = config.apiSources?.find(s => s.type === 'anilist');
    const alResults = await anilist.search(baseTitle, source);
    if (alResults.length === 0) return [];

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
    const target = candidates[season - 1];
    if (!target) return [];

    const nativeTitle = target.title_native || target.name;
    if (!nativeTitle) return [];

    logger.info(`Season lookup: "${baseTitle}" S${season} → "${nativeTitle}" (${target.seasonYear || '?'} ${target.season || '?'}, ${target.format})`);
    return await searchBangumi(bangumi, nativeTitle, config);
  } catch (e) {
    logger.error('Season-specific AniList lookup failed:', e.message);
    return [];
  }
}

/**
 * Main entry: single-phase matching
 * Search by title → pick best → get detail
 */
async function matchSeason(registry, keyword, folderParsed, videoCount, config) {
  const bangumi = registry.get('bangumi');
  if (!bangumi) return null;

  // 1. Build search terms (multiple variations)
  const searchTerms = buildSearchTerms(folderParsed, keyword);

  // 2. Season-aware lookup via AniList (both romaji and CJK titles)
  //    Bangumi search ignores "第3期" markers and always returns S1.
  //    AniList provides seasonYear/season metadata → sort temporally →
  //    find the N-th entry's native title → precise Bangumi match.
  let results = [];
  if (folderParsed.season) {
    results = await searchBangumiBySeason(registry, bangumi, folderParsed.cleanTitle, folderParsed.season, config);
  }

  // 3. Fallback: normal search term loop
  if (results.length === 0) {
    for (const term of searchTerms) {
      // Base title → use AniList route (gets native JP/CJK title → Bangumi)
      // Other terms (season marker, suffix) → Bangumi directly
      const isBaseTitle = term === (folderParsed.cleanTitle || folderParsed.title);
      if (isBaseTitle) {
        results = await searchViaAniList(registry, bangumi, term, config);
      } else {
        results = await searchBangumi(bangumi, term, config);
      }
      if (results.length > 0) break;
    }
  }
  if (results.length === 0) return null;

  // 4. Pick best match using Sorensen-Dice
  const best = pickBestBySimilarity(folderParsed.cleanTitle, results);

  // 5. Get full detail
  const detail = await bangumi.getSubjectDetail(best.id);
  if (!detail) return null;

  // 6. Validate (optional, for confidence reference)
  const confidence = validateMatch(detail, folderParsed);

  return {
    ...detail,
    source: 'bangumi',
    matchedSeason: folderParsed.season || null,
    confidence,
    _detail: detail,
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
      return config.apiSources.filter(s => s.type !== 'tmdb');
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
 * Sync AniList metadata for an anime: search → match → fetch → download banner → apply.
 * Modifies `anime` in place. Returns applied fields or null.
 */
async function syncAnilist(anime, config, bannerDir, coverDir) {
  if (!anime) return null;
  // Already attempted and not found
  if (anime.anilistId === -1) return null;

  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled(config)) return null;
  const source = config.apiSources?.find(s => s.type === 'anilist');

  let anilistId = anime.anilistId;

  // Search by title if we don't have an ID yet
  if (!anilistId) {
    const romaji = extractRomajiTitle(anime.infobox);
    const searchTitles = [
      romaji,                  // 罗马音 → AniList 拉丁文字搜索最准
      anime.bangumiTitleJp,    // 日文原名
      anime.bangumiTitleEn,    // 英文标题
      anime.title,             // 中文标题
      anime.bangumiTitle,      // Bangumi 主标题
    ].filter(Boolean);
    // Deduplicate
    const seen = new Set();
    const unique = searchTitles.filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

    for (const t of unique) {
      try {
        const results = await anilist.search(t, source);
        if (results.length === 0) continue;
        const bestItem = pickBestBySimilarity(t, results);
        if (bestItem) {
          const matchTitle = bestItem.name_cn || bestItem.name || '';
          const score = sorensenDice(t, matchTitle);
          if (score >= 0.5) {
            anilistId = bestItem.id;
            break;
          }
        }
      } catch (e) {
        logger.warn(`AniList search failed for "${t}": ${e.message}`);
      }
    }

    if (!anilistId) {
      anime.anilistId = -1; // Mark as attempted
      logger.info(`syncAnilist: no match for "${anime.title}" (bgmId=${anime.bangumiId})`);
      return null;
    }
  }

  // Fetch full AniList metadata
  let meta;
  try {
    meta = await anilist.fetchMetadata(anime.title || '', coverDir, anilistId);
  } catch (e) {
    logger.error(`syncAnilist: fetchMetadata failed for id=${anilistId}: ${e.message}`);
    return null;
  }
  if (!meta) return null;

  // Download banner
  let localBanner = null;
  if (meta.bannerImage) {
    try {
      localBanner = await anilist.downloadBanner(meta.bannerImage, bannerDir, anilistId);
    } catch (e) {
      logger.warn(`syncAnilist: banner download failed for id=${anilistId}: ${e.message}`);
    }
  }

  // Apply to anime object
  anime.anilistId = anilistId;
  if (localBanner) anime.anilistBanner = localBanner;
  if (meta.anilistTitleEn) anime.anilistTitleEn = meta.anilistTitleEn;
  if (meta.seasonChain) anime.seasonChain = meta.seasonChain;

  logger.info(`syncAnilist: done for id=${anime.id} → anilistId=${anilistId}${localBanner ? ' +banner' : ''}`);
  return { anilistId, localBanner, anilistTitleEn: meta.anilistTitleEn };
}

module.exports = {
  registry,
  ScraperRegistry,
  matchSeason,
  searchViaAniList,
  searchBangumi,
  searchBangumiBySeason,
  pickBestBySimilarity,
  buildSearchTerms,
  validateMatch,
  sorensenDice,
  normalizeTitle,
  detectSpecialType,
  extractBaseAndSuffix,
  parallelMap,
  syncAnilist,
  extractRomajiTitle,
  isPrimarilyRomaji,
  truncateSummary: BangumiScraper.truncateSummary,
};
