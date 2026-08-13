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
  library: false,
  stats: false,
  mylist: false,
  detail: false,
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

// Detail 接管时启用：window.showDetail = window.openDetail（签名兼容）
// 当前 detail 未接管（SVELTE_VIEWS.detail=false），暂不桥接，避免与 vanilla showDetail 冲突。

export default app;