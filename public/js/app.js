// Main app logic
let currentView = 'library';
let configCache = null;
let libraryScrollTop = 0;

function showView(view) {
  const views = ['discovery', 'library', 'mylist', 'detail'];
  for (const v of views) {
    const el = document.getElementById(v + 'View');
    if (el) el.classList.toggle('hidden', v !== view);
  }

  // Update sidebar active state
  document.getElementById('btnDiscovery').classList.toggle('active', view === 'discovery');
  document.getElementById('btnLibrary').classList.toggle('active', view === 'library');
  document.getElementById('btnMyList').classList.toggle('active', view === 'mylist');

  const mc = document.querySelector('.main-content');

  // Save library scroll before leaving
  if (currentView === 'library' && view !== 'library' && mc) {
    libraryScrollTop = mc.scrollTop;
  }

  currentView = view;

  // Scroll to top when entering detail view
  if (view === 'detail') {
    if (mc) mc.scrollTop = 0;
  }

  if (view !== 'detail') {
    resetDetailEnter();
    if (typeof stopDetailRefresh === 'function') stopDetailRefresh();
  }

  // Load data for view
  if (view === 'discovery') loadDiscovery();
  if (view === 'library') {
    loadLibrary();
    // Restore scroll after render
    requestAnimationFrame(() => { if (mc) mc.scrollTop = libraryScrollTop; });
  }
  if (view === 'mylist') loadMyList();
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

function handleDockZoom(input) {
  const scale = parseInt(input.value) / 100;
  applyZoom(scale);
  document.getElementById('dockZoomLabel').textContent = input.value + '%';
}

function openVisualDock() {
  closeModal('settingsModal');
  openThemeDock();
}

// Zoom via CSS --scale variable (GSAP-safe, fixed-position-friendly)
function applyZoom(scale) {
  const s = parseFloat(scale) || 1;
  document.documentElement.style.setProperty('--scale', s);
  if (typeof applyGridZoom === 'function') applyGridZoom();
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
    document.getElementById('settingsMpvPath').value = config.mpvPath || '';
    document.getElementById('settingsAutoMark').checked = config.autoMarkWatched !== false;
    document.getElementById('settingsError').textContent = '';

    // Load scraper settings
    const sources = config.apiSources || [];
    const bangumiSrc = sources.find(s => s.type === 'bangumi');
    const anilistSrc = sources.find(s => s.type === 'anilist');
    document.getElementById('bangumiUrl').value = bangumiSrc?.url || 'https://api.bangumi.one';
    document.getElementById('anilistEnabled').checked = !!anilistSrc;

    // Bangumi OAuth 凭据
    if (config.bangumiClientId) document.getElementById('bangumiClientId').value = config.bangumiClientId;
    if (config.bangumiClientSecret) document.getElementById('bangumiClientSecret').value = '••••••••';
    refreshBangumiAuthStatus();

    openModal('settingsModal');
  } catch (e) {
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载设置失败: ' + e.message);
  }
}

async function refreshBangumiAuthStatus() {
  try {
    const state = await API.get('/api/bangumi/auth/status');
    const statusEl = document.getElementById('bangumiAuthStatus');
    const bindBtn = document.getElementById('bangumiBindBtn');
    const unbindBtn = document.getElementById('bangumiUnbindBtn');
    const syncBtn = document.getElementById('bangumiSyncBtn');
    const syncStatus = document.getElementById('bangumiSyncStatus');
    if (state.authed) {
      statusEl.textContent = '✓ 已绑定 ' + (state.username || '');
      statusEl.style.color = '#22c55e';
      bindBtn.style.display = 'none';
      unbindBtn.style.display = '';
      syncBtn.style.display = '';
      if (state.lastSyncTime) {
        const t = new Date(state.lastSyncTime);
        syncStatus.textContent = '上次同步: ' + t.toLocaleString('zh-CN');
        syncStatus.style.display = '';
      } else {
        syncStatus.textContent = '';
        syncStatus.style.display = 'none';
      }
    } else if (state.hasCredentials) {
      statusEl.textContent = 'Client ID 已填入，可点击绑定';
      statusEl.style.color = 'var(--text3)';
      bindBtn.style.display = '';
      unbindBtn.style.display = 'none';
      syncBtn.style.display = 'none';
    } else {
      statusEl.textContent = '填入 Client ID / Secret 后可绑定';
      statusEl.style.color = 'var(--text3)';
      bindBtn.style.display = '';
      unbindBtn.style.display = 'none';
      syncBtn.style.display = 'none';
    }
  } catch {}
}

async function bangumiSync() {
  const syncBtn = document.getElementById('bangumiSyncBtn');
  const syncStatus = document.getElementById('bangumiSyncStatus');
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
    showToast('请先填入 Bangumi Client ID');
    return;
  }
  // 如果 secret 仍是占位符掩码，则沿用已保存的值
  if (clientSecret === '••••••••') {
    clientSecret = configCache?.bangumiClientSecret || '';
  }
  if (!clientSecret) {
    showToast('请先填入 Bangumi Client Secret');
    return;
  }
  // Save OAuth creds first (saveSettings may not be called)
  await API.post('/api/bangumi/auth/creds', { clientId, clientSecret });
  // Get OAuth URL and open browser
  const { url } = await API.get('/api/bangumi/auth/url');
  if (!url) {
    showToast('无法生成授权链接');
    return;
  }
  // Tauri 中用 shell.open 打开系统默认浏览器，浏览器环境用 window.open
  if (window.__TAURI__?.shell?.open) {
    try {
      await window.__TAURI__.shell.open(url);
    } catch (e) {
      showToast('打开浏览器失败: ' + e.message);
      return;
    }
  } else {
    window.open(url, '_blank');
  }
  showToast('请在浏览器中完成 Bangumi 授权');
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
        showToast('Bangumi 绑定成功！');
        refreshBangumiAuthStatus();
      }
    } catch {}
    if (attempts >= maxAttempts) {
      clearInterval(authPollTimer);
      authPollTimer = null;
      showToast('绑定超时，请检查 Bangumi 授权页面');
    }
  }, 2000);
}

async function bangumiUnbind() {
  await API.post('/api/bangumi/auth/logout');
  refreshBangumiAuthStatus();
  showToast('已解除 Bangumi 绑定');
}

async function saveSettings() {
  const mediaDir = document.getElementById('settingsMediaDir').value.trim();
  const mpvPath = document.getElementById('settingsMpvPath').value.trim();

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
  const bangumiUrl = document.getElementById('bangumiUrl').value.trim() || 'https://api.bangumi.one';
  const anilistEnabled = document.getElementById('anilistEnabled').checked;

  const apiSources = [
    { type: 'bangumi', url: bangumiUrl, key: '' },
  ];
  if (anilistEnabled) {
    apiSources.push({ type: 'anilist', url: 'https://graphql.anilist.co', key: '' });
  }

  try {
    const bangumiClientId = document.getElementById('bangumiClientId').value.trim();
    const bangumiClientSecret = document.getElementById('bangumiClientSecret').value.trim();
    // Only send secret if it's not the masked placeholder
    const secretToSend = bangumiClientSecret === '••••••••' ? undefined : bangumiClientSecret;

    await API.post('/api/config', {
      mediaDir,
      playerMode: 'mpv',
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

    closeModal('settingsModal');

    showToast('设置已保存');
    refreshDiscovery();
  } catch (e) {
    document.getElementById('settingsError').textContent = '保存失败: ' + e.message;
  }
}

// Player mode toggle
// 播放器模式已固定 mpv，原切换逻辑已移除

function goBack() {
  if (typeof stopDetailRefresh === 'function') stopDetailRefresh();
  AppState.set('isArchiveMode', false);
  const layoutEl = document.querySelector('.detail-layout');
  if (layoutEl) layoutEl.classList.remove('detail-layout--archive');
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
      <div class="modal" style="max-width:420px;text-align:center">
        <p style="margin:0 0 24px;line-height:1.6;color:var(--text1);font-size:15px">${message}</p>
        <div class="modal-actions" style="justify-content:center;gap:12px">
          <button class="btn btn-ghost confirm-cancel" style="min-width:80px">取消</button>
          <button class="btn btn-danger confirm-ok" style="min-width:80px">确认</button>
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

// Toast
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
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
  // 回退：core.invoke（Tauri v2 plugin 命名规则用下划线）
  if (window.__TAURI__?.core?.invoke) {
    return await window.__TAURI__.core.invoke('plugin:dialog_open', options);
  }
  if (window.__TAURI__?.invoke) {
    return await window.__TAURI__.invoke('plugin:dialog_open', options);
  }
  return null;
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
      showToast('浏览器模式下请在输入框中手动输入路径');
    }
  } catch (e) {
    showToast('选择目录失败: ' + e.message);
  }
}

async function browseFile(inputId) {
  try {
    const selected = await openDialog({
      multiple: false,
      title: '选择 mpv 可执行文件',
      filters: [{ name: '可执行文件', extensions: ['exe', 'com'] }]
    });
    if (selected) {
      document.getElementById(inputId).value = selected;
    } else if (!window.__TAURI__) {
      showToast('浏览器模式下请在输入框中手动输入路径');
    }
  } catch (e) {
    showToast('选择文件失败: ' + e.message);
  }
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  const onServerOrigin = window.location.origin === 'http://localhost:3456';
  if (onServerOrigin) {
    try {
      configCache = await API.get('/api/config');
    } catch (_) {}
  }
  loadTheme();
  loadReduceMotion();
  applyZoom(configCache?.uiScale || 1);
  initSortSelect();
  showView('library');

  // Handle Bangumi OAuth redirect result
  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('bangumi_auth');
  if (authResult === 'success') {
    showToast('Bangumi 绑定成功！');
    refreshBangumiAuthStatus();
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'denied') {
    showToast('Bangumi 授权被拒绝');
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'error') {
    const errMsg = params.get('bangumi_auth_msg') || '请检查回调 URL 是否与 bgm.tv 注册的地址一致';
    showToast('Bangumi 绑定失败: ' + errMsg);
    window.history.replaceState({}, '', window.location.pathname);
  }
});
