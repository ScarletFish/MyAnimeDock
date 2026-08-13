<script module>
  // ─── Settings 视图（Svelte 迁移版）───
  // 渐进迁移的第一个视图：把 index.html 的 #settingsModal + src/js/settings.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  import { writable } from 'svelte/store';

  // 跨组件打开开关：main.js 桥接 window.openSettings → settingsOpen.set(true)
  export const settingsOpen = writable(false);
</script>

<script>
  import { onMount } from 'svelte';
  import { showToast } from '../components/Toast.svelte';

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
      showToast(tr('app.loadSettingsFailed', '设置加载失败：{error}', { error: e.message }), 'error');
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
      errorMsg = tr('app.enterMediaDirPath', '请输入媒体目录路径');
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
      showToast(tr('app.settingsSaved', '设置已保存'), 'success');
      if (typeof refreshDiscovery === 'function') refreshDiscovery();
    } catch (e) {
      errorMsg = tr('app.saveFailed', '保存失败：{error}', { error: e.message });
    }
  }

  // ─── 播放器下拉 ───
  function populatePlayerDropdown(playersList, currentMode, currentPath) {
    players = playersList;
    playerMode = currentMode;
    mpvPath = currentPath || '';
    playerPathHint = currentPath
      ? tr('app.currentPath', '当前路径：{path}', { path: currentPath })
      : tr('app.autoSearchPath', '留空自动搜索 PATH');
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
        title: tr('app.selectMediaDir', '选择媒体目录'),
      });
      if (selected) mediaDir = selected;
      else if (!window.__TAURI__) showToast(tr('app.browserModeEnterPathManually', '浏览器模式请手动输入路径'), 'info');
    } catch (e) {
      showToast(tr('app.selectDirFailed', '选择目录失败：{error}', { error: e.message }), 'error');
    }
  }

  async function browsePlayerExecutable() {
    const name =
      { mpv: tr('app.playerNameMpv', 'mpv'), vlc: tr('app.playerNameVlc', 'VLC'), mpchc: tr('app.playerNameMpchc', 'MPC-HC') }[playerMode] ||
      tr('app.playerNameGeneric', '{name}', { name: playerMode });
    try {
      const result = await openDialog({
        multiple: false,
        title: tr('app.selectPlayer', '选择播放器：{name}', { name }),
        filters: [{ name: tr('app.executableFileFilter', '可执行文件'), extensions: ['exe', 'com'] }],
      });
      if (result) mpvPath = result;
      else if (!window.__TAURI__) showToast(tr('app.browserModeEnterPathManually', '浏览器模式请手动输入路径'), 'info');
    } catch (e) {
      showToast(tr('app.selectFileFailed', '选择文件失败：{error}', { error: e.message }), 'error');
    }
  }

  // ─── 打开外部 URL（Tauri-safe）───
  function openExternalUrl(url) {
    if (window.__TAURI__?.shell?.open) {
      window.__TAURI__.shell.open(url).catch(() => {
        showToast(tr('app.openBrowserFailedGeneric', '打开浏览器失败'), 'error');
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
        authStatusText = tr('app.boundUser', '已绑定用户：{username}', { username: state.username || '' });
        authStatusColor = '#22c55e';
        authBound = true;
        authHasCredentials = true;
        if (state.lastSyncTime) {
          const d = new Date(state.lastSyncTime);
          lastSyncText = tr('app.lastSync', '上次同步：{time}', { time: d.toLocaleString('zh-CN') });
          lastSyncVisible = true;
        } else {
          lastSyncText = '';
          lastSyncVisible = false;
        }
      } else if (state.hasCredentials) {
        authStatusText = tr('app.clientIdEnteredCanBind', '已填写 Client ID，可绑定');
        authStatusColor = 'var(--text3)';
        authBound = false;
        authHasCredentials = true;
        lastSyncVisible = false;
      } else {
        authStatusText = tr('app.enterClientIdSecretToBind', '填写 Client ID 与 Secret 后绑定');
        authStatusColor = 'var(--text3)';
        authBound = false;
        authHasCredentials = false;
        lastSyncVisible = false;
      }
    } catch {}
  }

  async function bangumiSync() {
    syncing = true;
    lastSyncText = tr('app.syncingMyList', '正在同步我的列表...');
    lastSyncVisible = true;
    try {
      const result = await api.post('/api/bangumi/sync', {});
      if (result.errors && result.errors.length > 0) {
        lastSyncText = tr('app.syncCompleteWithErrors', '同步完成（创建 {created}，推送 {pushed}，错误 {errors}）', {
          created: result.created,
          pushed: result.pushed,
          errors: result.errors.length,
        });
        lastSyncColor = '#f59e0b';
      } else {
        lastSyncText = tr('app.syncComplete', '同步完成（拉取 {pulled}，创建 {created}，推送 {pushed}）', {
          pulled: result.pulled,
          created: result.created,
          pushed: result.pushed,
        });
        lastSyncColor = '#22c55e';
      }
      if (result.lastSyncTime) refreshBangumiAuthStatus();
    } catch (e) {
      lastSyncText = tr('app.syncFailed', '同步失败：{error}', { error: e.message });
      lastSyncColor = '#ef4444';
    } finally {
      syncing = false;
    }
  }

  async function bangumiBind() {
    const clientId = bangumiClientId.trim();
    let clientSecret = bangumiClientSecret.trim();
    if (!clientId) {
      showToast(tr('app.enterBangumiClientId', '请先填入 Bangumi Client ID'), 'warning');
      return;
    }
    if (clientSecret === '••••••••') clientSecret = configCache?.bangumiClientSecret || '';
    if (!clientSecret) {
      showToast(tr('app.enterBangumiClientSecret', '请先填入 Bangumi Client Secret'), 'warning');
      return;
    }
    await api.post('/api/bangumi/auth/creds', { clientId, clientSecret });
    const { url } = await api.get('/api/bangumi/auth/url');
    if (!url) {
      showToast(tr('app.cannotGenerateAuthUrl', '无法生成授权链接'), 'error');
      return;
    }
    if (window.__TAURI__?.shell?.open) {
      try {
        await window.__TAURI__.shell.open(url);
      } catch (e) {
        showToast(tr('app.openBrowserFailed', '打开浏览器失败：{error}', { error: e.message }), 'error');
        return;
      }
    } else {
      window.open(url, '_blank');
    }
    showToast(tr('app.completeBangumiAuthInBrowser', '请在浏览器中完成 Bangumi 授权'), 'info');
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
          showToast(tr('app.bangumiBindSuccess', 'Bangumi 绑定成功！'), 'success');
          refreshBangumiAuthStatus();
        }
      } catch {}
      if (attempts >= maxAttempts) {
        clearInterval(authPollTimer);
        authPollTimer = null;
        showToast(tr('app.bindTimeoutCheckAuthPage', '绑定超时，请检查 Bangumi 授权页面'), 'warning');
      }
    }, 2000);
  }

  async function bangumiUnbind() {
    await api.post('/api/bangumi/auth/logout');
    refreshBangumiAuthStatus();
    showToast(tr('app.bangumiUnbound', '已解除 Bangumi 绑定'), 'info');
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
    return { stats: tr('app.dashboardStats', '统计'), continueWatch: tr('app.dashboardContinueWatch', '继续观看'), localLibrary: tr('app.dashboardLocalLibrary', '本地动漫库') }[id] || id;
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
    return { thumbs: tr('app.cacheVideoThumbs', '视频缩略图'), covers: tr('app.cacheCovers', '封面'), banners: tr('app.cacheBanners', '横幅') }[key] || key;
  }

  async function refreshDbInfo() {
    dbLoaded = false;
    try {
      const info = await api.get('/api/db/info');
      dbInfo = info;
      cacheInfo = info.cache || null;
      dbInfoError = '';
    } catch (e) {
      dbInfoError = tr('app.dbInfoLoadFailed', '数据库信息加载失败：{error}', { error: e.message });
    } finally {
      dbLoaded = true;
    }
  }

  async function dbBackup() {
    try {
      const res = await fetch('/api/db/backup');
      if (!res.ok) throw new Error(tr('app.dbBackupError', '数据库备份失败'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `myanimedock-backup-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(tr('app.backupDownloaded', '备份已下载'), 'success');
    } catch (e) {
      showToast(tr('app.backupFailed', '备份失败：{error}', { error: e.message }), 'error');
    }
  }

  async function dbBackupAll() {
    try {
      const res = await fetch('/api/db/backup/download-all', { method: 'POST' });
      if (!res.ok) throw new Error(tr('app.packBackupError', '打包备份失败'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `myanimedock-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(tr('app.fullBackupDownloaded', '完整备份已下载'), 'success');
    } catch (e) {
      showToast(tr('app.backupFailed', '备份失败：{error}', { error: e.message }), 'error');
    }
  }

  async function dbRestore(input) {
    const file = input.files[0];
    if (!file) return;
    const confirmed = await globalThis.showConfirm(tr('app.confirmRestoreBackup', '确认恢复该备份？'));
    if (!confirmed) {
      input.value = '';
      return;
    }
    showToast(tr('app.restoringDatabase', '正在恢复数据库...'), 'info');
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
        showToast(tr('app.databaseRestored', '数据库已恢复'), 'success');
        refreshDbInfo();
        if (typeof refreshLibrary === 'function') refreshLibrary();
      }
    } catch (e) {
      showToast(tr('app.restoreFailed', '恢复失败：{error}', { error: e.message }), 'error');
    } finally {
      input.value = '';
    }
  }

  async function dbClearSessions() {
    const confirmed = await globalThis.showConfirm(tr('app.confirmClearSessions', '确认清除所有播放记录？'));
    if (!confirmed) return;
    try {
      const res = await api.post('/api/db/clear-sessions', {});
      if (res.ok) {
        showToast(tr('app.sessionsCleared', '播放记录已清除'), 'success');
        refreshDbInfo();
      }
    } catch (e) {
      showToast(tr('app.clearSessionsFailed', '清除失败：{error}', { error: e.message }), 'error');
    }
  }

  async function dbVacuum() {
    const confirmed = await globalThis.showConfirm(tr('app.confirmVacuum', '确认优化数据库？'));
    if (!confirmed) return;
    try {
      const res = await api.post('/api/db/vacuum', {});
      if (res.ok) {
        const newSize = res.dbSize > 1048576 ? (res.dbSize / 1048576).toFixed(1) + ' MB' : (res.dbSize / 1024).toFixed(1) + ' KB';
        showToast(tr('app.vacuumComplete', '数据库已优化（{size}）', { size: newSize }), 'success');
        refreshDbInfo();
      }
    } catch (e) {
      showToast(tr('app.vacuumFailed', '优化失败：{error}', { error: e.message }), 'error');
    }
  }

  async function dbReset() {
    const step1 = await globalThis.showConfirm(tr('app.confirmResetDbStep1', '确认重置数据库？此操作不可撤销。'));
    if (!step1) return;
    const step2 = await globalThis.showConfirm(tr('app.confirmResetDbStep2', '再次确认：将清空所有动漫数据、播放记录和列表。'));
    if (!step2) return;
    try {
      const res = await api.post('/api/db/reset', {});
      if (res.ok) {
        showToast(tr('app.databaseReset', '数据库已重置'), 'info');
        refreshDbInfo();
        if (typeof refreshLibrary === 'function') refreshLibrary();
        if (typeof renderMyList === 'function') renderMyList();
      }
    } catch (e) {
      showToast(tr('app.resetFailed', '重置失败：{error}', { error: e.message }), 'error');
    }
  }

  async function dbClearCache(target) {
    const label = { thumbs: tr('app.cacheLabelThumbs', '缩略图'), covers: tr('app.cacheLabelCovers', '封面'), banners: tr('app.cacheLabelBanners', '横幅'), all: tr('app.cacheLabelAll', '全部') }[target] || target;
    const confirmed = await globalThis.showConfirm(tr('app.confirmClearCache', '确认清除{label}缓存？', { label }));
    if (!confirmed) return;
    try {
      const res = await api.post('/api/db/clear-cache', { target: target === 'all' ? undefined : target });
      if (res.ok) {
        const parts = [];
        for (const key in res.results) {
          const r = res.results[key];
          if (r.cleared > 0) parts.push(key + ': ' + formatSize(r.size) + ' (' + tr('app.cacheFilesCount', '{count} 个文件', { count: r.cleared }) + ')');
        }
        showToast(tr('app.cacheCleared', '已清除{label}缓存', { label, parts: parts.length ? parts.join(' | ') : '' }), 'success');
        refreshDbInfo();
      }
    } catch (e) {
      showToast(tr('app.clearCacheFailed', '清除缓存失败：{error}', { error: e.message }), 'error');
    }
  }
</script>

{#if $settingsOpen}
  <div class="modal-overlay show" id="settingsModal" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="modal modal--settings">
      <div class="settings-header">
        <div class="settings-header-top">
          <h2>{tr('common.settings', '设置')}</h2>
          <button
            class="btn-icon visual-settings-btn"
            onclick={() => { close(); window.openVisualDock(); }}
            data-tooltip={tr('nav.themeVisual', '主题与视觉设置')}
            aria-label={tr('nav.themeVisual', '主题与视觉设置')}
          >
            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="var(--accent)" stroke="var(--accent)" stroke-width="0.5"/><text x="8" y="13" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="12" fill="var(--bg-elevated)" text-anchor="middle">D</text></svg>
            <span>{tr('settings.visual', '视觉')}</span>
          </button>
        </div>
        <nav class="settings-tabs" role="tablist">
          <button class="settings-tab" class:active={activeTab === 'basic'} role="tab" aria-selected={activeTab === 'basic'} onclick={() => switchSettingsTab('basic')}>{tr('settings.tabBasic', '基本')}</button>
          <button class="settings-tab" class:active={activeTab === 'playback'} role="tab" aria-selected={activeTab === 'playback'} onclick={() => switchSettingsTab('playback')}>{tr('settings.tabPlayback', '播放')}</button>
          <button class="settings-tab" class:active={activeTab === 'scraper'} role="tab" aria-selected={activeTab === 'scraper'} onclick={() => switchSettingsTab('scraper')}>{tr('settings.tabScraper', '刮削')}</button>
          <button class="settings-tab" class:active={activeTab === 'dashboard'} role="tab" aria-selected={activeTab === 'dashboard'} onclick={() => switchSettingsTab('dashboard')}>{tr('settings.tabDashboard', '动漫库')}</button>
          <button class="settings-tab" class:active={activeTab === 'personalize'} role="tab" aria-selected={activeTab === 'personalize'} onclick={() => switchSettingsTab('personalize')}>{tr('settings.tabPersonalize', '个性化')}</button>
          <button class="settings-tab" class:active={activeTab === 'database'} role="tab" aria-selected={activeTab === 'database'} onclick={() => switchSettingsTab('database')}>{tr('settings.tabDatabase', '数据库')}</button>
        </nav>
      </div>
      <div class="settings-panels">
        <!-- Tab: 基本 -->
        <div class="settings-panel" class:active={activeTab === 'basic'} id="tab-basic">
          <div class="form-group">
            <label for="settingsMediaDir">{tr('settings.mediaDir', '媒体目录路径')}</label>
            <div class="input-with-btn">
              <input type="text" id="settingsMediaDir" placeholder="E:/Anime" bind:value={mediaDir}>
              <button class="btn btn-sm" onclick={browseFolder}>{tr('common.browse', '浏览')}</button>
            </div>
          </div>
        </div>

        <!-- Tab: 播放 -->
        <div class="settings-panel" class:active={activeTab === 'playback'} id="tab-playback">
          <div class="form-group">
            <label>{tr('settings.player', '播放器')}</label>
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
              <input type="text" id="settingsPlayerPath" placeholder={tr('settings.playerPathPlaceholder', '路径，留空自动搜索 PATH')} bind:value={mpvPath}>
              <button class="btn btn-sm" onclick={browsePlayerExecutable}>{tr('common.browse', '浏览')}</button>
            </div>
            <p class="form-hint" id="playerPathHint">{playerPathHint}</p>
          </div>
          <div class="form-group">
            <label>{tr('settings.autoMark', '自动标记前序集数')}</label>
            <p class="form-hint mt-0">{tr('settings.autoMarkHint', '播放下一集时自动将前序集标记为已观看')}</p>
            <div class="dashboard-layout-list" style="margin-top:0.75rem">
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsAutoMark" bind:checked={autoMark}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('settings.enableAutoMark', '启用自动标记')}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab: 刮削 -->
        <div class="settings-panel" class:active={activeTab === 'scraper'} id="tab-scraper">
          <div class="form-group">
            <label for="bangumiUrl">{tr('settings.bangumiApi', 'Bangumi API 地址')}</label>
            <input type="text" id="bangumiUrl" placeholder="https://api.bangumi.lol" bind:value={bangumiUrl}>
            <p class="form-hint">{tr('settings.bangumiHint', '默认 api.bangumi.lol，官方源 api.bgm.tv')}</p>
          </div>
          <div class="form-group">
            <label>{tr('settings.anilist', 'AniList 双源匹配')}</label>
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:var(--space-2)">
              <label class="toggle-switch" style="margin:0">
                <input type="checkbox" id="anilistEnabled" bind:checked={anilistEnabled}>
                <span class="toggle-slider"></span>
              </label>
              <span class="dashboard-layout-label">{tr('settings.enableAnilist', '启用 AniList')}</span>
            </div>
            <blockquote class="form-hint" style="border-inline-start: 2px solid var(--border); padding-inline-start: var(--space-3); margin: 0; font-style: normal;"><span>{tr('settings.anilistRomanji', '罗马音标题')}</span><br><span>{tr('settings.anilistBanner', '横幅图')}</span></blockquote>
          </div>
        </div>

        <!-- Tab: 动漫库 -->
        <div class="settings-panel" class:active={activeTab === 'dashboard'} id="tab-dashboard">
          <div class="form-group">
            <label>{tr('settings.libraryModules', '动漫库模块')}</label>
            <p class="form-hint mt-0">{tr('settings.libraryModulesHint', '勾选要在首页显示的模块，拖拽或点击箭头调整顺序')}</p>
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
                    <button class="btn btn-icon btn-xs" onclick={() => moveDashboardSection(s.id, -1)} disabled={i === 0} data-tooltip={tr('app.tooltipMoveUp', '上移')} aria-label={tr('app.tooltipMoveUp', '上移')}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                    </button>
                    <button class="btn btn-icon btn-xs" onclick={() => moveDashboardSection(s.id, 1)} disabled={i === layout.length - 1} data-tooltip={tr('app.tooltipMoveDown', '下移')} aria-label={tr('app.tooltipMoveDown', '下移')}>
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
            <label>{tr('settings.cardTitle', '卡片常显标题')}</label>
            <p class="form-hint mt-0">{tr('settings.cardTitleHint', '是否在卡片底部始终显示标题文字')}</p>
            <div class="dashboard-layout-list" style="margin-top:0.75rem">
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsCardTitleLibrary" bind:checked={cardTitleLibrary}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('library.title', '动漫库')}</span>
              </div>
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsCardTitleMylist" bind:checked={cardTitleMylist}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('mylist.title', '我的列表')}</span>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>{tr('settings.detailTitleBg', '详情页标题背景')}</label>
            <p class="form-hint mt-0">{tr('settings.detailTitleBgHint', '浅色模式下在标题文字后添加半透明白色背景，提升深色场景下的可读性')}</p>
            <div class="dashboard-layout-list" style="margin-top:0.75rem">
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsDetailTitleBg" bind:checked={detailTitleBg}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('settings.titleBackground', '标题背景')}</span>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>{tr('settings.progressConfirm', '进度确认')}</label>
            <p class="form-hint mt-0">{tr('settings.progressConfirmHint', '观看进度超过90%未标记时')}</p>
            <div class="seg-radio-group" style="margin-top:0.75rem">
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="prompt" bind:group={finishConfirmMode}>
                <span>{tr('settings.confirmPrompt', '弹窗确认')}</span>
              </label>
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="auto" bind:group={finishConfirmMode}>
                <span>{tr('settings.autoMarkOption', '自动标记')}</span>
              </label>
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="off" bind:group={finishConfirmMode}>
                <span>{tr('settings.doNothing', '不处理')}</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Tab: 数据库 -->
        <div class="settings-panel" class:active={activeTab === 'database'} id="tab-database">
          <div class="form-group">
            <label>{tr('settings.dbOverview', '数据库概览')}</label>
            <div id="dbInfoContainer">
              {#if !dbLoaded}
                <p class="form-hint">{tr('common.loading', '加载中...')}</p>
              {:else if dbInfoError}
                <p class="form-hint text-error">{dbInfoError}</p>
              {:else if dbInfo}
                <div class="db-info-grid">
                  <div class="db-info-item db-info-item--full"><span class="db-info-label">{tr('app.dbLocation', '数据库位置')}</span><span class="db-info-value db-info-path" data-tooltip={dbInfo.dbPath}>{dbInfo.dbPath}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.dbSize', '数据库大小')}</span><span class="db-info-value">{formatSize(dbInfo.dbSize)}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.animeCount', '动漫数')}</span><span class="db-info-value">{dbInfo.counts.anime}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.episodeCount', '剧集数')}</span><span class="db-info-value">{dbInfo.counts.episodes}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.playSessionCount', '播放记录')}</span><span class="db-info-value">{dbInfo.counts.playSessions}</span></div>
                  <div class="db-info-item"><span class="db-info-label">{tr('app.myListCount', '我的列表')}</span><span class="db-info-value">{dbInfo.counts.myList}</span></div>
                </div>
              {/if}
            </div>
          </div>

          <div class="form-group">
            <label>{tr('settings.backupRestore', '备份与恢复')}</label>
            <div class="db-action-row">
              <button class="btn btn-sm" onclick={dbBackup} id="btnDbBackup">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8"/><path d="M5 5l3-3 3 3"/><path d="M8 2v9"/></svg>
                <span>{tr('settings.downloadDbBackup', '下载 DB 备份')}</span>
              </button>
              <button class="btn btn-sm" onclick={dbBackupAll} id="btnDbBackupAll">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8"/><path d="M5 5l3-3 3 3"/><path d="M8 2v9"/></svg>
                <span>{tr('settings.fullBackup', '完整备份（含配置）')}</span>
              </button>
              <button class="btn btn-sm" onclick={() => document.getElementById('restoreFileInput').click()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8"/><path d="M5 11l3 3 3-3"/><path d="M8 14V2"/></svg>
                <span>{tr('settings.restoreBackup', '恢复备份')}</span>
              </button>
              <input type="file" id="restoreFileInput" accept=".db" style="display:none" onchange={(e) => dbRestore(e.currentTarget)}>
            </div>
          </div>

          <div class="form-group">
            <label>{tr('settings.cacheManagement', '缓存管理')}</label>
            <p class="form-hint">{tr('settings.cacheHint', '系统会自动清理超过 14 天的缓存')}</p>
            <div id="dbCacheContainer">
              {#if !dbLoaded}
                <p class="form-hint">{tr('common.loading', '加载中...')}</p>
              {:else if cacheInfo}
                <div class="db-info-grid">
                  {#each Object.entries(cacheInfo) as [key, c]}
                    <div class="db-info-item">
                      <span class="db-info-label">{cacheLabel(key)}</span>
                      <span class="db-info-value">{formatSize(c.size)}</span>
                      <span class="db-info-label" style="margin-top:1px">{tr('app.cacheFilesCount', '{count} 个文件', { count: c.files })}</span>
                    </div>
                  {/each}
                </div>
                <div class="db-action-row mt-2">
                  <button class="btn btn-sm" onclick={() => dbClearCache('thumbs')} data-tooltip={tr('app.clearCacheTooltipThumbs', '清除视频缩略图缓存')}>{tr('app.clearCacheBtnThumbs', '清除缩略图')}</button>
                  <button class="btn btn-sm" onclick={() => dbClearCache('covers')} data-tooltip={tr('app.clearCacheTooltipCovers', '清除封面缓存')}>{tr('app.clearCacheBtnCovers', '清除封面')}</button>
                  <button class="btn btn-sm" onclick={() => dbClearCache('banners')} data-tooltip={tr('app.clearCacheTooltipBanners', '清除横幅缓存')}>{tr('app.clearCacheBtnBanners', '清除横幅')}</button>
                  <button class="btn btn-sm" onclick={() => dbClearCache('all')} data-tooltip={tr('app.clearCacheTooltipAll', '清除全部缓存')}>{tr('app.clearCacheBtnAll', '清除全部')}</button>
                </div>
              {:else}
                <p class="form-hint">{tr('app.noCacheData', '暂无缓存数据')}</p>
              {/if}
            </div>
          </div>

          <div class="form-group">
            <label>{tr('settings.maintenance', '维护操作')}</label>
            <div class="db-action-row">
              <button class="btn btn-sm" onclick={dbClearSessions} id="btnDbClearSessions">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h14"/><path d="M3 4v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4"/><path d="M6 4V2h4v2"/></svg>
                <span>{tr('settings.clearSessions', '清除播放记录')}</span>
              </button>
              <button class="btn btn-sm" onclick={dbVacuum} id="btnDbVacuum" data-tooltip={tr('settings.vacuumTooltip', '压缩数据库文件大小，回收已删除数据的磁盘空间')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="7"/><path d="M8 5v3"/><path d="M8 11h.01"/></svg>
                <span>{tr('settings.vacuum', '优化数据库（VACUUM）')}</span>
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="db-danger-label">{tr('settings.danger', '危险操作')}</label>
            <div class="db-action-row">
              <button class="btn btn-sm btn-danger" onclick={dbReset} id="btnDbReset">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l4 4"/><path d="M10 6l-4 4"/><circle cx="8" cy="8" r="7"/></svg>
                <span>{tr('settings.resetDb', '重置数据库')}</span>
              </button>
            </div>
            <p class="form-hint db-danger-hint">{tr('settings.resetDbHint', '重置会清空所有动漫数据、播放记录和列表。操作前会自动备份当前数据库。')}</p>
          </div>
        </div>
      </div>
      <div id="settingsError" class="error-msg">{errorMsg}</div>
      <div class="modal-actions">
        <button class="btn" onclick={close}>{tr('common.cancel', '取消')}</button>
        <button class="btn btn-primary" onclick={saveSettings}>{tr('common.save', '保存')}</button>
      </div>
    </div>
  </div>
{/if}