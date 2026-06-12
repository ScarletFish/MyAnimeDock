let discoveryData = [];
let selectedPaths = new Set();
let isScanning = false;
let filterMode = 'all';

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
    discoveryData = resp.tree || [];
    selectedPaths.clear();

    for (const n of discoveryData) {
      if (!n.alreadyImported) selectedPaths.add(n.path);
    }

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
          discoveryData = msg.tree;
          selectedPaths.clear();
          for (const n of discoveryData) {
            if (!n.alreadyImported) selectedPaths.add(n.path);
          }
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
    document.getElementById('discoveryEmptyText').textContent = '媒体目录中未发现动漫';
    stats.style.display = 'none';
    actions.style.display = 'none';
    return;
  }

  empty.style.display = 'none';

  const total = discoveryData.length;
  const imported = discoveryData.filter(n => n.alreadyImported).length;
  document.getElementById('statAnime').textContent = total;
  document.getElementById('statImported').textContent = imported;
  stats.style.display = '';

  document.querySelectorAll('#discoveryToolbar .filter-btn[data-filter]').forEach(b => {
    b.classList.toggle('filter-btn--active', b.dataset.filter === filterMode);
  });

  const hasNew = discoveryData.some(n => !n.alreadyImported);
  actions.style.display = hasNew ? '' : 'none';
  updateImportCount();

  const displayData = filterMode === 'all'
    ? discoveryData
    : discoveryData.filter(n => !n.alreadyImported);

  const parentCounts = {};
  for (const n of displayData) {
    const key = (n.parentChain || []).join('\0');
    if (key) parentCounts[key] = (parentCounts[key] || 0) + 1;
  }

  let html = '';
  for (let i = 0; i < displayData.length; i++) {
    const key = (displayData[i].parentChain || []).join('\0');
    const isSibling = key && parentCounts[key] > 1;
    if (isSibling) {
      html += '<div class="discovery-sibling-group">';
      while (i < displayData.length && (displayData[i].parentChain || []).join('\0') === key) {
        html += renderCard(displayData[i], true);
        i++;
      }
      html += '</div>';
      i--;
    } else {
      html += renderCard(displayData[i], false);
    }
  }
  grid.innerHTML = html;
}

function renderCard(node, showLine) {
  const isChecked = selectedPaths.has(node.path);
  const sizeMB = (node.totalSize / (1024 * 1024)).toFixed(0);
  const seasonText = node.parsedSeason ? ` S${node.parsedSeason}` : '';
  const fileId = 'dc-' + node.path.replace(/[^a-zA-Z0-9]/g, '-');
  const hasVideos = node.videos && node.videos.length > 0;
  const chain = node.parentChain || [];

  const folderSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M2 9h20"/></svg>';
  const playSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  const chevronSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>';

  const hasChain = chain.length > 0;

  return `
    <div class="discovery-card${node.alreadyImported ? ' discovery-card--imported' : ''}${showLine ? ' discovery-card--sibling' : ''}">
      <div class="discovery-card-main">
        ${hasVideos ? `<span class="discovery-card-toggle" onclick="event.stopPropagation();toggleCardFiles(this)">${chevronSvg}</span>`
          : '<span class="discovery-card-toggle discovery-card-toggle--hidden"></span>'}
        <label class="discovery-card-row" for="${fileId}">
          <input type="checkbox" class="discovery-cb" id="${fileId}"
            ${isChecked ? 'checked' : ''}
            ${node.alreadyImported ? 'disabled' : ''}
            onchange="toggleCard('${escAttr(node.path)}', this.checked)">
          <span class="discovery-cb-visual">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          <span class="discovery-card-icon">${folderSvg}</span>
          <div class="discovery-card-info">
            <span class="discovery-card-title">${escHtml(node.parsedTitle)}${seasonText}</span>
            <span class="discovery-card-meta">${node.videoCount} 集 · ${sizeMB} MB</span>
          </div>
          ${node.alreadyImported
            ? '<span class="discovery-badge discovery-badge--imported">已导入</span>'
            : '<span class="discovery-badge discovery-badge--new">新</span>'}
        </label>
      </div>
      ${(hasChain || hasVideos) ? `
      <div class="discovery-annotation${hasChain ? ' discovery-annotation--nested' : ''}">
        ${hasChain ? `<div class="discovery-parent">${chain.map(p => escHtml(p)).join('<br>')}</div>` : ''}
        ${hasVideos ? `
        <ul class="discovery-card-files collapsed">
          ${node.videos.map(v => `
            <li class="discovery-card-file" title="${escAttr(v.name)}">
              <span class="discovery-card-file-icon">${playSvg}</span>
              <span class="discovery-card-file-name">${escHtml(v.name)}</span>
              <span class="discovery-card-file-size">${(v.size / 1024 / 1024).toFixed(0)} MB</span>
            </li>
          `).join('')}
        </ul>` : ''}
      </div>` : ''}
    </div>`;
}

function toggleCardFiles(el) {
  const card = el.closest('.discovery-card');
  const files = card.querySelector('.discovery-card-files');
  if (files) {
    files.classList.toggle('collapsed');
    el.classList.toggle('open');
  }
}

function toggleCard(path, checked) {
  if (checked) selectedPaths.add(path);
  else selectedPaths.delete(path);
  updateImportCount();
}

function setFilter(mode) {
  filterMode = mode;
  renderDiscovery();
}

function expandAll() {
  document.querySelectorAll('.discovery-card-files.collapsed').forEach(el => {
    el.classList.remove('collapsed');
  });
  document.querySelectorAll('.discovery-card-toggle.open').forEach(el => {
    el.classList.remove('open');
  });
  document.querySelectorAll('.discovery-card-toggle:not(.discovery-card-toggle--hidden)').forEach(el => {
    el.classList.add('open');
  });
}

function collapseAll() {
  document.querySelectorAll('.discovery-card-files:not(.collapsed)').forEach(el => {
    el.classList.add('collapsed');
  });
  document.querySelectorAll('.discovery-card-toggle.open').forEach(el => {
    el.classList.remove('open');
  });
}

function selectAllCandidates() {
  const newLeaves = discoveryData.filter(n => !n.alreadyImported);
  const allSelected = newLeaves.every(n => selectedPaths.has(n.path));
  selectedPaths.clear();
  if (!allSelected) {
    newLeaves.forEach(n => selectedPaths.add(n.path));
  }
  renderDiscovery();
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
  const items = discoveryData.filter(n => selectedPaths.has(n.path)).map(n => ({
    folderPath: n.path,
    folderName: n.name,
    parsedTitle: n.parsedTitle,
    parsedSeason: n.parsedSeason,
  }));
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
