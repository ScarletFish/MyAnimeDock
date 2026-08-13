// Settings modal + Bangumi auth/sync + player dropdown (搬移自 app.js —— 零逻辑改动)

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
    showToast(t('app.loadSettingsFailed', { error: e.message }), 'error');
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
      if (statusEl) { statusEl.textContent = t('app.boundUser', { username: state.username || '' }); statusEl.style.color = '#22c55e'; }
      if (bindBtn) bindBtn.style.display = 'none';
      if (unbindBtn) unbindBtn.style.display = '';
      if (syncBtn) syncBtn.style.display = '';
      if (syncStatus) {
        if (state.lastSyncTime) {
          const t = new Date(state.lastSyncTime);
          syncStatus.textContent = t('app.lastSync', { time: t.toLocaleString('zh-CN') });
          syncStatus.style.display = '';
        } else {
          syncStatus.textContent = '';
          syncStatus.style.display = 'none';
        }
      }
    } else if (state.hasCredentials) {
      if (statusEl) { statusEl.textContent = t('app.clientIdEnteredCanBind'); statusEl.style.color = 'var(--text3)'; }
      if (bindBtn) bindBtn.style.display = '';
      if (unbindBtn) unbindBtn.style.display = 'none';
      if (syncBtn) syncBtn.style.display = 'none';
    } else {
      if (statusEl) { statusEl.textContent = t('app.enterClientIdSecretToBind'); statusEl.style.color = 'var(--text3)'; }
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
  syncBtn.textContent = t('app.syncing');
  syncStatus.textContent = t('app.syncingMyList');
  syncStatus.style.display = '';
  try {
    const result = await API.post('/api/bangumi/sync', {});
    if (result.errors && result.errors.length > 0) {
      syncStatus.textContent = t('app.syncCompleteWithErrors', { created: result.created, pushed: result.pushed, errors: result.errors.length });
      syncStatus.style.color = '#f59e0b';
    } else {
      syncStatus.textContent = t('app.syncComplete', { pulled: result.pulled, created: result.created, pushed: result.pushed });
      syncStatus.style.color = '#22c55e';
    }
    if (result.lastSyncTime) {
      refreshBangumiAuthStatus();
    }
  } catch (e) {
    syncStatus.textContent = t('app.syncFailed', { error: e.message });
    syncStatus.style.color = '#ef4444';
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = t('app.syncMyList');
  }
}

async function bangumiBind() {
  const clientId = document.getElementById('bangumiClientId').value.trim();
  let clientSecret = document.getElementById('bangumiClientSecret').value.trim();
  if (!clientId) {
    showToast(t('app.enterBangumiClientId'), 'warning');
    return;
  }
  // 如果 secret 仍是占位符掩码，则沿用已保存的值
  if (clientSecret === '••••••••') {
    clientSecret = configCache?.bangumiClientSecret || '';
  }
  if (!clientSecret) {
    showToast(t('app.enterBangumiClientSecret'), 'warning');
    return;
  }
  // Save OAuth creds first (saveSettings may not be called)
  await API.post('/api/bangumi/auth/creds', { clientId, clientSecret });
  // Get OAuth URL and open browser
  const { url } = await API.get('/api/bangumi/auth/url');
  if (!url) {
    showToast(t('app.cannotGenerateAuthUrl'), 'error');
    return;
  }
  // Tauri 中用 shell.open 打开系统默认浏览器，浏览器环境用 window.open
  if (window.__TAURI__?.shell?.open) {
    try {
      await window.__TAURI__.shell.open(url);
    } catch (e) {
      showToast(t('app.openBrowserFailed', { error: e.message }), 'error');
      return;
    }
  } else {
    window.open(url, '_blank');
  }
  showToast(t('app.completeBangumiAuthInBrowser'), 'info');
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
        showToast(t('app.bangumiBindSuccess'), 'success');
        refreshBangumiAuthStatus();
      }
    } catch {}
    if (attempts >= maxAttempts) {
      clearInterval(authPollTimer);
      authPollTimer = null;
      showToast(t('app.bindTimeoutCheckAuthPage'), 'warning');
    }
  }, 2000);
}

async function bangumiUnbind() {
  await API.post('/api/bangumi/auth/logout');
  refreshBangumiAuthStatus();
  showToast(t('app.bangumiUnbound'), 'info');
}

async function saveSettings() {
  const mediaDir = document.getElementById('settingsMediaDir').value.trim();
  const playerMode = document.getElementById('playerModeDropdown')?.dataset.playerMode || 'mpv';
  const mpvPath = document.getElementById('settingsPlayerPath').value.trim();

  if (!mediaDir) {
    document.getElementById('settingsError').textContent = t('app.enterMediaDirPath');
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

    showToast(t('app.settingsSaved'), 'success');
    refreshDiscovery();
  } catch (e) {
    document.getElementById('settingsError').textContent = t('app.saveFailed', { error: e.message });
  }
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
      ? t('app.currentPath', { path: currentPath })
      : t('app.autoSearchPath');
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
  const name = { mpv: t('app.playerNameMpv'), vlc: t('app.playerNameVlc'), mpchc: t('app.playerNameMpchc') }[mode] || t('app.playerNameGeneric', { name: mode });
  try {
    const result = await openDialog({
      multiple: false,
      title: t('app.selectPlayer', { name: name }),
      filters: [{ name: t('app.executableFileFilter'), extensions: ['exe', 'com'] }]
    });
    if (result) {
      document.getElementById('settingsPlayerPath').value = result;
    } else if (!window.__TAURI__) {
      showToast(t('app.browserModeEnterPathManually'), 'info');
    }
  } catch (e) {
    showToast(t('app.selectFileFailed', { error: e.message }), 'error');
  }
}

async function browseFolder(inputId) {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t('app.selectMediaDir')
    });
    if (selected) {
      document.getElementById(inputId).value = selected;
    } else if (!window.__TAURI__) {
      showToast(t('app.browserModeEnterPathManually'), 'info');
    }
  } catch (e) {
    showToast(t('app.selectDirFailed', { error: e.message }), 'error');
  }
}

// ─── Open external URL (Tauri-safe) ───
function openExternalUrl(url) {
  if (window.__TAURI__?.shell?.open) {
    window.__TAURI__.shell.open(url).catch(() => {
      showToast(t('app.openBrowserFailedGeneric'), 'error');
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

// ─── ESM exports for onclick handlers ───
window.openSettings = openSettings;
window.saveSettings = saveSettings;
window.browseFolder = browseFolder;
window.switchSettingsTab = switchSettingsTab;
