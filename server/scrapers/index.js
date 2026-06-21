const BangumiScraper = require('./bangumi');
const TMDBScraper = require('./tmdb');
const logger = require('../logger').child('[SCRAPER]');

// Relation type mapping from Bangumi API
const RELATION_TYPE = {
  '续集': 'sequel',
  '前传': 'prequel',
  '同系列': 'same_series',
  '外传': 'spin_off',
  '合集': 'summary',
  '其他': 'other'
};

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
 * Simple similarity score between two normalized titles
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  // Could add Levenshtein here if needed
  return 0;
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
 * Select best match from seasonMap based on folder parsed info
 * @param {Map} seasonMap - season number -> subject
 * @param {Object} folderParsed - result from parseFolderName()
 * @param {number} videoCount - number of video files
 * @param {Array} specials - array of {subject, specialType}
 * @param {string} specialSuffix - extracted ~...~ suffix from folder title
 */
function selectBestMatch(seasonMap, folderParsed, videoCount, specials = [], specialSuffix = null) {
  const { season, cleanTitle, title } = folderParsed;
  
  // 1. EXACT SPECIAL SUFFIX MATCH (highest priority)
  // If folder has ~...~ suffix, try to match exactly against specials
  if (specialSuffix) {
    const normSuffix = normalizeTitle(specialSuffix);
    for (const { subject, specialType } of specials) {
      const subjectTitle = normalizeTitle(subject.name_cn || subject.name);
      // Check if subject title contains the special suffix
      if (subjectTitle.includes(normSuffix)) {
        return subject;
      }
    }
  }

  // 2. Special type detection fallback (for OVA/movie without ~...~)
  const specialType = detectSpecialType(title);
  if (specialType && seasonMap.has(specialType)) {
    return seasonMap.get(specialType);
  }

  // 3. Normal season match
  const targetSeason = season || 1;
  const candidate = seasonMap.get(targetSeason);
  
  if (candidate) {
    // Episode count verification
    if (candidate.eps && videoCount) {
      // Proportional tolerance: 25%-100% of total eps, or absolute diff <= 3
      const ratio = videoCount / candidate.eps;
      const diff = Math.abs(candidate.eps - videoCount);
      if (diff <= 3 || (ratio >= 0.25 && ratio <= 1.0)) return candidate;
      // If eps mismatch, continue to fallback
    } else {
      return candidate;  // No eps data, trust the relation chain
    }
  }

  // 4. Fallback: title similarity against all seasons
  const normTarget = normalizeTitle(cleanTitle);
  let best = seasonMap.get(1);
  let bestScore = 0;

  for (const [key, v] of seasonMap) {
    if (typeof key === 'string') continue;  // Skip specials ('movie'/'ova'/'special' keys)
    const score = similarity(normTarget, normalizeTitle(v.name_cn || v.name));
    if (score > bestScore) { bestScore = score; best = v; }
  }

  return best;
}

/**
 * Phase 1: Find any main subject using multi-keyword search
 * Returns { detail, searchResults } with full subject detail and the search results used
 */
async function findMainSubject(registry, folderParsed, config) {
  const bangumi = registry.get('bangumi');
  if (!bangumi) return null;

  const keywords = generateSearchKeywords(folderParsed);
  
  for (const kw of keywords) {
    try {
      const results = await registry.searchAll(kw, config);
      const animeResults = results.filter(r => r.type === 2);
      if (animeResults.length === 0) continue;

      // Pick best match by title similarity
      const normTarget = normalizeTitle(folderParsed.cleanTitle);
      const best = animeResults.reduce((b, r) => {
        const score = similarity(normTarget, normalizeTitle(r.name_cn || r.name));
        return score > b.score ? { item: r, score } : b;
      }, { item: animeResults[0], score: 0 }).item;

      // Fetch full detail to get official titles
      const detail = await bangumi.getSubjectDetail(best.id);
      if (detail) return { detail, searchResults: results };
    } catch (e) {
      logger.error('findMainSubject keyword="', kw, '" failed:', e.message);
    }
  }
  return null;
}

/**
 * Generate search keywords from folder parsed data
 * Creates variants: cleanTitle, baseTitle, romaji, core words
 */
function generateSearchKeywords(folderParsed) {
  const { cleanTitle, title, animeTitle, cjkTitle } = folderParsed;
  const keywords = new Set();

  // Highest priority: CJK title (Bangumi prefers Japanese/Chinese originals)
  if (cjkTitle) keywords.add(cjkTitle);

  // Primary: cleanTitle (anitomy's cleaned title)
  if (cleanTitle) keywords.add(cleanTitle);

  // Secondary: animeTitle (anitomy's animeTitle field)
  if (animeTitle && animeTitle !== cleanTitle) keywords.add(animeTitle);

  // Tertiary: base title without special suffix
  const { baseTitle } = extractBaseAndSuffix(title);
  if (baseTitle && baseTitle !== cleanTitle) keywords.add(baseTitle);

  // Quaternary: core words (first 2-3 meaningful words)
  const coreWords = cleanTitle
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 3)
    .join(' ');
  if (coreWords && coreWords !== cleanTitle) keywords.add(coreWords);

  // If primarily romaji, also try romaji variants
  if (isPrimarilyRomaji(title)) {
    keywords.add(title); // Original folder name
    // Try without season markers
    const noSeason = title.replace(/\s*(?:S|Season)\s*\d+/i, '').replace(/\s*\d+$/, '').trim();
    if (noSeason && noSeason !== title) keywords.add(noSeason);
  }

  // Sanitize: add variants with special characters that break search APIs replaced
  for (const kw of Array.from(keywords)) {
    const noAt = kw.replace(/[@＠]/g, 'a').trim();
    if (noAt && noAt !== kw) keywords.add(noAt);
  }

  return Array.from(keywords);
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
 * Extract season number from title (Chinese/Japanese)
 * Returns season number (1, 2, 3...) or null
 */
function extractSeasonFromTitle(title) {
  if (!title) return null;
  
  // Explicit season patterns with capture groups
  const explicitPatterns = [
    /第\s*(\d+)\s*[季期]/,           // 第2季, 第2期
    /[Ss]\s*(\d+)\b/,                // S2, s2 (with word boundary)
    /Season\s*(\d+)/i,               // Season 2
    /(\d+)\s*[期季]/,                // 2期, 2季
    /(\d+)(?:st|nd|rd|th)\s*[Ss]eason/i, // 2nd Season
    // Trailing number at end of title (e.g., "Yuru Yuri 2", "Title 3")
    /\s(\d+)$/,
  ];
  
  for (const p of explicitPatterns) {
    const m = title.match(p);
    if (m && m[1]) {
      const num = parseInt(m[1]);
      if (num >= 1 && num <= 10) return num;
    }
  }
  
  // Unicode numerals
  if (/Ⅱ/.test(title)) return 2;
  if (/Ⅲ/.test(title)) return 3;
  if (/Ⅳ/.test(title)) return 4;
  if (/Ⅴ/.test(title)) return 5;
  
  // Symbol-based season markers (count symbols)
  // ♪♪ = 2, ♪♪♪ = 3, etc.
  const symbolMatch = title.match(/([♪♫★☆♥♡!！])\1+/);
  if (symbolMatch) {
    const count = symbolMatch[0].length;
    if (count >= 2 && count <= 5) return count;
  }
  
  // Prefix-based: 续/続/新/真/Zoku/Shin = Season 2
  if (/^(?:续|続|新|真|Zoku|Shin)\s/.test(title)) return 2;
  
  return null;
}

/**
 * Phase 2: Build complete season chain using official titles
 * @param {Array} initialResults - Optional search results from Phase 1 to avoid redundant search
 */
async function buildSeasonChainFromMain(registry, mainDetail, config, initialResults = null) {
  if (!mainDetail) return { seasonMap: new Map(), specials: [] };

  const bangumi = registry.get('bangumi');
  if (!bangumi) return { seasonMap: new Map(), specials: [] };

  // Reuse initial results if available, otherwise search with official title
  let animeResults;
  if (initialResults && initialResults.length > 0) {
    animeResults = initialResults.filter(r => r.type === 2);
  } else {
    const officialTitle = mainDetail.name_cn || mainDetail.name;
    const results = await registry.searchAll(officialTitle, config);
    animeResults = results.filter(r => r.type === 2);
  }

  if (animeResults.length === 0) {
    // Fallback: just use the main detail as season 1
    const seasonMap = new Map();
    mainDetail.source = 'bangumi';
    seasonMap.set(1, mainDetail);
    return { seasonMap, specials: [] };
  }

  // Enrich with relations (batched to avoid rate limits)
  const enriched = await parallelMap(animeResults, async r => {
    try {
      const relations = await bangumi.getSubjectRelations(r.id);
      return { ...r, relations };
    } catch (e) {
      return { ...r, relations: [] };
    }
  });

  // Find the main entry in enriched results (match by id)
  const main = enriched.find(r => r.id === mainDetail.id) || enriched[0];

  // Build seasonMap by following sequel relations
  const seasonMap = new Map();
  seasonMap.set(1, main);

  let current = main;
  let season = 2;
  const visited = new Set([main.id]);

  while (current && season <= 10) {
    const sequelRel = current.relations?.find(r => 
      RELATION_TYPE[r.relation] === 'sequel' && r.type === 2 && !visited.has(r.id)
    );
    if (!sequelRel) break;

    const sequel = enriched.find(r => r.id === sequelRel.id);
    if (!sequel) break;

    seasonMap.set(season, sequel);
    visited.add(sequel.id);
    current = sequel;
    season++;
  }

  // ALSO: Direct title-based season detection from search results
  // This catches cases where Bangumi has separate entries per season without proper relations
  enriched.forEach(r => {
    if (r.id === main.id) return; // Skip main
    const detectedSeason = extractSeasonFromTitle(r.name_cn || r.name);
    if (detectedSeason && detectedSeason >= 2 && !seasonMap.has(detectedSeason)) {
      seasonMap.set(detectedSeason, r);
    }
  });

  // Collect specials
  const specials = [];
  enriched.forEach(r => {
    const cn = r.name_cn || '';
    const jp = r.name || '';
    const specialType = detectSpecialType(cn) || detectSpecialType(jp);
    if (specialType) {
      specials.push({ ...r, specialType });
      if (!seasonMap.has(specialType)) {
        seasonMap.set(specialType, r);
      }
    }
  });

  return { seasonMap, specials };
}

/**
 * Main entry: two-phase matching
 * Phase 1: Find any subject using multi-keyword search (handles romaji)
 * Phase 2: Use official titles to build complete season chain
 */
async function matchSeason(registry, keyword, folderParsed, videoCount, config) {
  // Phase 1: Find main subject (handles romaji, multi-lang)
  const result = await findMainSubject(registry, folderParsed, config);
  if (!result) return null;

  // Phase 2: Build season chain, reusing search results from Phase 1
  const { seasonMap, specials } = await buildSeasonChainFromMain(registry, result.detail, config, result.searchResults);
  if (seasonMap.size === 0) return null;

  // Select best match using folder's season/special info
  const { specialSuffix } = extractBaseAndSuffix(folderParsed.title);
  return selectBestMatch(seasonMap, folderParsed, videoCount, specials, specialSuffix);
}

class ScraperRegistry {
  constructor() {
    this.scrapers = [];
    this.defaultOrder = ['bangumi', 'tmdb'];
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
      return config.apiSources;
    }
    // Legacy format fallback
    const sources = [];
    if (config.scrapers?.bangumi?.enabled !== false) {
      sources.push({
        type: 'bangumi',
        url: config.scrapers.bangumi?.apiBase || 'https://api.bangumi.one',
        key: '',
      });
    }
    if (config.scrapers?.tmdb?.enabled !== false && config.tmdbApiKey) {
      sources.push({
        type: 'tmdb',
        url: 'https://api.themoviedb.org/3',
        key: config.tmdbApiKey,
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
        // Try next source on failure
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
  }

  /**
   * Find the first matching source for a scraper type and fetch metadata
   */
  async fetchMetadata(scraperName, title, coverDir, subjectId, config) {
    const scraper = this.get(scraperName);
    if (!scraper) throw new Error(`Scraper not found: ${scraperName}`);

    const sources = this.getSources(config).filter(s => s.type === scraperName);
    const source = sources[0]; // Use first matching source
    if (!source) throw new Error(`No configured source for ${scraperName}`);

    if (typeof scraper.setSource === 'function') scraper.setSource(source);
    return scraper.fetchMetadata(title, coverDir, subjectId);
  }
}

const registry = new ScraperRegistry();
registry.register(new BangumiScraper());
registry.register(new TMDBScraper());

module.exports = { 
  registry, 
  ScraperRegistry, 
  matchSeason,
  buildSeasonChainFromMain,
  findMainSubject,
  selectBestMatch,
  normalizeTitle,
  similarity,
  detectSpecialType,
  RELATION_TYPE,
  generateSearchKeywords,
  extractBaseAndSuffix,
  isPrimarilyRomaji,
  parallelMap
};