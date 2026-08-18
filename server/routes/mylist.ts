// server/routes/mylist.ts — MyList 路由
import { jsonResp, readBody } from '../lib/utils';
import { enrichAnime } from '../lib/enrich';
import type { ServerState } from '../types';

function handleGetMyList(req: any, res: any, state: ServerState) {
  const { data } = state;
  const merged: any[] = [];
  const animeMap = new Map(data.library.map((a: any) => [a.id, a]));
  for (const item of data.myList || []) {
    if (item.animeId) {
      const anime: any = animeMap.get(item.animeId);
      if (anime) enrichAnime(anime, data);
      merged.push({
        id: item.id || item.animeId, animeId: item.animeId,
        bangumiId: anime ? anime.bangumiId : item.bangumiId,
        title: anime ? anime.title : item.title,
        bangumiTitle: anime ? anime.bangumiTitle : item.bangumiTitle,
        bangumiTitleJp: anime ? anime.bangumiTitleJp : null,
        coverUrl: anime ? anime.localCover : item.coverUrl,
        localCover: anime ? anime.localCover : null,
        season: anime ? anime.season : null,
        matchedSeason: anime ? anime.matchedSeason : null,
        platform: anime ? anime.platform : null,
        rating: anime ? (anime.rating || null) : item.rating,
        userRating: item.rating, thoughts: item.thoughts, notes: item.notes,
        progress: item.progress, startedAt: item.startedAt, completedAt: item.completedAt,
        firstPlayedAt: anime ? (anime.firstPlayedAt || null) : null,
        lastPlayedAt: anime ? (anime.lastPlayedAt || null) : null,
        importedAt: anime ? anime.importedAt : null,
        status: item.status,
        episodeCount: anime ? anime.episodes.length : 0,
        episodesWatched: anime ? anime.episodes.filter((e: any) => e.watched).length : 0,
        episodes: anime ? anime.episodes : [],
        hasLocalFiles: !!anime, source: 'library',
        summary: anime ? anime.summary : item.summary,
      });
    }
  }
  jsonResp(res, 200, merged);
}

async function handleUpdateMyListStatus(req: any, res: any, state: ServerState) {
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
    let existing = data.myList.find(m => m.animeId === id || m.id === id);
    if (existing) {
      existing.status = status;
    } else {
      data.myList.push({ animeId: id, status, rating: null, thoughts: '', notes: '' } as any);
    }
    db.saveMyList(data).then(() => {
      jsonResp(res, 200, { ok: true });
      if (existing && existing.animeId) bangumiSync.pushStatusChange(existing.animeId, data);
    }).catch((e: any) => {
      logger.error('MyList status save error:', e);
      jsonResp(res, 500, { error: 'Failed to save status' });
    });
  } catch (e: any) {
    jsonResp(res, 400, { error: 'Invalid request body' });
  }
}

async function handleUpdateMyListItem(req: any, res: any, state: ServerState) {
  const { data, db, logger } = state;
  try {
    const body = await readBody(req);
    const fields = JSON.parse(body);
    const mylistUpdateMatch = req.url.match(/^\/api\/mylist\/([^/]+)$/);
    const id = decodeURIComponent(mylistUpdateMatch[1]);
    const allowed = ['status', 'rating', 'progress', 'startedAt', 'completedAt', 'notes', 'thoughts'];
    const update: any = {};
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
            if (update[k] !== undefined) (data.myList[idx] as any)[k] = update[k];
          }
        }
      }
      jsonResp(res, 200, { ok: true });
    }).catch((e: any) => {
      logger.error('MyList update error:', e);
      jsonResp(res, 500, { error: 'Failed to update' });
    });
  } catch (e: any) {
    jsonResp(res, 400, { error: 'Invalid request body' });
  }
}

async function handleDeleteMyListItem(req: any, res: any, state: ServerState) {
  const { data, db, logger } = state;
  try {
    const mylistDeleteMatch = req.url.match(/^\/api\/mylist\/([^/]+)$/);
    const id = decodeURIComponent(mylistDeleteMatch[1]);
    if (data.myList) {
      const idx = data.myList.findIndex(m => m.id === id || m.animeId === id);
      if (idx !== -1) data.myList.splice(idx, 1);
    }
    db.saveMyList(data).then(() => jsonResp(res, 200, { ok: true }))
      .catch((e: any) => { logger.error('MyList delete save error:', e); jsonResp(res, 500, { error: 'Failed to persist' }); });
  } catch (e: any) {
    jsonResp(res, 400, { error: 'Invalid request body' });
  }
}

export {
  handleGetMyList,
  handleUpdateMyListStatus,
  handleUpdateMyListItem,
  handleDeleteMyListItem,
};
