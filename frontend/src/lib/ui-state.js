// ─── 跨组件共享状态（Svelte store）───
// 渐进迁移收敛：组件间通过 window.* 全局通信的副产物，统一收口到这里的 writable store。
// 写入方 / 读取方：
//   libraryData          Library.svelte 写入，Detail.svelte / SearchBar.svelte 读取
//   mylistData           Mylist.svelte 写入，Detail.svelte 读取
//   pendingAutoPlay      Library.svelte 写入，Detail.svelte 读取
//   pendingFinishAnimeId mpv-status.js 写入，Detail.svelte 读取
import { writable } from 'svelte/store';
import { localStore } from './local-store.js';

export const libraryData = writable([]);
export const mylistData = writable([]);
export const pendingAutoPlay = writable(null);
export const pendingFinishAnimeId = writable(null);

// ─── 设置项（localStorage ↔ store 双向同步）───
// Settings.svelte 写入，Library / Mylist / Detail 等视图响应式读取。
export const cardTitleLibrary = localStore('myAnimDock_cardTitle_library', false);
export const cardTitleMylist = localStore('myAnimDock_cardTitle_mylist', false);
export const finishConfirmMode = localStore('myAnimDock_finishConfirm', 'prompt');
export const detailTitleBg = localStore('myAnimDock_detailTitleBg', false);
export const ignoreLocalFileMissing = localStore('myAnimDock_ignoreLocalFileMissing', false);

// ─── 启动预取 promise（main.js 发起，Library.svelte 首次消费）───
// 首屏并行：/api/library 不依赖 /api/config，启动时立即发起并缓存 promise，
// Library 首次加载时消费（省一次串行 RTT，服务器端 pinyin 计算提前开始）。
// 消费后置空，后续刷新/视图切换走全新请求。
export let startupLibraryPromise = null;
export function setStartupLibraryPromise(p) { startupLibraryPromise = p; }
export function consumeStartupLibraryPromise() {
  const p = startupLibraryPromise;
  startupLibraryPromise = null;
  return p;
}