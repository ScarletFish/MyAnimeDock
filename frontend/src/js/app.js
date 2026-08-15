// Main app logic
let currentView = 'library';
let configCache = null;
let libraryScrollTop = 0;
let mylistScrollTop = 0;
let _libraryChangingView = false; // set by showView to skip scroll-save in loadLibrary
let _mylistChangingView = false;

// ─── Theme init functions (consolidated from theme.js) ───

function loadTheme() {
  const theme = localStorage.getItem('theme') || configCache?.theme || 'default';
  const themeMode = localStorage.getItem('themeMode') || configCache?.themeMode || 'dark';
  const isOldFormat = theme === 'dark' || theme === 'light';
  const resolvedTheme = isOldFormat ? 'default' : theme;
  const resolvedMode = isOldFormat ? theme : themeMode;
  setThemeAttributes(resolvedTheme, resolvedMode);
  localStorage.setItem('theme', resolvedTheme);
  localStorage.setItem('themeMode', resolvedMode);
}

function setThemeAttributes(theme, themeMode) {
  if (theme === 'default') {
    document.documentElement.setAttribute('data-theme', themeMode);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  document.documentElement.setAttribute('data-theme-mode', themeMode);
}

function applyZoom(factor) {
  const s = parseFloat(factor) || 1;
  document.documentElement.style.setProperty('--scale', s);
  if (typeof applyGridColumns === 'function') applyGridColumns();
}

function loadReduceMotion() {
  const reduced = localStorage.getItem('reduceMotion') === '1' || configCache?.reduceMotion === true;
  if (reduced) {
    document.documentElement.setAttribute('data-reduce-motion', 'true');
  }
}

function applyDetailTitleBg() {
  var on = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
  document.documentElement.setAttribute('data-detail-title-bg', on ? 'on' : '');
}

// 播放器关闭后自动将 App 窗口带回前台（Windows 前台锁限制时系统会闪烁任务栏兜底）。
// 浏览器环境（无 Tauri API）直接无操作。
function focusAppWindow() {
  if (!(window.__TAURI__ && window.__TAURI__.window)) return;
  try {
    var win = window.__TAURI__.window.getCurrentWindow();
    win.unminimize().then(function () { return win.setFocus(); }).catch(function () {});
  } catch (_) {}
}

// 暴露给 Svelte Library：showView 离开 library 时已把正确滚动位置存进 libraryScrollTop
// （此时 library 仍可见，mc.scrollTop 处于 library 坐标系）。Svelte 版重渲染后据此恢复。
window.__getLibraryScrollTop = () => libraryScrollTop;

// 暴露给 Svelte Mylist：showView 离开 mylist 时已把正确滚动位置存进 mylistScrollTop。
window.__getMyListScrollTop = () => mylistScrollTop;

// ── 全局 mpv-status 监听：播放结束反馈在任何页面生效 ──
// 进度数据由 server 每次事件落盘（与前端页面无关）；这里负责"播放结束"那一刻的
// UI 反馈：自动聚焦窗口（不跳页）+ toast + 回详情页时的兜底"标记看完"弹窗。
let gMpvActive = false;
let gMpvAnimeId = null; // 最近一次 active:true 事件的 animeId（end 事件不带 id）

function startGlobalMpvStatus() {
  var es = new EventSource('/api/events/mpv-status');
  es.onmessage = function (e) {
    try { var p = JSON.parse(e.data); onGlobalMpvStatus(p.active, p); } catch (_) {}
  };
  // SSE 未就绪时的降级：HTTP 查询一次当前状态
  API.get('/api/mpv-status').then(function (st) { onGlobalMpvStatus(st.active, st); }).catch(function () {});
}

function onGlobalMpvStatus(active, payload) {
  if (active) {
    gMpvActive = true;
    gMpvAnimeId = payload.animeId || null;
    return;
  }
  if (!gMpvActive) return; // 非"播放结束"的 inactive（如启动时无播放），忽略
  gMpvActive = false;
  var endedAnimeId = gMpvAnimeId;
  gMpvAnimeId = null;

  // 1. 自动聚焦 App 窗口（不跳转页面）
  if (typeof focusAppWindow === 'function') focusAppWindow();

  // 2. 正在详情页且播放结束的正是当前番 → 交给 detail.js 刷新 + 弹标记确认
  if (currentView === 'detail' &&
      typeof window.handleDetailPlaybackEnded === 'function' &&
      window.handleDetailPlaybackEnded(endedAnimeId)) {
    return;
  }

// 3. 其他页面 → 通用 toast + 记录 pending，回到该番详情页时补弹"标记看完"
   showToast(t('app.playbackEndedProgressUpdated'), 'success');
  if (endedAnimeId) window.pendingFinishAnimeId = endedAnimeId;
}

function showView(view) {
  const mc = document.querySelector('.main-content');

  // 识别「从详情页返回」：起点是 detail、目标是 library/mylist 时置一次性标记，
  // 供 Svelte 视图的入场动画（容器淡入/模块级 fade）跳过——返回时不重播入场。
  // 标记在每次 showView 调用时按当前切换重算（天然覆盖旧值），消费侧无需清除，
  // 也不存在多个 effect 竞争清除的顺序问题；其余切换（library↔mylist 等）恒为 false。
  const prevView = currentView;
  window.__skipViewEnter = prevView === 'detail' && (view === 'library' || view === 'mylist');

  // Save library scroll BEFORE toggling view visibility
  // At this point library view is still visible, so mc.scrollTop is in
  // the library content coordinate system — the only correct moment to save.
  if (currentView === 'library' && view !== 'library' && mc) {
    libraryScrollTop = mc.scrollTop;
  }
  if (currentView === 'mylist' && view !== 'mylist' && mc) {
    mylistScrollTop = mc.scrollTop;
  }
  __debug.snapshot(currentView + ' → ' + view + ' (after save, before toggle)');

  const views = ['discovery', 'library', 'stats', 'mylist', 'detail'];
  for (const v of views) {
    if (window.SVELTE_VIEWS?.[v]) continue; // Svelte 拥有的视图由 store 驱动，vanilla 不 toggle
    const el = document.getElementById(v + 'View');
    if (el) el.classList.toggle('hidden', v !== view);
  }

  // Update sidebar active state
  document.getElementById('btnDiscovery').classList.toggle('active', view === 'discovery');
  document.getElementById('btnLibrary').classList.toggle('active', view === 'library');
  document.getElementById('btnStats').classList.toggle('active', view === 'stats');
  document.getElementById('btnMyList').classList.toggle('active', view === 'mylist');

  currentView = view;
  // 桥接：同步到 window，供 Svelte Detail 的键盘/鼠标事件闸门（检查 window.currentView==='detail'）
  // 与播放结束回调（app.js:46 检查词法 currentView）统一使用同一份当前视图。
  window.currentView = view;
  __debug.snapshot(currentView + ' (after toggle)');

  // Scroll to top when entering detail view
  if (view === 'detail') {
    if (mc) mc.scrollTop = 0;
  }

  if (view !== 'detail') {
    // Reset title bar to brand text
    if (typeof window.setTitlebarContext === 'function') window.setTitlebarContext('default');
  }

  // Load data for view（Svelte 拥有的视图由组件自身加载，vanilla 不重复渲染）
  if (view === 'discovery' && !window.SVELTE_VIEWS?.discovery) window.loadDiscovery();
  if (view === 'library' && !window.SVELTE_VIEWS?.library) {
    _libraryChangingView = true;
    window.loadLibrary(true);
  }
  if (view === 'mylist' && !window.SVELTE_VIEWS?.mylist) {
    _mylistChangingView = true;
    window.loadMyList();
  }
  if (view === 'stats' && !window.SVELTE_VIEWS?.stats) {
    window.loadStats();
    window.loadActivityChart();
    window.loadRatingChart();
    window.loadSeasonChart();
    window.loadChordChart();
  }

  // 同步 Svelte 视图可见性（未拥有的视图 store 恒 false）
  if (window.__svelteViewSync) window.__svelteViewSync(view);
}

function goBack() {
  const target = AppState.get('detailSourceView') || 'library';
  showView(target);
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  const onServerOrigin = window.location.origin.startsWith('http');
  if (onServerOrigin) {
    try {
      configCache = await API.get('/api/config');
      const ai = configCache?.autoImport || {};
      if (ai.count > 0) {
        showToast(ai.message, 'success');
      } else if (!ai.done && onServerOrigin) {
        // 自动导入还没完成 → 延迟轮询通知（兜底竞态条件）
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
  loadTheme();
  loadReduceMotion();
  applyZoom(configCache?.uiScale || 1);
  applyDetailTitleBg();
  showView('library');
  startGlobalMpvStatus();

  // First-run: show onboarding overlay (Svelte Chrome 组件)
  if (configCache?.firstRun) {
    if (typeof window.showOnboarding === 'function') window.showOnboarding();
  }

  // Handle Bangumi OAuth redirect result
  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('bangumi_auth');
  if (authResult === 'success') {
    showToast(t('app.bangumiBindSuccessRedirect'), 'success');
    refreshBangumiAuthStatus();
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'denied') {
    showToast(t('app.bangumiAuthDenied'), 'error');
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'error') {
    const errMsg = params.get('bangumi_auth_msg') || t('app.authRedirectMsgError');
    showToast(t('app.bangumiBindFailed', { error: errMsg }), 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }
});

// ─── Sidebar floating tooltip ───
(function() {
  var tip = document.getElementById('sidebarTooltip');
  if (!tip) return;
  var textEl = document.getElementById('sidebarTooltipText');
  var btns = document.querySelectorAll('.sidebar-brand, .sidebar-nav .nav-btn, .sidebar-bottom .nav-btn');
  var hideTimer = null;
  var showTimer = null;

  function showTip(btn) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    var label = btn.getAttribute('data-tip');
    if (!label) return;
    textEl.textContent = label;
    var br = btn.getBoundingClientRect();
    tip.style.top = (br.top + br.height / 2) + 'px';
    tip.classList.add('is-visible');
  }

  function scheduleShow(btn) {
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(function() { showTip(btn); }, 400);
  }

  function cancelShow() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  }

  function hideTip() {
    cancelShow();
    hideTimer = setTimeout(function() {
      tip.classList.remove('is-visible');
    }, 120);
  }

  btns.forEach(function(btn) {
    btn.addEventListener('mouseenter', function() { scheduleShow(btn); });
    btn.addEventListener('mouseleave', hideTip);
  });

  // Hide on tip mouseenter to avoid flicker when cursor moves to tooltip
  tip.addEventListener('mouseenter', function() {
    cancelShow();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  });
  tip.addEventListener('mouseleave', hideTip);
})();

// ─── ESM exports for onclick handlers ───
window.showView = showView;