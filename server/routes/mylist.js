// @ts-nocheck
// server/routes/mylist.js — MyList、Wishlist 路由
const { jsonResp, readBody } = require('../lib/utils');

module.exports = {
  handleGetMyList(req, res, state) {
    const { data } = state;
    const merged = [];
    const animeMap = new Map(data.library.map(a => [a.id, a]));
    // 每部动画最早一次播放的开始时间（状态弹窗预填"开始日期"用，避免用户回忆）
    const firstPlayedMap = new Map();
    for (const s of data.playSessions || []) {
      const cur = firstPlayedMap.get(s.animeId);
      if (!cur || new Date(s.startTime) < new Date(cur)) firstPlayedMap.set(s.animeId, s.startTime);
    }
    for (const item of data.myList || []) {
      if (item.animeId) {
        const anime = animeMap.get(item.animeId);
        merged.push({
          id: item.id || item.animeId, animeId: item.animeId,
          bangumiId: anime ? anime.bangumiId : item.bangumiId,
          title: anime ? anime.title : item.title,
          bangumiTitle: anime ? anime.bangumiTitle : item.bangumiTitle,
          bangumiTitleJp: anime ? anime.bangumiTitleJp : null,
          coverUrl: anime ? anime.coverUrl : item.coverUrl,
          localCover: anime ? anime.localCover : null,
          season: anime ? anime.season : null,
          matchedSeason: anime ? anime.matchedSeason : null,
          platform: anime ? anime.platform : null,
          rating: anime ? (anime.rating || null) : item.rating,
          userRating: item.rating, thoughts: item.thoughts, notes: item.notes,
          progress: item.progress, startedAt: item.startedAt, completedAt: item.completedAt,
          firstPlayedAt: firstPlayedMap.get(item.animeId) || null,
          importedAt: anime ? anime.importedAt : null,
          status: item.status,
          episodeCount: anime ? anime.episodes.length : 0,
          episodesWatched: anime ? anime.episodes.filter(e => e.watched).length : 0,
          episodes: anime ? anime.episodes : [],
          hasLocalFiles: !!anime, source: 'library',
          summary: anime ? anime.summary : item.summary,
        });
      } else {
        merged.push({
          id: item.id, bangumiId: item.bangumiId,
          title: item.title, bangumiTitle: item.bangumiTitle,
          coverUrl: item.coverUrl,
          rating: item.rating, status: 'wish',
          hasLocalFiles: false, source: 'wishlist',
          summary: item.summary,
        });
      }
    }
    jsonResp(res, 200, merged);
  },

  async handleUpdateMyListStatus(req, res, state) {
    const { data, db, bangumiSync, logger } = state;
    try {
      const body = await readBody(req);
      const { status } = JSON.parse(body);
      const mylistStatusMatch = req.url.match(/^\/api\/mylist\/([^/]+)\/status$/);
      const id = decodeURIComponent(mylistStatusMatch[1]);
      if (!status || !['watching', 'wish', 'completed', 'on_hold', 'dropped'].includes(status)) {
        jsonResp(res, 400, { error: 'Invalid status' }); return;
      }
      if (!data.myList) data.myList = [];
      let existing;
      if (id.startsWith('wish-')) {
        existing = data.myList.find(m => m.id === id);
      } else {
        existing = data.myList.find(m => m.animeId === id || m.id === id);
      }
      if (existing) {
        existing.status = status;
      } else if (id.startsWith('wish-')) {
        data.myList.push({ id, bangumiId: parseInt(id.replace('wish-', '')), title: '', status, rating: null, thoughts: '', notes: '' });
      } else {
        data.myList.push({ animeId: id, status, rating: null, thoughts: '', notes: '' });
      }
      db.saveMyList(data).then(() => {
        jsonResp(res, 200, { ok: true });
        if (existing && existing.animeId) bangumiSync.pushStatusChange(existing.animeId, data);
      }).catch(e => {
        logger.error('MyList status save error:', e);
        jsonResp(res, 500, { error: 'Failed to save status' });
      });
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },

  async handleUpdateMyListItem(req, res, state) {
    const { data, db, logger } = state;
    try {
      const body = await readBody(req);
      const fields = JSON.parse(body);
      const mylistUpdateMatch = req.url.match(/^\/api\/mylist\/([^/]+)$/);
      const id = decodeURIComponent(mylistUpdateMatch[1]);
      const allowed = ['status', 'rating', 'progress', 'startedAt', 'completedAt', 'notes', 'thoughts'];
      const update = {};
      for (const k of allowed) {
        if (fields[k] !== undefined) update[k] = fields[k];
      }
      if (Object.keys(update).length === 0) { jsonResp(res, 400, { error: 'No valid fields' }); return; }
      if (update.status && !['watching', 'wish', 'completed', 'on_hold', 'dropped'].includes(update.status)) {
        jsonResp(res, 400, { error: 'Invalid status' }); return;
      }
      db.updateMyListItem(id, update).then(() => {
        if (data && data.myList) {
          const idx = data.myList.findIndex(m => m.id === id || m.animeId === id);
          if (idx !== -1) {
            for (const k of allowed) {
              if (update[k] !== undefined) data.myList[idx][k] = update[k];
            }
          }
        }
        jsonResp(res, 200, { ok: true });
      }).catch(e => {
        logger.error('MyList update error:', e);
        jsonResp(res, 500, { error: 'Failed to update' });
      });
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },

  async handleDeleteMyListItem(req, res, state) {
    const { data, db, logger } = state;
    try {
      const mylistDeleteMatch = req.url.match(/^\/api\/mylist\/([^/]+)$/);
      const id = decodeURIComponent(mylistDeleteMatch[1]);
      if (data.myList) {
        const idx = data.myList.findIndex(m => m.id === id || m.animeId === id);
        if (idx !== -1) data.myList.splice(idx, 1);
      }
      db.saveMyList(data).then(() => jsonResp(res, 200, { ok: true }))
        .catch(e => { logger.error('MyList delete save error:', e); jsonResp(res, 500, { error: 'Failed to persist' }); });
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },

  handleGetWishlist(req, res, state) {
    const { data } = state;
    const wishItems = (data.myList || []).filter(m => !m.animeId);
    jsonResp(res, 200, wishItems);
  },

  async handlePostWishlist(req, res, state) {
    const { data, db, logger } = state;
    try {
      const body = await readBody(req);
      const item = JSON.parse(body);
      if (!item.bangumiId || !item.title) { jsonResp(res, 400, { error: 'bangumiId and title required' }); return; }
      if (!data.myList) data.myList = [];
      const existing = data.myList.find(m => !m.animeId && m.bangumiId === item.bangumiId);
      if (existing) { jsonResp(res, 200, { ok: true, myList: existing }); return; }
      const entry = {
        bangumiId: item.bangumiId, title: item.title,
        bangumiTitle: item.bangumiTitle || null, coverUrl: item.coverUrl || null,
        summary: item.summary || null, rating: item.rating || null, status: 'wish',
      };
      data.myList.push(entry);
      db.saveMyList(data).then(() => {
        jsonResp(res, 200, { ok: true, myList: entry });
      }).catch(e => {
        logger.error('Wishlist save error:', e);
        jsonResp(res, 500, { error: 'Failed to persist' });
      });
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },

  async handleDeleteWishlistItem(req, res, state) {
    const { data, db, logger } = state;
    try {
      const wishlistDeleteMatch = req.url.match(/^\/api\/wishlist\/([^/]+)$/);
      const id = decodeURIComponent(wishlistDeleteMatch[1]);
      const idx = (data.myList || []).findIndex(m => m.id === id);
      if (idx === -1) { jsonResp(res, 404, { error: 'Wishlist item not found' }); return; }
      data.myList.splice(idx, 1);
      db.saveMyList(data).then(() => jsonResp(res, 200, { ok: true }))
        .catch(e => { logger.error('Wishlist delete save error:', e); jsonResp(res, 500, { error: 'Failed to persist' }); });
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },
};
