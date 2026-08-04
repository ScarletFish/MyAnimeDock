import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { curlFetch, fetchWithTimeout, downloadImage, isNetworkError, isCurlFallbackActive, activateCurlFallback, DEFAULT_TIMEOUT, USER_AGENT } from '../lib/http-fetch';

const logger: Logger = require('../logger').child('[ANILIST]');

const ANILIST_API = 'https://graphql.anilist.co';
const ANILIST_IMAGE_BASE = 'https://s4.anilist.co/file';

// Rate limiter: ensure minimum 2s gap between requests (AniList 30 req/min limit)
let _lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY = 1500;

async function rateLimitWait() {
  const now = Date.now();
  const elapsed = now - _lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
  }
  _lastRequestTime = Date.now();
}

// GraphQL Queries
const SEARCH_QUERY = `
query ($search: String!, $type: MediaType) {
  Page(perPage: 10) {
    media(search: $search, type: $type, sort: POPULARITY_DESC) {
      id
      bannerImage
      title { romaji english native }
      coverImage { large medium }
      meanScore
      episodes
      status
      format
      season
      seasonYear
      relations {
        edges {
          relationType
          node {
            id
            title { romaji english native }
            format
            episodes
          }
        }
      }
    }
  }
}`;

const DETAIL_QUERY = `
query ($id: Int!) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    coverImage { large medium }
    bannerImage
    meanScore
    episodes
    status
    format
    season
    seasonYear
    startDate { year month day }
    endDate { year month day }
    description(asHtml: false)
    genres
    tags { name rank }
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english native }
          coverImage { large }
          meanScore
          format
          episodes
        }
      }
    }
    characters(perPage: 20, sort: ROLE) {
      edges {
        role
        node { id name { full native } image { medium } }
        voiceActors(language: JAPANESE) { id name { full native } image { medium } }
      }
    }
    staff(perPage: 10) {
      edges { role node { id name { full native } image { medium } } }
    }
  }
}`;

const BATCH_DETAIL_QUERY = `
query ($ids: [Int!]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      bannerImage
      title { romaji english native }
      coverImage { large }
      meanScore
      episodes
      relations {
        edges {
          relationType
          node {
            id
            title { romaji english native }
            format
            episodes
          }
        }
      }
    }
  }
}`;

const RECOMMENDATION_QUERY = `
query ($id: Int!, $perPage: Int) {
  Media(id: $id, type: ANIME) {
    recommendations(perPage: $perPage, sort: RATING_DESC) {
      nodes {
        rating
        mediaRecommendation {
          id
          title { romaji english native }
          coverImage { large }
          meanScore
          format
          episodes
        }
      }
    }
  }
}`;

class AniListScraper {
  name: string;
  apiBase: string;
  _pendingSearches?: Map<string, Promise<any>>;
  _registry?: any;

  constructor() {
    this.name = 'anilist';
    this.apiBase = ANILIST_API;
  }

  enabled(config: any): boolean {
    if (!config?.apiSources) return true; // No config → enabled by default
    const src = config.apiSources.find((s: any) => s.type === 'anilist');
    if (!src) return true; // Not listed → enabled by default (AniList is free)
    return src.enabled !== false; // Explicitly disabled only if enabled:false
  }

  setSource(source: any): this {
    if (source?.url) this.apiBase = source.url;
    return this;
  }

  async tryFetch(url: string, options: any = {}) {
    if (!isCurlFallbackActive()) {
      try {
        const res = await fetchWithTimeout(url, options);
        if (res.ok) return res;
        const text = await res.text();
        if (res.status === 429) {
          const err: any = new Error(`AniList API error (429): ${text.substring(0, 200)}`);
          err.status = 429;
          err.retryAfter = res.headers.get('Retry-After') ? parseInt(res.headers.get('Retry-After') as string) : null;
          err.rateLimitReset = res.headers.get('X-RateLimit-Reset') ? parseInt(res.headers.get('X-RateLimit-Reset') as string) : null;
          throw err;
        }
        if (text.includes('fetch failed') || text.includes('ECONNREFUSED')) {
          activateCurlFallback();
        } else {
          throw new Error(`AniList API error (${res.status}): ${text.substring(0, 200)}`);
        }
      } catch (e: any) {
        if (e.status === 429) throw e; // Let graphqlRequest handle rate limits
        if (isNetworkError(e)) {
          activateCurlFallback();
        } else {
          throw e;
        }
      }
    }

    const body = options.body || null;
    return { json: () => curlFetch('POST', url, body) };
  }

  async graphqlRequest(query: string, variables: any = {}) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimitWait();
      const body = JSON.stringify({ query, variables });
      try {
        const res = await this.tryFetch(this.apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body,
        });
        const data = await res.json();
        if (data.errors) {
          throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
        }
        return data.data;
      } catch (e: any) {
        if (attempt >= MAX_RETRIES) throw e;

        // 结构化 429（含 Retry-After / X-RateLimit-Reset 头）
        if (e.status === 429) {
          const retryMs = e.retryAfter
            ? e.retryAfter * 1000
            : e.rateLimitReset
              ? Math.max(1000, e.rateLimitReset * 1000 - Date.now())
              : RETRY_BASE_DELAY * Math.pow(2, attempt);
          const retrySec = Math.ceil(retryMs / 1000);
          logger.warn(`AniList 429 rate limited, waiting ${retrySec}s (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, retryMs));
          continue;
        }

        // 非结构化 429（curl fallback 等路径）
        if (e.message.includes('429')) {
          const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
          logger.warn(`AniList 429 (fallback), retry in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw e;
      }
    }
  }

  async search(keyword: string, source: any) {
    if (source) this.setSource(source);

    // 请求去重：相同 keyword 的进行中请求共享 Promise（parallelMap 并发时重用）
    if (!this._pendingSearches) this._pendingSearches = new Map();
    const dedupKey = `${this.apiBase}:${keyword}`;
    if (this._pendingSearches.has(dedupKey)) {
      logger.debug(`anilist.search: 去重 keyword="${keyword}" → 复用进行中请求`);
      return this._pendingSearches.get(dedupKey);
    }

    // Check search cache first
    if (this._registry) {
      const cached = this._registry._searchCache?.get(keyword);
      if (cached && Date.now() - cached.timestamp < this._registry._cacheTTL) {
        logger.debug(`anilist.search: 缓存命中 keyword="${keyword}" → ${cached.results.length} 条`);
        return cached.results;
      }
    }

    const promise = (async () => {
      logger.debug(`anilist.search: 请求 API keyword="${keyword}"`);
      try {
        const data = await this.graphqlRequest(SEARCH_QUERY, {
          search: keyword,
          type: 'ANIME',
        });
        const results = (data?.Page?.media || []).map((m: any) => ({
          id: m.id,
          bannerImage: m.bannerImage || null,
          name: m.title.romaji || m.title.english,
          name_cn: m.title.native || m.title.romaji,
          original_name: m.title.native,
          title_romaji: m.title.romaji,
          title_english: m.title.english,
          title_native: m.title.native,
          coverUrl: m.coverImage?.large || m.coverImage?.medium || null,
          rating: m.meanScore ? Number((m.meanScore / 10).toFixed(1)) : null,
          episodes: m.episodes,
          status: m.status,
          format: m.format,
          season: m.season,
          seasonYear: m.seasonYear,
          relations: (m.relations?.edges || []).map((e: any) => ({
            relationType: e.relationType,
            id: e.node.id,
            title: e.node.title.romaji,
            title_native: e.node.title.native,
            format: e.node.format,
            episodes: e.node.episodes,
          })),
          source: 'anilist',
        }));
        logger.debug(`anilist.search: API 返回 ${results.length} 条, top="${results[0]?.name || '无'}"`);
        results.forEach((r: any, i: number) => {
          logger.debug(`  result[${i}]: id=${r.id} name="${r.name}" format=${r.format} ${r.seasonYear||'?'} ${r.season||'?'}`);
        });
        // 写入搜索缓存，后续相同关键词直接命中
        if (this._registry?._searchCache) {
          this._registry._searchCache.set(keyword, { results, timestamp: Date.now() });
        }
        return results;
      } catch (e: any) {
        logger.error('search failed:', e.message);
        return [];
      } finally {
        this._pendingSearches!.delete(dedupKey);
      }
    })();

    this._pendingSearches.set(dedupKey, promise);
    return promise;
  }

  async getDetail(id: number) {
    const data = await this.graphqlRequest(DETAIL_QUERY, { id });
    return data?.Media || null;
  }

  async getRecommendations(id: number, perPage = 12) {
    const data = await this.graphqlRequest(RECOMMENDATION_QUERY, { id, perPage });
    return (data?.Media?.recommendations?.nodes || []).map((n: any) => ({
      rating: n.rating,
      ...n.mediaRecommendation,
    }));
  }

  async batchGetDetails(ids: number[]) {
    if (ids.length === 0) return [];
    const data = await this.graphqlRequest(BATCH_DETAIL_QUERY, { ids });
    return data?.Page?.media || [];
  }

  async downloadCover(imageUrl: string, coverDir: string, subjectId: number) {
    if (!imageUrl) return null;
    const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    const filename = `anilist-${subjectId}${ext}`;
    return downloadImage(imageUrl, coverDir, filename, {
      onSaved: (fp) => {
        if (ext.match(/\.(jpg|jpeg|png|webp)$/i)) {
          try { require('../lib/utils').preGenerateCovers(fp); } catch (_) {}
        }
      },
    });
  }

  async downloadBanner(imageUrl: string, bannerDir: string, subjectId: number) {
    if (!imageUrl) return null;
    const filename = `al-${subjectId}.jpg`;
    return downloadImage(imageUrl, bannerDir, filename, { timeout: DEFAULT_TIMEOUT });
  }

  async fetchMetadata(title: string, coverDir: string, subjectId: number) {
    const detail = await this.getDetail(subjectId);
    if (!detail) return null;

    let localCover = null;
    if (detail.coverImage?.large) {
      try {
        localCover = await this.downloadCover(detail.coverImage.large, coverDir, subjectId);
      } catch (e: any) {
        logger.error('Cover download failed:', e.message);
      }
    }

    return {
      source: 'anilist',
      anilistId: detail.id,
      bangumiTitle: detail.title.native || detail.title.romaji,
      bangumiTitleJp: detail.title.native,
      bangumiTitleEn: detail.title.english,
      bangumiTitleRomaji: detail.title.romaji,
      summary: detail.description || null,
      coverUrl: detail.coverImage?.large || null,
      localCover,
      bannerImage: detail.bannerImage || null,
      rating: detail.meanScore ? Number((detail.meanScore / 10).toFixed(1)) : null,
      episodes: detail.episodes,
      genres: detail.genres || [],
      relations: (detail.relations?.edges || []).map((e: any) => ({
        relationType: e.relationType,
        id: e.node.id,
        title: e.node.title.romaji,
        title_native: e.node.title.native,
      })),
    };
  }
}

export = AniListScraper;
