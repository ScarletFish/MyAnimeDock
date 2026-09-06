// server/lib/list-item.ts — ListItem 统一投影（single data source）
// GET /api/mylist（全集 / ?filter=local）与 mylist mutation 响应（{ ok, item }）的唯一构建入口。
// 列表层不再注入 myListStatus（改 status），episodes[] 不下发只给计数。
// 字段投影规则：
//   anime（library）行 → title/bangumiTitle/bangumiTitleJp/localCover/rating/pinyinTitle/
//                        anilistTags/importedAt/season/matchedSeason/platform/episodes(计数)
//   mylist 行           → status/userRating/progress/startedAt/completedAt/thoughts/notes/coverUrl/bangumiId
//   playSessions        → firstPlayedAt（最早）/ lastPlayedAt（最晚），对齐 lib/enrich.ts
import type { AppData, Anime, ListItem, MyListItem, PlaySession } from '../types';

export interface BuildListItemsOptions {
  /** 仅本地条目：animeId 非空 && downloaded === true（语义同旧 GET /api/library） */
  localOnly?: boolean;
  /** 限定 animeId / 列表项 id（mutation 响应取单条 ListItem 用） */
  ids?: ReadonlySet<string>;
}

export function buildListItems(data: AppData, opts: BuildListItemsOptions = {}): ListItem[] {
  const { localOnly = false, ids } = opts;
  const library = data.library ?? [];
  const myList = data.myList ?? [];
  const playSessions = data.playSessions ?? [];

  const mylistByAnimeId = new Map<string, MyListItem>();
  for (const m of myList) {
    if (m.animeId) mylistByAnimeId.set(m.animeId, m);
  }

  const items: ListItem[] = [];

  // 1) animeId 非空的 mylist 行（无 animeId 的幽灵行不进入列表）
  for (const m of myList) {
    if (!m.animeId) continue;
    const anime = library.find((a) => a.id === m.animeId) ?? null;
    items.push(buildItem(m, anime, playSessions));
  }

  // 2) 无 mylist 行的 library 行 → 合成行（mylist 侧字段 null/''）
  for (const a of library) {
    if (mylistByAnimeId.has(a.id)) continue;
    items.push(buildItem(null, a, playSessions));
  }

  let result = items;

  if (localOnly) {
    result = result.filter((it) => it.animeId !== null && it.hasLocalFiles);
  }
  if (ids) {
    result = result.filter((it) => ids.has(it.animeId ?? '') || ids.has(it.id));
  }

  return result;
}

function buildItem(m: MyListItem | null, a: Anime | null, playSessions: PlaySession[]): ListItem {
  // 播放会话派生（对齐 lib/enrich.ts）：startTime 倒序，首/末次播放
  const sessions = a
    ? playSessions
        .filter((s) => s.animeId === a.id)
        .sort((x, y) => new Date(y.startTime).getTime() - new Date(x.startTime).getTime())
    : [];
  const lastPlayed = sessions[0] ?? null;
  const firstPlayed = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  const episodes = a?.episodes ?? [];
  const episodesWatched = episodes.filter((e) => e.watched).length;

  return {
    id: m?.id || a?.id || '',
    animeId: a ? a.id : (m?.animeId ?? null),
    bangumiId: a ? (a.bangumiId ?? null) : (m?.bangumiId ?? null),
    hasLocalFiles: !!(a && a.downloaded),
    title: a ? (a.title ?? '') : (m?.title ?? ''),
    bangumiTitle: a ? (a.bangumiTitle ?? null) : (m?.bangumiTitle ?? null),
    bangumiTitleJp: a ? (a.bangumiTitleJp ?? null) : null,
    localCover: a ? (a.localCover ?? null) : null,
    coverUrl: m ? (m.coverUrl ?? null) : null,
    summary: a ? (a.summary ?? null) : (m?.summary ?? null),
    status: m?.status ?? null,
    userRating: m?.rating ?? null,
    rating: a ? (a.rating ?? null) : null,
    progress: m?.progress ?? null,
    startedAt: m?.startedAt ?? null,
    completedAt: m?.completedAt ?? null,
    thoughts: m?.thoughts ?? '',
    notes: m?.notes ?? '',
    season: a ? (a.season ?? null) : null,
    matchedSeason: a ? (a.matchedSeason ?? null) : null,
    platform: a ? (a.platform ?? null) : null,
    pinyinTitle: a ? (a.pinyinTitle ?? null) : null,
    anilistTags: a ? (a.anilistTags ?? null) : null,
    importedAt: a ? (a.importedAt ?? null) : null,
    episodeCount: episodes.length,
    episodesWatched,
    firstPlayedAt: firstPlayed ? firstPlayed.startTime : null,
    lastPlayedAt: lastPlayed ? lastPlayed.startTime : null,
    source: a ? (a.source ?? null) : null,
  };
}
