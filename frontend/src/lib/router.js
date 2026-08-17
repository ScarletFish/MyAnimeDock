// Router — showView + scroll state + sidebar active state.
// All 5 views are Svelte-owned, so showView is now a thin coordinator:
// scroll-save, sidebar active state, currentView, __skipViewEnter, view store sync.
import { AppState } from './state.js';
import { __debug } from './debug.js';
import { discoveryOpen } from '../views/Discovery.svelte';
import { libraryOpen } from '../views/Library.svelte';
import { statsOpen } from '../views/Stats.svelte';
import { mylistOpen } from '../views/Mylist.svelte';
import { detailOpen, openDetail } from '../views/Detail.svelte';
import { titlebarContext } from '../components/chrome/Titlebar.svelte';

export let currentView = 'library';
let libraryScrollTop = 0;
let mylistScrollTop = 0;
export let __skipViewEnter = false;
let _libraryChangingView = false;

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
  __skipViewEnter = prevView === 'detail' && (view === 'library' || view === 'mylist');

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
  _libraryChangingView = false;
  __debug.snapshot(currentView + ' (after toggle)');

  // Scroll to top when entering detail view
  if (view === 'detail') {
    if (mc) mc.scrollTop = 0;
  }

  if (view !== 'detail') {
    titlebarContext.set({ mode: 'default', title: '' });
  }

  // Sync Svelte view visibility (all views are Svelte-owned)
  discoveryOpen.set(view === 'discovery');
  libraryOpen.set(view === 'library');
  statsOpen.set(view === 'stats');
  mylistOpen.set(view === 'mylist');
  detailOpen.set(view === 'detail');
}

export function goBack() {
  const target = AppState.get('detailSourceView') || 'library';
  showView(target);
}

export function getLibraryScrollTop() {
  return libraryScrollTop;
}

export function getMyListScrollTop() {
  return mylistScrollTop;
}

// 打开详情视图（与 vanilla showDetail 签名兼容）。
// 所有调用方（SearchBar/anime-utils/Library/Mylist）都调 showDetail(id, rect, imgSrc, sourceView)。
export function showDetail(id, fromRect, fromSrc, sourceView) {
  openDetail(id, fromRect, fromSrc, sourceView);
  // 委托 showView('detail') 统一处理：view store 同步 + 词法 currentView + scrollTop=0。
  showView('detail');
}

export { focusAppWindow };