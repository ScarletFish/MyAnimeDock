let discoveryData = [];
let checkedPaths = new Set();
let isScanning = false;
let stickObserver = null;

const discoveryFilterBar = createFilterBar({
  container: '.discovery-actions .filter-group',
  options: [
    { key: 'all', label: '全部' },
    { key: 'unimported', label: '未导入' },
    { key: 'excluded', label: '已排除' }
  ],
  initial: 'all',
  onChange: function() { loadDiscovery(); }
});

async function loadDiscovery() {
  const grid = document.getElementById('discoveryGrid');
  const empty = document.getElementById('discoveryEmpty');
  const stats = document.getElementById('discoveryStats');
  const actions = document.getElementById('discoveryActions');
  const scanBtn = document.getElementById('discoveryScanBtn');
  const heroPath = document.getElementById('discoveryPath');
  const scanBtnText = document.getElementById('scanBtnText');

  grid.innerHTML = '';
  empty.style.display = 'none';
  stats.style.display = 'none';
  actions.style.display = 'none';
  scanBtn.style.display = '';
  scanBtnText.textContent = '扫描目录';
  scanBtn.disabled = false;

  try {
    const config = await API.get('/api/config');
    if (!config.dirValid) {
      heroPath.textContent = '未配置媒体目录';
      empty.style.display = 'flex';
      scanBtn.style.display = 'none';
      return;
    }
    heroPath.textContent = config.mediaDir;

    const showExcluded = discoveryFilterBar.current === 'excluded';
    const resp = await API.get(`/api/browse${showExcluded ? '?showExcluded=true' : ''}`);
    discoveryData = resp.tree || [];

    if (discoveryData.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'flex';
      document.getElementById('discoveryEmptyText').textContent = '尚未扫描媒体目录';
      document.getElementById('discoveryEmpty').querySelector('.empty-hint').textContent = '点击上方「扫描目录」开始';
      stats.style.display = 'none';
      actions.style.display = 'none';
      return;
    }

    renderDiscovery();
  } catch (e) {
    // Tauri 初始加载时静默失败
    if (!window.location.origin.startsWith('http')) return;
    showToast('加载失败: ' + e.message, 'error');
  }
}

async function startScan() {
  if (isScanning) return;
  isScanning = true;

  const scanBtn = document.getElementById('discoveryScanBtn');
  const scanBtnText = document.getElementById('scanBtnText');
  const grid = document.getElementById('discoveryGrid');
  const empty = document.getElementById('discoveryEmpty');
  const stats = document.getElementById('discoveryStats');
  const actions = document.getElementById('discoveryActions');

  scanBtn.disabled = true;
  scanBtnText.textContent = '扫描中...';
  grid.innerHTML = '';
  empty.style.display = 'none';
  stats.style.display = 'none';
  actions.style.display = 'none';

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
          scanBtnText.textContent = `扫描 ${msg.current}/${msg.total}`;
        } else if (msg.type === 'done') {
          loadDiscovery();
        } else if (msg.type === 'error') {
          showToast('扫描失败: ' + msg.message, 'error');
        }
      }
    }
  } catch (e) {
    showToast('扫描失败: ' + e.message, 'error');
  }

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

  discoveryFilterBar.render();

  const hasNew = discoveryData.some(n => !n.alreadyImported && !n.excluded);
  actions.style.display = hasNew ? '' : 'none';

  // Sticky action bar: observe sentinel above the bar
  if (stickObserver) stickObserver.disconnect();
  const sentinel = document.getElementById('discoveryActionsSentinel');
  if (sentinel) {
    stickObserver = new IntersectionObserver(
      ([e]) => {
        if (actions.style.display === 'none') return;
        actions.classList.toggle('discovery-actions--stuck', !e.isIntersecting);
      },
      { threshold: [0] }
    );
    stickObserver.observe(sentinel);
  }

  let displayData = discoveryData;
  if (discoveryFilterBar.current === 'unimported') {
    displayData = discoveryData.filter(n => !n.alreadyImported && !n.excluded);
  } else if (discoveryFilterBar.current === 'excluded') {
    displayData = discoveryData.filter(n => n.excluded);
  } else if (discoveryFilterBar.current === 'all') {
    displayData = discoveryData.filter(n => !n.excluded);
    // 未导入排前
    displayData.sort((a, b) => {
      if (a.alreadyImported !== b.alreadyImported) {
        return a.alreadyImported ? 1 : -1;
      }
      return 0;
    });
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
      // 父目录下只有一个子项时，展平父目录（如制片公司合集/系列合集）
      const singleChild = key && parentCounts[key] === 1;
      const node = singleChild ? { ...displayData[i], parentChain: [] } : displayData[i];
      html += renderCard(node, false);
    }
  }
  grid.innerHTML = html;

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.from('.discovery-card', { opacity: 0, y: 12, stagger: 0.03, duration: 0.3, ease: 'power2.out' });
  }

  // Restore checked state from set, clean up stale paths
  const validPaths = new Set(displayData.filter(n => !n.alreadyImported && !n.excluded).map(n => n.path));
  for (const p of checkedPaths) {
    if (!validPaths.has(p)) checkedPaths.delete(p);
  }
  document.querySelectorAll('.discovery-cb').forEach(cb => {
    const card = cb.closest('.discovery-card');
    if (card) cb.checked = checkedPaths.has(card.dataset.path);
  });
  updateImportCount();
}

function renderCard(node, showLine) {
  const isChecked = false;
  const sizeMB = (node.totalSize / (1024 * 1024)).toFixed(0);
  const seasonText = node.parsedSeason ? ` S${node.parsedSeason}` : '';
  const fileId = 'dc-' + node.path.replace(/[^a-zA-Z0-9]/g, '-');
  const hasVideos = node.videos && node.videos.length > 0;
  const chain = node.parentChain || [];
  const excluded = node.excluded || false;

  const folderSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M2 9h20"/></svg>';
  const playSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  const chevronSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>';
  const unlinkSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>';
  const excludeSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
  const includeSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';

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
            onchange="toggleCard()">
          <span class="discovery-cb-visual">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          ` : ''}
          <span class="discovery-card-icon">${folderSvg}</span>
          <div class="discovery-card-info">
            <div class="discovery-card-title-row">
              <span class="discovery-card-title${node.alreadyImported ? ' discovery-card-title--imported' : ''}${excluded ? ' discovery-card-title--excluded' : ''}">${escHtml(node.parsedTitle)}${seasonText}</span>
              <div class="discovery-card-row-actions">
                ${node.alreadyImported ? `<button class="discovery-card-action discovery-card-unlink" onclick="event.preventDefault();event.stopPropagation();unlinkSingle(this.closest('.discovery-card').dataset.path)" data-tooltip="取消导入">${unlinkSvg} 取消导入</button>` : ''}
                ${!node.alreadyImported && !excluded ? `<button class="discovery-card-action discovery-card-exclude" onclick="event.preventDefault();event.stopPropagation();excludeSingle(this.closest('.discovery-card').dataset.path)" data-tooltip="排除扫描">${excludeSvg} 排除</button>` : ''}
                ${excluded ? `<button class="discovery-card-action discovery-card-unexclude" onclick="event.preventDefault();event.stopPropagation();includeSingle(this.closest('.discovery-card').dataset.path)" data-tooltip="取消排除">${includeSvg} 取消排除</button>` : ''}
              </div>
            </div>
            <span class="discovery-card-meta">${node.videoCount} 集 · ${sizeMB} MB</span>
          </div>
          ${excluded
            ? '<span class="discovery-badge discovery-badge--excluded">已排除</span>'
            : node.alreadyImported
              ? '<span class="discovery-badge discovery-badge--imported">已导入</span>'
              : '<span class="discovery-badge discovery-badge--new">新</span>'}
        </label>
      </div>
      ${(showParentChain || hasVideos) ? `
      <div class="discovery-annotation${showParentChain ? ' discovery-annotation--nested' : ''}">
        ${showParentChain ? `<div class="discovery-parent">${chain.map(p => escHtml(p)).join('<br>')}</div>` : ''}
        ${hasVideos ? `
        <ul class="discovery-card-files collapsed">
          ${node.videos.map(v => `
            <li class="discovery-card-file" data-tooltip="${escAttr(v.name)}">
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

function toggleCard() {
  document.querySelectorAll('.discovery-cb').forEach(cb => {
    const card = cb.closest('.discovery-card');
    if (!card) return;
    if (cb.checked) checkedPaths.add(card.dataset.path);
    else checkedPaths.delete(card.dataset.path);
  });
  updateImportCount();
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
  const cbs = document.querySelectorAll('.discovery-cb');
  if (cbs.length === 0) return;
  const allChecked = Array.from(cbs).every(cb => cb.checked);
  cbs.forEach(cb => {
    cb.checked = !allChecked;
    const card = cb.closest('.discovery-card');
    if (card) {
      if (!allChecked) checkedPaths.add(card.dataset.path);
      else checkedPaths.delete(card.dataset.path);
    }
  });
  updateImportCount();
}

function updateSelectAllLabel() {
  const btn = document.getElementById('selectAllBtn');
  if (!btn) return;
  const cbs = document.querySelectorAll('.discovery-cb');
  const allChecked = cbs.length > 0 && Array.from(cbs).every(cb => cb.checked);
  btn.textContent = allChecked ? '取消全选' : '全选';
}

function getCheckedPaths() {
  return Array.from(checkedPaths);
}

function updateImportCount() {
  const el = document.getElementById('importCount');
  if (el) el.textContent = getCheckedPaths().length;
  updateSelectAllLabel();
}

async function importSelected() {
  const paths = getCheckedPaths();
  const items = discoveryData.filter(n => paths.includes(n.path) && !n.alreadyImported).map(n => ({
    folderPath: n.path,
    folderName: n.name,
    parsedTitle: n.parsedTitle,
    parsedSeason: n.parsedSeason,
    specialSuffix: n.specialSuffix,
  }));
  if (items.length === 0) {
    showToast('请先选择要导入的动漫', 'warning');
    return;
  }
  try {
    const result = await API.post('/api/import', { items });
    showToast(`已导入 ${result.imported.length} 部动漫`, 'success');
    showToast('已自动添加到我的列表', 'silent');
    loadDiscovery();
    loadLibrary();
  } catch (e) {
    showToast('导入失败: ' + e.message, 'error');
  }
}

function refreshDiscovery() {
  loadDiscovery();
}

// --- Inline Actions ---
async function unlinkSingle(path) {
  try {
    await API.post('/api/discovery/unlink', { path });
    showToast('已取消导入', 'info');
    checkedPaths.delete(path);
    loadDiscovery();
    loadLibrary();
  } catch (e) {
    showToast('取消导入失败: ' + e.message, 'error');
  }
}

async function excludeSingle(path) {
  try {
    await API.post('/api/discovery/exclude', { path });
    showToast('已排除扫描', 'info');
    loadDiscovery();
  } catch (e) {
    showToast('排除失败: ' + e.message, 'error');
  }
}

async function includeSingle(path) {
  try {
    await API.post('/api/discovery/include', { path });
    showToast('已取消排除', 'info');
    loadDiscovery();
  } catch (e) {
    showToast('取消排除失败: ' + e.message, 'error');
  }
}

// ─── ESM exports for onclick handlers ───
window.startScan = startScan;
window.expandAll = expandAll;
window.collapseAll = collapseAll;
window.selectAllCandidates = selectAllCandidates;
window.importSelected = importSelected;

// ─── Background notification polling ───
