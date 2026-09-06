// ─── 跨组件共享状态（Svelte store）───
// 渐进迁移收敛：组件间通过 window.* 全局通信的副产物，统一收口到这里的 writable store。
// 单一事实源（统一刷新管线）：
//   mylistData   唯一可写 store = 全集（/api/mylist）。所有增删改（patch/remove）只动它。
//   libraryData  derived = 本地子集（animeId 非空 && hasLocalFiles，语义同 ?filter=local）。
//                读方（Library/SearchBar/Detail）照常 $libraryData，删本地条目两视图自动一致。
//   pendingAutoPlay      Library.svelte 写入，Detail.svelte 读取
//   pendingFinishAnimeId mpv-status.js 写入，Detail.svelte 读取
import { writable, derived } from 'svelte/store';
import { localStore } from './local-store.js';

export const mylistData = writable([]);
export const libraryData = derived(
  mylistData,
  ($ml) => $ml.filter((it) => it.animeId !== null && it.hasLocalFiles),
  [],
);
export const pendingAutoPlay = writable(null);
export const pendingFinishAnimeId = writable(null);

// ─── 排序模式（localStorage ↔ store 双向同步）───
// LocalAnimeSection / Mylist 写入，Detail 读取用于左右导航顺序。
export const librarySortMode = localStore('librarySort', 'name');
export const mylistSortMode = localStore('mylistSort', 'name');

// ─── 设置项（localStorage ↔ store 双向同步）───
// Settings.svelte 写入，Library / Mylist / Detail 等视图响应式读取。
export const cardTitleLibrary = localStore('myAnimDock_cardTitle_library', false);
export const cardTitleMylist = localStore('myAnimDock_cardTitle_mylist', false);
export const finishConfirmMode = localStore('myAnimDock_finishConfirm', 'prompt');
export const detailTitleBg = localStore('myAnimDock_detailTitleBg', false);
export const ignoreLocalFileMissing = localStore('myAnimDock_ignoreLocalFileMissing', false);

// ─── 启动预取 promise（main.js 发起，Library.svelte 首次消费）───
// 首屏并行：/api/mylist 全集不依赖 /api/config，启动时立即发起并缓存 promise，
// Library 首次加载时消费（省一次串行 RTT，服务器端 pinyin 计算提前开始）。
// 消费后置空，后续刷新/视图切换走全新请求。
// 单 store 方案：预取全集，Library 用 libraryData derived 视图渲染本地子集，
// Mylist 打开直接吃同一份缓存。
export let startupLibraryPromise = null;
export function setStartupLibraryPromise(p) { startupLibraryPromise = p; }
export function consumeStartupLibraryPromise() {
  const p = startupLibraryPromise;
  startupLibraryPromise = null;
  return p;
}

// ─── 分模块响应式刷新：单条目变更就地 patch，不整库重取 ───
// 变更方（后端已在 mutation 响应中返回统一 ListItem）调用 patchLibraryItem，
// 只更新唯一事实源 mylistData；libraryData 为 derived 自动跟随，两视图同时一致。
// Library 的 continueItems / 状态分区 derived 随 store 更新自动重算，只重渲染受影响模块。
// 找不到目标条目时 no-op（条目可能已被删除/从未加载，交由既有全量路径处理）。
// 匹配用 id || animeId：ListItem.id 可能是 mylist 行 id 或 anime id，两形态都要能命中。
export function patchLibraryItem(updatedAnime) {
  if (!updatedAnime || !updatedAnime.id) return false;
  // changed 记录本次 update 是否真的替换成功；未命中（条目已被删/从未加载）不发失效。
  let changed = false;
  let missDiag = null;
  mylistData.update((list) => {
    const idx = list.findIndex((a) => a.id === updatedAnime.id || a.animeId === updatedAnime.id);
    if (idx === -1) {
      // 正常路径必然命中（store 即数据源）。未命中 = 数据失同步（bug），
      // 保留全量兜底自愈，但 warn 暴露以便定位根因。
      missDiag = { id: updatedAnime.id, animeId: updatedAnime.animeId ?? null, storeLength: list.length };
      return list;
    }
    const next = list.slice();
    next[idx] = { ...updatedAnime };
    changed = true;
    return next;
  });
  if (changed) notifyInvalidated('library');
  else if (missDiag) console.warn('[ui-state] patchLibraryItem 未命中（触发调用方全量兜底）', missDiag);
  return changed;
}

// 单条目删除：从唯一事实源 mylistData 移除（删除 API 已成功时调用），
// libraryData 派生自动消失。stats 由调用方决定是否刷新。
export function removeLibraryItemFromStore(id) {
  if (!id) return;
  // changed 记录条目是否真的存在；不存在时 no-op，不发失效。
  let changed = false;
  let missDiag = null;
  mylistData.update((list) => {
    const next = list.filter((a) => a.id !== id && a.animeId !== id);
    changed = next.length !== list.length;
    if (!changed) missDiag = { id, storeLength: list.length };
    return next;
  });
  if (changed) notifyInvalidated('library');
  else if (missDiag) console.warn('[ui-state] removeLibraryItemFromStore 未命中（store 中无该条目）', missDiag);
}

// ─── 数据失效总线：写入方 notify，消费者 subscribe 后按需刷新 ───
// 单条变更（patch/remove）后广播 'library' 失效；全量重载路径自身会带刷新，不发通知。
// 微任务合并：同一次变更内的多次 notify 只触发一轮订阅回调。
const invalidationListeners = new Map();      // kind → Set<fn>
let invalidationScheduled = false;
export function notifyInvalidated(kind) {
  const fns = invalidationListeners.get(kind);
  if (!fns || fns.size === 0) return;
  invalidationScheduled = true;
  queueMicrotask(() => {
    if (!invalidationScheduled) return;
    invalidationScheduled = false;
    for (const [k, set] of invalidationListeners) {
      if (set.size === 0) continue;
      for (const fn of [...set]) fn();
    }
  });
}
// 返回取消订阅函数
export function onInvalidated(kind, fn) {
  if (!invalidationListeners.has(kind)) invalidationListeners.set(kind, new Set());
  invalidationListeners.get(kind).add(fn);
  return () => invalidationListeners.get(kind)?.delete(fn);
}