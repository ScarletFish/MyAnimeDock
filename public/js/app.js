// Main app logic
let currentView = 'discovery';
let configCache = null;

function showView(view) {
  const views = ['discovery', 'library', 'memories', 'detail'];
  for (const v of views) {
    const el = document.getElementById(v + 'View');
    if (el) el.classList.toggle('hidden', v !== view);
  }

  // Update sidebar active state
  document.getElementById('btnDiscovery').classList.toggle('active', view === 'discovery');
  document.getElementById('btnLibrary').classList.toggle('active', view === 'library');
  document.getElementById('btnMemories').classList.toggle('active', view === 'memories');

  currentView = view;

  if (view !== 'detail') {
    resetDetailEnter();
    if (typeof stopDetailRefresh === 'function') stopDetailRefresh();
  }

  // Load data for view
  if (view === 'discovery') loadDiscovery();
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

// Settings
async function openSettings() {
  try {
    const config = await API.get('/api/config');
    configCache = config;
    document.getElementById('settingsMediaDir').value = config.mediaDir || '';
    document.getElementById('settingsTheme').value = localStorage.getItem('theme') || config.theme || 'dark';
    document.getElementById('settingsPlayerMode').value = config.playerMode || 'system';
    document.getElementById('settingsMpvPath').value = config.mpvPath || 'mpv';
    document.getElementById('mpvPathGroup').style.display =
      config.playerMode === 'mpv' ? '' : 'none';
    document.getElementById('settingsError').textContent = '';
    document.getElementById('settingsModal').classList.add('show');
  } catch (e) {
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

  if (!mediaDir) {
    document.getElementById('settingsError').textContent = '请输入媒体目录路径';
    return;
  }

  try {
    await API.post('/api/config', { mediaDir, playerMode, mpvPath, theme });
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

// Quit - auto close browser page
async function quitApp() {
  if (!confirm('确定要退出吗？')) return;
  try {
    const res = await API.post('/api/quit');
    if (res.shutdown) {
      // Server is shutting down, close this tab
      window.close();
      // Fallback: show message if window.close() is blocked
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:20px;color:#999">服务器已停止，可以关闭此页面</div>';
    }
  } catch (e) {
    // Server already stopped
    window.close();
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:20px;color:#999">服务器已停止</div>';
  }
}

function goBack() {
  if (typeof stopDetailRefresh === 'function') stopDetailRefresh();
  showView('library');
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
  try {
    configCache = await API.get('/api/config');
  } catch (_) {}
  loadTheme();
  showView('discovery');
});
