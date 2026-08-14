import { mount } from 'svelte';
import App from './App.svelte';
import { settingsOpen } from './views/Settings.svelte';
import { discoveryOpen } from './views/Discovery.svelte';
import { libraryOpen } from './views/Library.svelte';
import { mylistOpen } from './views/Mylist.svelte';
import { statsOpen } from './views/Stats.svelte';
import { detailOpen, openDetail } from './views/Detail.svelte';

const app = mount(App, {
  target: document.getElementById('app'),
});

// ─── 渐进迁移路由表 ───
// SVELTE_VIEWS[v] = true 表示该视图已由 Svelte 接管（vanilla 不再渲染/切换它）。
// 逐视图翻转一个 flag 即可切换，一行回滚（改回 false）。
// 未拥有的视图 store 恒 false，避免双份渲染。
window.SVELTE_VIEWS = {
  discovery: true,
  library: true,
  stats: true,
  mylist: true,
  detail: true,
};

const openStores = {
  discovery: discoveryOpen,
  library: libraryOpen,
  stats: statsOpen,
  mylist: mylistOpen,
  detail: detailOpen,
};

// 由 vanilla showView() 在末尾调用，同步 Svelte 视图可见性
window.__svelteViewSync = (view) => {
  for (const [v, store] of Object.entries(openStores)) {
    store.set(window.SVELTE_VIEWS[v] ? v === view : false);
  }
};

// ─── 桥接：index.html 内联 onclick 仍调用 openSettings() ───
// main.js 是 module（延迟执行），晚于 vanilla 同步脚本，故此处赋值覆盖 vanilla 的 window.openSettings。
// 使导航栏/库页的「设置」按钮打开 Svelte 版 Settings 组件（vanilla 版保留共存，后续清理）。
window.openSettings = () => settingsOpen.set(true);

// ─── 桥接外部刷新入口到 Svelte discovery ───
// 保存设置（Settings.svelte:195）和删除动漫（detail.js:998）后调用 refreshDiscovery/loadDiscovery。
// 当 discovery 由 Svelte 接管时路由到 Svelte 视图刷新；否则回退 vanilla。
// 若不桥接，外部调用会渲染进隐藏的 vanilla #discoveryGrid，产生重复 dc- id 使勾选失灵。
const vanillaRefreshDiscovery = window.refreshDiscovery;
const vanillaLoadDiscovery = window.loadDiscovery;
const svelteRefreshDiscovery = () => {
  if (window.SVELTE_VIEWS?.discovery && typeof window.refreshDiscoverySvelte === 'function') {
    window.refreshDiscoverySvelte();
    return true;
  }
  return false;
};
window.refreshDiscovery = () => {
  if (!svelteRefreshDiscovery() && typeof vanillaRefreshDiscovery === 'function') vanillaRefreshDiscovery();
};
window.loadDiscovery = () => {
  if (!svelteRefreshDiscovery() && typeof vanillaLoadDiscovery === 'function') vanillaLoadDiscovery();
};

// ─── 桥接外部刷新入口到 Svelte library ───
// 状态保存（mylist.js saveStatusModal）、详情页操作（detail.js:981/997）、
// discovery/metamatch 等 vanilla 流程调用裸 loadLibrary()（经典脚本全局绑定 = window.loadLibrary）。
// 当 library 由 Svelte 接管时路由到 Svelte 视图刷新；否则回退 vanilla。
// 若不桥接，外部调用会渲染进隐藏的 vanilla #libraryDashboard，Svelte 库页收不到刷新信号。
const vanillaLoadLibrary = window.loadLibrary;
window.loadLibrary = (soft) => {
  if (window.SVELTE_VIEWS?.library && typeof window.loadLibrarySvelte === 'function') {
    window.loadLibrarySvelte();
    return true;
  }
  if (typeof vanillaLoadLibrary === 'function') return vanillaLoadLibrary(soft);
  return false;
};

// ─── 桥接外部刷新入口到 Svelte mylist ───
// 镜像 loadLibrary 桥接模式：当 mylist 由 Svelte 接管时路由到 Svelte 视图刷新；否则回退 vanilla。
const vanillaLoadMyList = window.loadMyList;
window.loadMyList = () => {
  if (window.SVELTE_VIEWS?.mylist && typeof window.loadMyListSvelte === 'function') {
    window.loadMyListSvelte();
    return true;
  }
  if (typeof vanillaLoadMyList === 'function') return vanillaLoadMyList();
  return false;
};

// Detail 接管：window.showDetail = window.openDetail（签名兼容）
// 所有调用方（vanilla library.js/mylist.js/search.js/detail.js + Svelte Mylist.svelte/anime-utils.js）
// 都调 window.showDetail(id, rect, imgSrc, sourceView)，桥接到 Svelte 版 openDetail。
// 保存 vanilla 引用回退，避免与 vanilla showDetail 冲突。
const vanillaShowDetail = window.showDetail;
window.showDetail = (id, fromRect, fromSrc, sourceView) => {
  if (window.SVELTE_VIEWS?.detail && typeof window.openDetail === 'function') {
    window.openDetail(id, fromRect, fromSrc, sourceView);
    // 委托 showView('detail') 统一处理：__svelteViewSync + 词法 currentView + scrollTop=0
    // （app.js showView 对 'detail' 无 vanilla 依赖，SVELTE_VIEWS.detail=true 跳过 vanilla toggle）。
    // 同时修复 B6：showView 内同步 window.currentView，使播放结束回调（app.js:46）能触发。
    window.showView('detail');
    return;
  }
  if (typeof vanillaShowDetail === 'function') return vanillaShowDetail(id, fromRect, fromSrc, sourceView);
};

export default app;