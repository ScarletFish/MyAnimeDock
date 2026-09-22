// ─── 会话级内存缓存：统计面板 5 图 + 发现页浏览数据 ───
// 模块级单例，跨组件/跨视图挂载存活；整页刷新即全清。
// 失效策略：
//   1. 订阅 onInvalidated('library') 数据变更总线（patch/remove 等）→ 统计 5 图全清 + 发现置脏，
//      下次打开自动重取。统计数据全依赖库内容，任何库变更都可能影响，统一全清。
//   2. 统计各图手动刷新按钮 → invalidateStatsCache() 强制重取兜底。
import { onInvalidated } from './ui-state.js';

// ─── 统计面板 5 图缓存 ───
// key 对应 Stats.svelte 5 图加载器：tags/activity/rating/season/chord。
// 缓存 fetch 的原始响应；loader 命中后走原有渲染/空态判定路径（跳过 fetch、不闪 loading）。
// null = 未缓存（首次/失效后）。
const statsCache = { tags: null, activity: null, rating: null, season: null, chord: null };

export function getStatsCache() {
  return statsCache;
}

export function setStatsCache(key, data) {
  if (!(key in statsCache)) return; // 保持 5-key 形状不变，invalidateStatsCache 全清才可靠
  statsCache[key] = data;
}

// 全部清空置 null（简单可靠）：库变更 + 手动刷新兜底统一走这里。
export function invalidateStatsCache() {
  for (const k of Object.keys(statsCache)) statsCache[k] = null;
}

// ─── 发现页缓存 ───
// Discovery 数据常驻组件内 $state([])，缓存语义 = "脏"标志：
// 打开时仅在脏时重拉（loadDiscovery）；成功取回新 tree 且非空后 markDiscoveryClean()。
// 失败/空树保持脏 → 下次打开自动重试。
let discoveryDirty = true;

export function isDiscoveryDirty() {
  return discoveryDirty;
}

export function markDiscoveryClean() {
  discoveryDirty = false;
}

export function invalidateDiscoveryCache() {
  discoveryDirty = true;
}

// 库数据变更总线 → 统计全清 + 发现置脏
onInvalidated('library', () => {
  invalidateStatsCache();
  invalidateDiscoveryCache();
});