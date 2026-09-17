// ─── ui-state.js 语义变化守卫单元测试 ───
// libraryItemChanged：详情页磁盘对账后判断 ListItem 投影是否发生语义变化，
// 决定是否 patchLibraryItem + 发失效（无变化时零请求零通知）。
import { describe, expect, it } from 'vitest';
import { libraryItemChanged, getMylistItem, mylistData } from './ui-state.js';

describe('libraryItemChanged', () => {
  const base = {
    hasLocalFiles: true,
    episodeCount: 12,
    episodesWatched: 3,
    title: '某番',
    bangumiTitle: null,
    bangumiTitleJp: null,
    localCover: '/covers/x.jpg',
    coverUrl: null,
    summary: '简介',
    status: 'watching',
    userRating: null,
    rating: 8.1,
    progress: 0.25,
    startedAt: '2026-01-01',
    completedAt: null,
    thoughts: '',
    notes: '',
    season: 1,
    matchedSeason: null,
    platform: 'Bangumi',
    pinyinTitle: 'mou-fan',
    anilistTags: ['Action'],
    importedAt: '2026-01-01',
    firstPlayedAt: null,
    lastPlayedAt: '2026-02-01',
  };

  it(' identical projections → false（对账无变化，不触发同步）', () => {
    expect(libraryItemChanged(base, { ...base })).toBe(false);
  });

  it('新增剧集（episodeCount 变化）→ true', () => {
    expect(libraryItemChanged(base, { ...base, episodeCount: 13 })).toBe(true);
  });

  it('episodesWatched 变化 → true', () => {
    expect(libraryItemChanged(base, { ...base, episodesWatched: 4 })).toBe(true);
  });

  it('hasLocalFiles 变化 → true', () => {
    expect(libraryItemChanged(base, { ...base, hasLocalFiles: false })).toBe(true);
  });

  it('status 变化 → true', () => {
    expect(libraryItemChanged(base, { ...base, status: 'completed' })).toBe(true);
  });

  it('progress 变化 → true', () => {
    expect(libraryItemChanged(base, { ...base, progress: 0.5 })).toBe(true);
  });

  it('anilistTags 数组内容变化 → true', () => {
    expect(libraryItemChanged(base, { ...base, anilistTags: ['Action', 'Slice of Life'] })).toBe(true);
  });

  it('anilistTags 内容相同但引用不同（独立 JSON fetch）→ false', () => {
    const a = { ...base };
    const b = { ...base, anilistTags: [...base.anilistTags] };
    expect(a.anilistTags).not.toBe(b.anilistTags); // 引用确实不同
    expect(libraryItemChanged(a, b)).toBe(false);
  });

  it('不影响语义的字段差异（episodes 等未参与比较）→ false', () => {
    const a = { ...base, episodes: [{ number: 1, filePath: '/a.mp4', watched: true }] };
    const b = { ...base, episodes: [] };
    expect(libraryItemChanged(a, b)).toBe(false);
  });

  it('null / undefined 视为相同值（undefined vs null 不触发）→ false', () => {
    expect(libraryItemChanged({ ...base, bangumiTitle: null }, { ...base, bangumiTitle: undefined })).toBe(false);
  });

  it('缺参（store 未缓存该条目）→ true（守卫外由调用方决定走全量兜底）', () => {
    expect(libraryItemChanged(null, base)).toBe(true);
    expect(libraryItemChanged(base, undefined)).toBe(true);
  });
});

describe('getMylistItem（mylistData id 索引直查）', () => {
  const rowA = { id: 'm1', animeId: 'anime-1', title: 'A', hasLocalFiles: true };
  const rowB = { id: 'anime-2', animeId: 'anime-2', title: 'B', hasLocalFiles: true }; // 合成行：id 同 animeId

  it('按 mylist 行 id 命中（m1 → rowA）', () => {
    mylistData.set([rowA, rowB]);
    expect(getMylistItem('m1')).toBe(rowA);
  });

  it('按 animeId 命中（anime-1 → rowA）', () => {
    mylistData.set([rowA, rowB]);
    expect(getMylistItem('anime-1')).toBe(rowA);
  });

  it('合成行 id=animeId 双键均可命中', () => {
    mylistData.set([rowA, rowB]);
    expect(getMylistItem('anime-2')).toBe(rowB);
  });

  it('store 更新后索引同步重建（旧 id 失效）', () => {
    mylistData.set([{ id: 'old', animeId: 'anime-old', title: 'O', hasLocalFiles: true }]);
    expect(getMylistItem('old')).toBeTruthy();
    mylistData.set([rowA]);
    expect(getMylistItem('old')).toBeNull();   // 旧条目被清出
    expect(getMylistItem('anime-1')).toBe(rowA); // 新条目立即可查
  });

  it('未知 id / 空 id → null', () => {
    mylistData.set([rowA]);
    expect(getMylistItem('nope')).toBeNull();
    expect(getMylistItem(null)).toBeNull();
    expect(getMylistItem('')).toBeNull();
  });
});