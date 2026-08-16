// Router — showView + scroll state + sidebar active state.
// All 5 views are Svelte-owned, so showView is now a thin coordinator:
// scroll-save, sidebar active state, window.currentView, __skipViewEnter, __svelteViewSync.
import { AppState } from '../js/state.js';
import { __debug } from '../js/debug.js';

let currentView = 'library';
let libraryScrollTop = 0;
let mylistScrollTop = 0;

// 播放器关闭后自动将 App 窗口带回前台
function focusAppWindow() {
  if (!(window.__TAURI__ && window.__TAURI__.window)) return;
  try {
    var win = window.__TAURI__.window.getCurrentWindow();
    win.unminimize().then(function () { return win.setFocus(); }).catch(function () {});
  } catch (_) {}
}

export function showView(view) {
  const mc = document.querySelector('.main-content');

  // 识别「从详情页返回」：起点是 detail、目标是 library/mylist 时置一次性标记，
  // 供 Svelte 视图的入场动画（容器淡入/模块级 fade）跳过——返回时不重播入场。
  const prevView = currentView;
  window.__skipViewEnter = prevView === 'detail' && (view === 'library' || view === 'mylist');

  // Save library/mylist scroll BEFORE toggling view visibility
  if (currentView === 'library' && view !== 'library' && mc) {
    libraryScrollTop = mc.scrollTop;
  }
  if (currentView === 'mylist' && view !== 'mylist' && mc) {
    mylistScrollTop = mc.scrollTop;
  }
  __debug.snapshot(currentView + ' → ' + view + ' (after save, before toggle)');

  // Update sidebar active state
  document.getElementById('btnDiscovery').classList.toggle('active', view === 'discovery');
  document.getElementById('btnLibrary').classList.toggle('active', view === 'library');
  document.getElementById('btnStats').classList.toggle('active', view === 'stats');
  document.getElementById('btnMyList').classList.toggle('active', view === 'mylist');

  currentView = view;
  window.currentView = view;
  // Debug bridge: expose for debug.js snapshot
  window._libraryChangingView = false;
  __debug.snapshot(currentView + ' (after toggle)');

  // Scroll to top when entering detail view
  if (view === 'detail') {
    if (mc) mc.scrollTop = 0;
  }

  if (view !== 'detail') {
    if (typeof window.setTitlebarContext === 'function') window.setTitlebarContext('default');
  }

  if (window.__svelteViewSync) window.__svelteViewSync(view);
}

export function goBack() {
  const target = AppState.get('detailSourceView') || 'library';
  showView(target);
}

// ─── Bridges ───
window.showView = showView;
window.goBack = goBack;
window.__getLibraryScrollTop = () => libraryScrollTop;
window.__getMyListScrollTop = () => mylistScrollTop;

export { focusAppWindow };
