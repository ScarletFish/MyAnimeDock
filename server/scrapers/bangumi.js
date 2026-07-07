const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { nodeFetch } = require('./node-fetch');
const logger = require('../logger').child('[BANGUMI]');

const USER_AGENT = 'anime-manager (https://github.com/ScarletFish/Gallery)';
const TIMEOUT = 3000;

let useCurlFallback = false;
let curlFallbackUntil = 0;
const CURL_COOLDOWN = 60000;

function curlFetch(method, url, body) {
  const args = ['-s', '--max-time', '5', '-X', method];
  if (body) args.push('-H', 'Content-Type: application/json', '-d', body);
  args.push('-H', `User-Agent: ${USER_AGENT}`, url);
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
    if (e.name === 'AbortError') throw new Error('Bangumi API 请求超时');
    if (e.code === 'ECONNREFUSED') throw new Error('无法连接到 Bangumi API，请检查网络');
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
      if (text.includes('illegal base64 data') || text.includes('can\'t decode request body') || (res.status === 403 && text.includes('<html'))) {
        useCurlFallback = true;
        curlFallbackUntil = Date.now() + CURL_COOLDOWN;
        logger.info('Detected proxy/Cloudflare interference (HTTP ' + res.status + '), falling back to curl');
      } else {
        throw new Error(`Bangumi API error (${res.status}): ${text.substring(0, 200)}`);
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

  const method = (options.method || 'GET').toUpperCase();
  const body = options.body || null;
  try {
    return { json: () => Promise.resolve(curlFetch(method, url, body)) };
  } catch (e) {
    useCurlFallback = false;
    throw e;
  }
}

class BangumiScraper {
  constructor() {
    this.name = 'bangumi';
    this.apiBase = 'https://api.bangumi.lol';
  }

  /**
   * Check if config has at least one bangumi source
   */
  enabled(config) {
    if (config?.apiSources) {
      const src = config.apiSources.find(s => s.type === 'bangumi');
      if (src?.url) this.apiBase = src.url.replace(/\/+$/, '');
      return !!src;
    }
    // Legacy fallback
    if (config?.scrapers?.bangumi?.apiBase) {
      this.apiBase = config.scrapers.bangumi.apiBase.replace(/\/+$/, '');
    }
    return config?.scrapers?.bangumi?.enabled !== false;
  }

  /**
   * Set active source from apiSources entry
   */
  setSource(source) {
    if (source?.url) this.apiBase = source.url.replace(/\/+$/, '');
    return this;
  }

  async search(keyword, source) {
    if (source) this.setSource(source);
    const url = `${this.apiBase}/v0/search/subjects`;
    const res = await tryFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ keyword }),
    });
    const data = await res.json();
    return (data.data || []).filter(r => r.type === 2);
  }

  async getSubjectDetail(id) {
    const url = `${this.apiBase}/v0/subjects/${id}`;
    const res = await tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    return res.json();
  }

  async downloadCover(imageUrl, coverDir, subjectId) {
    if (!imageUrl) return null;
    if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });

    const urlPath = new URL(imageUrl).pathname;
    const ext = path.extname(urlPath) || '.jpg';
    const filename = `${subjectId}${ext}`;
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
    return filepath;
  }

  /**
   * Truncate Bangumi summary to remove Japanese text after Chinese text.
   * Bangumi often stores bilingual summaries: Chinese version first, then Japanese.
   * Detection uses hiragana (U+3040-U+309F) and katakana (U+30A0-U+30FF) which
   * are unique to Japanese and never appear in Chinese text.
   * - If the first line contains kana → summary is entirely Japanese, keep as-is.
   * - If no kana detected → Chinese/English only, keep as-is.
   * - If Chinese lines followed by Japanese lines → truncate at first kana line.
   */
  static truncateSummary(summary) {
    if (!summary) return summary;
    const lines = summary.split('\n').filter(l => l.trim());
    if (lines.length <= 1) return summary;
    const hasKana = /[\u3040-\u309F\u30A0-\u30FF]/;
    const firstJpIdx = lines.findIndex(l => hasKana.test(l));
    if (firstJpIdx <= 0) return summary; // all Japanese or no Japanese detected
    return lines.slice(0, firstJpIdx).join('\n');
  }

  async fetchMetadata(title, coverDir, subjectId, preDetail) {
    let detail = preDetail;
    if (!detail) {
      detail = await this.getSubjectDetail(subjectId);
    }

    const imageUrl = detail?.images?.large;
    const coverPromise = imageUrl
      ? this.downloadCover(imageUrl, coverDir, subjectId).catch(e => { logger.error('Cover download failed:', e.message); return null; })
      : Promise.resolve(null);

    const [characters, persons, localCover] = await Promise.all([
      this.getCharacters(subjectId).catch(e => { logger.error('getCharacters failed:', e.message); return []; }),
      this.getPersons(subjectId).catch(e => { logger.error('getPersons failed:', e.message); return []; }),
      coverPromise,
    ]);

    return {
      source: 'bangumi',
      bangumiId: subjectId,
      bangumiTitle: detail.name_cn || detail.name || null,
      bangumiTitleJp: detail.name || null,
      summary: BangumiScraper.truncateSummary(detail.summary) || null,
      coverUrl: detail.images?.large || null,
      localCover,
      rating: detail.rating?.score ? parseFloat(detail.rating.score.toFixed(1)) : null,
      ratingRank: detail.rating?.rank || null,
      ratingTotal: detail.rating?.total || null,
      date: detail.date || null,
      eps: detail.eps || null,
      totalEpisodes: detail.total_episodes || null,
      platform: detail.platform || null,
      tags: (detail.tags || []).map(t => typeof t === 'string' ? t : (t.name || '')),
      infobox: detail.infobox || [],
      collection: detail.collection || null,
      characters: (() => {
        const ROLE_ORDER = { '主角': 0, '配角': 1, '客串': 2 };
        const SKIP_NAMES = [
          'アナウンス', '旁白', '解说', 'ナレーター', 'Narrator', '播报员', '播音员',
          'モブキャラクター', '路人甲', '群演', 'extras', 'Mob',
        ];
        return characters
          .map((c, i) => ({
            id: c.id,
            name: c.name,
            nameCn: c.name_cn || '',
        image: c.images?.small || c.images?.grid || null,
        roleName: c.relation || c.role_name || '',
        actors: (c.actors || []).map(a => ({
          id: a.id,
          name: a.name,
          nameCn: a.name_cn || '',
          image: a.images?.small || a.images?.grid || null,
            })),
            _i: i,
          }))
          .filter(c => {
            if (SKIP_NAMES.includes(c.name) || SKIP_NAMES.includes(c.nameCn)) return false;
            if (!c.actors || !c.actors.length) return false;
            return true;
          })
          .sort((a, b) => {
            const ra = ROLE_ORDER[a.roleName];
            const rb = ROLE_ORDER[b.roleName];
            if (ra != null && rb != null) return ra - rb;
            if (ra != null) return -1;
            if (rb != null) return 1;
            return a._i - b._i;
          })
          .map(({ _i, ...rest }) => rest);
      })(),
      persons: persons.map(p => ({
        id: p.id,
        name: p.name,
        nameCn: p.name_cn || '',
        image: p.images?.grid || p.images?.small || null,
        roleName: p.role_name || '',
        jobs: p.jobs || [],
      })),
    };
  }

  async getCharacters(subjectId) {
    const url = `${this.apiBase}/v0/subjects/${subjectId}/characters`;
    const res = await tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    return res.json();
  }

  async getPersons(subjectId) {
    const url = `${this.apiBase}/v0/subjects/${subjectId}/persons`;
    const res = await tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    return res.json();
  }

  /**
   * Get subject relations (sequels, prequels, spin-offs, etc.)
   * Used for building season chains for multi-season anime.
   */
  async getSubjectRelations(subjectId) {
    const url = `${this.apiBase}/v0/subjects/${subjectId}/subjects`;
    const res = await tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    return res.json(); // [{id, type, name, name_cn, relation, ...}]
  }
}

module.exports = BangumiScraper;
module.exports.truncateSummary = BangumiScraper.truncateSummary.bind(BangumiScraper);