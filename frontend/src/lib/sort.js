// ─── 共享排序逻辑（Svelte 迁移 Chunk A）───
// 从 Mylist.svelte 逐字节抽取，禁止优化，保持行为一致。
import { tr } from './anime-utils.js';

export const STATUS_LABELS = {
  watching: tr('common.watching', '进行中'),
  wish: tr('common.wish', '计划中'),
  completed: tr('common.completed', '已完成'),
  on_hold: tr('common.on_hold', '搁置'),
  dropped: tr('common.dropped', '抛弃'),
};

export const MYLIST_STATUS_ORDER = ['watching', 'wish', 'completed', 'on_hold', 'dropped'];

export const ANIME_SORT_OPTIONS = [
  { key: 'name', label: tr('mylist.sortName', '名称') },
  { key: 'recent', label: tr('mylist.sortRecent', '最近观看') },
  { key: 'updated', label: tr('mylist.sortUpdated', '最近更新') },
  { key: 'rating', label: tr('common.rating', '评分') },
  { key: 'imported', label: tr('mylist.sortImported', '导入时间') },
];

export function sortAnimeItems(items, sortMode) {
  var FORMAT_RANK = { TV: 0, OVA: 1, SP: 2, MOVIE: 3 };

  function getBaseKey(a) {
    var t = (a.bangumiTitle || a.title || '').toLowerCase();
    t = t.replace(/[♪♫☆★！!？?~～\s]+/g, ' ').trim();
    t = t.replace(/\d+季/g, '').trim();
    t = t.replace(/\s*(OVA|SP|OAD|剧场版|Movie|Special|夏日时光|Dear My Sister|Sing For You|BLOOM|Nachuyachumi).*$/i, '').trim();
    t = t.replace(/\s+\d+[\s\S]*$/, '').trim();
    t = t.replace(/\d+$/, '').trim();
    return t || (a.title || a.id || '').toLowerCase();
  }
  function getSeasonRank(a) {
    var p = (a.platform || '').toUpperCase();
    var formatRank = FORMAT_RANK[p] != null ? FORMAT_RANK[p] : 0;
    var season = a.matchedSeason || a.season || 1;
    return formatRank * 100 + season;
  }
  function getJpName(a) {
    return (a.bangumiTitleJp || a.bangumiTitle || a.title || '').toLowerCase();
  }
  function getLastWatched(a) {
    if (!a.episodes || a.episodes.length === 0) return '';
    var latest = '';
    a.episodes.forEach(function (e) {
      if (e.updatedAt && e.updatedAt > latest) latest = e.updatedAt;
    });
    return latest;
  }
  function getBlockScore(block, key) {
    if (key === 'rating') return Math.max.apply(null, block.map(function (a) { return a.rating || 0; }));
    if (key === 'recent') return block.reduce(function (m, a) { var lw = getLastWatched(a); return lw > m ? lw : m; }, '');
    if (key === 'updated') return block.reduce(function (m, a) { return (a.importedAt || '') > m ? a.importedAt || '' : m; }, '');
    if (key === 'imported') return block.reduce(function (m, a) { var i = a.importedAt || 'z'; return i < m ? i : m; }, 'z');
    return getJpName(block[0]);
  }

  var groups = {};
  items.forEach(function (a) {
    var key = getBaseKey(a);
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  });
  var blocks = Object.values(groups);
  blocks.forEach(function (block) { block.sort(function (a, b) { return getSeasonRank(a) - getSeasonRank(b); }); });

  blocks.sort(function (a, b) {
    var sa = getBlockScore(a, sortMode);
    var sb = getBlockScore(b, sortMode);
    if (typeof sa === 'number') return sb - sa;
    if (sortMode === 'imported') return sa.localeCompare(sb);
    return sb.localeCompare(sa) || sa.localeCompare(sb);
  });

  var result = [];
  blocks.forEach(function (block) { block.forEach(function (a) { result.push(a); }); });
  return result;
}