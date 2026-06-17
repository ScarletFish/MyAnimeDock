// Main app logic
let currentView = 'library';
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
    document.getElementById('mpvPathGroup').style.display =
      config.playerMode === 'mpv' ? '' : 'none';
    document.getElementById('settingsAutoMark').checked = config.autoMarkWatched !== false;
    document.getElementById('settingsError').textContent = '';

    // Render API sources
    renderApiSources(config.apiSources || []);

    document.getElementById('settingsModal').classList.add('show');
  } catch (e) {
    showToast('加载设置失败: ' + e.message);
  }
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('show');
}

function renderApiSources(sources) {
  const container = document.getElementById('apiSourcesList');
  if (!container) return;

  if (sources.length === 0) {
    sources = [{ type: 'bangumi', url: 'https://api.bangumi.one', key: '' }];
  }

  let html = '';
  sources.forEach((src, i) => {
    const isBangumi = src.type === 'bangumi';
    const typeLabel = isBangumi ? 'Bangumi' : 'TMDB';
    html += `
      <div class="api-source-card" draggable="true" data-index="${i}"
        ondragstart="onApiSourceDragStart(event, ${i})"
        ondragover="onApiSourceDragOver(event)"
        ondrop="onApiSourceDrop(event, ${i})"
        ondragend="onApiSourceDragEnd(event)">
        <div class="api-source-drag" title="拖拽排序">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
        </div>
        <div class="api-source-body">
          <div class="api-source-type">
            <span class="api-source-badge api-source-badge--${isBangumi ? 'bangumi' : 'tmdb'}">${typeLabel}</span>
            <select class="api-source-type-select" onchange="onApiSourceTypeChange(${i}, this)">
              <option value="bangumi" ${isBangumi ? 'selected' : ''}>Bangumi</option>
              <option value="tmdb" ${!isBangumi ? 'selected' : ''}>TMDB</option>
            </select>
          </div>
          <div class="api-source-fields">
            <input type="text" class="api-source-url" value="${escAttr(src.url)}" placeholder="API 地址" onchange="onApiSourceChange(${i}, 'url', this.value)">
            <div class="api-source-key-row">
              <input type="${isBangumi ? 'text' : 'password'}" class="api-source-key" value="${escAttr(src.key || '')}" placeholder="${isBangumi ? '无需密钥（可选）' : 'API 密钥'}" onchange="onApiSourceChange(${i}, 'key', this.value)">
            </div>
          </div>
        </div>
        <button class="api-source-remove" onclick="removeApiSource(${i})" title="移除此源"
          ${sources.length <= 1 ? 'style="opacity:0.3"' : ''}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  });
  container.innerHTML = html;
  document.getElementById('settingsError').textContent = '';
}

function addApiSource(type) {
  const defaults = {
    bangumi: { type: 'bangumi', url: 'https://api.bangumi.one', key: '' },
    tmdb: { type: 'tmdb', url: 'https://api.themoviedb.org/3', key: '' },
  };
  const sources = getApiSourcesFromDOM();
  sources.push({ ...(defaults[type] || defaults.bangumi) });
  renderApiSources(sources);
}

function removeApiSource(index) {
  const container = document.getElementById('apiSourcesList');
  const cards = container.querySelectorAll('.api-source-card');
  if (cards.length <= 1) return;
  const sources = getApiSourcesFromDOM();
  sources.splice(index, 1);
  renderApiSources(sources);
}

function onApiSourceChange(index, field, value) {
  const sources = getApiSourcesFromDOM();
  sources[index][field] = value;
}

function onApiSourceTypeChange(index, select) {
  const sources = getApiSourcesFromDOM();
  sources[index].type = select.value;
  // Reset key when switching type
  if (select.value === 'bangumi') {
    sources[index].key = '';
  }
  renderApiSources(sources);
}

// --- Drag & Drop ---
let _dragIndex = null;

function onApiSourceDragStart(event, index) {
  _dragIndex = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(index));
  event.target.classList.add('api-source-card--dragging');
}

function onApiSourceDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const card = event.target.closest('.api-source-card');
  if (card) card.classList.add('api-source-card--drag-over');
}

function onApiSourceDrop(event, dropIndex) {
  event.preventDefault();
  const sources = getApiSourcesFromDOM();
  if (_dragIndex !== null && _dragIndex !== dropIndex) {
    const [moved] = sources.splice(_dragIndex, 1);
    sources.splice(dropIndex, 0, moved);
    renderApiSources(sources);
  }
  _dragIndex = null;
  document.querySelectorAll('.api-source-card').forEach(c => {
    c.classList.remove('api-source-card--dragging', 'api-source-card--drag-over');
  });
}

function onApiSourceDragEnd(event) {
  _dragIndex = null;
  document.querySelectorAll('.api-source-card').forEach(c => {
    c.classList.remove('api-source-card--dragging', 'api-source-card--drag-over');
  });
}

function getApiSourcesFromDOM() {
  const cards = document.querySelectorAll('.api-source-card');
  return Array.from(cards).map(card => {
    const typeSelect = card.querySelector('.api-source-type-select');
    const urlInput = card.querySelector('.api-source-url');
    const keyInput = card.querySelector('.api-source-key');
    return {
      type: typeSelect.value,
      url: urlInput.value.trim(),
      key: keyInput.value.trim(),
    };
  }).filter(s => s.url); // Only keep non-empty URL sources
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

  const apiSources = getApiSourcesFromDOM();
  if (apiSources.length === 0) {
    document.getElementById('settingsError').textContent = '至少需要一个 API 源';
    return;
  }

  try {
    await API.post('/api/config', { 
      mediaDir, 
      playerMode, 
      mpvPath, 
      theme,
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
  try {
    configCache = await API.get('/api/config');
  } catch (_) {}
  loadTheme();
  initSortSelect();
  showView('library');
});
