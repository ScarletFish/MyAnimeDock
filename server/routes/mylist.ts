// server/routes/mylist.ts — MyList 路由（统一 ListItem 模型）
// GET /api/mylist（全集 / ?filter=local）与 mutation 响应（{ ok, item }）
// 均经 lib/list-item.ts 的 buildListItems() 聚合，单一数据源。
import { jsonResp, readBody } from '../lib/utils';
import { buildListItems } from '../lib/list-item';
import type { ServerState } from '../types';

function handleGetMyList(req: any, res: any, state: ServerState) {
  const { data, logger } = state;
  try {
    const localOnly = new URL(req.url, 'http://localhost').searchParams.get('filter') === 'local';
    jsonResp(res, 200, buildListItems(data, { localOnly }));
  } catch (err) {
    logger.error('[mylist]', err);
    jsonResp(res, 500, { error: (err as Error).message });
  }
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
      // 返回更新后的 ListItem，前端就地 patch 对应模块，免全量重取
      const animeId = existing?.animeId || id;
      const item = buildListItems(data, { ids: new Set([animeId, id]) })[0] ?? null;
      jsonResp(res, 200, { ok: true, item });
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
      // 返回更新后的 ListItem，前端就地 patch 对应模块，免全量重取
      const entry = (data.myList || []).find(m => m.id === id || m.animeId === id);
      const animeId = entry?.animeId || id;
      const item = buildListItems(data, { ids: new Set([animeId, id]) })[0] ?? null;
      jsonResp(res, 200, { ok: true, item });
    }).catch((e: any) => {
      logger.error('MyList update error:', e);
      jsonResp(res, 500, { error: 'Failed to update' });
    });
  } catch (e: any) {
    jsonResp(res, 400, { error: 'Invalid request body' });
  }
}

export {
  handleGetMyList,
  handleUpdateMyListStatus,
  handleUpdateMyListItem,
};
