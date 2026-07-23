// server/routes/relations.js — 关联作品 + 推荐 (on-demand)
const { jsonResp } = require('../lib/utils');
const { registry } = require('../scrapers');

module.exports = {
  async handleAnimeRelations(req, res, state) {
    const { data, logger } = state;
    const match = req.url.match(/^\/api\/anime\/(.+)\/relations$/);
    if (!match) { jsonResp(res, 400, { error: 'Invalid URL' }); return; }
    const id = decodeURIComponent(match[1]);
    const anime = data.library.find(a => a.id === id);
    if (!anime || !anime.anilistId) { jsonResp(res, 200, { relations: [] }); return; }

    try {
      const anilist = registry.get('anilist');
      const detail = await anilist.getDetail(anime.anilistId);
      const relations = (detail?.relations?.edges || []).map(e => {
        const node = e.node;
        const local = data.library.find(a => a.anilistId === node.id);
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
    } catch (e) {
      logger.error('Relations fetch failed:', e.message);
      jsonResp(res, 200, { relations: [], error: e.message });
    }
  },

  async handleAnimeRecommendations(req, res, state) {
    const { data, logger } = state;
    const match = req.url.match(/^\/api\/anime\/(.+)\/recommendations$/);
    if (!match) { jsonResp(res, 400, { error: 'Invalid URL' }); return; }
    const id = decodeURIComponent(match[1]);
    const anime = data.library.find(a => a.id === id);
    if (!anime || !anime.anilistId) { jsonResp(res, 200, { recommendations: [] }); return; }

    try {
      const anilist = registry.get('anilist');
      const recs = await anilist.getRecommendations(anime.anilistId);
      const recommendations = recs.map(r => {
        const local = data.library.find(a => a.anilistId === r.id);
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
    } catch (e) {
      logger.error('Recommendations fetch failed:', e.message);
      jsonResp(res, 200, { recommendations: [], error: e.message });
    }
  },
};