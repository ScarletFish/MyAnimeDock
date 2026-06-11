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

    walkTree(discoveryData, n => {
      if (n.type === 'leaf' && !n.alreadyImported) selectedPaths.add(n.path);
    });

    renderDiscovery();
  } catch (e) {
    showToast('加载失败: ' + e.message);
  }
}

function walkTree(nodes, fn) {
  for (const node of nodes) {
    fn(node);
    if (node.children) walkTree(node.children, fn);
  }
}

function collectLeaves(nodes) {
  const leaves = [];
  walkTree(nodes, n => { if (n.type === 'leaf') leaves.push(n); });
  return leaves;
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
          walkTree(discoveryData, n => {
            if (n.type === 'leaf' && !n.alreadyImported) selectedPaths.add(n.path);
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

function countTreeStats(nodes) {
  let leaves = 0, imported = 0, branches = 0;
  walkTree(nodes, n => {
    if (n.type === 'leaf') { leaves++; if (n.alreadyImported) imported++; }
    else if (n.type === 'branch') branches++;
  });
  return { leaves, imported, branches, total: leaves + branches };
}

function renderDiscovery() {
  const grid = document.getElementById('discoveryGrid');
  const empty = document.getElementById('discoveryEmpty');
  const stats = document.getElementById('discoveryStats');
  const actions = document.getElementById('discoveryActions');

  const allLeaves = collectLeaves(discoveryData);

  if (discoveryData.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = '媒体目录中未发现动漫';
    stats.style.display = 'none';
    actions.style.display = 'none';
    return;
  }

  empty.style.display = 'none';

  const { leaves, imported, total } = countTreeStats(discoveryData);
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statAnime').textContent = leaves;
  document.getElementById('statImported').textContent = imported;
  stats.style.display = '';

  // Update filter button active state
  document.querySelectorAll('#discoveryToolbar .filter-btn[data-filter]').forEach(b => {
    b.classList.toggle('filter-btn--active', b.dataset.filter === filterMode);
  });

  const hasNew = allLeaves.some(n => !n.alreadyImported);
  actions.style.display = hasNew ? '' : 'none';
  updateImportCount();

  const displayData = filterMode === 'all' ? discoveryData : filterImported(discoveryData);
  const treeHtml = renderTree(displayData, 0);
  grid.innerHTML = `<ul class="folder-tree">${treeHtml}</ul>`;
}

function filterImported(nodes) {
  return nodes.reduce((acc, n) => {
    if (n.type === 'leaf') {
      if (!n.alreadyImported) acc.push(n);
    } else {
      const kept = filterImported(n.children);
      if (kept.length > 0) acc.push({ ...n, children: kept });
    }
    return acc;
  }, []);
}

function setFilter(mode) {
  filterMode = mode;
  renderDiscovery();
}

function expandAll() {
  document.querySelectorAll('.tree-branch.collapsed, .tree-leaf.collapsed').forEach(el => {
    el.classList.remove('collapsed');
  });
}

function collapseAll() {
  document.querySelectorAll('.tree-branch:not(.collapsed), .tree-leaf:not(.collapsed)').forEach(el => {
    el.classList.add('collapsed');
  });
}

function renderTree(nodes, depth) {
  return nodes.map(node => {
    if (node.type === 'branch') {
      const toggleSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>';
      const folderSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      return `
        <li class="tree-branch" style="--depth:${depth}">
          <div class="tree-row" onclick="toggleTreeBranch(this)">
            <span class="tree-toggle">${toggleSvg}</span>
            <span class="tree-icon tree-icon--folder">${folderSvg}</span>
            <span class="tree-label">${escHtml(node.name)}</span>
          </div>
          <ul class="tree-children">
            ${renderTree(node.children, depth + 1)}
          </ul>
        </li>`;
    }

    const isChecked = selectedPaths.has(node.path);
    const sizeMB = (node.totalSize / (1024 * 1024)).toFixed(0);
    const seasonText = node.parsedSeason ? ` S${node.parsedSeason}` : '';
    const fileId = 'tl-' + node.path.replace(/[^a-zA-Z0-9]/g, '-');

    const toggleSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>';
    const folderSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M2 9h20"/></svg>';
    const playSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    const hasVideos = node.videos && node.videos.length > 0;

    return `
      <li class="tree-leaf ${node.alreadyImported ? 'tree-leaf--imported' : ''}">
        <label class="tree-row tree-row--leaf" for="${fileId}">
          <span class="tree-toggle${hasVideos ? '' : ' tree-toggle--hidden'}" onclick="event.stopPropagation();toggleTreeLeaf(this)">${toggleSvg}</span>
          <input type="checkbox" class="tree-cb" id="${fileId}"
            ${isChecked ? 'checked' : ''}
            ${node.alreadyImported ? 'disabled' : ''}
            onchange="toggleCandidate('${escAttr(node.path)}', this.checked)">
          <span class="tree-cb-visual">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          <span class="tree-icon tree-icon--leaf">${folderSvg}</span>
          <div class="tree-leaf-info">
            <span class="tree-leaf-title">${escHtml(node.parsedTitle)}${seasonText}</span>
            <span class="tree-leaf-meta">${node.videoCount} 集 · ${sizeMB} MB</span>
          </div>
          ${node.alreadyImported
            ? '<span class="tree-badge tree-badge--imported">已导入</span>'
            : '<span class="tree-badge tree-badge--new">新</span>'}
        </label>
        ${hasVideos ? `
        <ul class="tree-files">
          ${node.videos.map(v => `
            <li class="tree-file" title="${escAttr(v.name)}">
              <span class="tree-file-icon">${playSvg}</span>
              <span class="tree-file-name">${escHtml(v.name)}</span>
              <span class="tree-file-size">${(v.size / 1024 / 1024).toFixed(0)} MB</span>
            </li>
          `).join('')}
        </ul>` : ''}
      </li>`;
  }).join('');
}

function toggleTreeBranch(el) {
  const li = el.closest('.tree-branch');
  if (li) li.classList.toggle('collapsed');
}

function toggleTreeLeaf(el) {
  const li = el.closest('.tree-leaf');
  if (li) li.classList.toggle('collapsed');
}

function toggleCandidate(path, checked) {
  if (checked) selectedPaths.add(path);
  else selectedPaths.delete(path);
  updateImportCount();
}

function selectAllCandidates() {
  const leaves = collectLeaves(discoveryData);
  const newLeaves = leaves.filter(n => !n.alreadyImported);
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
  const leaves = collectLeaves(discoveryData);
  const items = leaves.filter(n => selectedPaths.has(n.path)).map(n => ({
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
