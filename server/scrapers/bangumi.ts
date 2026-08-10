import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { curlFetch, fetchWithTimeout, downloadImage, isNetworkError, isCloudflareInterference, isCurlFallbackActive, activateCurlFallback, USER_AGENT } from '../lib/http-fetch';
import { createTimedCache, createPersistentCache } from '../lib/utils';
import { DATA_DIR } from '../lib/config';

const logger: Logger = require('../logger').child('[BANGUMI]');

class BangumiScraper {
  name: string;
  apiBase: string;

  constructor() {
    this.name = 'bangumi';
    this.apiBase = 'https://api.bangumi.lol';
  }

  /**
   * Check if config has at least one bangumi source
   */
enabled(config: any): boolean {
    if (config?.apiSources) {
      return !!config.apiSources.find((s: any) => s.type === 'bangumi');
    }
    return config?.scrapers?.bangumi?.enabled !== false;
  }

  setSource(source: any): this {
    if (source?.url) this.apiBase = source.url.replace(/\/+$/, '');
    return this;
  }

  async tryFetch(url: string, options: any = {}): Promise<{ json: () => Promise<any> }> {
    if (!isCurlFallbackActive()) {
      try {
        const res = await fetchWithTimeout(url, options);
        if (res.ok) return res;
        const text = await res.text();
        if (isCloudflareInterference(res.status, text)) {
          activateCurlFallback();
        } else {
          throw new Error(`Bangumi API error (${res.status}): ${text.substring(0, 200)}`);
        }
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        activateCurlFallback();
      }
    }

    // Fall through to curl for Cloudflare/network failures
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body || null;
    return { json: () => curlFetch(method, url, body) };
  }

async search(keyword: string, source: any): Promise<any[]> {
    if (source) this.setSource(source);
    const url = `${this.apiBase}/v0/search/subjects`;
    const res = await this.tryFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ keyword }),
    });
    const data = await res.json();
    return (data.data || []).filter((r: any) => r.type === 2);
  }

  async getSubjectDetail(id: any): Promise<any> {
    const url = `${this.apiBase}/v0/subjects/${id}`;
    const res = await this.tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    return res.json();
  }

  async downloadCover(imageUrl: string, coverDir: string, subjectId: any): Promise<string | null> {
    if (!imageUrl) return null;
    const urlPath = new URL(imageUrl).pathname;
    const ext = path.extname(urlPath) || '.jpg';
    const filename = `${subjectId}${ext}`;
    return downloadImage(imageUrl, coverDir, filename, {
      onSaved: (fp) => {
        if (ext.match(/\.(jpg|jpeg|png|webp)$/i)) {
          try { require('../lib/utils').preGenerateCovers(fp); } catch (_) {}
        }
      },
    });
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
  static truncateSummary(summary: string): string {
    if (!summary) return summary;
    const lines = summary.split('\n').filter(l => l.trim());
    if (lines.length <= 1) return summary;
    const hasKana = /[\u3040-\u309F\u30A0-\u30FF]/;
    const firstJpIdx = lines.findIndex(l => hasKana.test(l));
    if (firstJpIdx <= 0) return summary; // all Japanese or no Japanese detected
    return lines.slice(0, firstJpIdx).join('\n');
  }

  async fetchMetadata(title: any, coverDir: string, subjectId: any, preDetail: any): Promise<any> {
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
      summary: detail.summary || null,
      localCover,
      rating: detail.rating?.score ? parseFloat(detail.rating.score.toFixed(1)) : null,
      ratingRank: detail.rating?.rank || null,
      ratingTotal: detail.rating?.total || null,
      date: detail.date || null,
      eps: detail.eps || null,
      totalEpisodes: detail.total_episodes || null,
      platform: detail.platform || null,
      tags: (detail.tags || []).map((t: any) => typeof t === 'string' ? t : (t.name || '')),
      infobox: detail.infobox || [],
      collection: detail.collection || null,
      characters: (() => {
        const ROLE_ORDER: Record<string, number> = { '主角': 0, '配角': 1, '客串': 2 };
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
        actors: (c.actors || []).map((a: any) => ({
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
        roleName: p.role_name || p.relation || '',
        jobs: p.jobs || p.career || [],
      })),
    };
  }

  async getCharacters(subjectId: any): Promise<any[]> {
    const url = `${this.apiBase}/v0/subjects/${subjectId}/characters`;
    const res = await this.tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    return res.json();
  }

  async getPersons(subjectId: any): Promise<any[]> {
    const url = `${this.apiBase}/v0/subjects/${subjectId}/persons`;
    const res = await this.tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    return res.json();
  }

  /**
   * Get subject relations (sequels, prequels, spin-offs, etc.)
   * Used for building season chains for multi-season anime.
   */
  async getSubjectRelations(subjectId: any): Promise<any[]> {
    const url = `${this.apiBase}/v0/subjects/${subjectId}/subjects`;
    const res = await this.tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    return res.json(); // [{id, type, name, name_cn, relation, ...}]
  }
}

(BangumiScraper as any).truncateSummary = BangumiScraper.truncateSummary.bind(BangumiScraper);
export = BangumiScraper;
