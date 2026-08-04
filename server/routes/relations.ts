// server/routes/relations.ts — 关联作品 + 推荐 (on-demand)
import { jsonResp } from '../lib/utils';
import { registry } from '../scrapers';

// 服务端内存缓存，避免重复调 AniList API
const _cache = new Map();
const _CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时
function cachedFetch(key: string, fetcher: () => Promise<any>) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < _CACHE_TTL_MS) return hit.data;

  // 缓存穿透 → 并发去重（同 key 同时涌入只调一次）
  if (_cache.has(key)) {
    const entry = _cache.get(key);
    if (entry.pending) return entry.pending;
    // 过期条目无 pending 请求 → 删除，走下方重新请求
    _cache.delete(key);
  }

  const p = fetcher().then(data => {
    _cache.set(key, { ts: Date.now(), data, pending: undefined });
    return data;
  }).catch(e => {
    _cache.delete(key);
    throw e;
  });
  _cache.set(key, { ts: 0, data: undefined, pending: p });
  return p;
}

export = {
  async handleAnimeRelations(req: any, res: any, state: any): Promise<void> {
    const { data, logger } = state;
    const match = req.url.match(/^\/api\/anime\/(.+)\/relations$/);
    if (!match) { jsonResp(res, 400, { error: 'Invalid URL' }); return; }
    const id = decodeURIComponent(match[1]);
    const anime = data.library.find((a: any) => a.id === id);
    if (!anime || !anime.anilistId) { jsonResp(res, 200, { relations: [] }); return; }

    try {
      const anilist = registry.get('anilist');
      if (!anilist) { jsonResp(res, 200, { relations: [] }); return; }
      const detail = await cachedFetch('detail:' + anime.anilistId, () => anilist.getDetail?.(anime.anilistId) ?? Promise.resolve(undefined));
      const relations = (detail?.relations?.edges || []).map((e: any) => {
        const node = e.node;
        const local = data.library.find((a: any) => a.anilistId === node.id);
        return {
          relationType: e.relationType,
          id: node.id,
          title: {
            romaji: node.title?.romaji || null,
            english: node.title?.english || null,
            native: node.title?.native || null,
          },
          coverImage: { large: node.coverImage?.large || null },
          meanScore: node.meanScore || null,
          format: node.format || null,
          episodes: node.episodes || null,
          inLibrary: !!local,
          localId: local?.id || null,
        };
      });
      jsonResp(res, 200, { relations });
    } catch (e: any) {
      logger.error('Relations fetch failed:', e.message);
      jsonResp(res, 200, { relations: [], error: e.message });
    }
  },

  async handleAnimeRecommendations(req: any, res: any, state: any): Promise<void> {
    const { data, logger } = state;
    const match = req.url.match(/^\/api\/anime\/(.+)\/recommendations$/);
    if (!match) { jsonResp(res, 400, { error: 'Invalid URL' }); return; }
    const id = decodeURIComponent(match[1]);
    const anime = data.library.find((a: any) => a.id === id);
    if (!anime || !anime.anilistId) { jsonResp(res, 200, { recommendations: [] }); return; }

    try {
      const anilist = registry.get('anilist');
      if (!anilist) { jsonResp(res, 200, { recommendations: [] }); return; }
      const recs = await cachedFetch('rec:' + anime.anilistId, () => anilist.getRecommendations?.(anime.anilistId) ?? Promise.resolve(undefined));
      const recommendations = recs.map((r: any) => {
        const local = data.library.find((a: any) => a.anilistId === r.id);
        return {
          rating: r.rating || 0,
          id: r.id,
          title: {
            romaji: r.title?.romaji || null,
            english: r.title?.english || null,
            native: r.title?.native || null,
          },
          coverImage: { large: r.coverImage?.large || null },
          meanScore: r.meanScore || null,
          format: r.format || null,
          episodes: r.episodes || null,
          inLibrary: !!local,
          localId: local?.id || null,
        };
      });
      jsonResp(res, 200, { recommendations });
    } catch (e: any) {
      logger.error('Recommendations fetch failed:', e.message);
      jsonResp(res, 200, { recommendations: [], error: e.message });
    }
  },
};
