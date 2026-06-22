// Main app logic
let currentView = 'library';
let configCache = null;

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

  currentView = view;

  if (view !== 'detail') {
    resetDetailEnter();
    if (typeof stopDetailRefresh === 'function') stopDetailRefresh();
  }

  // Load data for view
  if (view === 'discovery') loadDiscovery();
  if (view === 'metamatch') mmLoadData();
  if (view === 'library') loadLibrary();
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
