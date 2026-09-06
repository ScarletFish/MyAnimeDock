// server/lib/enrich.ts — 动漫条目的 myList 关联字段 + 播放会话派生字段统一注入
// 供 /api/anime/:id、/api/continue-watching、bangumi 检索共用，保证详情/续播预填数据一致。
// 列表读取已由 lib/list-item.ts 的 buildListItems() 统一（不注入 myListStatus，改 ListItem.status）。
import type { AppData, Anime } from '../types';

// 给单个 anime 注入：
//  - myList 关联字段：myListStatus / userRating / progress / startedAt / completedAt
//  - 播放会话派生字段：firstPlayedAt（最早播放）/ lastPlayedAt（最晚播放）/ lastPlayedEp
// 变异并返回原对象。
export function enrichAnime(a: Anime, data: AppData): Anime {
  const myItem = (data.myList || []).find((m: any) => m.animeId === a.id);
  a.myListStatus = myItem ? myItem.status : null;
  a.userRating = myItem ? myItem.rating : null;
  a.progress = myItem ? myItem.progress : null;
  a.startedAt = myItem ? myItem.startedAt : null;
  a.completedAt = myItem ? myItem.completedAt : null;
  const sessions = (data.playSessions || [])
    .filter((s: any) => s.animeId === a.id)
    .sort((x: any, y: any) => (new Date(y.startTime) as any) - (new Date(x.startTime) as any));
  if (sessions.length > 0) {
    a.lastPlayedEp = sessions[0].episodeNumber;
    a.lastPlayedAt = sessions[0].startTime;
    a.firstPlayedAt = sessions[sessions.length - 1].startTime;
  } else {
    a.lastPlayedEp = null;
    a.lastPlayedAt = null;
    a.firstPlayedAt = null;
  }
  return a;
}