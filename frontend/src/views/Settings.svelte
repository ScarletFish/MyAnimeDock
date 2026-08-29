<script module>
  // ─── Settings 视图（Svelte 迁移版）───
  // 渐进迁移的第一个视图：把 index.html 的 #settingsModal + src/js/settings.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  import { writable } from 'svelte/store';

  // 跨组件打开开关：调用方直接 import settingsOpen 并 set(true)
  export const settingsOpen = writable(false);
  // 跨组件指定初始标签页：调用方直接 import settingsTab 并 set(tab)
  export const settingsTab = writable(null);

  // Bangumi 授权状态刷新入口：实例脚本挂载时注册，main.js 的 OAuth 回调 import 调用。
  let _refreshBangumiAuthStatus = null;
  export function setRefreshBangumiAuthStatus(fn) { _refreshBangumiAuthStatus = fn; }
  export function refreshBangumiAuthStatus() {
    if (_refreshBangumiAuthStatus) _refreshBangumiAuthStatus();
  }
</script>

<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';
  import { openVisualDock } from '../components/ThemeDock.svelte';
  import { tr } from '../lib/anime-utils.js';
  import { API as api } from '../lib/api.js';
  import { portal } from '../lib/portal.js';
  import MikanTagEditorModal from '../components/MikanTagEditorModal.svelte';
  import { Select } from 'bits-ui';
  import BrandMark from '../components/BrandMark.svelte';
  import { applyDetailTitleBg } from '../lib/theme.js';
  import { cardTitleLibrary, cardTitleMylist, finishConfirmMode, detailTitleBg } from '../lib/ui-state.js';

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
  let autoMark = $state(true);
  // scraper
  let bangumiUrl = $state('https://api.bgm.tv');
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
  let cardTitleLibraryLocal = $state(false);
  let cardTitleMylistLocal = $state(false);
  let detailTitleBgLocal = $state(false);
  let finishConfirmModeLocal = $state('prompt');
  // dashboard layout
  let layout = $state([]);
  let dragState = $state(null);
  // database
  let dbInfo = $state(null);
  let cacheInfo = $state(null);
  let dbLoaded = $state(false);
  let dbInfoError = $state('');
  // qBittorrent
  let qbPort = $state(8080);
  let qbUsername = $state('admin');
  let qbPassword = $state('');
  let qbPasswordSet = $state(false);
  let showPassword = $state(false);
  let qbStatus = $state(null); // { ok, version, error } | null
  // 蜜柑计划
  let mikanMirror = $state('https://mikanime.tv');
  let mikanInclude = $state([]);
  let mikanExclude = $state([]);
  let mikanLangOptions = $state([]);

  function isRegexValid(r) {
    try {
      new RegExp(r);
      return true;
    } catch {
      return false;
    }
  }

  // 蜜柑正则 Tag 库编辑器（弹窗）
  let editorOpen = $state(false);
  let editorMode = $state('include');
  let editorTag = $state(null);

  function openEditor(mode, tag) {
    editorMode = mode;
    editorTag = tag;
    editorOpen = true;
  }

  // 语言编辑器：复用弹窗，直接传入 label（纯文本，非 i18n key）
  function openLangEditor(lang) {
    openEditor('lang', lang ? { key: lang.key, name: lang.label, regex: lang.regex } : null);
  }

  function nextLangBit() {
    const bits = mikanLangOptions.map((l) => l.bit);
    let b = 1;
    while (bits.includes(b)) b <<= 1;
    return b;
  }

  function handleTagSave(data) {
    if (editorMode === 'include') {
      const i = mikanInclude.findIndex((t) => t.key === data.key);
      mikanInclude = i >= 0 ? mikanInclude.map((t) => (t.key === data.key ? data : t)) : [...mikanInclude, data];
    } else if (editorMode === 'exclude') {
      const i = mikanExclude.findIndex((t) => t.key === data.key);
      mikanExclude = i >= 0 ? mikanExclude.map((t) => (t.key === data.key ? data : t)) : [...mikanExclude, data];
    } else if (editorMode === 'lang') {
      const i = mikanLangOptions.findIndex((l) => l.key === data.key);
      const saved = { key: data.key, label: data.name, regex: data.regex };
      if (i >= 0) {
        const existing = mikanLangOptions[i];
        mikanLangOptions = mikanLangOptions.map((l) => (l.key === data.key ? { ...saved, bit: existing.bit } : l));
      } else {
        mikanLangOptions = [...mikanLangOptions, { ...saved, bit: nextLangBit() }];
      }
    }
    editorOpen = false;
  }

  function handleTagDelete(key) {
    if (editorMode === 'include') mikanInclude = mikanInclude.filter((t) => t.key !== key);
    else if (editorMode === 'exclude') mikanExclude = mikanExclude.filter((t) => t.key !== key);
    else if (editorMode === 'lang') mikanLangOptions = mikanLangOptions.filter((l) => l.key !== key);
    // 级联：被删项若被默认启用引用，一并移出，避免悬空引用
    mikanDefaultRequired = mikanDefaultRequired.filter((k) => k !== key);
    mikanDefaultExcluded = mikanDefaultExcluded.filter((k) => k !== key);
    editorOpen = false;
  }

  // ─── 默认启用（引用已有 tag / 语言，不新建）───
  let mikanDefaultRequired = $state([]);
  let mikanDefaultExcluded = $state([]);

  function defaultItemName(key) {
    const lang = mikanLangOptions.find((l) => l.key === key);
    if (lang) return lang.label;
    const tag = [...mikanInclude, ...mikanExclude].find((t) => t.key === key);
    return tag ? tag.name : key;
  }

  function addDefaultRequired(key) {
    if (key && !mikanDefaultRequired.includes(key)) mikanDefaultRequired = [...mikanDefaultRequired, key];
  }
  function addDefaultExcluded(key) {
    if (key && !mikanDefaultExcluded.includes(key)) mikanDefaultExcluded = [...mikanDefaultExcluded, key];
  }
  function removeDefaultRequired(key) {
    mikanDefaultRequired = mikanDefaultRequired.filter((k) => k !== key);
  }
  function removeDefaultExcluded(key) {
    mikanDefaultExcluded = mikanDefaultExcluded.filter((k) => k !== key);
  }

  let configCache = $state(null);
  let authPollTimer = null;
  const fieldErrors = $state({});

  // ─── 打开/关闭 + body 滚动锁定 ───
  $effect(() => {
    if ($settingsOpen) {
      document.body.style.overflow = 'hidden';
      loadSettings();
    } else {
      document.body.style.overflow = '';
    }
  });

  // ─── 外部指定初始标签页（调用方 import settingsTab 后 set）───
  $effect(() => {
    if ($settingsTab) {
      activeTab = $settingsTab;
      settingsTab.set(null);
    }
  });

  onMount(() => {
    // 注册 Bangumi 授权状态刷新入口：main.js 的 OAuth 回调处理 import 调用。
    setRefreshBangumiAuthStatus(() => refreshBangumiAuthStatus());
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

  // ─── 后端校验（blur 时调用） ───
  async function onFieldBlur(field, value) {
    try {
      const res = await api.post('/api/config/validate', { field, value });
      if (res.ok) {
        delete fieldErrors[field];
        // 回填 normalize 后的值（mediaDir/mpvPath/bangumiUrl）
        if (res.normalized !== undefined) {
          if (field === 'mediaDir') mediaDir = res.normalized;
          else if (field === 'mpvPath') mpvPath = res.normalized;
          else if (field === 'bangumiUrl') bangumiUrl = res.normalized;
        }
      } else {
        fieldErrors[field] = res.error;
      }
    } catch {
      delete fieldErrors[field];
    }
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
      bangumiUrl = bangumiSrc?.url || 'https://api.bgm.tv';

      if (config.bangumiClientId) bangumiClientId = config.bangumiClientId;
      bangumiClientSecret = '••••••••';
      refreshBangumiAuthStatus();

      cardTitleLibraryLocal = get(cardTitleLibrary);
      cardTitleMylistLocal = get(cardTitleMylist);
      renderDashboardLayoutSettings();

      detailTitleBgLocal = get(detailTitleBg);
      applyDetailTitleBg();

      // qBittorrent
      qbPort = config.qbPort || 8080;
      qbUsername = config.qbUsername || 'admin';
      qbPassword = '';
      qbPasswordSet = !!config.qbPasswordSet;
      qbStatus = null;

      // 蜜柑计划
      mikanMirror = config.mikanMirror || 'https://mikanime.tv';
      mikanInclude = config.mikanTagLibrary?.include || [];
      mikanExclude = config.mikanTagLibrary?.exclude || [];
      mikanLangOptions = config.mikanLangOptions || [];
      mikanDefaultRequired = config.mikanDefaultRequired || [];
      mikanDefaultExcluded = config.mikanDefaultExcluded || [];

      let mode = get(finishConfirmMode);
      if (mode === 'on') mode = 'prompt';
      finishConfirmModeLocal = mode;

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

  // ─── qBittorrent 测试连接 ───
  async function testQbConnection() {
    qbStatus = { testing: true };
    try {
      const res = await api.post('/api/qb/test', {
        port: Number(qbPort) || 8080,
        username: qbUsername || 'admin',
        password: qbPassword || '',
      });
      qbStatus = res;
    } catch (e) {
      qbStatus = { ok: false, error: e.message };
    }
  }

  // ─── 表单保存 ───
  async function saveSettings() {
    if (!mediaDir.trim()) {
      errorMsg = tr('app.enterMediaDirPath');
      return;
    }
    // 蜜柑正则 Tag 库：校验每条正则是否合法
    for (const tag of [...mikanInclude, ...mikanExclude, ...mikanLangOptions]) {
      if (!isRegexValid(tag.regex)) {
        errorMsg = tr('settings.mikanTagInvalidRegex');
        return;
      }
    }
    if (Object.keys(fieldErrors).length > 0) return;

    const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = rawTheme === 'dark' || rawTheme === 'light' ? 'default' : rawTheme;
    const newThemeMode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
    const currentZoom = parseFloat(document.documentElement.style.getPropertyValue('--scale')) || 1;

    const apiSources = [
      { type: 'bangumi', url: bangumiUrl.trim() || 'https://api.bgm.tv', key: '' },
      { type: 'anilist', url: 'https://graphql.anilist.co', key: '' },
    ];

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
        qbPort: Number(qbPort) || 8080,
        qbUsername: qbUsername || 'admin',
        qbPassword: qbPassword || '',
        mikanMirror: mikanMirror.trim() || 'https://mikanime.tv',
        mikanTagLibrary: { include: mikanInclude, exclude: mikanExclude },
        mikanLangOptions,
        mikanDefaultRequired,
        mikanDefaultExcluded,
        ...(bangumiClientId ? { bangumiClientId } : {}),
        ...(secretToSend ? { bangumiClientSecret: secretToSend } : {}),
      });

      cardTitleLibrary.set(cardTitleLibraryLocal);
      cardTitleMylist.set(cardTitleMylistLocal);
      detailTitleBg.set(detailTitleBgLocal);
      applyDetailTitleBg();
      finishConfirmMode.set(finishConfirmModeLocal);

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

  function notifyDashboardLayoutChanged() {
    document.dispatchEvent(new CustomEvent('dashboard-layout-changed'));
  }

  function toggleDashboardSection(id, enabled) {
    const l = getDashboardLayout();
    const s = l.find((x) => x.id === id);
    if (s) s.enabled = enabled;
    saveDashboardLayout(l);
    renderDashboardLayoutSettings();
    notifyDashboardLayoutChanged();
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
    notifyDashboardLayoutChanged();
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
    notifyDashboardLayoutChanged();
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
  <div class="modal-overlay show" id="settingsModal" use:portal onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="modal modal--settings">
      <div class="settings-header">
        <div class="settings-header-top">
          <h2>{tr('common.settings')}</h2>
          <button
            class="btn-icon visual-settings-btn"
            onclick={() => { close(); openVisualDock(); }}
            data-tooltip={tr('nav.themeVisual')}
            aria-label={tr('nav.themeVisual')}
          >
            <BrandMark />
            <span>{tr('settings.visual')}</span>
          </button>
        </div>
        <nav class="settings-tabs" role="tablist">
          <button class="settings-tab" class:active={activeTab === 'basic'} role="tab" aria-selected={activeTab === 'basic'} onclick={() => switchSettingsTab('basic')}>{tr('settings.tabBasic')}</button>
          <button class="settings-tab" class:active={activeTab === 'personalize'} role="tab" aria-selected={activeTab === 'personalize'} onclick={() => switchSettingsTab('personalize')}>{tr('settings.tabPersonalize')}</button>
          <button class="settings-tab" class:active={activeTab === 'dashboard'} role="tab" aria-selected={activeTab === 'dashboard'} onclick={() => switchSettingsTab('dashboard')}>{tr('settings.tabDashboard')}</button>
          <button class="settings-tab" class:active={activeTab === 'downloader'} role="tab" aria-selected={activeTab === 'downloader'} onclick={() => switchSettingsTab('downloader')}>{tr('settings.tabDownloader')}</button>
          <button class="settings-tab" class:active={activeTab === 'database'} role="tab" aria-selected={activeTab === 'database'} onclick={() => switchSettingsTab('database')}>{tr('settings.tabDatabase')}</button>
        </nav>
      </div>
      <div class="settings-panels">
        <!-- Tab: 基本 -->
        <div class="settings-panel" class:active={activeTab === 'basic'} id="tab-basic">
          <div class="form-group">
            <label for="settingsMediaDir">{tr('settings.mediaDir')}</label>
            <div class="input-with-btn">
              <input type="text" id="settingsMediaDir" placeholder="E:/Anime" bind:value={mediaDir} onblur={() => onFieldBlur('mediaDir', mediaDir)} class:invalid={fieldErrors.mediaDir}>
              <button class="btn btn-sm" onclick={browseFolder}>{tr('common.browse')}</button>
            </div>
            {#if fieldErrors.mediaDir}<span class="field-error">{fieldErrors.mediaDir}</span>{/if}
          </div>
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
              <input type="text" id="settingsPlayerPath" placeholder={tr('settings.playerPathPlaceholder')} bind:value={mpvPath} onblur={() => onFieldBlur('mpvPath', mpvPath)} class:invalid={fieldErrors.mpvPath} data-tooltip={mpvPath || ''}>
              <button class="btn btn-sm" onclick={browsePlayerExecutable}>{tr('common.browse')}</button>
            </div>
            {#if fieldErrors.mpvPath}<span class="field-error">{fieldErrors.mpvPath}</span>{/if}
          </div>
          <div class="form-group">
            <label for="bangumiUrl">{tr('settings.bangumiApi')}</label>
            <input type="text" id="bangumiUrl" placeholder="https://api.bgm.tv" bind:value={bangumiUrl} onblur={() => onFieldBlur('bangumiUrl', bangumiUrl)} class:invalid={fieldErrors.bangumiUrl}>
            {#if fieldErrors.bangumiUrl}<span class="field-error">{fieldErrors.bangumiUrl}</span>{/if}
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
          <div class="form-group">
            <label>{tr('settings.progressConfirm')}</label>
            <p class="form-hint mt-0">{tr('settings.progressConfirmHint')}</p>
            <div class="seg-radio-group" style="margin-top:0.75rem">
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="prompt" bind:group={finishConfirmModeLocal}>
                <span>{tr('settings.confirmPrompt')}</span>
              </label>
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="auto" bind:group={finishConfirmModeLocal}>
                <span>{tr('settings.autoMarkOption')}</span>
              </label>
              <label class="seg-radio-item">
                <input type="radio" name="settingsFinishConfirmMode" value="off" bind:group={finishConfirmModeLocal}>
                <span>{tr('settings.doNothing')}</span>
              </label>
            </div>
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
                  <input type="checkbox" id="settingsCardTitleLibrary" bind:checked={cardTitleLibraryLocal}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('library.title')}</span>
              </div>
              <div class="dashboard-layout-item" style="cursor:default">
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" id="settingsCardTitleMylist" bind:checked={cardTitleMylistLocal}>
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
                  <input type="checkbox" id="settingsDetailTitleBg" bind:checked={detailTitleBgLocal}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="dashboard-layout-label">{tr('settings.titleBackground')}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab: 下载器 -->
        <div class="settings-panel" class:active={activeTab === 'downloader'} id="tab-downloader">
          <div class="form-group">
            <label>qBittorrent</label>
            <div class="qb-config">
              <div class="form-group">
                <label>{tr('settings.qbPort')}</label>
                <input type="text" id="qbPort" bind:value={qbPort}>
              </div>
              <div class="form-group">
                <label>{tr('settings.qbUsername')}</label>
                <input type="text" id="qbUsername" bind:value={qbUsername}>
              </div>
              <div class="form-group">
                <label>{tr('settings.qbPassword')}</label>
                <div class="password-input-wrapper">
                  <input type={showPassword ? 'text' : 'password'} id="qbPassword" bind:value={qbPassword} placeholder={qbPasswordSet ? tr('settings.qbPasswordSetHint') : ''}>
                  <button type="button" class="password-toggle-btn" onclick={() => showPassword = !showPassword}>
                    {#if showPassword}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    {:else}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    {/if}
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label>{tr('settings.qbTest')}</label>
                <div class="qb-test-row">
                  <button class="qb-test-btn" onclick={testQbConnection} disabled={qbStatus?.testing} aria-label={tr('settings.qbTest')}>
                    {#if qbStatus?.testing}
                      <svg class="spinning" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                      </svg>
                    {:else}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2a10 10 0 1 0 10 10"/>
                        <path d="M12 12l5-5"/>
                        <circle cx="12" cy="12" r="1" fill="currentColor"/>
                      </svg>
                    {/if}
                  </button>
                  {#if qbStatus && !qbStatus.testing}
                    {#if qbStatus.ok}
                      <span class="qb-test-status qb-test-success">{tr('settings.qbConnected', { version: qbStatus.version })}</span>
                    {:else}
                      <span class="qb-test-status qb-test-error">{qbStatus.error || tr('settings.qbFailed')}</span>
                    {/if}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>蜜柑计划</label>
            <p class="form-hint mt-0">{tr('settings.mikanMirrorHint')}</p>
            <input type="text" id="mikanMirror" placeholder="https://mikanime.tv" bind:value={mikanMirror}>
          </div>
          <div class="form-group">
            <label>{tr('settings.mikanTagLibrary')}</label>

            <div class="mikan-lib-source">
              <div class="mikan-lib-block">
                <h4 class="mikan-lib-heading">{tr('settings.mikanLangHeading')}</h4>
                <div class="mikan-lib-chips">
                  {#each mikanLangOptions as lang (lang.key)}
                    <button class="tag-pill" onclick={() => openLangEditor(lang)}>{lang.label}</button>
                  {/each}
                  <button class="tag-pill tag-pill--add" onclick={() => openLangEditor(null)}>+</button>
                </div>
              </div>

              <div class="mikan-lib-block">
                <h4 class="mikan-lib-heading">{tr('settings.mikanTagInclude')}</h4>
                <div class="mikan-lib-chips">
                  {#each mikanInclude as tag (tag.key)}
                    <button class="tag-pill" onclick={() => openEditor('include', tag)}>{tag.name}</button>
                  {/each}
                  <button class="tag-pill tag-pill--add" onclick={() => openEditor('include', null)}>+</button>
                </div>
              </div>

              <div class="mikan-lib-block">
                <h4 class="mikan-lib-heading">{tr('settings.mikanTagExclude')}</h4>
                <div class="mikan-lib-chips">
                  {#each mikanExclude as tag (tag.key)}
                    <button class="tag-pill tag-pill--exclude" onclick={() => openEditor('exclude', tag)}>{tag.name}</button>
                  {/each}
                  <button class="tag-pill tag-pill--add" onclick={() => openEditor('exclude', null)}>+</button>
                </div>
              </div>
            </div>

            <div class="mikan-lib-block mikan-default-block">
              <div class="mikan-lib-sub">
                <span class="mikan-lib-sub-label">{tr('settings.mikanDefaultRequired')}</span>
                <div class="mikan-lib-chips">
                  {#each mikanDefaultRequired as key (key)}
                    <button class="tag-pill" onclick={() => removeDefaultRequired(key)}>{defaultItemName(key)} ✕</button>
                  {/each}
                  <Select.Root type="single" bind:value={() => null, addDefaultRequired}>
                    <Select.Trigger class="tag-pill tag-pill--add">+</Select.Trigger>
                    <Select.Portal to="#modal-root">
                      <Select.Content class="mikan-add-dd" side="bottom" sideOffset={4}>
                        <Select.Group class="mikan-add-dd-group">
                          <div class="mikan-add-dd-label">{tr('settings.mikanTagInclude')}</div>
                          {#each mikanInclude.filter(t => !mikanDefaultRequired.includes(t.key) && !mikanDefaultExcluded.includes(t.key)) as tag}
                            <Select.Item value={tag.key} class="mikan-add-dd-item">{tag.name}</Select.Item>
                          {/each}
                        </Select.Group>
                        <Select.Group class="mikan-add-dd-group">
                          <div class="mikan-add-dd-label">{tr('mikan.lang')}</div>
                          {#each mikanLangOptions.filter(l => !mikanDefaultRequired.includes(l.key) && !mikanDefaultExcluded.includes(l.key)) as lang}
                            <Select.Item value={lang.key} class="mikan-add-dd-item">{lang.label}</Select.Item>
                          {/each}
                        </Select.Group>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>
              </div>

              <div class="mikan-lib-sub">
                <span class="mikan-lib-sub-label">{tr('settings.mikanDefaultExcluded')}</span>
                <div class="mikan-lib-chips">
                  {#each mikanDefaultExcluded as key (key)}
                    <button class="tag-pill tag-pill--exclude" onclick={() => removeDefaultExcluded(key)}>{defaultItemName(key)} ✕</button>
                  {/each}
                  <Select.Root type="single" bind:value={() => null, addDefaultExcluded}>
                    <Select.Trigger class="tag-pill tag-pill--add">+</Select.Trigger>
                    <Select.Portal to="#modal-root">
                      <Select.Content class="mikan-add-dd" side="bottom" sideOffset={4}>
                        <Select.Group class="mikan-add-dd-group">
                          <div class="mikan-add-dd-label">{tr('settings.mikanTagExclude')}</div>
                          {#each mikanExclude.filter(t => !mikanDefaultExcluded.includes(t.key) && !mikanDefaultRequired.includes(t.key)) as tag}
                            <Select.Item value={tag.key} class="mikan-add-dd-item">{tag.name}</Select.Item>
                          {/each}
                        </Select.Group>
                        <Select.Group class="mikan-add-dd-group">
                          <div class="mikan-add-dd-label">{tr('mikan.lang')}</div>
                          {#each mikanLangOptions.filter(l => !mikanDefaultExcluded.includes(l.key) && !mikanDefaultRequired.includes(l.key)) as lang}
                            <Select.Item value={lang.key} class="mikan-add-dd-item">{lang.label}</Select.Item>
                          {/each}
                        </Select.Group>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>
              </div>
            </div>

            <MikanTagEditorModal
              open={editorOpen}
              mode={editorMode}
              tag={editorTag}
              onSave={handleTagSave}
              onDelete={handleTagDelete}
              onCancel={() => editorOpen = false}
            />
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

<style>
  .mikan-lib-block { margin-top: 0.75rem; }
  .mikan-lib-block + .mikan-lib-block { margin-top: 0.5rem; }
  .mikan-lib-heading {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--fg-muted);
    letter-spacing: 0.02em;
  }
  .mikan-lib-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .mikan-lib-chips .tag-pill {
    font-size: var(--text-base);
    padding: var(--space-2) var(--space-3);
  }
  .mikan-lib-chips .tag-pill--add {
    padding: 0;
    flex: 0 0 auto;
  }
  .mikan-default-block .mikan-lib-sub {
    margin-top: var(--space-4);
  }
  .mikan-lib-sub-label {
    display: block;
    margin-bottom: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-muted);
    letter-spacing: 0.02em;
  }

  /* ── 分区容器：源定义区 vs 默认引用区 ── */
  .mikan-lib-source {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .mikan-lib-source .mikan-lib-block { margin-top: 0; }
  .mikan-lib-source .mikan-lib-block + .mikan-lib-block { margin-top: var(--space-3); }

  .mikan-default-block {
    margin-top: var(--space-4);
    padding: var(--space-4);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  /* ── 引用芯片视觉降级（非新增、非 +）：幽灵描边，从属于源定义 ── */
  .mikan-default-block .mikan-lib-chips .tag-pill:not(.tag-pill--add) {
    background: transparent;
    border: 1px dashed var(--fg-muted);
    color: var(--fg-muted);
  }
  .mikan-default-block .mikan-lib-chips .tag-pill--exclude:not(.tag-pill--add) {
    background: transparent;
    border-color: rgba(var(--warning-rgb), 0.55);
    color: var(--warning);
  }
  .mikan-default-block .mikan-lib-chips .tag-pill:not(.tag-pill--add):hover {
    border-color: var(--accent);
    color: var(--accent-soft);
    background: rgba(var(--accent-rgb), 0.06);
  }
</style>