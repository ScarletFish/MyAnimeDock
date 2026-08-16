// ─── 跨组件共享状态（Svelte store）───
// 渐进迁移收敛：组件间通过 window.* 全局通信的副产物，统一收口到这里的 writable store。
// 写入方 / 读取方：
//   libraryData          Library.svelte 写入，Detail.svelte / SearchBar.svelte 读取
//   mylistData           Mylist.svelte 写入，Detail.svelte 读取
//   pendingAutoPlay      Library.svelte 写入，Detail.svelte 读取
//   pendingFinishAnimeId mpv-status.js 写入，Detail.svelte 读取
import { writable } from 'svelte/store';

export const libraryData = writable([]);
export const mylistData = writable([]);
export const pendingAutoPlay = writable(null);
export const pendingFinishAnimeId = writable(null);