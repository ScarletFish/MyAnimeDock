import BangumiScraper from './bangumi';
import AniListScraper from './anilist';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';

const logger: Logger = require('../logger').child('[SCRAPER]');

export interface ScraperConfig {
  apiSources?: Array<{ type: string; url?: string; enabled?: boolean; key?: string }>;
  scrapers?: any;
}

export interface Scraper {
  name: string;
  search: (keyword: string, source: any) => Promise<any[]>;
  fetchMetadata: (title: any, coverDir: string, subjectId: any, preDetail?: any) => Promise<any>;
  downloadCover: (imageUrl: string, coverDir: string, subjectId: any) => Promise<string | null>;
  getSubjectDetail?: (id: any) => Promise<any>;
  getDetail?: (id: any) => Promise<any>;
  getRecommendations?: (id: any, perPage?: number) => Promise<any>;
  downloadBanner?: (imageUrl: string, bannerDir: string, subjectId: any) => Promise<any>;
  enabled?: (config: ScraperConfig) => boolean;
  setSource?: (source: any) => void;
  _registry?: ScraperRegistry;
}

/**
 * Process items in parallel with concurrency limit
 */
const DEFAULT_CONCURRENCY = 3;
export async function parallelMap(items: any[], fn: (item: any, index: number) => Promise<any>, concurrency = DEFAULT_CONCURRENCY): Promise<any[]> {
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
export function normalizeTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/[？?！!。.、,，～~··・（ ）【】「」『』《》：；!@#$%^&*()_\-+=\[\]{}|\\;:'",.<>?/`~]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** Convert katakana to hiragana for AniList search normalization */
export function toHiragana(s: string): string {
  if (!s) return s;
  return s.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Sorensen-Dice coefficient for fuzzy string comparison
 * Returns 0-1, where 1 is identical
 */
export function sorensenDice(a: string, b: string): number {
  if (!a || !b) return 0;
  a = normalizeTitle(a);
  b = normalizeTitle(b);
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const getBigrams = (s: string): Set<string> => {
    const bigrams = new Set<string>();
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
export function detectSpecialType(title: string): string | null {
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
export function extractBaseAndSuffix(title: string): { baseTitle: string; specialSuffix: string | null } {
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
export function isPrimarilyRomaji(title: string): boolean {
  if (!title) return false;
  const latinChars = (title.match(/[a-zA-Z]/g) || []).length;
  const totalChars = title.replace(/\s/g, '').length;
  return latinChars / totalChars > 0.6;
}

/**
 * Build search terms from folder parsed data (multiple variations)
 */
export function buildSearchTerms(folderParsed: any, keyword: string): string[] {
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

export async function searchBangumi(bangumi: any, keyword: string, config: ScraperConfig): Promise<any[]> {
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
    const filtered = results.filter((r: any) => r.type === 2);
    logger.debug(`searchBangumi: "${keyword}" → Bangumi 返回 ${results.length} 条，filter type=2 → ${filtered.length} 条`);
    _bangumiSearchCache.set(keyword, { results: filtered, ts: Date.now() });
    _bangumiSearchFailLogged = false;
    return filtered;
  } catch (e: any) {
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
export async function searchViaAniList(registry: ScraperRegistry, bangumi: any, searchTerm: string, config: ScraperConfig): Promise<{ bangumiResults: any[]; anilistId: any }> {
  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled?.(config)) {
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
  } catch (e: any) {
    logger.error('AniList search failed, fallback to Bangumi:', e.message);
    const errorResults = await searchBangumi(bangumi, searchTerm, config);
    return { bangumiResults: errorResults, anilistId: null };
  }
}

/**
 * Pick best match from search results using Sorensen-Dice
 * 根据搜索词脚本选择匹配字段：拉丁词对 name（罗马音），东亚词对 name_cn（本地名）
 */
export function pickBestBySimilarity(cleanTitle: string, results: any[]): { item: any; score: number } {
  const useName = isPrimarilyRomaji(cleanTitle);
  return results.reduce((best, r) => {
    const matchTitle = useName ? (r.name || r.name_cn || '') : (r.name_cn || r.name || '');
    const score = sorensenDice(cleanTitle, matchTitle);
    return score > best.score ? { item: r, score } : best;
  }, { item: results[0], score: 0 });
}

/**
 * Search AniList for base title → find Nth season by temporal sort → native title → Bangumi
 * Bangumi search ignores "第3期" markers, so we use AniList's season metadata to
 * locate the correct entry, then use its exact native title for Bangumi lookup.
 */
export async function searchBangumiBySeason(registry: ScraperRegistry, bangumi: any, baseTitle: string, season: number, config: ScraperConfig): Promise<{ bangumiResults: any[]; anilistId: any }> {
  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled?.(config)) {
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
    const SEASON_ORDER: Record<string, number> = { WINTER: 1, SPRING: 2, SUMMER: 3, FALL: 4 };
    const sorted = [...alResults].sort((a, b) => {
      const ya = a.seasonYear || 9999, yb = b.seasonYear || 9999;
      if (ya !== yb) return ya - yb;
      return (SEASON_ORDER[a.season] || 0) - (SEASON_ORDER[b.season] || 0);
    });

    // Prefer TV entries, fall back to any format
    let candidates = sorted.filter(r => r.format === 'TV');
    if (candidates.length === 0) candidates = sorted;
    logger.debug(`searchBangumiBySeason: "${baseTitle}" S${season} → 排序后 TV=${sorted.filter(r=>r.format==='TV').length} 条, candidates=${candidates.length} 条`);
    candidates.forEach((c: any, i: number) => {
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
  } catch (e: any) {
    logger.error('Season-specific AniList lookup failed:', e.message);
    return { bangumiResults: [], anilistId: null };
  }
}

/**
 * Given an anilistId, search AniList for the franchise's base title,
 * sort entries chronologically, and find this entry's season number.
 * Returns 1-indexed season number or null.
 */
export async function findSeasonByAnilistId(registry: ScraperRegistry, baseTitle: string, anilistId: any, config: ScraperConfig): Promise<number | null> {
  const anilist = registry.get('anilist');
  if (!anilist || !anilist.enabled?.(config) || !baseTitle || !anilistId) return null;
  try {
    const source = config.apiSources?.find(s => s.type === 'anilist');
    const alResults = await anilist.search(baseTitle, source);
    if (alResults.length === 0) return null;

    const SEASON_ORDER: Record<string, number> = { WINTER: 1, SPRING: 2, SUMMER: 3, FALL: 4 };
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
  } catch (e: any) {
    logger.warn(`findSeasonByAnilistId: "${baseTitle}" anilistId=${anilistId} → ${e.message}`);
    return null;
  }
}

/**
 * Main entry: single-phase matching
 * Search by title → pick best → get detail
 */
export async function matchSeason(registry: ScraperRegistry, keyword: string, folderParsed: any, videoCount: any, config: ScraperConfig): Promise<any> {
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
  const matchResult = pickBestBySimilarity(folderParsed.cleanTitle, results);
  const best = matchResult.item;
  logger.info(`matchSeason: pickBestBySimilarity → id=${best.id} name="${best.name_cn || best.name}" score=${matchResult.score.toFixed(3)}`);

  // 5. Get full detail
  const detail = await bangumi.getSubjectDetail?.(best.id);
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

export class ScraperRegistry {
  scrapers: Scraper[];
  defaultOrder: string[];
  _searchCache: Map<string, any>;
  _cacheTTL: number;

  constructor() {
    this.scrapers = [];
    this.defaultOrder = ['bangumi', 'anilist'];
    this._searchCache = new Map();
    this._cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  register(scraper: Scraper) {
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

  get(name: string): Scraper | undefined {
    return this.scrapers.find(s => s.name === name);
  }

  getAll(): Scraper[] {
    return [...this.scrapers];
  }

  /**
   * Get list of active sources from config.apiSources
   */
  getSources(config: ScraperConfig): any[] {
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

  getEnabled(config: ScraperConfig): Scraper[] {
    const sources = this.getSources(config);
    const available = new Set(sources.map(s => s.type));
    return this.scrapers.filter(s => available.has(s.name));
  }

  async searchAll(keyword: string, config: ScraperConfig): Promise<any[]> {
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
      } catch (e: any) {
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
  async fetchMetadata(scraperName: string, title: any, coverDir: string, subjectId: any, config: ScraperConfig, preDetail: any): Promise<any> {
    const scraper = this.get(scraperName);
    if (!scraper) throw new Error(`Scraper not found: ${scraperName}`);

    const sources = this.getSources(config).filter(s => s.type === scraperName);
    const source = sources[0];
    if (!source) throw new Error(`No configured source for ${scraperName}`);

    if (typeof scraper.setSource === 'function') scraper.setSource(source);
    return scraper.fetchMetadata(title, coverDir, subjectId, preDetail);
  }
}

export const registry = new ScraperRegistry();
registry.register(new BangumiScraper());
registry.register(new AniListScraper());

/**
 * Extract the first Latin/Romaji alias from Bangumi infobox.
 * Bangumi infobox entries have `key` + `value`, where aliases look like:
 *   { key: "别名", value: [{ v: "容易对付的恶魔大人" }, { v: "Kanan-sama wa Akumade Choroi" }] }
 */
export function extractRomajiTitle(infobox: any[]): string | null {
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
 * 统一元数据管线：给定一个已有 bangumiId / anilistId 的 anime，
 * 从双源拉取元数据并下载封面/横幅到本地。核心不变式：
 *   - 存储字段只存「本地路径 / null / '__none__'」，绝不落远程 URL
 *   - 下载失败 → null（前端显示占位，不裂图）
 *   - '__none__' 表示"已确认无横幅"，避免重复查 API
 * 原地修改 anime，返回被修改的字段 key 集合（供调用方落盘）。
 */
export interface MetadataDirs {
  coverDir: string;
  bannerDir: string;
}

async function downloadBannerLocal(anime: any, url: string, id: number, bannerDir: string): Promise<void> {
  const anilist = registry.get('anilist');
  if (!anilist?.downloadBanner) { anime.anilistBanner = null; return; }
  try {
    const localPath = await anilist.downloadBanner(url, bannerDir, id);
    anime.anilistBanner = localPath || null;
  } catch (_) {
    anime.anilistBanner = null; // 下载失败 → null，不裂图
  }
}

export async function ensureMetadata(anime: any, config: ScraperConfig, dirs: MetadataDirs): Promise<Set<string>> {
  const changed = new Set<string>();
  if (!anime) return changed;
  const bangumi = registry.get('bangumi');
  const anilist = registry.get('anilist');

  // ── Bangumi 侧：有 bangumiId → 拉元数据 + 下载封面到本地 ──
  if (anime.bangumiId && bangumi && bangumi.enabled?.(config)) {
    try {
      const meta = await bangumi.fetchMetadata(anime.title || '', dirs.coverDir, anime.bangumiId);
      if (meta) {
        Object.assign(anime, meta); // 含 localCover（本地路径或 null）
        changed.add(anime.id);
      }
    } catch (e: any) {
      logger.error(`ensureMetadata: Bangumi fetch failed for id=${anime.bangumiId}: ${e.message}`);
    }
  }

  // ── AniList 侧：有 anilistId → 拉元数据 + 下载横幅到本地 ──
  if (anime.anilistId && anime.anilistId !== -1 && anilist && anilist.enabled?.(config)) {
    try {
      const meta = await anilist.fetchMetadata(anime.title || '', dirs.coverDir, anime.anilistId);
      if (meta) {
        if (meta.bannerImage) {
          await downloadBannerLocal(anime, meta.bannerImage, anime.anilistId, dirs.bannerDir);
        } else {
          anime.anilistBanner = '__none__'; // 已确认无横幅，避免重复查询
        }
        if (meta.anilistTitleEn) anime.anilistTitleEn = meta.anilistTitleEn;
        if (meta.anilistTags) anime.anilistTags = meta.anilistTags;
        if (meta.anilistStudios) anime.anilistStudios = meta.anilistStudios;
        changed.add(anime.id);
      }
    } catch (e: any) {
      logger.error(`ensureMetadata: AniList fetch failed for id=${anime.anilistId}: ${e.message}`);
    }
  }

  return changed;
}

/**
 * 批量版 ensureMetadata：对一批 anime 用 batchGetDetails（id_in 一次 50 条）批量拉 AniList 数据，
 * 再并行下载横幅到本地。Bangumi 侧逐条 fetchMetadata。
 * 返回被修改的 anime id 集合。
 */
export async function ensureMetadataBatch(animes: any[], config: ScraperConfig, dirs: MetadataDirs): Promise<Set<string>> {
  const changed = new Set<string>();
  if (!animes || animes.length === 0) return changed;
  const anilist = registry.get('anilist') as any;
  const bangumi = registry.get('bangumi') as any;

  // ── AniList 侧：批量补 banner/tags/studios/titleEn ──
  if (anilist && anilist.enabled?.(config)) {
    const needAnilist = animes.filter((a: any) => a.anilistId && a.anilistId !== -1);
    const ids = [...new Set(needAnilist.map((a: any) => a.anilistId))];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try {
        const results = await anilist.batchGetDetails(chunk);
        const toDownload: Array<{ anime: any; url: string; id: number }> = [];
        for (const media of results) {
          const matches = needAnilist.filter((a: any) => a.anilistId === media.id);
          for (const anime of matches) {
            if (media.bannerImage) {
              anime.anilistBanner = media.bannerImage;
              toDownload.push({ anime, url: media.bannerImage, id: media.id });
            } else {
              anime.anilistBanner = '__none__'; // 已确认无横幅，避免重复查询
            }
            if (media.title?.english) anime.anilistTitleEn = media.title.english;
            if (media.tags) {
              anime.anilistTags = media.tags.map((t: any) => ({
                name: t.name,
                rank: t.rank,
                isGeneralSpoiler: t.isGeneralSpoiler,
                isMediaSpoiler: t.isMediaSpoiler,
              }));
            }
            if (media.studios?.edges) {
              anime.anilistStudios = media.studios.edges
                .filter((e: any) => e.isMain)
                .map((e: any) => e.node.name);
            }
            changed.add(anime.id);
          }
        }
        // 并行下载 banner（并发 5）
        await parallelMap(toDownload, async ({ anime, url, id }: any) => {
          await downloadBannerLocal(anime, url, id, dirs.bannerDir);
        }, 5);
      } catch (e: any) {
        logger.error(`ensureMetadataBatch: AniList batch failed: ${e.message}`);
      }
    }
    if (ids.length > 0) logger.info(`ensureMetadataBatch: AniList 补全 ${ids.length} 个 id`);
  }

  // ── Bangumi 侧：逐条补缺核心字段 ──
  if (bangumi && bangumi.enabled?.(config)) {
    const needBangumi = animes.filter((a: any) => a.bangumiId && !a.summaryChecked && (!a.summary || !a.rating || !a.characters?.length));
    if (needBangumi.length > 0) {
      await parallelMap(needBangumi, async (anime: any) => {
        try {
          const meta = await bangumi.fetchMetadata(anime.title || '', dirs.coverDir, anime.bangumiId);
          if (meta) {
            Object.assign(anime, meta);
            if (!meta.summary) anime.summaryChecked = true;
            changed.add(anime.id);
          }
        } catch (e: any) {
          logger.error(`ensureMetadataBatch: Bangumi fetch failed for id=${anime.bangumiId}: ${e.message}`);
        }
      }, 3);
      logger.info(`ensureMetadataBatch: Bangumi 补全 ${needBangumi.length} 条`);
    }
  }

  return changed;
}

export const truncateSummary = BangumiScraper.truncateSummary;
