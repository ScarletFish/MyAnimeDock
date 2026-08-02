// Main app logic
let currentView = 'library';
let configCache = null;
let libraryScrollTop = 0;
let mylistScrollTop = 0;
let _libraryChangingView = false; // set by showView to skip scroll-save in loadLibrary
let _mylistChangingView = false;

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
  showToast('播放已结束，进度已更新', 'success');
  if (endedAnimeId) window.pendingFinishAnimeId = endedAnimeId;
}

function showView(view) {
  const mc = document.querySelector('.main-content');

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
    const el = document.getElementById(v + 'View');
    if (el) el.classList.toggle('hidden', v !== view);
  }

  // Update sidebar active state
  document.getElementById('btnDiscovery').classList.toggle('active', view === 'discovery');
  document.getElementById('btnLibrary').classList.toggle('active', view === 'library');
  document.getElementById('btnStats').classList.toggle('active', view === 'stats');
  document.getElementById('btnMyList').classList.toggle('active', view === 'mylist');

  currentView = view;
  __debug.snapshot(currentView + ' (after toggle)');

  // Scroll to top when entering detail view
  if (view === 'detail') {
    if (mc) mc.scrollTop = 0;
  }

  if (view !== 'detail') {
    resetDetailEnter();
    if (typeof window.stopDetailRefresh === 'function') window.stopDetailRefresh();
    // Reset title bar to brand text
    if (typeof window.setTitlebarContext === 'function') window.setTitlebarContext('default');
  }

  // Load data for view
  if (view === 'discovery') window.loadDiscovery();
  if (view === 'library') {
    _libraryChangingView = true;
    window.loadLibrary(true);
  }
  if (view === 'mylist') {
    _mylistChangingView = true;
    window.loadMyList();
  }
  if (view === 'stats') {
    window.loadStats();
    window.loadActivityChart();
    window.loadRatingChart();
    window.loadSeasonChart();
  }
}

// Theme
function loadTheme() {
  const theme = localStorage.getItem('theme') || configCache?.theme || 'default';
  const themeMode = localStorage.getItem('themeMode') || configCache?.themeMode || 'dark';
  // Backward compatibility: old format stored 'dark'/'light' as theme
  const isOldFormat = theme === 'dark' || theme === 'light';
  const resolvedTheme = isOldFormat ? 'default' : theme;
  const resolvedMode = isOldFormat ? theme : themeMode;
  setThemeAttributes(resolvedTheme, resolvedMode);
  localStorage.setItem('theme', resolvedTheme);
  localStorage.setItem('themeMode', resolvedMode);
  // Sync theme picker UI
  document.querySelectorAll('.theme-option').forEach(b => {
    b.classList.toggle('theme-option--active', b.dataset.theme === resolvedTheme);
  });
}

function applyTheme(theme, themeMode) {
  localStorage.setItem('theme', theme);
  localStorage.setItem('themeMode', themeMode);
  setThemeAttributes(theme, themeMode);
  document.dispatchEvent(new CustomEvent('themechanged'));
}

function setThemeAttributes(theme, themeMode) {
  // For default theme, use backward-compatible data-theme="dark|light"
  // so existing [data-theme="light"] selectors continue to work.
  // For non-default themes, use data-theme="themeName" + data-theme-mode.
  if (theme === 'default') {
    document.documentElement.setAttribute('data-theme', themeMode);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  document.documentElement.setAttribute('data-theme-mode', themeMode);
}

function updateDockThemeToggleLabels() {
  const dockToggle = document.getElementById('dockThemeMode');
  if (!dockToggle) return;
  const isLight = dockToggle.checked;
  document.getElementById('dockLabelDark').className = 'theme-toggle-label' + (isLight ? ' theme-toggle-label--inactive' : ' theme-toggle-label--active');
  document.getElementById('dockLabelLight').className = 'theme-toggle-label' + (isLight ? ' theme-toggle-label--active' : ' theme-toggle-label--inactive');
}

function selectTheme(btn, theme) {
  document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('theme-option--active'));
  btn.classList.add('theme-option--active');
  const dockToggle = document.getElementById('dockThemeMode');
  const mode = dockToggle ? (dockToggle.checked ? 'light' : 'dark') : 'dark';
  const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const oldMode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
  // Resolve raw data-theme to theme name (default theme stores "dark"/"light")
  const oldTheme = (rawTheme === 'dark' || rawTheme === 'light') ? 'default' : rawTheme;
  if (theme === oldTheme && mode === oldMode) return;
  animateThemeTransition(theme, mode);
}

function handleDockThemeModeToggle(toggle) {
  const newMode = toggle.checked ? 'light' : 'dark';
  const theme = document.querySelector('.theme-option.theme-option--active')?.dataset?.theme || 'default';
  const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const oldMode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
  const oldTheme = (rawTheme === 'dark' || rawTheme === 'light') ? 'default' : rawTheme;
  if (theme === oldTheme && newMode === oldMode) return;
  updateDockThemeToggleLabels();
  animateThemeTransition(theme, newMode);
}

function animateThemeTransition(theme, mode) {
  document.documentElement.classList.add('theme-transitioning');
  applyTheme(theme, mode);
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transitioning');
  }, 500);
}

// ─── Theme Dock ───
function openThemeDock() {
  const dock = document.getElementById('themeDock');
  const overlay = document.getElementById('themeDockOverlay');
  // Sync dock controls with current state
  const mode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
  const dockToggle = document.getElementById('dockThemeMode');
  if (dockToggle) {
    dockToggle.checked = mode === 'light';
    updateDockThemeToggleLabels();
  }
  const zoomEl = document.getElementById('dockZoom');
  if (zoomEl) {
    const currentZoom = Math.round((parseFloat(document.documentElement.style.getPropertyValue('--scale')) || 1) * 100);
    zoomEl.value = currentZoom;
    document.getElementById('dockZoomLabel').textContent = currentZoom + '%';
  }
  const rmToggle = document.getElementById('dockReduceMotion');
  if (rmToggle) {
    rmToggle.checked = document.documentElement.getAttribute('data-reduce-motion') === 'true';
  }
  dock.classList.add('open');
  overlay.classList.add('open');
  document.addEventListener('keydown', handleDockEsc);
}

function closeThemeDock() {
  const dock = document.getElementById('themeDock');
  const overlay = document.getElementById('themeDockOverlay');
  dock.classList.remove('open');
  overlay.classList.remove('open');
  document.removeEventListener('keydown', handleDockEsc);
}

function handleDockEsc(e) {
  if (e.key === 'Escape') closeThemeDock();
}

let _dockZoomTimer = null;
function handleDockZoom(input) {
  const scale = parseInt(input.value) / 100;
  applyZoom(scale);
  document.getElementById('dockZoomLabel').textContent = input.value + '%';
  clearTimeout(_dockZoomTimer);
  _dockZoomTimer = setTimeout(async () => {
    try { await API.post('/api/config', { uiScale: scale }); } catch (_) {}
  }, 300);
}

function openVisualDock() {
  closeModal('settingsModal');
  openThemeDock();
}

function toggleThemeDock() {
  const dock = document.getElementById('themeDock');
  if (dock.classList.contains('open')) {
    closeThemeDock();
  } else {
    openThemeDock();
  }
}

// Zoom via CSS --scale variable (GSAP-safe, fixed-position-friendly)
function applyZoom(factor) {
  const s = parseFloat(factor) || 1;
  document.documentElement.style.setProperty('--scale', s);
  if (typeof applyGridColumns === 'function') applyGridColumns();
}

// ─── Reduce Motion ───
function handleReduceMotionToggle(input) {
  const reduced = input.checked;
  localStorage.setItem('reduceMotion', reduced ? '1' : '');
  document.documentElement.setAttribute('data-reduce-motion', reduced ? 'true' : 'false');
}

function loadReduceMotion() {
  const reduced = localStorage.getItem('reduceMotion') === '1' || configCache?.reduceMotion === true;
  if (reduced) {
    document.documentElement.setAttribute('data-reduce-motion', 'true');
  }
}

// Settings
async function openSettings() {
  // Close dock if open before showing modal
  const dock = document.getElementById('themeDock');
  if (dock?.classList.contains('open')) closeThemeDock();
  try {
    const config = await API.get('/api/config');
    configCache = config;
    document.getElementById('settingsMediaDir').value = config.mediaDir || '';

    // 填充播放器下拉
    populatePlayerDropdown(config.players || [], config.playerMode || 'mpv', config.mpvPath || '');

    document.getElementById('settingsAutoMark').checked = config.autoMarkWatched !== false;
    document.getElementById('settingsError').textContent = '';

    // Load scraper settings
    const sources = config.apiSources || [];
    const bangumiSrc = sources.find(s => s.type === 'bangumi');
    const anilistSrc = sources.find(s => s.type === 'anilist');
    document.getElementById('bangumiUrl').value = bangumiSrc?.url || 'https://api.bangumi.lol';
    document.getElementById('anilistEnabled').checked = !!anilistSrc;

    // Bangumi OAuth 凭据（UI 元素可能已移除）
    const bangumiClientIdEl = document.getElementById('bangumiClientId');
    const bangumiClientSecretEl = document.getElementById('bangumiClientSecret');
    if (bangumiClientIdEl && config.bangumiClientId) bangumiClientIdEl.value = config.bangumiClientId;
    if (bangumiClientSecretEl && config.bangumiClientSecret) bangumiClientSecretEl.value = '••••••••';
    refreshBangumiAuthStatus();

    // Dashboard layout
    var cardTitleLib = document.getElementById('settingsCardTitleLibrary');
    if (cardTitleLib) cardTitleLib.checked = getCardTitleVisible('library');
    var cardTitleMylist = document.getElementById('settingsCardTitleMylist');
    if (cardTitleMylist) cardTitleMylist.checked = getCardTitleVisible('mylist');
    if (typeof renderDashboardLayoutSettings === 'function') renderDashboardLayoutSettings();

    // Detail title bg
    var detailTitleBg = document.getElementById('settingsDetailTitleBg');
    if (detailTitleBg) detailTitleBg.checked = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
    applyDetailTitleBg();

    // Finish confirm mode (prompt/auto/off), 默认 prompt；存量 on/off 迁移
    var mode = localStorage.getItem('myAnimDock_finishConfirm') || 'prompt';
    if (mode === 'on') mode = 'prompt';
    if (mode === 'off') mode = 'off';
    var finishRadio = document.querySelector('input[name="settingsFinishConfirmMode"][value="' + mode + '"]');
    if (finishRadio) finishRadio.checked = true;

    // Preload DB info
    if (typeof refreshDbInfo === 'function') refreshDbInfo();

    openModal('settingsModal');
  } catch (e) {
    if (!window.location.origin.startsWith('http')) return;
    showToast('加载设置失败: ' + e.message, 'error');
  }
}

async function refreshBangumiAuthStatus() {
  const statusEl = document.getElementById('bangumiAuthStatus');
  const bindBtn = document.getElementById('bangumiBindBtn');
  const unbindBtn = document.getElementById('bangumiUnbindBtn');
  const syncBtn = document.getElementById('bangumiSyncBtn');
  const syncStatus = document.getElementById('bangumiSyncStatus');
  // If OAuth UI elements are not in the DOM, skip
  if (!statusEl && !bindBtn) return;
  try {
    const state = await API.get('/api/bangumi/auth/status');
    if (state.authed) {
      if (statusEl) { statusEl.textContent = '✓ 已绑定 ' + (state.username || ''); statusEl.style.color = '#22c55e'; }
      if (bindBtn) bindBtn.style.display = 'none';
      if (unbindBtn) unbindBtn.style.display = '';
      if (syncBtn) syncBtn.style.display = '';
      if (syncStatus) {
        if (state.lastSyncTime) {
          const t = new Date(state.lastSyncTime);
          syncStatus.textContent = '上次同步: ' + t.toLocaleString('zh-CN');
          syncStatus.style.display = '';
        } else {
          syncStatus.textContent = '';
          syncStatus.style.display = 'none';
        }
      }
    } else if (state.hasCredentials) {
      if (statusEl) { statusEl.textContent = 'Client ID 已填入，可点击绑定'; statusEl.style.color = 'var(--text3)'; }
      if (bindBtn) bindBtn.style.display = '';
      if (unbindBtn) unbindBtn.style.display = 'none';
      if (syncBtn) syncBtn.style.display = 'none';
    } else {
      if (statusEl) { statusEl.textContent = '填入 Client ID / Secret 后可绑定'; statusEl.style.color = 'var(--text3)'; }
      if (bindBtn) bindBtn.style.display = '';
      if (unbindBtn) unbindBtn.style.display = 'none';
      if (syncBtn) syncBtn.style.display = 'none';
    }
  } catch {}
}

async function bangumiSync() {
  const syncBtn = document.getElementById('bangumiSyncBtn');
  const syncStatus = document.getElementById('bangumiSyncStatus');
  if (!syncBtn || !syncStatus) return;
  syncBtn.disabled = true;
  syncBtn.textContent = '同步中…';
  syncStatus.textContent = '正在同步 MyList…';
  syncStatus.style.display = '';
  try {
    const result = await API.post('/api/bangumi/sync', {});
    if (result.errors && result.errors.length > 0) {
      syncStatus.textContent = `同步完成: 创建 ${result.created}, 推送 ${result.pushed}, 错误 ${result.errors.length}`;
      syncStatus.style.color = '#f59e0b';
    } else {
      syncStatus.textContent = `同步完成: 拉取 ${result.pulled} 条, 新增 ${result.created} 条, 推送 ${result.pushed} 条`;
      syncStatus.style.color = '#22c55e';
    }
    if (result.lastSyncTime) {
      refreshBangumiAuthStatus();
    }
  } catch (e) {
    syncStatus.textContent = '同步失败: ' + e.message;
    syncStatus.style.color = '#ef4444';
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = '同步 MyList';
  }
}

async function bangumiBind() {
  const clientId = document.getElementById('bangumiClientId').value.trim();
  let clientSecret = document.getElementById('bangumiClientSecret').value.trim();
  if (!clientId) {
    showToast('请先填入 Bangumi Client ID', 'warning');
    return;
  }
  // 如果 secret 仍是占位符掩码，则沿用已保存的值
  if (clientSecret === '••••••••') {
    clientSecret = configCache?.bangumiClientSecret || '';
  }
  if (!clientSecret) {
    showToast('请先填入 Bangumi Client Secret', 'warning');
    return;
  }
  // Save OAuth creds first (saveSettings may not be called)
  await API.post('/api/bangumi/auth/creds', { clientId, clientSecret });
  // Get OAuth URL and open browser
  const { url } = await API.get('/api/bangumi/auth/url');
  if (!url) {
    showToast('无法生成授权链接', 'error');
    return;
  }
  // Tauri 中用 shell.open 打开系统默认浏览器，浏览器环境用 window.open
  if (window.__TAURI__?.shell?.open) {
    try {
      await window.__TAURI__.shell.open(url);
    } catch (e) {
      showToast('打开浏览器失败: ' + e.message, 'error');
      return;
    }
  } else {
    window.open(url, '_blank');
  }
  showToast('请在浏览器中完成 Bangumi 授权', 'info');
  // 启动轮询检测授权完成
  startAuthPolling();
}

/** 轮询 /api/bangumi/auth/status 直到授权完成或超时 */
let authPollTimer = null;
function startAuthPolling() {
  if (authPollTimer) clearInterval(authPollTimer);
  let attempts = 0;
  const maxAttempts = 90; // ~3 分钟 (2s 间隔)
  authPollTimer = setInterval(async () => {
    attempts++;
    try {
      const state = await API.get('/api/bangumi/auth/status');
      if (state.authed) {
        clearInterval(authPollTimer);
        authPollTimer = null;
        showToast('Bangumi 绑定成功！', 'success');
        refreshBangumiAuthStatus();
      }
    } catch {}
    if (attempts >= maxAttempts) {
      clearInterval(authPollTimer);
      authPollTimer = null;
      showToast('绑定超时，请检查 Bangumi 授权页面', 'warning');
    }
  }, 2000);
}

async function bangumiUnbind() {
  await API.post('/api/bangumi/auth/logout');
  refreshBangumiAuthStatus();
  showToast('已解除 Bangumi 绑定', 'info');
}

async function saveSettings() {
  const mediaDir = document.getElementById('settingsMediaDir').value.trim();
  const playerMode = document.getElementById('playerModeDropdown')?.dataset.playerMode || 'mpv';
  const mpvPath = document.getElementById('settingsPlayerPath').value.trim();

  if (!mediaDir) {
    document.getElementById('settingsError').textContent = '请输入媒体目录路径';
    return;
  }

  // Read visual state from HTML attributes (always current — drawer applies changes immediately)
  const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = (rawTheme === 'dark' || rawTheme === 'light') ? 'default' : rawTheme;
  const newThemeMode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
  const currentZoom = parseFloat(document.documentElement.style.getPropertyValue('--scale')) || 1;

  // Build apiSources from simple toggles
  const bangumiUrl = document.getElementById('bangumiUrl').value.trim() || 'https://api.bangumi.lol';
  const anilistEnabled = document.getElementById('anilistEnabled').checked;

  const apiSources = [
    { type: 'bangumi', url: bangumiUrl, key: '' },
  ];
  if (anilistEnabled) {
    apiSources.push({ type: 'anilist', url: 'https://graphql.anilist.co', key: '' });
  }

  try {
    const bangumiClientIdEl = document.getElementById('bangumiClientId');
    const bangumiClientSecretEl = document.getElementById('bangumiClientSecret');
    const bangumiClientId = bangumiClientIdEl?.value.trim() || '';
    const bangumiClientSecret = bangumiClientSecretEl?.value.trim() || '';
    // Only send secret if it's not the masked placeholder
    const secretToSend = bangumiClientSecret === '••••••••' ? undefined : bangumiClientSecret;

    await API.post('/api/config', {
      mediaDir,
      playerMode,
      mpvPath,
      theme: newTheme,
      themeMode: newThemeMode,
      uiScale: currentZoom,
      reduceMotion: document.documentElement.getAttribute('data-reduce-motion') === 'true',
      autoMarkWatched: document.getElementById('settingsAutoMark').checked,
      apiSources,
      ...(bangumiClientId ? { bangumiClientId } : {}),
      ...(secretToSend ? { bangumiClientSecret: secretToSend } : {}),
    });

    // Save card-title toggles
    var ctLib = document.getElementById('settingsCardTitleLibrary');
    if (ctLib) localStorage.setItem('myAnimDock_cardTitle_library', ctLib.checked);
    var ctMylist = document.getElementById('settingsCardTitleMylist');
    if (ctMylist) localStorage.setItem('myAnimDock_cardTitle_mylist', ctMylist.checked);

    // Save detail title bg toggle
    var dtBg = document.getElementById('settingsDetailTitleBg');
    if (dtBg) {
      localStorage.setItem('myAnimDock_detailTitleBg', dtBg.checked ? 'on' : '');
      applyDetailTitleBg();
    }

    // Save finish confirm mode
    var finishMode = document.querySelector('input[name="settingsFinishConfirmMode"]:checked');
    if (finishMode) {
      localStorage.setItem('myAnimDock_finishConfirm', finishMode.value);
    }

    closeModal('settingsModal');

    showToast('设置已保存', 'success');
    refreshDiscovery();
  } catch (e) {
    document.getElementById('settingsError').textContent = '保存失败: ' + e.message;
  }
}

// ─── DB Management ───

async function refreshDbInfo() {
  const container = document.getElementById('dbInfoContainer');
  const cacheContainer = document.getElementById('dbCacheContainer');
  if (!container) return;
  try {
    const info = await API.get('/api/db/info');
    const dbSizeStr = info.dbSize > 1048576
      ? (info.dbSize / 1048576).toFixed(1) + ' MB'
      : info.dbSize > 1024
        ? (info.dbSize / 1024).toFixed(1) + ' KB'
        : info.dbSize + ' B';
    const configSizeStr = info.configSize > 1024
      ? (info.configSize / 1024).toFixed(1) + ' KB'
      : info.configSize + ' B';
    container.innerHTML = '<div class="db-info-grid">' +
      '<div class="db-info-item db-info-item--full"><span class="db-info-label">数据库位置</span><span class="db-info-value db-info-path" data-tooltip="' + escAttr(info.dbPath) + '">' + escHtml(info.dbPath) + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">数据库大小</span><span class="db-info-value">' + dbSizeStr + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">动漫数量</span><span class="db-info-value">' + info.counts.anime + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">剧集数量</span><span class="db-info-value">' + info.counts.episodes + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">播放记录</span><span class="db-info-value">' + info.counts.playSessions + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">列表条目</span><span class="db-info-value">' + info.counts.myList + '</span></div>' +
    '</div>';

    // 渲染缓存信息
    if (cacheContainer) {
      if (info.cache) {
        var cacheHtml = '<div class="db-info-grid">';
        for (var key in info.cache) {
          var c = info.cache[key];
          var label = {thumbs:'视频缩略图', covers:'封面图片', banners:'横幅图片'}[key] || key;
          cacheHtml += '<div class="db-info-item">' +
            '<span class="db-info-label">' + label + '</span>' +
            '<span class="db-info-value">' + formatSize(c.size) + '</span>' +
            '<span class="db-info-label" style="margin-top:1px">' + c.files + ' 个文件</span>' +
          '</div>';
        }
        cacheHtml += '</div>' +
          '<div class="db-action-row mt-2">' +
            '<button class="btn btn-sm" onclick="dbClearCache(\'thumbs\')" data-tooltip="超过14天的缩略图系统会自动清理，一般无需手动操作">清除缩略图</button>' +
            '<button class="btn btn-sm" onclick="dbClearCache(\'covers\')" data-tooltip="超过14天的缩放缓存系统会自动清理，原图保留">清除封面缓存</button>' +
            '<button class="btn btn-sm" onclick="dbClearCache(\'banners\')" data-tooltip="横幅图片缓存，需要时自动重新下载">清除横幅缓存</button>' +
            '<button class="btn btn-sm" onclick="dbClearCache(\'all\')" data-tooltip="清除所有缓存，系统会在需要时重新生成">清除全部缓存</button>' +
          '</div>';
        cacheContainer.innerHTML = cacheHtml;
      } else {
        cacheContainer.innerHTML = '<p class="form-hint">暂无数据（请重启服务器以使改动生效）</p>';
      }
    }
  } catch (e) {
    container.innerHTML = '<p class="form-hint text-error">加载失败: ' + escHtml(e.message) + '</p>';
  }
}

async function dbClearCache(target) {
  var label = {thumbs:'缩略图', covers:'封面缓存', banners:'横幅缓存', all:'全部缓存'}[target] || target;
  var confirmed = await showConfirm('确定要清除' + label + '吗？\n\n缓存文件会在需要时重新生成。');
  if (!confirmed) return;

  try {
    var res = await API.post('/api/db/clear-cache', { target: target === 'all' ? undefined : target });
    if (res.ok) {
      var parts = [];
      for (var key in res.results) {
        var r = res.results[key];
        if (r.cleared > 0) parts.push(key + ': ' + formatSize(r.size) + ' (' + r.cleared + ' 个文件)');
      }
      showToast('已清除 ' + label + (parts.length ? ' — ' + parts.join(' | ') : ''), 'success');
      refreshDbInfo();
    }
  } catch (e) {
    showToast('清除失败: ' + e.message, 'error');
  }
}

function dbBackup() {
  const btn = document.getElementById('btnDbBackup');
  btn.disabled = true;
  btn.textContent = '下载中...';
  // 直接用 fetch 获取二进制
  fetch('/api/db/backup')
    .then(res => {
      if (!res.ok) throw new Error('备份失败');
      return res.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = blob.name || `myanimedock-backup-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('数据库备份已下载', 'success');
    })
    .catch(e => showToast('备份失败: ' + e.message, 'error'))
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8"/><path d="M5 5l3-3 3 3"/><path d="M8 2v9"/></svg> 下载 DB 备份';
    });
}

async function dbBackupAll() {
  const btn = document.getElementById('btnDbBackupAll');
  btn.disabled = true;
  btn.textContent = '打包中...';
  try {
    const res = await fetch('/api/db/backup/download-all', { method: 'POST' });
    if (!res.ok) throw new Error('打包备份失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `myanimedock-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('完整备份已下载', 'success');
  } catch (e) {
    showToast('备份失败: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8"/><path d="M5 5l3-3 3 3"/><path d="M8 2v9"/></svg> 完整备份（含配置）';
  }
}

async function dbRestore(input) {
  const file = input.files[0];
  if (!file) return;

  const confirmed = await showConfirm('恢复备份将替换当前数据库。\n\n当前数据会自动备份到 backups/ 目录。\n确定要继续吗？');
  if (!confirmed) {
    input.value = '';
    return;
  }

  // Show loading state on the file input's sibling buttons
  showToast('正在恢复数据库...', 'info');

  try {
    // 读取文件为 base64
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result;
        const commaIdx = result.indexOf(',');
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = await API.post('/api/db/restore', { file: base64 });
    if (res.ok) {
      showToast('数据库恢复成功', 'success');
      refreshDbInfo();
      if (typeof refreshLibrary === 'function') refreshLibrary();
    }
  } catch (e) {
    showToast('恢复失败: ' + e.message, 'error');
  } finally {
    input.value = '';
  }
}

async function dbClearSessions() {
  const confirmed = await showConfirm('确定要清除所有播放记录吗？\n此操作不可撤销。');
  if (!confirmed) return;

  const btn = document.getElementById('btnDbClearSessions');
  btn.disabled = true;
  btn.textContent = '清除中...';
  try {
    const res = await API.post('/api/db/clear-sessions', {});
    if (res.ok) {
      showToast('播放记录已清除', 'success');
      refreshDbInfo();
    }
  } catch (e) {
    showToast('清除失败: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h14"/><path d="M3 4v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4"/><path d="M6 4V2h4v2"/></svg> 清除播放记录';
  }
}

async function dbVacuum() {
  const confirmed = await showConfirm('数据库优化（VACUUM）会压缩数据库文件大小，期间数据库操作可能暂时变慢。\n确定要继续吗？');
  if (!confirmed) return;

  const btn = document.getElementById('btnDbVacuum');
  btn.disabled = true;
  btn.textContent = '优化中...';
  try {
    const res = await API.post('/api/db/vacuum', {});
    if (res.ok) {
      const newSize = res.dbSize > 1048576
        ? (res.dbSize / 1048576).toFixed(1) + ' MB'
        : (res.dbSize / 1024).toFixed(1) + ' KB';
      showToast('数据库优化完成，当前大小: ' + newSize, 'success');
      refreshDbInfo();
    }
  } catch (e) {
    showToast('优化失败: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="7"/><path d="M8 5v3"/><path d="M8 11h.01"/></svg> 优化数据库（VACUUM）';
  }
}

async function dbReset() {
  const step1 = await showConfirm('⚠️ 危险操作\n\n确定要重置数据库吗？\n这将删除所有动漫数据、播放记录和列表。\n\n当前数据库会自动备份到 backups/ 目录。');
  if (!step1) return;

  const step2 = await showConfirm('再次确认：真的要重置吗？\n\n所有数据将被永久删除！');
  if (!step2) return;

  const btn = document.getElementById('btnDbReset');
  btn.disabled = true;
  btn.textContent = '重置中...';
  try {
    const res = await API.post('/api/db/reset', {});
    if (res.ok) {
      showToast('数据库已重置', 'info');
      refreshDbInfo();
      // 刷新各个界面
      if (typeof refreshLibrary === 'function') refreshLibrary();
      if (typeof renderMyList === 'function') renderMyList();
    }
  } catch (e) {
    showToast('重置失败: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l4 4"/><path d="M10 6l-4 4"/><circle cx="8" cy="8" r="7"/></svg> 重置数据库';
  }
}

// Player mode toggle
// 播放器模式已固定 mpv，原切换逻辑已移除

function goBack() {
  if (typeof stopDetailRefresh === 'function') stopDetailRefresh();
  const target = AppState.get('detailSourceView') || 'library';
  showView(target);
}

// ─── Modal confirm (replaces window.confirm, works in Tauri too) ───
function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px;padding:var(--space-6) var(--space-8) var(--space-5)">
        <p style="margin:0 0 18px;line-height:1.7;font-size:15px;text-align:left" class="text-content">${message}</p>
        <div class="modal-actions flex items-center justify-between">
          <button class="btn btn-ghost confirm-cancel min-w-[80px]">取消</button>
          <button class="btn btn-danger confirm-ok min-w-[80px]">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Trigger show transition
    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    overlay.addEventListener('click', e => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
    overlay.querySelector('.confirm-ok').focus();
  });
}

// ─── Toast: SVG Icons ───
const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  silent:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
};
const TOAST_DURATION = { success: 4000, error: 6000, warning: 5000, info: 3500, silent: 2500 };
const TOAST_MAX = 5;

// Toast: dismiss helper
function dismissToast(el) {
  if (el.classList.contains('dismissing')) return;
  el.classList.add('dismissing');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => { if (el.parentNode) el.remove(); }, 600);
}

// Toast: show
//   msg  – string, or { title, desc? }
//   type – 'success' | 'error' | 'warning' | 'info' (default) | 'silent'
//   opts – { duration? } override auto-dismiss ms
function showToast(msg, type, opts) {
  type = type || 'info';
  opts = opts || {};
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Normalize msg
  const title = typeof msg === 'string' ? msg : (msg.title || '');
  const desc  = typeof msg === 'object' && msg.desc ? msg.desc : '';

  // Create element
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('data-type', type);
  const duration = opts.duration || TOAST_DURATION[type] || 3500;
  el.innerHTML = `
    <div class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</div>
    <div class="toast-text">
      <div class="toast-title">${escHtml(title)}</div>
      ${desc ? '<div class="toast-desc">' + escHtml(desc) + '</div>' : ''}
    </div>
    <div class="toast-progress" style="animation-duration:${duration}ms"></div>
  `;
  container.prepend(el);

  // Cap max visible
  while (container.children.length > TOAST_MAX) {
    dismissToast(container.lastChild);
  }

  // ─── Auto-dismiss with hover pause ───
  let remaining = duration;
  let timerStart = Date.now();
  let timerId;

  function startTimer() {
    timerId = setTimeout(() => dismissToast(el), remaining);
    timerStart = Date.now();
  }
  function pauseTimer() {
    clearTimeout(timerId);
    remaining -= Date.now() - timerStart;
    if (remaining < 0) remaining = 0;
  }

  el.addEventListener('mouseenter', pauseTimer);
  el.addEventListener('mouseleave', startTimer);

  // Left-click dismiss
  el.addEventListener('click', function onClick() {
    clearTimeout(timerId);
    dismissToast(el);
  });

  // Right-click copy message
  el.addEventListener('contextmenu', function onContext(e) {
    e.preventDefault();
    e.stopPropagation();
    const text = title + (desc ? '\n' + desc : '');
    navigator.clipboard.writeText(text)
      .then(() => showToast('已复制', 'success', { duration: 1500 }))
      .catch(() => showToast('复制失败', 'error'));
  });

  startTimer();
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ─── Native file/directory dialogs (Tauri) ───

async function openDialog(options) {
  // Tauri v2 withGlobalTauri: plugin API 挂载在 __TAURI__.dialog
  if (window.__TAURI__?.dialog?.open) {
    return await window.__TAURI__.dialog.open(options);
  }
  // 回退：core.invoke（Tauri v2 plugin 命名规则用竖线分隔）
  if (window.__TAURI__?.core?.invoke) {
    return await window.__TAURI__.core.invoke('plugin:dialog|open', options);
  }
  if (window.__TAURI__?.invoke) {
    return await window.__TAURI__.invoke('plugin:dialog|open', options);
  }
  return null;
}

/**
 * 填充播放器自定义下拉菜单
 */
function populatePlayerDropdown(players, currentMode, currentPath) {
  const container = document.getElementById('playerModeDropdown');
  const menu = document.getElementById('playerDdMenu');
  const text = document.getElementById('playerDdText');
  const pathInput = document.getElementById('settingsPlayerPath');
  const pathHint = document.getElementById('playerPathHint');
  if (!container || !menu) return;

  // 构建选项
  menu.innerHTML = '';
  for (const p of players) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'player-dd-opt' + (p.type === currentMode ? ' is-selected' : '');
    opt.dataset.value = p.type;
    opt.textContent = p.displayName || p.type;
    opt.addEventListener('click', function () { selectPlayerOption(this); });
    menu.appendChild(opt);
  }

  // 设置当前值
  container.dataset.playerMode = currentMode;
  if (text) text.textContent = currentMode;

  // 路径
  if (pathInput) pathInput.value = currentPath || '';
  if (pathHint) {
    pathHint.textContent = currentPath
      ? `当前路径: ${currentPath}`
      : '留空则自动搜索 PATH';
  }
}

function togglePlayerDropdown(event) {
  event.stopPropagation();
  const dd = document.getElementById('playerModeDropdown');
  if (!dd) return;
  dd.classList.toggle('is-open');
}

function selectPlayerOption(el) {
  const dd = document.getElementById('playerModeDropdown');
  if (!dd) return;

  // 更新选中态
  dd.querySelectorAll('.player-dd-opt').forEach(function (o) { o.classList.remove('is-selected'); });
  el.classList.add('is-selected');

  // 更新显示值和 dataset
  const value = el.dataset.value;
  dd.dataset.playerMode = value;
  const text = document.getElementById('playerDdText');
  if (text) text.textContent = el.textContent;

  // 关闭菜单
  dd.classList.remove('is-open');
}

// 点击外部关闭播放器下拉
document.addEventListener('click', function (e) {
  var dd = document.getElementById('playerModeDropdown');
  if (!dd) return;
  if (dd.classList.contains('is-open') && !e.target.closest('.player-dd')) {
    dd.classList.remove('is-open');
  }
});

async function browsePlayerExecutable() {
  const mode = document.getElementById('playerModeDropdown')?.dataset.playerMode || 'mpv';
  const name = { mpv: 'mpv 播放器', vlc: 'VLC 播放器', mpchc: 'MPC-HC 播放器' }[mode] || mode + ' 播放器';
  try {
    const result = await openDialog({
      multiple: false,
      title: '选择 ' + name,
      filters: [{ name: '可执行文件', extensions: ['exe', 'com'] }]
    });
    if (result) {
      document.getElementById('settingsPlayerPath').value = result;
    } else if (!window.__TAURI__) {
      showToast('浏览器模式下请在输入框中手动输入路径', 'info');
    }
  } catch (e) {
    showToast('选择文件失败: ' + e.message, 'error');
  }
}

async function browseFolder(inputId) {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: '选择媒体目录'
    });
    if (selected) {
      document.getElementById(inputId).value = selected;
    } else if (!window.__TAURI__) {
      showToast('浏览器模式下请在输入框中手动输入路径', 'info');
    }
  } catch (e) {
    showToast('选择目录失败: ' + e.message, 'error');
  }
}

// ─── Open external URL (Tauri-safe) ───
function openExternalUrl(url) {
  if (window.__TAURI__?.shell?.open) {
    window.__TAURI__.shell.open(url).catch(() => {
      showToast('打开浏览器失败', 'error');
    });
  } else {
    window.open(url, '_blank');
  }
}
window.openExternalUrl = openExternalUrl;

// ─── Derive Bangumi frontend URL from configured API URL ───
// e.g. https://api.bangumi.lol → https://bangumi.lol
function getBangumiFrontendUrl() {
  const sources = configCache?.apiSources;
  if (Array.isArray(sources)) {
    const bgm = sources.find(s => s.type === 'bangumi');
    if (bgm?.url) {
      // Strip 'api.' subdomain prefix to get the frontend URL
      return bgm.url.replace(/^(https?:\/\/)api\./i, '$1');
    }
  }
  return 'https://bgm.tv';
}
window.getBangumiFrontendUrl = getBangumiFrontendUrl;

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

  // First-run: show onboarding overlay (defined in onboarding.js)
  if (configCache?.firstRun) {
    if (typeof showOnboarding === 'function') showOnboarding();
  }

  // Handle Bangumi OAuth redirect result
  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('bangumi_auth');
  if (authResult === 'success') {
    showToast('Bangumi 绑定成功！', 'success');
    refreshBangumiAuthStatus();
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'denied') {
    showToast('Bangumi 授权被拒绝', 'error');
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'error') {
    const errMsg = params.get('bangumi_auth_msg') || '请检查回调 URL 是否与 bgm.tv 注册的地址一致';
    showToast('Bangumi 绑定失败: ' + errMsg, 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }
});

// ─── Dashboard Layout (动漫库页面模块排序与开关) ───

/** 默认布局配置 */
function defaultDashboardLayout() {
  return [
    { id: 'stats', enabled: true },
    { id: 'continueWatch', enabled: true },
    { id: 'localLibrary', enabled: true }
  ];
}

/** 从 localStorage 读取布局配置，不存在则返回默认 */
function getDashboardLayout() {
  try {
    var saved = JSON.parse(localStorage.getItem('myAnimDock_layout'));
    if (saved && Array.isArray(saved) && saved.length > 0) return saved;
  } catch (e) {}
  return defaultDashboardLayout();
}

/** 保存布局配置到 localStorage */
function saveDashboardLayout(layout) {
  localStorage.setItem('myAnimDock_layout', JSON.stringify(layout));
}

// ─── Card Title Always Visible（三处独立开关） ───

function getCardTitleVisible(view, defaultVal) {
  var val = localStorage.getItem('myAnimDock_cardTitle_' + view);
  if (val === null) return defaultVal === true;
  return val === 'true';
}

function applyDetailTitleBg() {
  var on = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
  document.documentElement.setAttribute('data-detail-title-bg', on ? 'on' : '');
}

function renderDashboardLayoutSettings() {
  var list = document.getElementById('dashboardLayoutList');
  if (!list) return;
  if (typeof getDashboardLayout !== 'function') return;
  var layout = getDashboardLayout();
  var defs = { stats: '统计概览', continueWatch: '继续观看', localLibrary: '本地动漫' };
  list.innerHTML = layout.map(function(s, i) {
    var label = defs[s.id] || s.id;
    return '<div class="dashboard-layout-item" data-id="' + s.id + '">' +
      '<span class="dashboard-layout-drag-handle" data-drag-handle="' + s.id + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>' +
      '</span>' +
      '<label class="toggle-switch" style="margin:0">' +
        '<input type="checkbox" ' + (s.enabled ? 'checked' : '') + ' onchange="toggleDashboardSection(\'' + s.id + '\', this.checked)">' +
        '<span class="toggle-slider"></span>' +
      '</label>' +
      '<span class="dashboard-layout-label">' + label + '</span>' +
      '<div class="dashboard-layout-arrows">' +
        '<button class="btn btn-icon btn-xs" onclick="moveDashboardSection(\'' + s.id + '\', -1)" ' + (i === 0 ? 'disabled' : '') + ' data-tooltip="上移">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>' +
        '</button>' +
        '<button class="btn btn-icon btn-xs" onclick="moveDashboardSection(\'' + s.id + '\', 1)" ' + (i === layout.length - 1 ? 'disabled' : '') + ' data-tooltip="下移">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  // ── Pointer-based drag (replaces native drag API) ──
  if (list._dragCleanup) list._dragCleanup();
  var dragState = { active: false, srcId: null, ghost: null, startY: 0, srcIdx: -1 };
  var items = function() { return list.querySelectorAll('.dashboard-layout-item'); };

  function onPointerDown(e) {
    var handle = e.target.closest('[data-drag-handle]');
    if (!handle) return;
    var item = handle.closest('.dashboard-layout-item');
    if (!item) return;
    e.preventDefault();
    dragState.active = true;
    dragState.srcId = item.dataset.id;
    dragState.startY = e.clientY;
    var arr = Array.from(items());
    dragState.srcIdx = arr.indexOf(item);
    item.classList.add('dragging');
  }

  function onPointerMove(e) {
    if (!dragState.active) return;
    e.preventDefault();
    // Find which item we're over
    var arr = Array.from(items());
    var overItem = null;
    for (var i = 0; i < arr.length; i++) {
      var rect = arr[i].getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        overItem = arr[i];
        break;
      }
    }
    arr.forEach(function(el) { el.classList.remove('drag-over'); });
    if (overItem && overItem.dataset.id !== dragState.srcId) {
      overItem.classList.add('drag-over');
    }
  }

  function onPointerUp(e) {
    if (!dragState.active) return;
    dragState.active = false;
    // Find target
    var arr = Array.from(items());
    var targetId = null;
    for (var i = 0; i < arr.length; i++) {
      var rect = arr[i].getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        targetId = arr[i].dataset.id;
        break;
      }
    }
    arr.forEach(function(el) { el.classList.remove('dragging', 'drag-over'); });
    if (!targetId || targetId === dragState.srcId) return;
    // Reorder
    var layout = getDashboardLayout();
    var fromIdx = layout.findIndex(function(s) { return s.id === dragState.srcId; });
    var toIdx = layout.findIndex(function(s) { return s.id === targetId; });
    if (fromIdx === -1 || toIdx === -1) return;
    var moved = layout.splice(fromIdx, 1)[0];
    layout.splice(toIdx, 0, moved);
    saveDashboardLayout(layout);
    renderDashboardLayoutSettings();
    if (typeof renderDashboard === 'function') renderDashboard();
  }

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  list._dragCleanup = function() {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  };
}

function toggleDashboardSection(id, enabled) {
  if (typeof getDashboardLayout !== 'function') return;
  var layout = getDashboardLayout();
  var s = layout.find(function(s) { return s.id === id; });
  if (s) s.enabled = enabled;
  saveDashboardLayout(layout);
  if (typeof renderDashboard === 'function') renderDashboard();
}

function moveDashboardSection(id, dir) {
  if (typeof getDashboardLayout !== 'function') return;
  var layout = getDashboardLayout();
  var idx = layout.findIndex(function(s) { return s.id === id; });
  if (idx === -1) return;
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layout.length) return;
  var tmp = layout[idx];
  layout[idx] = layout[newIdx];
  layout[newIdx] = tmp;
  saveDashboardLayout(layout);
  renderDashboardLayoutSettings();
  if (typeof renderDashboard === 'function') renderDashboard();
}

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
window.selectTheme = selectTheme;
window.handleDockThemeModeToggle = handleDockThemeModeToggle;
window.handleDockZoom = handleDockZoom;
window.handleReduceMotionToggle = handleReduceMotionToggle;
window.toggleThemeDock = toggleThemeDock;
window.closeThemeDock = closeThemeDock;
window.openVisualDock = openVisualDock;
window.openSettings = openSettings;
window.saveSettings = saveSettings;
window.browseFolder = browseFolder;
window.switchSettingsTab = switchSettingsTab;

// ─── Settings tab switching (defined in old public/index.html inline script) ───
function switchSettingsTab(btn, tab) {
  document.querySelectorAll('.settings-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'database' && typeof refreshDbInfo === 'function') {
    refreshDbInfo();
  }
}

// ─── ESM exports for cross-module utilities ───
window.showToast = showToast;
window.showConfirm = showConfirm;
window.dismissToast = dismissToast;
