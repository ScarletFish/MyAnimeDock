// My List view — 全生命周期总览
let mylistData = [];
let mylistFilter = 'all';

// 引用自 ui.js 的 STATUS_LABELS
const MYLIST_LABELS = STATUS_LABELS;
const MYLIST_STATUS_ORDER = ['watching', 'wish', 'completed', 'on_hold', 'dropped'];

// ─── Sort (owned by My List, shared with Dashboard) ───

const ANIME_SORT_OPTIONS = [
  { key: 'name', label: '名称' },
  { key: 'recent', label: '最近观看' },
  { key: 'updated', label: '最近更新' },
  { key: 'rating', label: '评分' },
  { key: 'imported', label: '导入时间' },
];

const mylistSortDropdown = createDropdown({
  containerId: 'mylistSortDropdown',
  storageKey: 'mylistSort',
  options: ANIME_SORT_OPTIONS,
  onSelect: function() { renderMyList(); }
});

function sortAnimeItems(items, sortMode) {
  var FORMAT_RANK = { TV: 0, OVA: 1, SP: 2, MOVIE: 3 };

  function getBaseKey(a) {
    var t = (a.bangumiTitle || a.title || '').toLowerCase();
    t = t.replace(/[♪♫☆★！!？?~～\s]+/g, ' ').trim();
    t = t.replace(/\d+季/g, '').trim();
    t = t.replace(/\s*(OVA|SP|OAD|剧场版|Movie|Special|夏日时光|Dear My Sister|Sing For You|BLOOM|Nachuyachumi).*$/i, '').trim();
    t = t.replace(/\s+\d+[\s\S]*$/, '').trim();   // strip "3 High!" etc (digit not at string end)
    t = t.replace(/\d+$/, '').trim();               // strip trailing "3" etc
    return t || (a.title || a.id || '').toLowerCase();
  }
  function getSeasonRank(a) {
    var p = (a.platform || '').toUpperCase();
    var formatRank = FORMAT_RANK[p] != null ? FORMAT_RANK[p] : 0;
    var season = a.matchedSeason || a.season || 1;
    return formatRank * 100 + season;
  }
  function getJpName(a) {
    return (a.bangumiTitleJp || a.bangumiTitle || a.title || '').toLowerCase();
  }
  function getLastWatched(a) {
    if (!a.episodes || a.episodes.length === 0) return '';
    var latest = '';
    a.episodes.forEach(function(e) {
      if (e.updatedAt && e.updatedAt > latest) latest = e.updatedAt;
    });
    return latest;
  }
  function getBlockScore(block, key) {
    if (key === 'rating') return Math.max.apply(null, block.map(function(a) { return a.rating || 0; }));
    if (key === 'recent') return block.reduce(function(m, a) { var lw = getLastWatched(a); return lw > m ? lw : m; }, '');
    if (key === 'updated') return block.reduce(function(m, a) { return (a.importedAt || '') > m ? a.importedAt || '' : m; }, '');
    if (key === 'imported') return block.reduce(function(m, a) { var i = a.importedAt || 'z'; return i < m ? i : m; }, 'z');
    return getJpName(block[0]);
  }

  var groups = {};
  items.forEach(function(a) {
    var key = getBaseKey(a);
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  });
  var blocks = Object.values(groups);
  blocks.forEach(function(block) { block.sort(function(a, b) { return getSeasonRank(a) - getSeasonRank(b); }); });

  blocks.sort(function(a, b) {
    var sa = getBlockScore(a, sortMode);
    var sb = getBlockScore(b, sortMode);
    if (typeof sa === 'number') return sb - sa;
    if (sortMode === 'imported') return sa.localeCompare(sb);
    return sb.localeCompare(sa) || sa.localeCompare(sb);
  });

  var result = [];
  blocks.forEach(function(block) { block.forEach(function(a) { result.push(a); }); });
  return result;
}

async function loadMyList() {
  try {
    mylistData = await API.get('/api/mylist');
    renderMyListStatusBar();
    renderMyListSortDropdown();
    renderMyList();
  } catch (e) {
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载我的列表失败: ' + e.message, 'error');
  }
}

// ─── Status Bar ───

function renderMyListStatusBar() {
  const el = document.getElementById('mylistStatusBar');
  if (!el) return;
  const counts = { all: mylistData.length };
  MYLIST_STATUS_ORDER.forEach(s => counts[s] = 0);
  mylistData.forEach(item => {
    const s = item.status || 'wish';
    if (counts[s] != null) counts[s]++;
  });

  const statuses = [
    { key: 'all', label: '全部' },
    ...MYLIST_STATUS_ORDER.map(s => ({ key: s, label: MYLIST_LABELS[s] || s })),
  ];

  el.innerHTML = statuses.map(s => {
    const active = mylistFilter === s.key ? ' active' : '';
    return '<div class="mylist-status-item' + active + '" data-status="' + s.key + '" onclick="setMyListFilter(\'' + s.key + '\')">' +
      '<b>' + (counts[s.key] || 0) + '</b>' + s.label + '</div>';
  }).join('');
}

// ─── Sort Dropdown ───

function switchMyListSort(mode) {
  mylistSortDropdown.select(mode);
}

function renderMyListSortDropdown() {
  mylistSortDropdown.render();
}

// ─── Sorting ───

// ─── Filter & Render ───

function setMyListFilter(filter) {
  mylistFilter = filter;
  renderMyListStatusBar();
  renderMyList();
}

function renderMyList() {
  const empty = document.getElementById('mylistEmpty');
  const grid = document.getElementById('mylistGrid');

  let filtered = mylistData;
  if (mylistFilter !== 'all') {
    filtered = mylistData.filter(item => item.status === mylistFilter);
  }

  filtered = sortAnimeItems(filtered, mylistSortDropdown.current);

  if (filtered.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    const p = empty ? empty.querySelector('p') : null;
    if (p) p.textContent = mylistFilter === 'all' ? '暂无内容' : '暂无"' + (MYLIST_LABELS[mylistFilter] || '') + '"的条目';
    return;
  }

  if (empty) empty.style.display = 'none';

  if (mylistFilter === 'all') {
    renderAllTab(filtered);
  } else {
    renderFilteredTab(filtered);
  }

  applyGridZoom();

  document.querySelectorAll('#mylistView .anime-card').forEach(card => {
    card.style.animation = 'cardReveal 300ms var(--ease-out) forwards';
  });
}

function renderAllTab(items) {
  // Group by status
  const groups = {};
  for (const item of items) {
    const s = item.status || 'wish';
    if (!groups[s]) groups[s] = [];
    groups[s].push(item);
  }

  // Defined order
  const order = ['watching', 'wish', 'completed', 'on_hold', 'dropped'];

  let html = '';
  for (const status of order) {
    const group = groups[status];
    if (!group || group.length === 0) continue;
    html += `
      <div class="mylist-section">
        <div class="mylist-section-header">
          <span class="mylist-section-title">${MYLIST_LABELS[status]}</span>
          <span class="mylist-section-count">${group.length}</span>
        </div>
        <div class="grid-container">
          ${group.map(item => renderMyListCard(item)).join('')}
        </div>
      </div>`;
  }

  document.getElementById('mylistGrid').innerHTML = html || '';
}

function renderFilteredTab(items) {
  const grid = document.getElementById('mylistGrid');
  grid.innerHTML = `
    <div class="grid-container">
      ${items.map(item => renderMyListCard(item)).join('')}
    </div>`;
}

function renderMyListCard(item) {
  const isWish = item.source === 'wishlist';
  const extraAttrs = 'data-source="' + escAttr(item.source) + '" data-anime-id="' + escAttr(item.id) + '"';

  if (isWish) {
    return renderAnimeCard(item, {
      onClick: 'showWishlistDetail',
      onContextMenu: 'showMyListContextMenu',
      showMoreBtn: false,
      isWish: true,
      userRating: item.userRating,
      extraAttrs: extraAttrs
    });
  }

  return renderAnimeCard(item, {
    onClick: 'navigateToMyListDetail',
    onContextMenu: 'showMyListContextMenu',
    userRating: item.userRating,
    extraAttrs: extraAttrs
  });
}

// ─── Card click handlers ───

function navigateToMyListDetail(id, cardEl) {
  const img = cardEl.querySelector('img');
  let rect = null;
  let imgSrc = null;
  if (img && img.naturalWidth > 0) {
    rect = img.getBoundingClientRect();
    if (rect.width && rect.height) imgSrc = img.currentSrc || img.src;
  }
  showDetail(id, rect, imgSrc, 'mylist');
}

function showWishlistDetail(id) {
  const item = mylistData.find(i => i.id === id);
  if (!item) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = function (e) { if (e.target === this) this.remove(); };

  const coverSrc = item.coverUrl || '';
  overlay.innerHTML = `
    <div class="modal wishlist-detail-modal">
      ${coverSrc ? `<div class="wishlist-detail-cover"><img src="${coverSrc}" alt="${escAttr(item.bangumiTitle || item.title)}" loading="lazy" decoding="async"></div>` : ''}
      <h2>${escHtml(item.bangumiTitle || item.title)}</h2>
      ${item.rating ? `<div class="wishlist-detail-rating">★ ${item.rating}</div>` : ''}
      ${item.summary ? `<p class="wishlist-detail-summary">${escHtml(item.summary)}</p>` : ''}
      <div class="wishlist-detail-actions">
        <a class="btn btn-primary" href="https://bgm.tv/subject/${item.bangumiId}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          在 Bangumi 中打开
        </a>
        <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">关闭</button>
      </div>
      <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
}

// ─── Hover status popover ───

let _statusModalId = null;

// Reverse map for status dropdown: label → value
function _statusValue(label) {
  for (var k in STATUS_LABELS) {
    if (STATUS_LABELS[k] === label) return k;
  }
  return 'watching';
}

function toggleStatusDropdown(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('statusDd');
  if (!dd) return;
  var isOpen = dd.classList.toggle('is-open');
  if (isOpen) {
    var selected = dd.querySelector('.status-dd-opt.is-selected');
    if (selected) {
      var menu = dd.querySelector('.status-dd-menu');
      var scrollTop = selected.offsetTop - menu.offsetTop - menu.clientHeight / 2 + selected.clientHeight / 2;
      menu.scrollTop = Math.max(0, scrollTop);
    }
    document.addEventListener('click', closeStatusDropdown);
  }
}

function closeStatusDropdown(e) {
  var dd = document.getElementById('statusDd');
  if (!dd) return;
  if (e && dd.contains(e.target)) return;
  dd.classList.remove('is-open');
  document.removeEventListener('click', closeStatusDropdown);
}

function selectStatusOption(btn) {
  var dd = document.getElementById('statusDd');
  if (!dd) return;
  var value = btn.getAttribute('data-value');
  var label = btn.querySelector('span').textContent;
  document.getElementById('statusDdText').textContent = label;
  dd.querySelectorAll('.status-dd-opt').forEach(function(o) { o.classList.remove('is-selected'); });
  btn.classList.add('is-selected');
  dd.classList.remove('is-open');
  document.removeEventListener('click', closeStatusDropdown);
}

// ─── Number Stepper ───
function stepperChange(btn, delta) {
  var stepper = btn.closest('.num-stepper');
  if (!stepper) return;
  var min = parseFloat(stepper.getAttribute('data-min')) || 0;
  var max = parseFloat(stepper.getAttribute('data-max')) || 999;
  var step = parseFloat(stepper.getAttribute('data-step')) || 1;
  var valDisplay = stepper.querySelector('.num-stepper-val');
  var current = valDisplay.textContent === '—' ? 0 : parseFloat(valDisplay.textContent) || 0;
  var newVal = Math.round((current + delta) / step) * step;
  newVal = Math.max(min, Math.min(max, newVal));
  valDisplay.textContent = newVal === 0 && delta < 0 ? '—' : newVal;
}

// ─── Date Segments ───
function segAutoTab(input) {
  var val = input.value.replace(/\D/g, '');
  input.value = val;
  if (val.length >= input.maxLength) {
    var segs = input.closest('.date-segments');
    if (segs) {
      var inputs = segs.querySelectorAll('.date-seg');
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i] === input && i < inputs.length - 1) {
          inputs[i + 1].focus();
          break;
        }
      }
    }
  }
}

function readDateSegments(segs) {
  var y = segs.querySelector('.date-seg--y').value.trim();
  var m = segs.querySelector('.date-seg--m').value.trim();
  var d = segs.querySelector('.date-seg--d').value.trim();
  if (!y && !m && !d) return '';
  y = y.padStart(4, '0');
  m = m.padStart(2, '0') || '01';
  d = d.padStart(2, '0') || '01';
  return y + '-' + m + '-' + d;
}

function setDateToSegments(segs, dateStr) {
  if (dateStr) {
    var parts = dateStr.substring(0, 10).split('-');
    var yEl = segs.querySelector('.date-seg--y');
    var mEl = segs.querySelector('.date-seg--m');
    var dEl = segs.querySelector('.date-seg--d');
    if (yEl) yEl.value = parts[0] || '';
    if (mEl) mEl.value = parts[1] || '';
    if (dEl) dEl.value = parts[2] || '';
  }
}

// ─── Open Status Modal ───
function openStatusModal(e, id) {
  if (e) e.stopPropagation();
  _statusModalId = id;

  // Find the item
  const item = mylistData.find(function(i) { return i.id === id; });
  const libItem = typeof libraryData !== 'undefined' ? libraryData.find(function(a) { return a.id === id; }) : null;
  const anime = libItem || item;

  // Title
  const titleEl = document.getElementById('statusModalTitle');
  if (titleEl) titleEl.textContent = anime ? (anime.bangumiTitle || anime.title || '标记状态') : '标记状态';

  // Cover background
  const bgEl = document.getElementById('statusModalBg');
  if (bgEl) {
    var coverSrc = anime && anime.localCover
      ? '/covers/' + path.basename(anime.localCover) + '?w=600&q=80'
      : (anime && anime.coverUrl || '');
    if (coverSrc) {
      bgEl.style.backgroundImage = 'url(' + coverSrc + ')';
    } else {
      bgEl.style.backgroundImage = '';
    }
  }

  // Status: vanilla dropdown
  var curStatus = (item && item.status) || 'wish';
  document.getElementById('statusDdText').textContent = STATUS_LABELS[curStatus] || '计划中';
  document.getElementById('statusDd').querySelectorAll('.status-dd-opt').forEach(function(o) {
    o.classList.toggle('is-selected', o.getAttribute('data-value') === curStatus);
  });

  // Rating: num-stepper
  var rating = item && item.userRating != null ? item.userRating : '';
  var ratingDisplay = document.getElementById('ratingDisplay');
  if (ratingDisplay) ratingDisplay.textContent = rating !== '' ? rating : '—';

  // Progress
  var progressEl = document.getElementById('progressDisplay');
  if (progressEl) {
    const storedProgress = item && item.progress != null ? item.progress : null;
    const watchedCount = anime && anime.episodes ? anime.episodes.filter(function(e) { return e.watched; }).length : 0;
    var progVal = storedProgress != null ? storedProgress : (watchedCount || '');
    progressEl.textContent = progVal !== '' ? progVal : '—';
  }

  // Start date: three-segment
  const startSegs = document.querySelector('.date-segments[data-date="startedAt"]');
  if (startSegs) {
    const storedStart = item && item.startedAt ? item.startedAt : null;
    setDateToSegments(startSegs, storedStart ? storedStart.substring(0, 10) : _todayStr());
  }

  // End date
  const endSegs = document.querySelector('.date-segments[data-date="completedAt"]');
  if (endSegs) {
    const storedEnd = item && item.completedAt ? item.completedAt : null;
    setDateToSegments(endSegs, storedEnd ? storedEnd.substring(0, 10) : _todayStr());
  }

  // Notes
  const notesEl = document.getElementById('notesInput');
  if (notesEl) notesEl.value = (item && item.notes) || '';

  openModal('statusModal');
}

function _todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// ─── Save Status Modal ───
async function saveStatusModal() {
  var id = _statusModalId;
  if (!id) return;

  // Read status from custom dropdown
  var statusText = document.getElementById('statusDdText').textContent;
  var status = _statusValue(statusText);

  // Read rating from stepper display
  var ratingText = document.getElementById('ratingDisplay').textContent;
  var rating = ratingText !== '—' ? parseFloat(ratingText) : null;

  // Read progress from stepper display
  var progressText = document.getElementById('progressDisplay').textContent;
  var progress = progressText !== '—' ? parseInt(progressText, 10) : null;

  // Read dates from segments
  var startSegs = document.querySelector('.date-segments[data-date="startedAt"]');
  var endSegs = document.querySelector('.date-segments[data-date="completedAt"]');
  var startedAt = startSegs ? readDateSegments(startSegs) : '';
  var completedAt = endSegs ? readDateSegments(endSegs) : '';

  // Read notes
  var notes = (document.getElementById('notesInput').value || '');

  var data = {
    status: status,
    rating: rating,
    progress: progress,
    startedAt: startedAt ? startedAt + 'T00:00:00.000Z' : null,
    completedAt: completedAt ? completedAt + 'T00:00:00.000Z' : null,
    notes: notes,
  };

  try {
    await API.put('/api/mylist/' + encodeURIComponent(id), data);
    showToast('已保存', 'success');
    closeModal('statusModal');
    hideContextMenu();
    loadMyList();
    if (typeof loadLibrary === 'function') loadLibrary();
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

// ─── Context menu (right-click status change) ───

function showMyListContextMenu(e, id) {
  e.preventDefault();
  e.stopPropagation();
  const item = mylistData.find(i => i.id === id);
  if (!item) return;
  contextMenuAnimeId = id;
  contextMenuCard = e.currentTarget;

  const menu = document.getElementById('contextMenu');

  if (item.source === 'wishlist') {
    menu.innerHTML = `
      <div class="context-menu-item context-menu-danger" onclick="event.stopPropagation();deleteWishlistItem('${id}')">从愿望单移除</div>`;
  } else {
    const title = item.bangumiTitle || item.title || '';
    menu.innerHTML =
      '<div class="context-menu-item" onclick="event.stopPropagation();navigator.clipboard.writeText(\'' + escAttr(title) + '\').then(function(){showToast(\'已复制\',\'success\')}).catch(function(){showToast(\'复制失败\',\'error\')});hideContextMenu()">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
        '<span>复制标题</span>' +
      '</div>' +
      '<div class="context-menu-item" onclick="event.stopPropagation();hideContextMenu();(window.__TAURI__?.shell?.open||function(u){window.open(u,\'_blank\')})(\'https://bgm.tv/subject/' + id + '\')">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
        '<span>在 Bangumi 打开</span>' +
      '</div>' +
      '<div class="context-menu-divider"></div>' +
      '<div class="context-menu-item" onclick="event.stopPropagation();hideContextMenu();openStatusModal(null, \'' + id + '\')">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
        '<span>标记状态</span>' +
      '</div>' +
      '<div class="context-menu-divider"></div>' +
      '<div class="context-menu-item context-menu-danger" onclick="event.stopPropagation();removeMyListItem(\'' + id + '\')">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>' +
        '<span>移除</span>' +
      '</div>';
  }

  // Position
  let x = e.clientX;
  let y = e.clientY;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('show');
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

async function setMyListItemStatus(id, status) {
  try {
    await API.put(`/api/mylist/${encodeURIComponent(id)}/status`, { status });
    showToast('状态已更新', 'success');
    hideContextMenu();
    loadMyList();
    if (typeof loadLibrary === 'function') loadLibrary();
  } catch (e) {
    showToast('更新失败: ' + e.message, 'error');
  }
}

async function deleteWishlistItem(id) {
  hideContextMenu();
  if (!(await showConfirm('从愿望单移除？'))) return;
  try {
    await API.del(`/api/wishlist/${encodeURIComponent(id)}`);
    showToast('已移除', 'info');
    loadMyList();
  } catch (e) {
    showToast('移除失败: ' + e.message, 'error');
  }
}

async function removeMyListItem(id) {
  hideContextMenu();
  const item = mylistData.find(i => i.id === id);
  const name = item ? (item.bangumiTitle || item.title || id) : id;
  if (!(await showConfirm(`将「${name}」从列表中移除？<br><small class="text-content">动漫库中的条目不受影响</small>`))) return;
  try {
    await API.del(`/api/mylist/${encodeURIComponent(id)}`);
    showToast('已移除', 'info');
    loadMyList();
  } catch (e) {
    showToast('移除失败: ' + e.message, 'error');
  }
}

// ─── ESM exports for onclick handlers ───
window.toggleStatusDropdown = toggleStatusDropdown;
window.selectStatusOption = selectStatusOption;
window.stepperChange = stepperChange;
window.segAutoTab = segAutoTab;
window.saveStatusModal = saveStatusModal;
