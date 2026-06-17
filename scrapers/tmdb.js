const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const TIMEOUT = 15000;

let useCurlFallback = false;

function curlFetch(method, url, body) {
  const args = ['-s', '--max-time', String(TIMEOUT / 1000), '-X', method];
  if (body) args.push('-H', 'Content-Type: application/json', '-d', body);
  args.push('-H', 'Accept: application/json', url);
  const result = spawnSync('curl', args, { timeout: TIMEOUT, encoding: 'utf-8' });
  if (result.error) throw new Error(`curl 调用失败: ${result.error.message}`);
  if (result.stderr) console.error('curl stderr:', result.stderr);
  return JSON.parse(result.stdout);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('TMDB API 请求超时');
    if (e.code === 'ECONNREFUSED') throw new Error('无法连接到 TMDB API，请检查网络');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function tryFetch(url, options = {}) {
  if (!useCurlFallback) {
    try {
      const res = await fetchWithTimeout(url, options);
      if (res.ok) return res;
      const text = await res.text();
      throw new Error(`TMDB API error (${res.status}): ${text.substring(0, 200)}`);
    } catch (e) {
      if (e.message.includes('fetch failed') || e.message.includes('ECONNREFUSED') || e.message.includes('ENOTFOUND')) {
        useCurlFallback = true;
        console.log('TMDB Network fetch failed, falling back to curl');
      } else {
        throw e;
      }
    }
  }

  const method = (options.method || 'GET').toUpperCase();
  const body = options.body || null;
  return { json: () => Promise.resolve(curlFetch(method, url, body)) };
}

class TMDBScraper {
  constructor() {
    this.name = 'tmdb';
    this.apiBase = 'https://api.themoviedb.org/3';
    this.apiKey = '';
  }

  getApiKey(config) {
    return config?.tmdbApiKey || this.apiKey || process.env.TMDB_API_KEY || null;
  }

  /**
   * Check if config has at least one tmdb source with valid key
   */
  enabled(config) {
    if (config?.apiSources) {
      const src = config.apiSources.find(s => s.type === 'tmdb');
      if (src?.key) this.apiKey = src.key;
      if (src?.url) this.apiBase = src.url.replace(/\/+$/, '');
      return !!(src?.key);
    }
    // Legacy fallback
    return !!this.getApiKey(config);
  }

  /**
   * Set active source from apiSources entry
   */
  setSource(source) {
    if (source?.key) this.apiKey = source.key;
    if (source?.url) this.apiBase = source.url.replace(/\/+$/, '');
    return this;
  }

  buildUrl(endpoint, params = {}) {
    const apiKey = this.apiKey;
    const url = new URL(`${this.apiBase}${endpoint}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('language', 'zh-CN');
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  async search(keyword, source) {
    if (source) this.setSource(source);
    const url = this.buildUrl('/search/tv', {
      query: keyword,
      include_adult: false,
    });
    const res = await tryFetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    return (data.results || [])
      .filter(r => r.origin_country?.some(c => ['JP', 'CN', 'KR', 'TW', 'HK'].includes(c)) || true)
      .map(r => ({
        id: r.id,
        name: r.name,
        name_cn: r.name,
        original_name: r.original_name,
        overview: r.overview,
        first_air_date: r.first_air_date,
        poster_path: r.poster_path,
        backdrop_path: r.backdrop_path,
        vote_average: r.vote_average,
        vote_count: r.vote_count,
        origin_country: r.origin_country,
        genre_ids: r.genre_ids,
      }));
  }

  async getSeriesDetail(id) {
    const url = this.buildUrl(`/tv/${id}`, {
      append_to_response: 'external_ids,content_ratings',
    });
    const res = await tryFetch(url, { headers: { 'Accept': 'application/json' } });
    return res.json();
  }

  async downloadCover(imagePath, coverDir, seriesId, size = 'w500') {
    if (!imagePath) return null;
    if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });

    const ext = path.extname(imagePath) || '.jpg';
    const filename = `${seriesId}${ext}`;
    const filepath = path.join(coverDir, filename);

    if (fs.existsSync(filepath)) return filepath;

    const imageUrl = `${TMDB_IMAGE_BASE}/${size}${imagePath}`;
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
    return filepath;
  }

  async fetchMetadata(title, coverDir, seriesId) {
    const detail = await this.getSeriesDetail(seriesId);

    let localCover = null;
    if (detail.poster_path) {
      try {
        localCover = await this.downloadCover(detail.poster_path, coverDir, seriesId, 'w500');
      } catch (e) {
        console.error('Cover download failed:', e.message);
      }
    }

    let rating = null;
    if (detail.vote_average && detail.vote_count > 10) {
      rating = parseFloat(detail.vote_average.toFixed(1));
    }

    return {
      source: 'tmdb',
      tmdbId: seriesId,
      bangumiId: null,
      bangumiTitle: detail.name || null,
      bangumiTitleJp: detail.original_name || null,
      summary: detail.overview || null,
      coverUrl: detail.poster_path ? `${TMDB_IMAGE_BASE}/w500${detail.poster_path}` : null,
      localCover,
      rating,
    };
  }
}

module.exports = TMDBScraper;