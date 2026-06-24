// Main app logic
let currentView = 'library';
let configCache = null;
let libraryScrollTop = 0;

function showView(view) {
  const views = ['discovery', 'metamatch', 'library', 'memories', 'detail'];
  for (const v of views) {
    const el = document.getElementById(v + 'View');
    if (el) el.classList.toggle('hidden', v !== view);
  }

  // Update sidebar active state
  document.getElementById('btnDiscovery').classList.toggle('active', view === 'discovery');
  document.getElementById('btnMetaMatch').classList.toggle('active', view === 'metamatch');
  document.getElementById('btnLibrary').classList.toggle('active', view === 'library');
  document.getElementById('btnMemories').classList.toggle('active', view === 'memories');

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
  if (view === 'metamatch') mmLoadData();
  if (view === 'library') {
    loadLibrary();
    // Restore scroll after render
    requestAnimationFrame(() => { if (mc) mc.scrollTop = libraryScrollTop; });
  }
  if (view === 'memories') loadMemories();
}

// Theme
function loadTheme() {
  const theme = localStorage.getItem('theme') || configCache?.theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function applyTheme(theme) {
  localStorage.setItem('theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
}

// Zoom via root rem scaling
function applyZoom(scale) {
  document.documentElement.style.fontSize = (16 * (scale || 1)) + 'px';
}

// Settings
async function openSettings() {
  try {
    const config = await API.get('/api/config');
    configCache = config;
    document.getElementById('settingsMediaDir').value = config.mediaDir || '';
    document.getElementById('settingsTheme').value = localStorage.getItem('theme') || config.theme || 'dark';
    document.getElementById('settingsZoom').value = Math.round((config.uiScale || 1) * 100);
    document.getElementById('zoomLabel').textContent = document.getElementById('settingsZoom').value + '%';
    document.getElementById('settingsPlayerMode').value = config.playerMode || 'system';
    document.getElementById('settingsMpvPath').value = config.mpvPath || '';
    document.getElementById('mpvPathGroup').style.display =
      config.playerMode === 'mpv' ? '' : 'none';
    document.getElementById('settingsAutoMark').checked = config.autoMarkWatched !== false;
    document.getElementById('settingsError').textContent = '';

    // Load scraper settings
    const sources = config.apiSources || [];
    const bangumiSrc = sources.find(s => s.type === 'bangumi');
    const anilistSrc = sources.find(s => s.type === 'anilist');
    document.getElementById('bangumiUrl').value = bangumiSrc?.url || 'https://api.bangumi.one';
    document.getElementById('anilistEnabled').checked = !!anilistSrc;

    document.getElementById('settingsModal').classList.add('show');
  } catch (e) {
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载设置失败: ' + e.message);
  }
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('show');
}

async function saveSettings() {
  const mediaDir = document.getElementById('settingsMediaDir').value.trim();
  const theme = document.getElementById('settingsTheme').value;
  const playerMode = document.getElementById('settingsPlayerMode').value;
  const mpvPath = document.getElementById('settingsMpvPath').value.trim();

  applyTheme(theme);
  applyZoom(document.getElementById('settingsZoom').value / 100);

  if (!mediaDir) {
    document.getElementById('settingsError').textContent = '请输入媒体目录路径';
    return;
  }

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
    await API.post('/api/config', {
      mediaDir,
      playerMode,
      mpvPath,
      theme,
      uiScale: parseInt(document.getElementById('settingsZoom').value) / 100,
      autoMarkWatched: document.getElementById('settingsAutoMark').checked,
      apiSources,
    });
    showToast('设置已保存');
    closeSettings();
    refreshDiscovery();
  } catch (e) {
    document.getElementById('settingsError').textContent = '保存失败: ' + e.message;
  }
}

// Player mode toggle
document.getElementById('settingsPlayerMode').addEventListener('change', function() {
  document.getElementById('mpvPathGroup').style.display =
    this.value === 'mpv' ? '' : 'none';
});

function goBack() {
  if (typeof stopDetailRefresh === 'function') stopDetailRefresh();
  isArchiveMode = false;
  const layoutEl = document.querySelector('.detail-layout');
  if (layoutEl) layoutEl.classList.remove('detail-layout--archive');
  const target = typeof detailSourceView !== 'undefined' ? detailSourceView : 'library';
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

// Utility
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// path helper for cover URLs
const path = {
  basename(p) {
    if (!p) return '';
    return p.split(/[\\/]/).pop();
  }
};

// ─── Native file/directory dialogs (Tauri) ───

async function openDialog(options) {
  // Tauri v2 withGlobalTauri: plugin API 直接挂载在 __TAURI__.dialog
  if (window.__TAURI__?.dialog?.open) {
    return await window.__TAURI__.dialog.open(options);
  }
  // 回退：raw invoke
  if (window.__TAURI__?.invoke) {
    return await window.__TAURI__.invoke('plugin:dialog:open', { options });
  }
  if (window.__TAURI__?.core?.invoke) {
    return await window.__TAURI__.core.invoke('plugin:dialog:open', { options });
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
  applyZoom(configCache?.uiScale || 1);
  initSortSelect();
  showView('library');
});
