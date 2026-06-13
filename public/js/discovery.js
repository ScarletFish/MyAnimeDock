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

    const showExcluded = filterMode === 'excluded';
    const resp = await API.get(`/api/browse${showExcluded ? '?showExcluded=true' : ''}`);
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
  const excluded = discoveryData.filter(n => n.excluded).length;
  document.getElementById('statAnime').textContent = total;
  document.getElementById('statImported').textContent = imported;
  stats.style.display = '';

  document.querySelectorAll('#discoveryToolbar .filter-btn[data-filter]').forEach(b => {
    b.classList.toggle('filter-btn--active', b.dataset.filter === filterMode);
  });

  const hasNew = discoveryData.some(n => !n.alreadyImported && !n.excluded);
  actions.style.display = hasNew ? '' : 'none';
  updateImportCount();

  let displayData = discoveryData;
  if (filterMode === 'unimported') {
    displayData = discoveryData.filter(n => !n.alreadyImported && !n.excluded);
  } else if (filterMode === 'excluded') {
    displayData = discoveryData.filter(n => n.excluded);
  } else if (filterMode === 'all') {
    displayData = discoveryData.filter(n => !n.excluded);
  }

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
  const excluded = node.excluded || false;
  const bangumiMatched = node.bangumiMatched || false;

  const folderSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M2 9h20"/></svg>';
  const playSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  const chevronSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>';
  const menuSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';

  const hasChain = chain.length > 0;
  const showParentChain = hasChain && chain[chain.length - 1] !== node.parsedTitle;

  return `
    <div class="discovery-card${node.alreadyImported ? ' discovery-card--imported' : ''}${showLine ? ' discovery-card--sibling' : ''}${excluded ? ' discovery-card--excluded' : ''}" data-path="${escAttr(node.path)}">
      <div class="discovery-card-main">
        ${hasVideos ? `<span class="discovery-card-toggle" onclick="event.stopPropagation();toggleCardFiles(this)">${chevronSvg}</span>`
          : '<span class="discovery-card-toggle discovery-card-toggle--hidden"></span>'}
        <label class="discovery-card-row" for="${fileId}">
          ${!node.alreadyImported && !excluded ? `
          <input type="checkbox" class="discovery-cb" id="${fileId}"
            ${isChecked ? 'checked' : ''}
            onchange="toggleCard('${escAttr(node.path)}', this.checked)">
          <span class="discovery-cb-visual">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          ` : ''}
          <span class="discovery-card-icon">${folderSvg}</span>
          <div class="discovery-card-info">
            <span class="discovery-card-title${node.alreadyImported ? ' discovery-card-title--imported' : ''}${excluded ? ' discovery-card-title--excluded' : ''}">${escHtml(node.parsedTitle)}${seasonText}</span>
            <span class="discovery-card-meta">${node.videoCount} 集 · ${sizeMB} MB</span>
            ${bangumiMatched ? '<div class="discovery-card-tags"><span class="tag tag--meta">已匹配</span></div>' : ''}
          </div>
          ${excluded
            ? '<span class="discovery-badge discovery-badge--excluded">已排除</span>'
            : node.alreadyImported
              ? '<span class="discovery-badge discovery-badge--imported">已导入</span>'
              : '<span class="discovery-badge discovery-badge--new">新</span>'}
        </label>
        <div class="discovery-card-actions" onclick="event.stopPropagation();openDiscoveryDetail('${escAttr(node.path)}')">
          ${menuSvg}
        </div>
      </div>
      ${(showParentChain || hasVideos) ? `
      <div class="discovery-annotation${showParentChain ? ' discovery-annotation--nested' : ''}">
        ${showParentChain ? `<div class="discovery-parent">${chain.map(p => escHtml(p)).join('<br>')}</div>` : ''}
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

  // Show/hide batch fetch metadata button
  const batchBtn = document.getElementById('batchFetchMetaBtn');
  if (batchBtn) {
    const hasFetchable = discoveryData.some(n => 
      selectedPaths.has(n.path) && !n.bangumiMatched && !n.alreadyImported
    );
    batchBtn.style.display = hasFetchable ? '' : 'none';
  }

  // Show/hide auto-import button (high confidence items not imported)
  const autoBtn = document.getElementById('autoImportBtn');
  if (autoBtn) {
    const hasAutoImportable = discoveryData.some(n => 
      !n.alreadyImported && !n.excluded && (n.confidence || 0) >= 0.85
    );
    autoBtn.style.display = hasAutoImportable ? '' : 'none';
  }
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

// --- Discovery Detail Panel ---
let detailPanelNode = null;

function openDiscoveryDetail(path) {
  const node = discoveryData.find(n => n.path === path);
  if (!node) return;
  detailPanelNode = node;

  const panel = document.getElementById('discoveryDetailPanel');
  const overlay = document.getElementById('detailPanelOverlay');
  const content = document.getElementById('discoveryDetailContent');

  content.innerHTML = renderDetailPanelContent(node);
  panel.classList.remove('hidden');
  overlay.classList.remove('hidden');
  // Trigger animation
  requestAnimationFrame(() => {
    panel.classList.add('open');
    overlay.classList.add('open');
  });
  document.body.style.overflow = 'hidden';
}

function closeDiscoveryDetailPanel() {
  const panel = document.getElementById('discoveryDetailPanel');
  const overlay = document.getElementById('detailPanelOverlay');
  panel.classList.remove('open');
  overlay.classList.remove('open');
  setTimeout(() => {
    panel.classList.add('hidden');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
    detailPanelNode = null;
  }, 250);
}

function renderDetailPanelContent(node) {
  const excluded = node.excluded || false;
  const bangumiMatched = node.bangumiMatched || false;
  const alreadyImported = node.alreadyImported || false;

  const sizeMB = (node.totalSize / (1024 * 1024)).toFixed(0);
  const seasonText = node.parsedSeason ? `Season ${node.parsedSeason}` : '单季';

  return `
    <div class="detail-panel-cover">
      ${node.localCover ? `<img src="/covers/${node.localCover.split('/').pop()}?w=300&q=80" alt="${escAttr(node.parsedTitle)}">` : '<div class="cover-placeholder"><svg viewBox="0 0 24 24" width="48" height="48" fill="#555"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div>'}
    </div>
    <div class="detail-panel-body">
      <div class="detail-panel-title-row">
        <h3 class="detail-panel-title">${escHtml(node.parsedTitle)}</h3>
        <div class="detail-panel-badges">
          ${bangumiMatched ? '<span class="badge badge--meta">Bangumi 已匹配</span>' : ''}
          ${alreadyImported ? '<span class="badge badge--imported">已导入</span>' : ''}
          ${excluded ? '<span class="badge badge--excluded">已排除</span>' : ''}
        </div>
      </div>
      <dl class="detail-panel-meta">
        <dt>文件夹名</dt><dd class="mono">${escHtml(node.name)}</dd>
        <dt>季数</dt><dd>${escHtml(seasonText)}</dd>
        <dt>集数</dt><dd>${node.videoCount} 集</dd>
        <dt>大小</dt><dd>${sizeMB} MB</dd>
        <dt>路径</dt><dd class="mono path-truncate" title="${escAttr(node.path)}">${escHtml(node.path)}</dd>
        ${node.parentChain && node.parentChain.length > 0 ? `<dt>父目录</dt><dd>${node.parentChain.map(p => escHtml(p)).join(' / ')}</dd>` : ''}
      </dl>
      ${node.bangumiTitle ? `
      <div class="detail-panel-bangumi">
        <h4>Bangumi 信息</h4>
        <p><strong>中文标题：</strong>${escHtml(node.bangumiTitle)}</p>
        ${node.bangumiTitleJp ? `<p><strong>原名：</strong>${escHtml(node.bangumiTitleJp)}</p>` : ''}
        ${node.rating ? `<p><strong>评分：</strong>★ ${node.rating}</p>` : ''}
        ${node.summary ? `<p><strong>简介：</strong>${escHtml(node.summary).substring(0, 200)}...</p>` : ''}
      </div>` : ''}
      <div class="detail-panel-actions">
        ${!alreadyImported && !excluded ? `
          <button class="btn btn-primary" onclick="importSingle('${escAttr(node.path)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            导入到资料库
          </button>
        ` : ''}
        ${alreadyImported && !excluded ? `
          <button class="btn btn-ghost" onclick="unlinkSingle('${escAttr(node.path)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
            取消关联
          </button>
        ` : ''}
        ${excluded ? `
          <button class="btn btn-ghost" onclick="includeSingle('${escAttr(node.path)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            取消排除
          </button>
        ` : `
          <button class="btn btn-ghost" onclick="excludeSingle('${escAttr(node.path)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            排除扫描
          </button>
        `}
        ${!bangumiMatched ? `
          <button class="btn btn-ghost" onclick="openBangumiSearchModal({mode:'single', path:'${escAttr(node.path)}', node:detailPanelNode})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            获取元数据
          </button>
        ` : ''}
        <button class="btn btn-ghost" onclick="rescanSingle('${escAttr(node.path)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>
          重新扫描
        </button>
      </div>
    </div>
  `;
}

// --- API Actions ---
async function importSingle(path) {
  const node = discoveryData.find(n => n.path === path);
  if (!node) return;
  try {
    const result = await API.post('/api/import', {
      items: [{
        folderPath: node.path,
        folderName: node.name,
        parsedTitle: node.parsedTitle,
        parsedSeason: node.parsedSeason,
      }]
    });
    showToast(`已导入 ${result.imported.length} 部动漫`);
    closeDiscoveryDetailPanel();
    loadDiscovery();
    loadLibrary();
  } catch (e) {
    showToast('导入失败: ' + e.message);
  }
}

async function unlinkSingle(path) {
  if (!confirm('确定要取消关联吗？观看记录将被保留。')) return;
  try {
    await API.post('/api/discovery/unlink', { path });
    showToast('已取消关联');
    closeDiscoveryDetailPanel();
    loadDiscovery();
    loadLibrary();
    loadMemories();
  } catch (e) {
    showToast('取消关联失败: ' + e.message);
  }
}

async function excludeSingle(path) {
  try {
    await API.post('/api/discovery/exclude', { path });
    showToast('已排除扫描');
    closeDiscoveryDetailPanel();
    loadDiscovery();
  } catch (e) {
    showToast('排除失败: ' + e.message);
  }
}

async function includeSingle(path) {
  try {
    await API.post('/api/discovery/include', { path });
    showToast('已取消排除');
    closeDiscoveryDetailPanel();
    loadDiscovery();
  } catch (e) {
    showToast('取消排除失败: ' + e.message);
  }
}

function fetchMetaSingle(path) {
  const node = discoveryData.find(n => n.path === path);
  if (!node) return;
  openBangumiSearchModal({ mode: 'single', path, node });
}

async function rescanSingle(path) {
  const btn = event.target.closest('button');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 扫描中...';
  try {
    // Trigger a full rescan for now (could optimize to single folder)
    await startScan();
    showToast('重新扫描完成');
  } catch (e) {
    showToast('重新扫描失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// --- Bangumi Search Modal ---
let bangumiSearchTarget = null; // { path, node, mode: 'single' | 'batch', paths: [] }

function openBangumiSearchModal(target) {
  bangumiSearchTarget = target;
  const modal = document.getElementById('bangumiSearchModal');
  const input = document.getElementById('bangumiSearchInput');
  const results = document.getElementById('bangumiSearchResults');

  // Set default search keyword from node title
  if (target.node) {
    input.value = target.node.parsedTitle;
  } else if (target.paths && target.paths.length > 0) {
    const firstNode = discoveryData.find(n => n.path === target.paths[0]);
    input.value = firstNode?.parsedTitle || '';
  }

  results.innerHTML = '';
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';

  // Focus input and trigger search
  requestAnimationFrame(() => {
    input.focus();
    performBangumiSearch();
  });
}

function closeBangumiSearchModal() {
  const modal = document.getElementById('bangumiSearchModal');
  modal.classList.remove('show');
  document.body.style.overflow = '';
  bangumiSearchTarget = null;
}

async function performBangumiSearch() {
  const input = document.getElementById('bangumiSearchInput');
  const results = document.getElementById('bangumiSearchResults');
  const keyword = input.value.trim();

  if (!keyword) {
    results.innerHTML = '<div class="bangumi-search-empty">请输入搜索关键词</div>';
    return;
  }

  results.innerHTML = '<div class="bangumi-search-loading"><div class="spinner"></div><p>搜索中...</p></div>';

  try {
    const resp = await API.post('/api/bangumi/search', { keyword });
    const subjects = resp.results || [];

    if (subjects.length === 0) {
      results.innerHTML = '<div class="bangumi-search-empty">未找到匹配结果</div>';
      return;
    }

    results.innerHTML = subjects.map(s => `
      <div class="bangumi-result-item" onclick="selectBangumiResult(${s.id}, '${escAttr(s.source || 'bangumi')}')">
        <img class="bangumi-result-cover" src="${s.images?.small || s.images?.grid || s.poster_path ? 'https://image.tmdb.org/t/p/w200' + s.poster_path : ''}" alt=""
          onerror="this.style.display='none'">
        <div class="bangumi-result-info">
          <div class="bangumi-result-title">${escHtml(s.name_cn || s.name)}</div>
          <div class="bangumi-result-subtitle">${escHtml(s.name)}</div>
          <div class="bangumi-result-meta">
            <span class="bangumi-result-type">${formatBangumiType(s.type)}</span>
            ${s.date ? `<span>${s.date.slice(0, 4)}</span>` : ''}
            ${s.first_air_date ? `<span>${s.first_air_date.slice(0, 4)}</span>` : ''}
            ${s.rating?.score ? `<span class="bangumi-result-rating">★ ${s.rating.score.toFixed(1)}</span>` : ''}
            ${s.vote_average ? `<span class="bangumi-result-rating">★ ${s.vote_average.toFixed(1)}</span>` : ''}
            <span class="bangumi-result-source badge" style="--badge-color: ${s.source === 'tmdb' ? 'var(--accent-secondary)' : 'var(--accent)'}">${s.source === 'tmdb' ? 'TMDB' : 'Bangumi'}</span>
          </div>
        </div>
        <button class="btn btn-primary bangumi-result-select">选择</button>
      </div>
    `).join('');
  } catch (e) {
    results.innerHTML = `<div class="bangumi-search-empty">搜索失败: ${escHtml(e.message)}</div>`;
  }
}

function formatBangumiType(type) {
  const types = { 1: '书籍', 2: '动画', 3: '音乐', 4: '游戏', 6: '三次元' };
  return types[type] || '未知';
}

async function selectBangumiResult(subjectId, source = 'bangumi') {
  if (!bangumiSearchTarget) return;

  const results = document.getElementById('bangumiSearchResults');
  results.innerHTML = '<div class="bangumi-search-loading"><div class="spinner"></div><p>获取元数据中...</p></div>';

  try {
    if (bangumiSearchTarget.mode === 'batch') {
      // Batch mode: fetch for all paths
      const { paths } = bangumiSearchTarget;
      let successCount = 0;
      for (const path of paths) {
        try {
          await API.post('/api/discovery/fetch-meta', { path, subjectId, source });
          successCount++;
        } catch (e) {
          console.error('Batch fetch failed for', path, e);
        }
      }
      showToast(`批量获取完成: 成功 ${successCount}/${paths.length}`);
    } else {
      // Single mode
      await API.post('/api/discovery/fetch-meta', { path: bangumiSearchTarget.path, subjectId, source });
      showToast('元数据获取成功');
    }
    closeBangumiSearchModal();
    closeDiscoveryDetailPanel();
    loadDiscovery();
  } catch (e) {
    results.innerHTML = `<div class="bangumi-search-empty">获取失败: ${escHtml(e.message)}</div>`;
  }
}

// Batch fetch metadata for selected items
async function batchFetchMetadata() {
  const selected = discoveryData.filter(n => selectedPaths.has(n.path) && !n.bangumiMatched && !n.alreadyImported);
  if (selected.length === 0) {
    showToast('没有可获取元数据的项目');
    return;
  }

  openBangumiSearchModal({
    mode: 'batch',
    paths: selected.map(n => n.path),
    node: selected[0] // Use first for default keyword
  });
}

// Auto-import high confidence items (>= 0.85)
async function autoImportHighConfidence() {
  const threshold = 0.85;
  const candidates = discoveryData.filter(n => 
    !n.alreadyImported && !n.excluded && (n.confidence || 0) >= threshold
  );
  if (candidates.length === 0) {
    showToast(`无置信度 ≥ ${Math.round(threshold * 100)}% 的可导入项目`);
    return;
  }
  if (!confirm(`将自动导入 ${candidates.length} 个高置信度 (${Math.round(threshold * 100)}%+) 项目，确定继续？`)) return;

  const btn = document.getElementById('autoImportBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 导入中...';

  try {
    const result = await API.post('/api/discovery/auto-import', { threshold });
    showToast(result.message || `自动导入完成: ${result.imported.length} 部`);
    loadDiscovery();
    loadLibrary();
  } catch (e) {
    showToast('自动导入失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}
