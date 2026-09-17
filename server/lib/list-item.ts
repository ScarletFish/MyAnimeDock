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

  // 索引先行：主键直查，避免循环内线性 find/filter（有 id 就该按 id 查）。
  const libraryById = new Map<string, Anime>();
  for (const a of library) libraryById.set(a.id, a);
  const mylistByAnimeId = new Map<string, MyListItem>();
  const mylistById = new Map<string, MyListItem>();
  for (const m of myList) {
    if (m.animeId) mylistByAnimeId.set(m.animeId, m);
    if (m.id) mylistById.set(m.id, m);
  }
  const sessionsByAnimeId = new Map<string, PlaySession[]>();
  for (const s of playSessions) {
    if (!s.animeId) continue;
    let arr = sessionsByAnimeId.get(s.animeId);
    if (!arr) { arr = []; sessionsByAnimeId.set(s.animeId, arr); }
    arr.push(s);
  }

  // ids 直达：只构建命中的投影（mylist 行 id 或 anime id 两种形态），不构建全集再过滤。
  if (ids) {
    const items: ListItem[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const m = mylistByAnimeId.get(id) ?? mylistById.get(id) ?? null;
      const a = m?.animeId ? (libraryById.get(m.animeId) ?? null) : (libraryById.get(id) ?? null);
      // 无 animeId 的幽灵行不进列表（与全集路径语义一致）
      if (!a && !m?.animeId) continue;
      const item = buildItem(m, a, sessionsByAnimeId.get(a?.id ?? m?.animeId ?? '') ?? []);
      if (localOnly && (item.animeId === null || !item.hasLocalFiles)) continue;
      items.push(item);
    }
    return items;
  }

  const items: ListItem[] = [];

  // 1) animeId 非空的 mylist 行（无 animeId 的幽灵行不进入列表）
  for (const m of myList) {
    if (!m.animeId) continue;
    const anime = libraryById.get(m.animeId) ?? null;
    items.push(buildItem(m, anime, sessionsByAnimeId.get(m.animeId) ?? []));
  }

  // 2) 无 mylist 行的 library 行 → 合成行（mylist 侧字段 null/''）
  for (const a of library) {
    if (mylistByAnimeId.has(a.id)) continue;
    items.push(buildItem(null, a, sessionsByAnimeId.get(a.id) ?? []));
  }

  if (localOnly) {
    return items.filter((it) => it.animeId !== null && it.hasLocalFiles);
  }
  return items;
}

function buildItem(m: MyListItem | null, a: Anime | null, sessions: PlaySession[]): ListItem {
  // 播放会话派生（对齐 lib/enrich.ts）：startTime 倒序，首/末次播放。
  // 单遍扫描取最早/最晚，避免排序（排序是 O(n·logn)，且不污染共享分组数组）。
  let lastPlayed: PlaySession | null = null;
  let firstPlayed: PlaySession | null = null;
  for (const s of sessions) {
    const t = new Date(s.startTime).getTime();
    if (!lastPlayed || t >= new Date(lastPlayed.startTime).getTime()) lastPlayed = s;
    if (!firstPlayed || t <= new Date(firstPlayed.startTime).getTime()) firstPlayed = s;
  }
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
