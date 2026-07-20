const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { nodeFetch } = require('./node-fetch');
const logger = require('../logger').child('[ANILIST]');

const ANILIST_API = 'https://graphql.anilist.co';
const ANILIST_IMAGE_BASE = 'https://s4.anilist.co/file';
const TIMEOUT = 3000;

// Rate limiter: ensure minimum 1.5s gap between requests
let _lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1500;

async function rateLimitWait() {
  const now = Date.now();
  const elapsed = now - _lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
  }
  _lastRequestTime = Date.now();
}

let useCurlFallback = false;
let curlFallbackUntil = 0;
const CURL_COOLDOWN = 60000;

function curlFetch(url, body) {
  const args = ['-s', '--max-time', '5', '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '-d', body,
    '-H', 'Accept: application/json',
    url];
  const result = spawnSync('curl', args, { timeout: 4000, encoding: 'utf-8' });
  if (result.error) throw new Error(`curl 调用失败: ${result.error.message}`);
  if (result.stderr) logger.error('curl stderr:', result.stderr);
  if (!result.stdout || !result.stdout.trim()) throw new Error('curl 返回空响应');
  return JSON.parse(result.stdout);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const fetcher = typeof fetch === 'function' ? fetch : nodeFetch;
    const res = await fetcher(url, { ...options, signal: controller.signal });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AniList API 请求超时');
    if (e.code === 'ECONNREFUSED') throw new Error('无法连接到 AniList API');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function tryFetch(url, options = {}) {
  if (!useCurlFallback || Date.now() > curlFallbackUntil) {
    useCurlFallback = false;
    try {
      const res = await fetchWithTimeout(url, options);
      if (res.ok) return res;
      const text = await res.text();
      if (text.includes('fetch failed') || text.includes('ECONNREFUSED')) {
        useCurlFallback = true;
        curlFallbackUntil = Date.now() + CURL_COOLDOWN;
        logger.info('Network fetch failed, falling back to curl');
      } else {
        throw new Error(`AniList API error (${res.status}): ${text.substring(0, 200)}`);
      }
    } catch (e) {
      if (e.message.includes('fetch failed') || e.message.includes('ECONNREFUSED') || e.message.includes('ENOTFOUND') || e.message.includes('请求超时')) {
        useCurlFallback = true;
        curlFallbackUntil = Date.now() + CURL_COOLDOWN;
        logger.info('Network fetch failed, falling back to curl');
      } else {
        throw e;
      }
    }
  }

  const body = options.body || null;
  try {
    return { json: () => Promise.resolve(curlFetch(url, body)) };
  } catch (e) {
    useCurlFallback = false;
    throw e;
  }
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

class AniListScraper {
  constructor() {
    this.name = 'anilist';
    this.apiBase = ANILIST_API;
  }

  enabled(config) {
    if (!config?.apiSources) return true; // No config → enabled by default
    const src = config.apiSources.find(s => s.type === 'anilist');
    if (!src) return true; // Not listed → enabled by default (AniList is free)
    return src.enabled !== false; // Explicitly disabled only if enabled:false
  }

  setSource(source) {
    if (source?.url) this.apiBase = source.url;
    return this;
  }

  async graphqlRequest(query, variables = {}) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        logger.info(`Retry ${attempt}/${MAX_RETRIES} after ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
      await rateLimitWait();
      const body = JSON.stringify({ query, variables });
      try {
        const res = await tryFetch(this.apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body,
        });
        const data = await res.json();
        if (data.errors) {
          throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
        }
        return data.data;
      } catch (e) {
        if (e.message.includes('429') && attempt < MAX_RETRIES) {
          logger.warn(`AniList 429 rate limited, will retry (${attempt + 1}/${MAX_RETRIES})`);
          continue;
        }
        throw e;
      }
    }
  }

  async search(keyword, source) {
    if (source) this.setSource(source);
    // Check search cache first
    if (this._registry) {
      const cached = this._registry._searchCache?.get(keyword);
      if (cached && Date.now() - cached.timestamp < this._registry._cacheTTL) {
        logger.debug(`anilist.search: 缓存命中 keyword="${keyword}" → ${cached.results.length} 条`);
        return cached.results;
      }
    }
    logger.debug(`anilist.search: 请求 API keyword="${keyword}"`);
    try {
      const data = await this.graphqlRequest(SEARCH_QUERY, {
        search: keyword,
        type: 'ANIME',
      });
      const results = (data?.Page?.media || []).map(m => ({
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
        relations: (m.relations?.edges || []).map(e => ({
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
      results.forEach((r, i) => {
        logger.debug(`  result[${i}]: id=${r.id} name="${r.name}" format=${r.format} ${r.seasonYear||'?'} ${r.season||'?'}`);
      });
      return results;
    } catch (e) {
      logger.error('search failed:', e.message);
      return [];
    }
  }

  async getDetail(id) {
    const data = await this.graphqlRequest(DETAIL_QUERY, { id });
    return data?.Media || null;
  }

  async batchGetDetails(ids) {
    if (ids.length === 0) return [];
    const data = await this.graphqlRequest(BATCH_DETAIL_QUERY, { ids });
    return data?.Page?.media || [];
  }

  async downloadCover(imageUrl, coverDir, subjectId) {
    if (!imageUrl) return null;
    if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });

    const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    const filename = `anilist-${subjectId}${ext}`;
    const filepath = path.join(coverDir, filename);

    if (fs.existsSync(filepath)) return filepath;

    let buffer;
    if (useCurlFallback) {
      const result = spawnSync('curl', ['-s', '--max-time', String(TIMEOUT/1000), imageUrl], { timeout: TIMEOUT });
      if (result.error) throw new Error(`封面下载失败: ${result.error.message}`);
      buffer = result.stdout;
    } else {
      const res = await fetchWithTimeout(imageUrl);
      if (!res.ok) throw new Error(`Cover download failed: ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
    }
    fs.writeFileSync(filepath, buffer);
    if (ext.match(/\.(jpg|jpeg|png|webp)$/i)) {
      try { require('../lib/utils').preGenerateCovers(filepath); } catch (_) {}
    }
    return filepath;
  }

  async downloadBanner(imageUrl, bannerDir, subjectId) {
    if (!imageUrl) return null;
    if (!fs.existsSync(bannerDir)) fs.mkdirSync(bannerDir, { recursive: true });

    const ext = '.jpg';
    const filename = `al-${subjectId}${ext}`;
    const filepath = path.join(bannerDir, filename);

    if (fs.existsSync(filepath)) return filepath;

    let buffer;
    if (useCurlFallback) {
      const result = spawnSync('curl', ['-s', '--max-time', String(TIMEOUT/1000), imageUrl], { timeout: TIMEOUT });
      if (result.error) throw new Error(`Banner download failed: ${result.error.message}`);
      buffer = result.stdout;
    } else {
      const res = await fetchWithTimeout(imageUrl);
      if (!res.ok) throw new Error(`Banner download failed: ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
    }
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  async fetchMetadata(title, coverDir, subjectId) {
    const detail = await this.getDetail(subjectId);
    if (!detail) return null;

    let localCover = null;
    if (detail.coverImage?.large) {
      try {
        localCover = await this.downloadCover(detail.coverImage.large, coverDir, subjectId);
      } catch (e) {
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
      relations: (detail.relations?.edges || []).map(e => ({
        relationType: e.relationType,
        id: e.node.id,
        title: e.node.title.romaji,
        title_native: e.node.title.native,
      })),
    };
  }
}

module.exports = AniListScraper;
