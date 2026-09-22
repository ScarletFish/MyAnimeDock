// Router — showView + scroll state + sidebar active state.
// All 5 views are Svelte-owned, so showView is now a thin coordinator:
// scroll-save, sidebar active state, currentView, __skipViewEnter, view store sync.
import { AppState } from './state.js';
import { __debug } from './debug.js';
import { discoveryOpen } from '../views/Discovery.svelte';
import { libraryOpen } from '../views/Library.svelte';
import { statsOpen } from '../views/Stats.svelte';
import { mylistOpen } from '../views/Mylist.svelte';
import { downloadOpen } from '../views/Download.svelte';
import { detailOpen, openDetail } from '../views/Detail.svelte';
import { titlebarContext } from '../components/chrome/Titlebar.svelte';

export let currentView = 'library';
// 每视图滚动记忆：showView 离开时保存，进入后由各视图恢复。detail 不参与（进入总是回到顶部）。
const viewScrollTops = { library: 0, mylist: 0, discovery: 0, stats: 0, download: 0 };
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

  if (view === 'detail') {
    __debug.log('router', 'showView-detail', { from: prevView });
  }

  // 离开视图前保存滚动位置（detail 不参与记忆）
  if (prevView !== 'detail' && view !== prevView && mc) {
    viewScrollTops[prevView] = mc.scrollTop;
  }
  __debug.snapshot(currentView + ' → ' + view + ' (after save, before toggle)');

  // Update sidebar active state
  document.getElementById('btnDiscovery').classList.toggle('active', view === 'discovery');
  document.getElementById('btnLibrary').classList.toggle('active', view === 'library');
  document.getElementById('btnStats').classList.toggle('active', view === 'stats');
  document.getElementById('btnMyList').classList.toggle('active', view === 'mylist');
  document.getElementById('btnDownload').classList.toggle('active', view === 'download');

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
  downloadOpen.set(view === 'download');
  detailOpen.set(view === 'detail');

  __debug.log('router', 'view-switched', { view });
}

export function goBack() {
  const target = AppState.get('detailSourceView') || 'library';
  showView(target);
}

export function getViewScrollTop(viewName) {
  return viewScrollTops[viewName] ?? 0;
}

export function getLibraryScrollTop() {
  return getViewScrollTop('library');
}

export function getMyListScrollTop() {
  return getViewScrollTop('mylist');
}

// 视图进入时把共享滚动容器定位到本视图保存的位置；saved<=0 视为回到顶部。
// .main-content 是全部视图共用的滚动容器，切换视图时不会自动复位；若不显式归位，
// 会继承上一个视图（如 mylist）的滚动位置，导致两视图滚动相互决定。
// 返回是否恢复到原位置（>0），供视图抑制入场位移动画。
export function restoreViewScroll(mc, saved) {
  mc.scrollTop = saved > 0 ? saved : 0;
  return saved > 0;
}

// 打开详情视图。
// 所有调用方（SearchBar/anime-utils/Library/Mylist）都调 showDetail(id, rect, imgSrc, sourceView)。
export function showDetail(id, fromRect, fromSrc, sourceView) {
  openDetail(id, fromRect, fromSrc, sourceView);
  // 委托 showView('detail') 统一处理：view store 同步 + 词法 currentView + scrollTop=0。
  showView('detail');
}

export { focusAppWindow };