import { mount } from 'svelte';
import App from './App.svelte';
import Chrome from './components/chrome/Chrome.svelte';
import Sidebar from './components/Sidebar.svelte';
import { titlebarContext } from './components/chrome/Titlebar.svelte';
import { onboardingOpen } from './components/Onboarding.svelte';
import { settingsOpen, settingsTab } from './views/Settings.svelte';
import { discoveryOpen } from './views/Discovery.svelte';
import { libraryOpen } from './views/Library.svelte';
import { mylistOpen } from './views/Mylist.svelte';
import { statsOpen } from './views/Stats.svelte';
import { detailOpen, openDetail } from './views/Detail.svelte';
import { metaMatchOpen } from './views/MetaMatch.svelte';
import { showToast } from './components/Toast.svelte';
import { loadTheme, loadReduceMotion, applyZoom, applyDetailTitleBg } from './lib/theme.js';
import { showView } from './lib/router.js';
import { startGlobalMpvStatus } from './lib/mpv-status.js';
import { initI18n, bindDom } from './lib/i18n.js';
import { API } from './js/api.js';
import './lib/tooltip.js';
import './js/keyboard.js';
import './lib/tauri-dialog.js';

// ─── i18n 初始化（必须在其他模块使用 t() 之前）───
initI18n();

const app = mount(App, {
  target: document.getElementById('app'),
});

// ─── Chrome 挂载：titlebar + onboarding（body 第一个子级 #chrome）───
// 与 App 并列，独立挂载点，互不影响。
mount(Chrome, {
  target: document.getElementById('chrome'),
});

// ─── Sidebar 挂载：body-wrapper 内 #sidebar 挂载点 ───
mount(Sidebar, {
  target: document.getElementById('sidebar'),
});

// ─── i18n DOM 绑定（替换 [data-i18n] 和 [data-i18n-attr]）───
bindDom();

// ─── 桥接：vanilla app.js/detail.js 仍调用 window.setTitlebarContext(mode, title) ───
// 路由到 Svelte 版 Titlebar 的 titlebarContext store（驱动品牌/详情上下文切换）。
window.setTitlebarContext = (mode, title) => {
  titlebarContext.set({ mode, title });
};

// ─── 桥接：vanilla app.js 首启检测调用 window.showOnboarding() ───
// 路由到 Svelte 版 Onboarding 的 onboardingOpen store。
window.showOnboarding = () => {
  onboardingOpen.set(true);
};

// ─── 渐进迁移路由表 ───
// 所有视图已由 Svelte 接管，SVELTE_VIEWS 机制已移除。
const openStores = {
  discovery: discoveryOpen,
  library: libraryOpen,
  stats: statsOpen,
  mylist: mylistOpen,
  detail: detailOpen,
};

// 由 showView() 在末尾调用，同步 Svelte 视图可见性（所有视图已由 Svelte 接管）
window.__svelteViewSync = (view) => {
  for (const [v, store] of Object.entries(openStores)) {
    store.set(v === view);
  }
};

// ─── 桥接：index.html 内联 onclick 仍调用 openSettings() ───
// main.js 是 module（延迟执行），晚于 vanilla 同步脚本，故此处赋值覆盖 vanilla 的 window.openSettings。
// 使导航栏/库页的「设置」按钮打开 Svelte 版 Settings 组件。
// 返回 Promise 以兼容 search.js 的 openSettings().then(...) 调用链。
window.openSettings = () => {
  settingsOpen.set(true);
  return Promise.resolve();
};

window.closeSettings = () => {
  settingsOpen.set(false);
};

// ─── 桥接：search.js 仍调用 switchSettingsTab(btn, tab) 打开指定标签页 ───
// 兼容旧签名（btn 参数忽略），路由到 Svelte 版 Settings 的 settingsTab store。
window.switchSettingsTab = (btn, tab) => {
  settingsOpen.set(true);
  settingsTab.set(tab);
};

// ─── 桥接外部刷新入口到 Svelte discovery ───
// 保存设置（Settings.svelte）和删除动漫（Detail.svelte）后调用 refreshDiscovery/loadDiscovery。
// 路由到 Svelte 版 Discovery 的刷新入口（Discovery.svelte 挂载时注册 window.refreshDiscoverySvelte）。
window.refreshDiscovery = () => {
  if (typeof window.refreshDiscoverySvelte === 'function') window.refreshDiscoverySvelte();
};
window.loadDiscovery = () => {
  if (typeof window.refreshDiscoverySvelte === 'function') window.refreshDiscoverySvelte();
};

// ─── 桥接外部刷新入口到 Svelte library ───
// 状态保存、详情页操作、discovery/metamatch 等流程调用裸 loadLibrary()。
// 路由到 Svelte 版 Library 的刷新入口（Library.svelte 挂载时注册 window.loadLibrarySvelte）。
window.loadLibrary = () => {
  if (typeof window.loadLibrarySvelte === 'function') window.loadLibrarySvelte();
};

// ─── 桥接外部刷新入口到 Svelte mylist ───
// 详情页操作等流程调用裸 loadMyList()。路由到 Svelte 版 Mylist 的刷新入口。
window.loadMyList = () => {
  if (typeof window.loadMyListSvelte === 'function') window.loadMyListSvelte();
};

// Detail 接管：window.showDetail = window.openDetail（签名兼容）。
// 所有调用方（SearchBar/anime-utils/Library/Mylist）都调 window.showDetail(id, rect, imgSrc, sourceView)。
window.showDetail = (id, fromRect, fromSrc, sourceView) => {
  window.openDetail(id, fromRect, fromSrc, sourceView);
  // 委托 showView('detail') 统一处理：__svelteViewSync + 词法 currentView + scrollTop=0。
  window.showView('detail');
};

// ─── 桥接：Library.svelte 的 openBatchMatch 仍调用 window.mmOpenModal() ───
// 使库页「批量匹配」按钮打开 Svelte 版 MetaMatch 组件。
window.mmOpenModal = () => {
  metaMatchOpen.set(true);
};

// ─── Init (DOM already ready — modules are deferred) ───
(async () => {
  let configCache = null;
  const onServerOrigin = window.location.origin.startsWith('http');
  if (onServerOrigin) {
    try {
      configCache = await API.get('/api/config');
      const ai = configCache?.autoImport || {};
      if (ai.count > 0) {
        showToast(ai.message, 'success');
      } else if (!ai.done) {
        (async function pollStartupNotifs() {
          for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
              const resp = await API.get('/api/notifications');
              const notifs = resp.notifications || [];
              for (const n of notifs) {
                if (n.type === 'auto_import') {
                  showToast(n.message, 'success');
                  return;
                }
              }
            } catch (_) { return; }
          }
        })();
      }
    } catch (_) {}
  }
  loadTheme(configCache);
  loadReduceMotion(configCache);
  applyZoom(configCache?.uiScale || 1);
  applyDetailTitleBg();
  showView('library');
  startGlobalMpvStatus();

  if (configCache?.firstRun) {
    if (typeof window.showOnboarding === 'function') window.showOnboarding();
  }

  // Handle Bangumi OAuth redirect result
  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('bangumi_auth');
  if (authResult === 'success') {
    showToast(t('app.bangumiBindSuccessRedirect'), 'success');
    if (typeof refreshBangumiAuthStatus === 'function') refreshBangumiAuthStatus();
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'denied') {
    showToast(t('app.bangumiAuthDenied'), 'error');
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'error') {
    const errMsg = params.get('bangumi_auth_msg') || t('app.authRedirectMsgError');
    showToast(t('app.bangumiBindFailed', { error: errMsg }), 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

export default app;