let discoveryData = [];
let selectedPaths = new Set();
let isScanning = false;

async function loadDiscovery() {
  const grid = document.getElementById('discoveryGrid');
  const empty = document.getElementById('discoveryEmpty');
  const stats = document.getElementById('discoveryStats');
  const actions = document.getElementById('discoveryActions');
  const scanBtn = document.getElementById('discoveryScanBtn');
  const heroPath = document.getElementById('discoveryPath');
  const radar = document.getElementById('discoveryRadar');

  grid.innerHTML = '';
  empty.style.display = 'none';
  stats.style.display = 'none';
  actions.style.display = 'none';
  scanBtn.style.display = '';

  try {
    const config = await API.get('/api/config');
    if (!config.dirValid) {
      heroPath.textContent = '未配置媒体目录';
      empty.style.display = 'flex';
      scanBtn.style.display = 'none';
      return;
    }
    heroPath.textContent = config.mediaDir;

    const resp = await API.get('/api/browse');
    discoveryData = resp.folders || [];
    selectedPaths.clear();

    discoveryData.forEach(f => {
      if (f.isAnime && !f.alreadyImported) selectedPaths.add(f.folderPath);
    });

    renderDiscovery();
  } catch (e) {
    showToast('加载失败: ' + e.message);
  }
}

async function startScan() {
  if (isScanning) return;
  isScanning = true;

  const scanBtn = document.getElementById('discoveryScanBtn');
  const scanBtnText = document.getElementById('scanBtnText');
  const radar = document.getElementById('discoveryRadar');
  const progress = document.getElementById('scanProgress');
  const fill = document.getElementById('scanProgressFill');
  const text = document.getElementById('scanProgressText');
  const grid = document.getElementById('discoveryGrid');
  const empty = document.getElementById('discoveryEmpty');
  const stats = document.getElementById('discoveryStats');
  const actions = document.getElementById('discoveryActions');

  scanBtn.disabled = true;
  scanBtnText.textContent = '扫描中...';
  radar.style.display = '';
  grid.innerHTML = '';
  empty.style.display = 'none';
  stats.style.display = 'none';
  actions.style.display = 'none';
  progress.style.display = 'block';
  fill.style.width = '0%';
  text.textContent = '准备扫描...';

  try {
    const resp = await fetch('/api/scan');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const msg = JSON.parse(line.slice(6));
        if (msg.type === 'progress') {
          const pct = Math.round((msg.current / msg.total) * 100);
          fill.style.width = pct + '%';
          text.textContent = `扫描 ${msg.current}/${msg.total} — ${msg.folder}`;
        } else if (msg.type === 'done') {
          discoveryData = msg.candidates;
          selectedPaths.clear();
          discoveryData.forEach(c => {
            if (!c.alreadyImported) selectedPaths.add(c.folderPath);
          });
          renderDiscovery();
        } else if (msg.type === 'error') {
          showToast('扫描失败: ' + msg.message);
        }
      }
    }
  } catch (e) {
    showToast('扫描失败: ' + e.message);
  }

  progress.style.display = 'none';
  radar.style.display = 'none';
  scanBtn.disabled = false;
  scanBtnText.textContent = '重新扫描';
  isScanning = false;
}

function renderDiscovery() {
  const grid = document.getElementById('discoveryGrid');
  const empty = document.getElementById('discoveryEmpty');
  const stats = document.getElementById('discoveryStats');
  const actions = document.getElementById('discoveryActions');

  if (discoveryData.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = '媒体目录中未发现动漫';
    stats.style.display = 'none';
    actions.style.display = 'none';
    return;
  }

  empty.style.display = 'none';

  const animeCount = discoveryData.filter(c => c.isAnime).length;
  const importedCount = discoveryData.filter(c => c.alreadyImported).length;
  document.getElementById('statTotal').textContent = discoveryData.length;
  document.getElementById('statAnime').textContent = animeCount;
  document.getElementById('statImported').textContent = importedCount;
  stats.style.display = '';

  const newAnime = discoveryData.filter(c => c.isAnime && !c.alreadyImported);
  if (newAnime.length > 0) {
    actions.style.display = '';
  } else {
    actions.style.display = 'none';
  }
  updateImportCount();

  grid.innerHTML = discoveryData.map((c, i) => {
    const isNewAnime = c.isAnime && !c.alreadyImported;
    const isChecked = selectedPaths.has(c.folderPath);
    const sizeMB = (c.totalSize / (1024 * 1024)).toFixed(0);
    const seasonText = c.parsedSeason ? ` S${c.parsedSeason}` : '';
    const statusClass = c.alreadyImported ? 'imported' : c.isAnime ? 'anime' : 'empty';
    const delay = Math.min(i * 30, 600);

    if (!c.isAnime) {
      return `
        <div class="folder-card folder-card--empty" style="animation-delay:${delay}ms">
          <div class="folder-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div class="folder-card-name">${escHtml(c.folderName)}</div>
          <div class="folder-card-status">无视频文件</div>
        </div>
      `;
    }

    return `
      <label class="folder-card folder-card--${statusClass}" style="animation-delay:${delay}ms"
        ${c.alreadyImported ? '' : `for="fc-${i}"`}>
        ${!c.alreadyImported ? `<input type="checkbox" class="folder-card-cb" id="fc-${i}"
          ${isChecked ? 'checked' : ''}
          onchange="toggleCandidate('${escAttr(c.folderPath)}', this.checked)">` : ''}
        <div class="folder-card-check" ${c.alreadyImported ? 'style="display:none"' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div class="folder-card-badge ${c.alreadyImported ? 'folder-card-badge--imported' : 'folder-card-badge--new'}">
          ${c.alreadyImported ? '已导入' : '新'}
        </div>
        <div class="folder-card-icon folder-card-icon--anime">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </div>
        <div class="folder-card-title">${escHtml(c.parsedTitle)}${seasonText}</div>
        <div class="folder-card-meta">${c.videoCount} 集 · ${sizeMB} MB</div>
        <div class="folder-card-folder">${escHtml(c.folderName)}</div>
      </label>
    `;
  }).join('');
}

function toggleCandidate(path, checked) {
  if (checked) selectedPaths.add(path);
  else selectedPaths.delete(path);
  updateImportCount();
}

function selectAllCandidates() {
  const cbs = document.querySelectorAll('.folder-card-cb');
  if (cbs.length === 0) return;
  const allChecked = Array.from(cbs).every(cb => cb.checked);
  cbs.forEach(cb => { cb.checked = !allChecked; });
  selectedPaths.clear();
  if (!allChecked) {
    discoveryData.forEach(c => {
      if (c.isAnime && !c.alreadyImported) selectedPaths.add(c.folderPath);
    });
  }
  updateImportCount();
}

function updateImportCount() {
  const el = document.getElementById('importCount');
  if (el) el.textContent = selectedPaths.size;
}

async function importSelected() {
  if (selectedPaths.size === 0) {
    showToast('请先选择要导入的动漫');
    return;
  }
  const items = discoveryData.filter(c => selectedPaths.has(c.folderPath));
  try {
    const result = await API.post('/api/import', { items });
    showToast(`已导入 ${result.imported.length} 部动漫`);
    selectedPaths.clear();
    loadDiscovery();
    loadLibrary();
  } catch (e) {
    showToast('导入失败: ' + e.message);
  }
}

function refreshDiscovery() {
  loadDiscovery();
}
