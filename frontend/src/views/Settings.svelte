<script module>
  // ─── Settings 视图（Svelte 迁移版）───
  // 渐进迁移的第一个视图：把 index.html 的 #settingsModal + src/js/settings.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  import { writable } from 'svelte/store';

  // 跨组件打开开关：main.js 桥接 window.openSettings → settingsOpen.set(true)
  export const settingsOpen = writable(false);
  // 跨组件指定初始标签页：main.js 桥接 window.switchSettingsTab → settingsTab.set(tab)
  export const settingsTab = writable(null);
</script>

<script>
  import { onMount } from 'svelte';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';

  // ─── i18n 辅助（复用全局 t()，回退文案）───
  function tr(key, fallback, options) {
    return typeof globalThis.t === 'function' ? globalThis.t(key, options) : fallback;
  }

  // ─── API 辅助（自包含，不复用全局 API）───
  const api = {
    async get(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async post(url, data) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };

  // ─── 状态 ───
  let activeTab = $state('basic');
  let errorMsg = $state('');

  // basic
  let mediaDir = $state('');
  // playback
  let players = $state([]);
  let playerMode = $state('mpv');
  let mpvPath = $state('');
  let playerDdOpen = $state(false);
  let playerPathHint = $state('');
  let autoMark = $state(true);
  // scraper
  let bangumiUrl = $state('https://api.bangumi.lol');
  let anilistEnabled = $state(false);
  let bangumiClientId = $state('');
  let bangumiClientSecret = $state('');
  // bangumi auth（当前 HTML 无对应 UI，逻辑保留迁移）
  let authStatusText = $state('');
  let authStatusColor = $state('var(--text3)');
  let authBound = $state(false);
  let authHasCredentials = $state(false);
  let lastSyncText = $state('');
  let lastSyncColor = $state('#22c55e');
  let lastSyncVisible = $state(false);
  let syncing = $state(false);
  // personalize
  let cardTitleLibrary = $state(false);
  let cardTitleMylist = $state(false);
  let detailTitleBg = $state(false);
  let finishConfirmMode = $state('prompt');
  // dashboard layout
  let layout = $state([]);
  let dragState = $state(null);
  // database
  let dbInfo = $state(null);
  let cacheInfo = $state(null);
  let dbLoaded = $state(false);
  let dbInfoError = $state('');

  let configCache = $state(null);
  let authPollTimer = null;

  // ─── 打开/关闭 + body 滚动锁定 ───
  $effect(() => {
    if ($settingsOpen) {
      document.body.style.overflow = 'hidden';
      loadSettings();
    } else {
      document.body.style.overflow = '';
    }
  });

  // ─── 外部指定初始标签页（search.js 桥接 window.switchSettingsTab）───
  $effect(() => {
    if ($settingsTab) {
      activeTab = $settingsTab;
      settingsTab.set(null);
    }
  });

  onMount(() => {
    function onDocClick(e) {
      if (playerDdOpen && !e.target.closest('.player-dd')) playerDdOpen = false;
    }
    function onKey(e) {
      if (e.key === 'Escape' && $settingsOpen) settingsOpen.set(false);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      if (authPollTimer) clearInterval(authPollTimer);
    };
  });

  function close() {
    settingsOpen.set(false);
  }

  // ─── 打开时加载配置 ───
  async function loadSettings() {
    try {
      const config = await api.get('/api/config');
      configCache = config;
      mediaDir = config.mediaDir || '';
      populatePlayerDropdown(config.players || [], config.playerMode || 'mpv', config.mpvPath || '');
      autoMark = config.autoMarkWatched !== false;
      errorMsg = '';

      const sources = config.apiSources || [];
      const bangumiSrc = sources.find((s) => s.type === 'bangumi');
      const anilistSrc = sources.find((s) => s.type === 'anilist');
      bangumiUrl = bangumiSrc?.url || 'https://api.bangumi.lol';
      anilistEnabled = !!anilistSrc;

      if (config.bangumiClientId) bangumiClientId = config.bangumiClientId;
      bangumiClientSecret = '••••••••';
      refreshBangumiAuthStatus();

      cardTitleLibrary = getCardTitleVisible('library');
      cardTitleMylist = getCardTitleVisible('mylist');
      renderDashboardLayoutSettings();

      detailTitleBg = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
      applyDetailTitleBg();

      let mode = localStorage.getItem('myAnimDock_finishConfirm') || 'prompt';
      if (mode === 'on') mode = 'prompt';
      finishConfirmMode = mode;

      refreshDbInfo();
    } catch (e) {
      if (!window.location.origin.startsWith('http')) return;
      showToast(tr('app.loadSettingsFailed', { error: e.message }), 'error');
    }
  }

  // ─── Tab 切换 ───
  function switchSettingsTab(tab) {
    activeTab = tab;
    if (tab === 'database') refreshDbInfo();
  }

  // ─── 表单保存 ───
  async function saveSettings() {
    if (!mediaDir) {
      errorMsg = tr('app.enterMediaDirPath');
      return;
    }

    const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = rawTheme === 'dark' || rawTheme === 'light' ? 'default' : rawTheme;
    const newThemeMode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
    const currentZoom = parseFloat(document.documentElement.style.getPropertyValue('--scale')) || 1;

    const apiSources = [{ type: 'bangumi', url: bangumiUrl.trim() || 'https://api.bangumi.lol', key: '' }];
    if (anilistEnabled) apiSources.push({ type: 'anilist', url: 'https://graphql.anilist.co', key: '' });

    try {
      const secretToSend = bangumiClientSecret === '••••••••' ? undefined : bangumiClientSecret;
      await api.post('/api/config', {
        mediaDir,
        playerMode,
        mpvPath,
        theme: newTheme,
        themeMode: newThemeMode,
        uiScale: currentZoom,
        reduceMotion: document.documentElement.getAttribute('data-reduce-motion') === 'true',
        autoMarkWatched: autoMark,
        apiSources,
        ...(bangumiClientId ? { bangumiClientId } : {}),
        ...(secretToSend ? { bangumiClientSecret: secretToSend } : {}),
      });

      localStorage.setItem('myAnimDock_cardTitle_library', cardTitleLibrary);
      localStorage.setItem('myAnimDock_cardTitle_mylist', cardTitleMylist);
      localStorage.setItem('myAnimDock_detailTitleBg', detailTitleBg ? 'on' : '');
      applyDetailTitleBg();
      localStorage.setItem('myAnimDock_finishConfirm', finishConfirmMode);

      close();
      showToast(tr('app.settingsSaved'), 'success');
      if (typeof refreshDiscovery === 'function') refreshDiscovery();
    } catch (e) {
      errorMsg = tr('app.saveFailed', { error: e.message });
    }
  }

  // ─── 播放器下拉 ───
  function populatePlayerDropdown(playersList, currentMode, currentPath) {
    players = playersList;
    playerMode = currentMode;
    mpvPath = currentPath || '';
    playerPathHint = currentPath
      ? tr('app.currentPath', { path: currentPath })
      : tr('app.autoSearchPath');
  }

  function togglePlayerDropdown(event) {
    event.stopPropagation();
    playerDdOpen = !playerDdOpen;
  }

  function selectPlayerOption(p) {
    playerMode = p.type;
    playerDdOpen = false;
  }

  // ─── 目录/可执行文件浏览（Tauri + 非 Tauri 降级）───
  async function openDialog(options) {
    if (window.__TAURI__?.dialog?.open) return await window.__TAURI__.dialog.open(options);
    if (window.__TAURI__?.core?.invoke) return await window.__TAURI__.core.invoke('plugin:dialog|open', options);
    if (window.__TAURI__?.invoke) return await window.__TAURI__.invoke('plugin:dialog|open', options);
    return null;
  }

  async function browseFolder() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: tr('app.selectMediaDir'),
      });
      if (selected) mediaDir = selected;
      else if (!window.__TAURI__) showToast(tr('app.browserModeEnterPathManually'), 'info');
    } catch (e) {
      showToast(tr('app.selectDirFailed', { error: e.message }), 'error');
    }
  }

  async function browsePlayerExecutable() {
    const name =
      { mpv: tr('app.playerNameMpv'), vlc: tr('app.playerNameVlc'), mpchc: tr('app.playerNameMpchc') }[playerMode] ||
      tr('app.playerNameGeneric', { name: playerMode });
    try {
      const result = await openDialog({
        multiple: false,
        title: tr('app.selectPlayer', { name }),
        filters: [{ name: tr('app.executableFileFilter'), extensions: ['exe', 'com'] }],
      });
      if (result) mpvPath = result;
      else if (!window.__TAURI__) showToast(tr('app.browserModeEnterPathManually'), 'info');
    } catch (e) {
      showToast(tr('app.selectFileFailed', { error: e.message }), 'error');
    }
  }

  // ─── 打开外部 URL（Tauri-safe）───
  function openExternalUrl(url) {
    if (window.__TAURI__?.shell?.open) {
      window.__TAURI__.shell.open(url).catch(() => {
        showToast(tr('app.openBrowserFailedGeneric'), 'error');
      });
    } else {
      window.open(url, '_blank');
    }
  }

  // ─── 从配置的 API URL 推导 Bangumi 前端 URL ───
  function getBangumiFrontendUrl() {
    const sources = configCache?.apiSources;
    if (Array.isArray(sources)) {
      const bgm = sources.find((s) => s.type === 'bangumi');
      if (bgm?.url) return bgm.url.replace(/^(https?:\/\/)api\./i, '$1');
    }
    return 'https://bgm.tv';
  }

  // ─── Bangumi 认证状态刷新 ───
  async function refreshBangumiAuthStatus() {
    try {
      const state = await api.get('/api/bangumi/auth/status');
      if (state.authed) {
        authStatusText = tr('app.boundUser', { username: state.username || '' });
        authStatusColor = '#22c55e';
        authBound = true;
        authHasCredentials = true;
        if (state.lastSyncTime) {
          const d = new Date(state.lastSyncTime);
          lastSyncText = tr('app.lastSync', { time: d.toLocaleString('zh-CN') });
          lastSyncVisible = true;
        } else {
          lastSyncText = '';
          lastSyncVisible = false;
        }
      } else if (state.hasCredentials) {
        authStatusText = tr('app.clientIdEnteredCanBind');
        authStatusColor = 'var(--text3)';
        authBound = false;
        authHasCredentials = true;
        lastSyncVisible = false;
      } else {
        authStatusText = tr('app.enterClientIdSecretToBind');
        authStatusColor = 'var(--text3)';
        authBound = false;
        authHasCredentials = false;
        lastSyncVisible = false;
      }
    } catch {}
  }

  async function bangumiSync() {
    syncing = true;
    lastSyncText = tr('app.syncingMyList');
    lastSyncVisible = true;
    try {
      const result = await api.post('/api/bangumi/sync', {});
      if (result.errors && result.errors.length > 0) {
        lastSyncText = tr('app.syncCompleteWithErrors', {
          created: result.created,
          pushed: result.pushed,
          errors: result.errors.length,
        });
        lastSyncColor = '#f59e0b';
      } else {
        lastSyncText = tr('app.syncComplete', {
          pulled: result.pulled,
          created: result.created,
          pushed: result.pushed,
        });
        lastSyncColor = '#22c55e';
      }
      if (result.lastSyncTime) refreshBangumiAuthStatus();
    } catch (e) {
      lastSyncText = tr('app.syncFailed', { error: e.message });
      lastSyncColor = '#ef4444';
    } finally {
      syncing = false;
    }
  }

  async function bangumiBind() {
    const clientId = bangumiClientId.trim();
    let clientSecret = bangumiClientSecret.trim();
    if (!clientId) {
      showToast(tr('app.enterBangumiClientId'), 'warning');
      return;
    }
    if (clientSecret === '••••••••') clientSecret = configCache?.bangumiClientSecret || '';
    if (!clientSecret) {
      showToast(tr('app.enterBangumiClientSecret'), 'warning');
      return;
    }
    await api.post('/api/bangumi/auth/creds', { clientId, clientSecret });
    const { url } = await api.get('/api/bangumi/auth/url');
    if (!url) {
      showToast(tr('app.cannotGenerateAuthUrl'), 'error');
      return;
    }
    if (window.__TAURI__?.shell?.open) {
      try {
        await window.__TAURI__.shell.open(url);
      } catch (e) {
        showToast(tr('app.openBrowserFailed', { error: e.message }), 'error');
        return;
      }
    } else {
      window.open(url, '_blank');
    }
    showToast(tr('app.completeBangumiAuthInBrowser'), 'info');
    startAuthPolling();
  }

  function startAuthPolling() {
    if (authPollTimer) clearInterval(authPollTimer);
    let attempts = 0;
    const maxAttempts = 90;
    authPollTimer = setInterval(async () => {
      attempts++;
      try {
        const state = await api.get('/api/bangumi/auth/status');
        if (state.authed) {
          clearInterval(authPollTimer);
          authPollTimer = null;
          showToast(tr('app.bangumiBindSuccess'), 'success');
          refreshBangumiAuthStatus();
        }
      } catch {}
      if (attempts >= maxAttempts) {
        clearInterval(authPollTimer);
        authPollTimer = null;
        showToast(tr('app.bindTimeoutCheckAuthPage'), 'warning');
      }
    }, 2000);
  }

  async function bangumiUnbind() {
    await api.post('/api/bangumi/auth/logout');
    refreshBangumiAuthStatus();
    showToast(tr('app.bangumiUnbound'), 'info');
  }

  // ─── 卡片标题 / 详情标题背景（localStorage）───
  function getCardTitleVisible(view, defaultVal) {
    const val = localStorage.getItem('myAnimDock_cardTitle_' + view);
    if (val === null) return defaultVal === true;
    return val === 'true';
  }

  function applyDetailTitleBg() {
    const on = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
    document.documentElement.setAttribute('data-detail-title-bg', on ? 'on' : '');
  }

  // ─── 动漫库布局（模块开关/排序）───
  function defaultDashboardLayout() {
    return [
      { id: 'stats', enabled: true },
      { id: 'continueWatch', enabled: true },
      { id: 'localLibrary', enabled: true },
    ];
  }

  function getDashboardLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem('myAnimDock_layout'));
      if (saved && Array.isArray(saved) && saved.length > 0) return saved;
    } catch (e) {}
    return defaultDashboardLayout();
  }

  function saveDashboardLayout(l) {
    localStorage.setItem('myAnimDock_layout', JSON.stringify(l));
  }

  function layoutLabel(id) {
    return { stats: tr('app.dashboardStats'), continueWatch: tr('app.dashboardContinueWatch'), localLibrary: tr('app.dashboardLocalLibrary') }[id] || id;
  }

  function renderDashboardLayoutSettings() {
    layout = getDashboardLayout();
  }

  function toggleDashboardSection(id, enabled) {
    const l = getDashboardLayout();
    const s = l.find((x) => x.id === id);
    if (s) s.enabled = enabled;
    saveDashboardLayout(l);
    renderDashboardLayoutSettings();
    if (typeof renderDashboard === 'function') renderDashboard();
  }

  function moveDashboardSection(id, dir) {
    const l = getDashboardLayout();
    const idx = l.findIndex((x) => x.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= l.length) return;
    const tmp = l[idx];
    l[idx] = l[newIdx];
    l[newIdx] = tmp;
    saveDashboardLayout(l);
    renderDashboardLayoutSettings();
    if (typeof renderDashboard === 'function') renderDashboard();
  }

  // 指针拖拽排序
  function onDragStart(e, id) {
    e.preventDefault();
    const idx = layout.findIndex((s) => s.id === id);
    dragState = { srcId: id, startY: e.clientY, srcIdx: idx };
  }

  function onDragMove(e) {
    if (!dragState) return;
    e.preventDefault();
    const items = document.querySelectorAll('#svelteDashboardLayoutList .dashboard-layout-item');
    let overIdx = -1;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        overIdx = i;
        break;
      }
    }
    if (overIdx >= 0 && overIdx !== dragState.srcIdx) {
      const l = [...layout];
      const [moved] = l.splice(dragState.srcIdx, 1);
      l.splice(overIdx, 0, moved);
      layout = l;
      dragState = { ...dragState, srcIdx: overIdx };
      saveDashboardLayout(l);
    }
  }

  function onDragEnd() {
    if (!dragState) return;
    dragState = null;
    if (typeof renderDashboard === 'function') renderDashboard();
  }

  // ─── 数据库管理 ───
  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function cacheLabel(key) {
    return { thumbs: tr('app.cacheVideoThumbs'), covers: tr('app.cacheCovers'), banners: tr('app.cacheBanners') }[key] || key;
  }

  async function refreshDbInfo() {
    dbLoaded = false;
    try {
      const info = await api.get('/api/db/info');
      dbInfo = info;
      cacheInfo = info.cache || null;
      dbInfoError = '';
    } catch (e) {
      dbInfoError = tr('app.dbInfoLoadFailed', { error: e.message });
    } finally {
      dbLoaded = true;
    }
  }

  async function dbBackup() {
    try {
      const res = await fetch('/api/db/backup');
      if (!res.ok) throw new Error(tr('app.dbBackupError'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `myanimedock-backup-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(tr('app.backupDownloaded'), 'success');
    } catch (e) {
      showToast(tr('app.backupFailed', { error: e.message }), 'error');
    }
  }

  async function dbBackupAll() {
    try {
      const res = await fetch('/api/db/backup/download-all', { method: 'POST' });
      if (!res.ok) throw new Error(tr('app.packBackupError'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `myanimedock-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(tr('app.fullBackupDownloaded'), 'success');
    } catch (e) {
      showToast(tr('app.backupFailed', { error: e.message }), 'error');
    }
  }

  async function dbRestore(input) {
    const file = input.files[0];
    if (!file) return;
    const confirmed = await showConfirm(tr('app.confirmRestoreBackup'));
    if (!confirmed) {
      input.value = '';
      return;
    }
    showToast(tr('app.restoringDatabase'), 'info');
    try {
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
      const res = await api.post('/api/db/restore', { file: base64 });
      if (res.ok) {
        showToast(tr('app.databaseRestored'), 'success');
        refreshDbInfo();
        if (typeof refreshLibrary === 'function') refreshLibrary();
      }
    } catch (e) {
      showToast(tr('app.restoreFailed', { error: e.message }), 'error');
    } finally {
      input.value = '';
    }
  }

  async function dbClearSessions() {
    const confirmed = await showConfirm(tr('app.confirmClearSessions'));
    if (!confirmed) return;
    try {
      const res = await api.post('/api/db/clear-sessions', {});
      if (res.ok) {
        showToast(tr('app.sessionsCleared'), 'success');
        refreshDbInfo();
      }
    } catch (e) {
      showToast(tr('app.clearSessionsFailed', { error: e.message }), 'error');
    }
  }

  async function dbVacuum() {
    const confirmed = await showConfirm(tr('app.confirmVacuum'));
    if (!confirmed) return;
    try {
      const res = await api.post('/api/db/vacuum', {});
      if (res.ok) {
        const newSize = res.dbSize > 1048576 ? (res.dbSize / 1048576).toFixed(1) + ' MB' : (res.dbSize / 1024).toFixed(1) + ' KB';
        showToast(tr('app.vacuumComplete', { size: newSize }), 'success');
        refreshDbInfo();
      }
    } catch (e) {
      showToast(tr('app.vacuumFailed', { error: e.message }), 'error');
    }
  }

  async function dbReset() {
    const step1 = await showConfirm(tr('app.confirmResetDbStep1'));
    if (!step1) return;
    const step2 = await showConfirm(tr('app.confirmResetDbStep2'));
    if (!step2) return;
    try {
      const res = await api.post('/api/db/reset', {});
      if (res.ok) {
        showToast(tr('app.databaseReset'), 'info');
        refreshDbInfo();
        if (typeof refreshLibrary === 'function') refreshLibrary();
        if (typeof renderMyList === 'function') renderMyList();
      }
    } catch (e) {
      showToast(tr('app.resetFailed', { error: e.message }), 'error');
    }
  }

  async function dbClearCache(target) {
    const label = { thumbs: tr('app.cacheLabelThumbs'), covers: tr('app.cacheLabelCovers'), banners: tr('app.cacheLabelBanners'), all: tr('app.cacheLabelAll') }[target] || target;
    const confirmed = await showConfirm(tr('app.confirmClearCache', { label }));
    if (!confirmed) return;
    try {
      const res = await api.post('/api/db/clear-cache', { target: target === 'all' ? undefined : target });
      if (res.ok) {
        const parts = [];
        for (const key in res.results) {
          const r = res.results[key];
          if (r.cleared > 0) parts.push(key + ': ' + formatSize(r.size) + ' (' + tr('app.cacheFilesCount', { count: r.cleared }) + ')');
        }
        showToast(tr('app.cacheCleared', { label, parts: parts.length ? parts.join(' | ') : '' }), 'success');
        refreshDbInfo();
      }
    } catch (e) {
      showToast(tr('app.clearCacheFailed', { error: e.message }), 'error');
    }
  }
</script>

{#if $settingsOpen}
  <div class="modal-overlay show" id="settingsModal" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="modal modal--settings">
      <div class="settings-header">
        <div class="settings-header-top">
          <h2>{tr('common.settings')}</h2>
          <button
            class="btn-icon visual-settings-btn"
            onclick={() => { close(); window.openVisualDock(); }}
            data-tooltip={tr('nav.themeVisual')}
            aria-label={tr('nav.themeVisual')}
          >
            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="var(--accent)" stroke="var(--accent)" stroke-width="0.5"/><text x="8" y="13" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="12" fill="var(--bg-elevated)" text-anchor="middle">D</text></svg>
            <span>{tr('settings.visual')}</span>
          </button>
        </div>
        <nav class="settings-tabs" role="tablist">
          <button class="settings-tab" class:active={activeTab === 'basic'} role="tab" aria-selected={activeTab === 'basic'} onclick={() => switchSettingsTab('basic')}>{tr('settings.tabBasic')}</button>
          <button class="settings-tab" class:active={activeTab === 'playback'} role="tab" aria-selected={activeTab === 'playback'} onclick={() => switchSettingsTab('playback')}>{tr('settings.tabPlayback')}</button>
          <button class="settings-tab" class:active={activeTab === 'scraper'} role="tab" aria-selected={activeTab === 'scraper'} onclick={() => switchSettingsTab('scraper')}>{tr('settings.tabScraper')}</button>
          <button class="settings-tab" class:active={activeTab === 'dashboard'} role="tab" aria-selected={activeTab === 'dashboard'} onclick={() => switchSettingsTab('dashboard')}>{tr('settings.tabDashboard')}</button>
          <button class="settings-tab" class:active={activeTab === 'personalize'} role="tab" aria-selected={activeTab === 'personalize'} onclick={() => switchSettingsTab('personalize')}>{tr('settings.tabPersonalize')}</button>
          <button class="settings-tab" class:active={activeTab === 'database'} role="tab" aria-selected={activeTab === 'database'} onclick={() => switchSettingsTab('database')}>{tr('settings.tabDatabase')}</button>
        </nav>
      </div>
      <div class="settings-panels">
        <!-- Tab: 基本 -->
        <div class="settings-panel" class:active={activeTab === 'basic'} id="tab-basic">
          <div class="form-group">
            <label for="settingsMediaDir">{tr('settings.mediaDir')}</label>
            <div class="input-with-btn">
              <input type="text" id="settingsMediaDir" placeholder="E:/Anime" bind:value={mediaDir}>
              <button class="btn btn-sm" onclick={browseFolder}>{tr('common.browse')}</button>
            </div>
          </div>
        </div>

        <!-- Tab: 播放 -->
        <div class="settings-panel" class:active={activeTab === 'playback'} id="tab-playback">
          <div class="form-group">
            <label>{tr('settings.player')}</label>
            <div class="input-with-btn">
              <div class="player-dd" id="playerModeDropdown" class:is-open={playerDdOpen}>
                <button type="button" class="player-dd-trigger" id="playerDdTrigger" onclick={togglePlayerDropdown}>
                  <span class="player-dd-text" id="playerDdText">{players.find((p) => p.type === playerMode)?.displayName || playerMode}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="player-dd-chevron"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div class="player-dd-menu" id="playerDdMenu">
                  {#each players as p (p.type)}
                    <button type="button" class="player-dd-opt" class:is-selected={p.type === playerMode} onclick={() => selectPlayerOption(p)}>{p.displayName || p.type}</button>
                  {/each}
                </div>
              </div>
              <input type="text" id="settingsPlayerPath" placeholder={tr('settings.playerPathPlaceholder')} bind:value={mpvPath}>
              <button class="btn btn-sm" onclick={browsePlayerExecutable}>{tr('common.browse')}</button>
            </div>
            <p class="form-hint" id="playerPathHint">{playerPathHint}</p>
          </div>
          <div class="form-group">
            <label>{tr('settings.autoMark')}</label>
            <p class="form-hint mt-0">{tr('settings.autoMarkHint')}</p>
            <div class="dashboard-layout-list" style="margin-top:0.75rem">
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsAutoMark" bind:checked={autoMark}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('settings.enableAutoMark')}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab: 刮削 -->
        <div class="settings-panel" class:active={activeTab === 'scraper'} id="tab-scraper">
          <div class="form-group">
            <label for="bangumiUrl">{tr('settings.bangumiApi')}</label>
            <input type="text" id="bangumiUrl" placeholder="https://api.bangumi.lol" bind:value={bangumiUrl}>
            <p class="form-hint">{tr('settings.bangumiHint')}</p>
          </div>
          <div class="form-group">
            <label>{tr('settings.anilist')}</label>
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:var(--space-2)">
              <label class="toggle-switch" style="margin:0">
                <input type="checkbox" id="anilistEnabled" bind:checked={anilistEnabled}>
                <span class="toggle-slider"></span>
              </label>
              <span class="dashboard-layout-label">{tr('settings.enableAnilist')}</span>
            </div>
            <blockquote class="form-hint" style="border-inline-start: 2px solid var(--border); padding-inline-start: var(--space-3); margin: 0; font-style: normal;"><span>{tr('settings.anilistRomanji')}</span><br><span>{tr('settings.anilistBanner')}</span></blockquote>
          </div>
        </div>

        <!-- Tab: 动漫库 -->
        <div class="settings-panel" class:active={activeTab === 'dashboard'} id="tab-dashboard">
          <div class="form-group">
            <label>{tr('settings.libraryModules')}</label>
            <p class="form-hint mt-0">{tr('settings.libraryModulesHint')}</p>
            <div class="dashboard-layout-list" id="svelteDashboardLayoutList" onpointermove={onDragMove} onpointerup={onDragEnd}>
              {#each layout as s, i (s.id)}
                <div class="dashboard-layout-item" data-id={s.id}>
                  <span class="dashboard-layout-drag-handle" data-drag-handle={s.id} onpointerdown={(e) => onDragStart(e, s.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                  </span>
                  <label class="toggle-switch" style="margin:0">
                    <input type="checkbox" checked={s.enabled} onchange={(e) => toggleDashboardSection(s.id, e.currentTarget.checked)}>
                    <span class="toggle-slider"></span>
                  </label>
                  <span class="dashboard-layout-label">{layoutLabel(s.id)}</span>
                  <div class="dashboard-layout-arrows">
                    <button class="btn btn-icon btn-xs" onclick={() => moveDashboardSection(s.id, -1)} disabled={i === 0} data-tooltip={tr('app.tooltipMoveUp')} aria-label={tr('app.tooltipMoveUp')}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                    </button>
                    <button class="btn btn-icon btn-xs" onclick={() => moveDashboardSection(s.id, 1)} disabled={i === layout.length - 1} data-tooltip={tr('app.tooltipMoveDown')} aria-label={tr('app.tooltipMoveDown')}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>

        <!-- Tab: 个性化 -->
        <div class="settings-panel" class:active={activeTab === 'personalize'} id="tab-personalize">
          <div class="form-group">
            <label>{tr('settings.cardTitle')}</label>
            <p class="form-hint mt-0">{tr('settings.cardTitleHint')}</p>
            <div class="dashboard-layout-list" style="margin-top:0.75rem">
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsCardTitleLibrary" bind:checked={cardTitleLibrary}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('library.title')}</span>
              </div>
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsCardTitleMylist" bind:checked={cardTitleMylist}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('mylist.title')}</span>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>{tr('settings.detailTitleBg')}</label>
            <p class="form-hint mt-0">{tr('settings.detailTitleBgHint')}</p>
            <div class="dashboard-layout-list" style="margin-top:0.75rem">
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsDetailTitleBg" bind:checked={detailTitleBg}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('settings.titleBackground')}</span>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>{tr('settings.progressConfirm')}</label>
            <p class="form-hint mt-0">{tr('settings.progressConfirmHint')}</p>
            <div class="seg-radio-group" style="margin-top:0.75rem">
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="prompt" bind:group={finishConfirmMode}>
                <span>{tr('settings.confirmPrompt')}</span>
              </label>
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="auto" bind:group={finishConfirmMode}>
                <span>{tr('settings.autoMarkOption')}</span>
              </label>
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="off" bind:group={finishConfirmMode}>
                <span>{tr('settings.doNothing')}</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Tab: 数据库 -->
        <div class="settings-panel" class:active={activeTab === 'database'} id="tab-database">
          <div class="form-group">
            <label>{tr('settings.dbOverview')}</label>
            <div id="dbInfoContainer">
              {#if !dbLoaded}
                <p class="form-hint">{tr('common.loading')}</p>
              {:else if dbInfoError}
                <p class="form-hint text-error">{dbInfoError}</p>
              {:else if dbInfo}
                <div class="db-info-grid">
                  <div class="db-info-item db-info-item--full"><span class="db-info-label">{tr('app.dbLocation')}</span><span class="db-info-value db-info-path" data-tooltip={dbInfo.dbPath}>{dbInfo.dbPath}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.dbSize')}</span><span class="db-info-value">{formatSize(dbInfo.dbSize)}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.animeCount')}</span><span class="db-info-value">{dbInfo.counts.anime}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.episodeCount')}</span><span class="db-info-value">{dbInfo.counts.episodes}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.playSessionCount')}</span><span class="db-info-value">{dbInfo.counts.playSessions}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.myListCount')}</span><span class="db-info-value">{dbInfo.counts.myList}</span></div>
                </div>
              {/if}
            </div>
          </div>

          <div class="form-group">
            <label>{tr('settings.backupRestore')}</label>
            <div class="db-action-row">
              <button class="btn btn-sm" onclick={dbBackup} id="btnDbBackup">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8"/><path d="M5 5l3-3 3 3"/><path d="M8 2v9"/></svg>
                <span>{tr('settings.downloadDbBackup')}</span>
              </button>
              <button class="btn btn-sm" onclick={dbBackupAll} id="btnDbBackupAll">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8"/><path d="M5 5l3-3 3 3"/><path d="M8 2v9"/></svg>
                <span>{tr('settings.fullBackup')}</span>
              </button>
              <button class="btn btn-sm" onclick={() => document.getElementById('restoreFileInput').click()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8"/><path d="M5 11l3 3 3-3"/><path d="M8 14V2"/></svg>
                <span>{tr('settings.restoreBackup')}</span>
              </button>
              <input type="file" id="restoreFileInput" accept=".db" style="display:none" onchange={(e) => dbRestore(e.currentTarget)}>
            </div>
          </div>

          <div class="form-group">
            <label>{tr('settings.cacheManagement')}</label>
            <p class="form-hint">{tr('settings.cacheHint')}</p>
            <div id="dbCacheContainer">
              {#if !dbLoaded}
                <p class="form-hint">{tr('common.loading')}</p>
              {:else if cacheInfo}
                <div class="db-info-grid">
                  {#each Object.entries(cacheInfo) as [key, c]}
                    <div class="db-info-item">
                      <span class="db-info-label">{cacheLabel(key)}</span>
                      <span class="db-info-value">{formatSize(c.size)}</span>
                      <span class="db-info-label" style="margin-top:1px">{tr('app.cacheFilesCount', { count: c.files })}</span>
                    </div>
                  {/each}
                </div>
                <div class="db-action-row mt-2">
                  <button class="btn btn-sm" onclick={() => dbClearCache('thumbs')} data-tooltip={tr('app.clearCacheTooltipThumbs')}>{tr('app.clearCacheBtnThumbs')}</button>
                  <button class="btn btn-sm" onclick={() => dbClearCache('covers')} data-tooltip={tr('app.clearCacheTooltipCovers')}>{tr('app.clearCacheBtnCovers')}</button>
                  <button class="btn btn-sm" onclick={() => dbClearCache('banners')} data-tooltip={tr('app.clearCacheTooltipBanners')}>{tr('app.clearCacheBtnBanners')}</button>
                  <button class="btn btn-sm" onclick={() => dbClearCache('all')} data-tooltip={tr('app.clearCacheTooltipAll')}>{tr('app.clearCacheBtnAll')}</button>
                </div>
              {:else}
                <p class="form-hint">{tr('app.noCacheData')}</p>
              {/if}
            </div>
          </div>

          <div class="form-group">
            <label>{tr('settings.maintenance')}</label>
            <div class="db-action-row">
              <button class="btn btn-sm" onclick={dbClearSessions} id="btnDbClearSessions">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h14"/><path d="M3 4v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4"/><path d="M6 4V2h4v2"/></svg>
                <span>{tr('settings.clearSessions')}</span>
              </button>
              <button class="btn btn-sm" onclick={dbVacuum} id="btnDbVacuum" data-tooltip={tr('settings.vacuumTooltip')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="7"/><path d="M8 5v3"/><path d="M8 11h.01"/></svg>
                <span>{tr('settings.vacuum')}</span>
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="db-danger-label">{tr('settings.danger')}</label>
            <div class="db-action-row">
              <button class="btn btn-sm btn-danger" onclick={dbReset} id="btnDbReset">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l4 4"/><path d="M10 6l-4 4"/><circle cx="8" cy="8" r="7"/></svg>
                <span>{tr('settings.resetDb')}</span>
              </button>
            </div>
            <p class="form-hint db-danger-hint">{tr('settings.resetDbHint')}</p>
          </div>
        </div>
      </div>
      <div id="settingsError" class="error-msg">{errorMsg}</div>
      <div class="modal-actions">
        <button class="btn" onclick={close}>{tr('common.cancel')}</button>
        <button class="btn btn-primary" onclick={saveSettings}>{tr('common.save')}</button>
      </div>
    </div>
  </div>
{/if}