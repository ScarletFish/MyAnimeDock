// server/lib/enrich.ts — 动漫条目的 myList 关联字段 + 播放会话派生字段统一注入
// 供 /api/library、/api/mylist、/api/anime/:id 共用，保证状态弹窗预填数据一致。
import type { AppData, Anime } from '../types';

// 给单个 anime 注入：
//  - myList 关联字段：myListStatus / userRating / progress / startedAt / completedAt
//  - 播放会话派生字段：firstPlayedAt（最早播放）/ lastPlayedAt（最晚播放）/ lastPlayedEp
// 变异并返回原对象（与既有 handleGetLibrary 的注入方式一致）。
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