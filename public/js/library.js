// Library view logic
let libraryData = [];
let contextMenuAnimeId = null;
let cardScrollTrigger = null;
let cardTween = null;

// Grid zoom
const GRID_ZOOM_MIN = 0.5;
const GRID_ZOOM_MAX = 2.0;
const GRID_BASE_SIZE = 207;
let gridZoom = parseFloat(localStorage.getItem('gridZoom') || '1');

// Dashboard section definitions
const DASHBOARD_SECTIONS = {
  stats: { title: '统计概览', defaultEnabled: true },
  continueWatch: { title: '继续观看', defaultEnabled: true },
  allAnime: { title: '全部动漫', defaultEnabled: true }
};
const DASHBOARD_DEFAULT_LAYOUT = [
  { id: 'stats', enabled: true },
  { id: 'continueWatch', enabled: true },
  { id: 'allAnime', enabled: true }
];

function getDashboardLayout() {
  try {
    const stored = localStorage.getItem('dashboardLayout');
    if (stored) {
      var layout = JSON.parse(stored);
      // Remove sections no longer defined
      layout = layout.filter(function(s) { return DASHBOARD_SECTIONS[s.id]; });
      // Merge new sections from defaults that aren't in stored layout
      var ids = layout.map(function(s) { return s.id; });
      DASHBOARD_DEFAULT_LAYOUT.forEach(function(s) {
        if (ids.indexOf(s.id) === -1) layout.push({ id: s.id, enabled: s.enabled });
      });
      return layout;
    }
  } catch {}
  return DASHBOARD_DEFAULT_LAYOUT.map(s => ({ ...s }));
}
function saveDashboardLayout(layout) {
  localStorage.setItem('dashboardLayout', JSON.stringify(layout));
}

function applyGridZoom() {
  const grid = document.getElementById('libraryGrid');
  if (!grid) return;
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
  const size = Math.round(GRID_BASE_SIZE * gridZoom * scale);
  grid.style.setProperty('--grid-min', size + 'px');
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
  // Also apply to mylist grids
  document.documentElement.style.setProperty('--grid-zoom-size', size + 'px');
  document.querySelectorAll('#mylistView .grid-container').forEach(g => {
    g.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
  });
}

function showZoomLevel() {
  let el = document.getElementById('zoomLevel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'zoomLevel';
    el.className = 'zoom-level';
    document.querySelector('.main-content').appendChild(el);
  }
  el.textContent = Math.round(gridZoom * 100) + '%';
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 1000);
}

gsap.registerPlugin(ScrollTrigger);

function initSortSelect() {
  const dropdown = document.getElementById('librarySort');
  const saved = localStorage.getItem('librarySort') || 'default';
  const target = dropdown.querySelector(`.sort-dropdown-option[data-value="${saved}"]`);
  if (target) {
    dropdown.querySelectorAll('.sort-dropdown-option').forEach(o => o.classList.remove('selected'));
    target.classList.add('selected');
    dropdown.querySelector('.sort-dropdown-label').textContent = target.textContent;
  }
  Object.defineProperty(dropdown, 'value', {
    get() {
      const sel = dropdown.querySelector('.sort-dropdown-option.selected');
      return sel ? sel.dataset.value : 'default';
    }
  });
  dropdown.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSortDropdown();
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) closeSortDropdown();
  });
}

function toggleSortDropdown() {
  const dropdown = document.getElementById('librarySort');
  const isOpen = dropdown.classList.contains('open');
  if (isOpen) closeSortDropdown();
  else {
    dropdown.classList.add('open');
    dropdown.focus();
  }
}

function closeSortDropdown() {
  document.getElementById('librarySort').classList.remove('open');
}

function selectSortOption(opt) {
  const dropdown = document.getElementById('librarySort');
  dropdown.querySelectorAll('.sort-dropdown-option').forEach(o => o.classList.remove('selected'));
  opt.classList.add('selected');
  dropdown.querySelector('.sort-dropdown-label').textContent = opt.textContent;
  localStorage.setItem('librarySort', opt.dataset.value);
  closeSortDropdown();
  filterLibrary();
}

function killCardAnimations() {
  if (cardTween) { cardTween.kill(); cardTween = null; }
  if (cardScrollTrigger) { cardScrollTrigger.kill(); cardScrollTrigger = null; }
}

async function loadLibrary() {
  try {
    libraryData = await API.get('/api/library');
    renderDashboard();
  } catch (e) {
    // Tauri 初始加载时（frontendDist，非 server 源）静默失败
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载资料库失败: ' + e.message, 'error');
  }
}

function renderDashboard() {
  const container = document.getElementById('libraryDashboard');
  if (!container) return;

  const layout = getDashboardLayout();
  const enabledSections = layout.filter(s => s.enabled);

  // Build HTML structure
  container.innerHTML = enabledSections.map(s => {
    const def = DASHBOARD_SECTIONS[s.id];
    if (!def) return '';
    return '<div class="dashboard-section" data-section="' + s.id + '">' +
      '<div class="dashboard-section-header">' +
        '<span class="dashboard-section-title">' + def.title + '</span>' +
      '</div>' +
      '<div class="dashboard-section-body" id="dashSection-' + s.id + '"></div>' +
    '</div>';
  }).join('');

  // Render each section
  for (const s of enabledSections) {
    const body = document.getElementById('dashSection-' + s.id);
    if (!body) continue;
    if (s.id === 'stats') renderStatsSection(libraryData, body);
    else if (s.id === 'continueWatch') renderContinueSection(libraryData, body);
    else if (s.id === 'allAnime') renderAllAnimeSection(libraryData, body);
  }
}

function renderStatsSection(data, container) {
  container.innerHTML = '<div class="dashboard-stats-loading">加载中...</div>';

  API.get('/api/stats').then(function(stats) {
    function fmtTime(sec) {
      if (sec < 60) return sec + 's';
      if (sec < 3600) return Math.round(sec / 60) + 'min';
      var h = Math.floor(sec / 3600);
      var m = Math.round((sec % 3600) / 60);
      return m > 0 ? h + 'h ' + m + 'min' : h + 'h';
    }
    function fmtSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
      return (bytes / 1073741824).toFixed(2) + ' GB';
    }
    var timeStr = fmtTime(stats.totalWatchSeconds || 0);
    var sizeStr = fmtSize(stats.totalFileSize || 0);
    container.innerHTML =
      '<div class="dashboard-stats">' +
        '<div class="dashboard-stats-item"><b>' + sizeStr + '</b>大小</div>' +
        '<div class="dashboard-stats-item"><b>' + stats.totalFileCount + '</b>文件</div>' +
        '<div class="dashboard-stats-item"><b>' + stats.watching + '</b>追番</div>' +
        '<div class="dashboard-stats-item"><b>' + stats.completed + '</b>看完</div>' +
        '<div class="dashboard-stats-item"><b>' + stats.total + '</b>本地</div>' +
        '<div class="dashboard-stats-item"><b>' + stats.totalEpWatched + '</b>集数</div>' +
        '<div class="dashboard-stats-item"><b>' + timeStr + '</b>时长</div>' +
      '</div>';
  }).catch(function() {
    container.style.display = 'none';
  });
}

function findContinueEpisode(anime) {
  if (!anime.episodes || anime.episodes.length === 0) return null;
  var first = null;
  for (var i = 0; i < anime.episodes.length; i++) {
    var ep = anime.episodes[i];
    if (!first) first = ep;
    if (!ep.watched && ep.progress > 0) return ep;
  }
  for (var i = 0; i < anime.episodes.length; i++) {
    if (!anime.episodes[i].watched) return anime.episodes[i];
  }
  return first;
}

function navigateToDetailWithPlay(id, rect) {
  pendingAutoPlay = id;
  navigateToDetail(id, rect);
}

var pendingAutoPlay = null;

function renderContinueSection(data, container) {
  var watching = data.filter(function(a) {
    if (!a.episodes || a.episodes.length === 0) return false;
    var watchedCount = a.episodes.filter(function(e) { return e.watched; }).length;
    var inProgress = a.episodes.some(function(e) { return e.progress > 0 && !e.watched; });
    return inProgress || (watchedCount > 0 && watchedCount < a.episodes.length);
  }).sort(function(a, b) {
    var aLast = Math.max.apply(null, (a.episodes || []).map(function(e) { return e.updatedAt ? new Date(e.updatedAt).getTime() : 0; }));
    var bLast = Math.max.apply(null, (b.episodes || []).map(function(e) { return e.updatedAt ? new Date(e.updatedAt).getTime() : 0; }));
    return bLast - aLast;
  }).slice(0, 10);

  container.parentElement.style.display = watching.length === 0 ? 'none' : '';
  if (watching.length === 0) return;

  container.innerHTML = '<div class="dashboard-continue-scroll">' +
    watching.map(function(a) {
      var total = a.episodes ? a.episodes.length : 0;
      var watchedCount = a.episodes ? a.episodes.filter(function(e) { return e.watched; }).length : 0;
      var nextEp = Math.min(watchedCount + 1, total);
      var title = escHtml(a.bangumiTitle || a.title);

      var ep = findContinueEpisode(a);
      var thumbUrl = '';
      if (ep) {
        var thumbTime = ep.progress > 0 ? ep.progress : 60;
        thumbUrl = '/api/thumbnail?path=' + encodeURIComponent(ep.filePath) + '&time=' + thumbTime;
      }
      var coverSrc = a.localCover
        ? '/covers/' + path.basename(a.localCover) + '?w=500&q=75'
        : (a.coverUrl || '');
      var bgStyle = thumbUrl ? ' style="background-image:url(' + escAttr(thumbUrl) + ')"' :
        (coverSrc ? ' style="background-image:url(' + escAttr(coverSrc) + ')"' : '');

      return '<div class="dashboard-continue-card" onclick="navigateToDetailWithPlay(\'' + escAttr(a.id) + '\', this)" oncontextmenu="showContextMenu(event, \'' + escAttr(a.id) + '\')">' +
        '<div class="dashboard-continue-bg"' + bgStyle + '></div>' +
        '<div class="dashboard-continue-overlay"></div>' +
        '<div class="dashboard-continue-content">' +
          '<div class="dashboard-continue-info">' +
            '<div class="dashboard-continue-label">继续播放</div>' +
            '<div class="dashboard-continue-title">' + title + '</div>' +
            '<div class="dashboard-continue-progress-wrap">' +
              '<span class="dashboard-continue-progress-label">第 ' + nextEp + ' / ' + total + ' 集</span>' +
            '</div>' +
          '</div>' +
          '<button class="dashboard-continue-btn" onclick="event.stopPropagation();navigateToDetailWithPlay(\'' + escAttr(a.id) + '\', this)">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>' +
            '继续播放' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

function renderAllAnimeSection(data, container, filter) {
  if (!filter) filter = '';
  var currentStatusFilter = container._statusFilter || 'all';
  var statusFilters = [
    { id: 'all', label: '全部' },
    { id: 'watching', label: '在看' },
    { id: 'completed', label: '看完' },
    { id: 'on_hold', label: '搁置' },
    { id: 'dropped', label: '抛弃' }
  ];

  var filtered = [].concat(data);

  if (currentStatusFilter !== 'all') {
    filtered = filtered.filter(function(a) { return a.myListStatus === currentStatusFilter; });
  }

  if (filter) {
    var q = filter.toLowerCase();
    filtered = filtered.filter(function(a) {
      return a.title.toLowerCase().includes(q) ||
        (a.bangumiTitle && a.bangumiTitle.toLowerCase().includes(q)) ||
        (a.pinyinTitle && a.pinyinTitle.toLowerCase().includes(q));
    });
  }

  var sortEl = document.getElementById('librarySort');
  var sortMode = sortEl ? sortEl.value : 'default';
  filtered = sortLibrary(filtered, sortMode);

  container.innerHTML =
    '<div class="all-anime-toolbar">' +
      '<div class="all-anime-status-tabs">' +
        statusFilters.map(function(sf) {
          return '<button class="all-anime-status-tab' + (currentStatusFilter === sf.id ? ' active' : '') + '" data-status="' + sf.id + '" onclick="setAllAnimeStatusFilter(\'' + sf.id + '\')">' + sf.label + '</button>';
        }).join('') +
      '</div>' +
      '<div class="all-anime-controls">' +
        '<div class="sort-dropdown" id="librarySort" tabindex="0">' +
          '<button class="sort-dropdown-trigger" onclick="toggleSortDropdown()">' +
            '<span class="sort-dropdown-label">默认排序</span>' +
            '<svg class="sort-dropdown-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="sort-dropdown-panel">' +
            '<div class="sort-dropdown-option" data-value="default" onclick="selectSortOption(this)">默认排序</div>' +
            '<div class="sort-dropdown-option" data-value="pinyin" onclick="selectSortOption(this)">拼音</div>' +
            '<div class="sort-dropdown-option" data-value="importDate" onclick="selectSortOption(this)">导入日期</div>' +
            '<div class="sort-dropdown-option" data-value="rating" onclick="selectSortOption(this)">评分</div>' +
          '</div>' +
        '</div>' +
        '<input type="text" class="search-input" id="librarySearch" placeholder="搜索动漫..." oninput="filterLibrary()">' +
      '</div>' +
    '</div>' +
    '<div class="grid-container" id="libraryGrid"></div>' +
    '<div class="empty-state" id="libraryEmpty" style="display:none">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>' +
      '<p>暂无条目</p>' +
      '<p style="font-size: 14px; color: var(--fg-muted)">' + (filter ? '没有匹配"' + escHtml(filter) + '"的动漫' : '设置媒体目录后自动导入动漫') + '</p>' +
    '</div>';

  // Re-init sort dropdown
  initSortSelect();

  var grid = document.getElementById('libraryGrid');
  var empty = document.getElementById('libraryEmpty');

  if (filtered.length === 0) {
    killCardAnimations();
    grid.innerHTML = '';
    var ps = empty.querySelectorAll('p');
    if (filter) {
      ps[0].textContent = '未检索到结果';
      ps[1].textContent = '没有匹配"' + filter + '"的动漫';
    } else {
      ps[0].textContent = '暂无条目';
      ps[1].textContent = '设置媒体目录后自动导入动漫';
    }
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = filtered.map(function(a) { return renderAnimeCard(a); }).join('');

  var cards = grid.querySelectorAll('.anime-card');
  if (cards.length === 0) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  killCardAnimations();

  var scroller = document.querySelector('.main-content');
  var scrollerRect = scroller.getBoundingClientRect();
  var visible = [];
  var hidden = [];
  cards.forEach(function(card) {
    var r = card.getBoundingClientRect();
    if (r.bottom > scrollerRect.top && r.top < scrollerRect.bottom) visible.push(card);
    else hidden.push(card);
  });
  visible.forEach(function(card) {
    card.style.animation = 'cardReveal 300ms var(--ease-out) forwards';
  });

  if (hidden.length > 0) {
    gsap.set(hidden, { opacity: 0, y: 24, scale: 0.97 });
    cardScrollTrigger = ScrollTrigger.create({
      scroller: '.main-content',
      trigger: grid,
      start: 'top bottom',
      once: true,
      onEnter: function() {
        cardTween = gsap.to(hidden, {
          opacity: 1, y: 0, scale: 1,
          stagger: 0.03,
          duration: 0.35,
          ease: 'back.out(1.4)',
          onComplete: function() { cardTween = null; }
        });
      }
    });
  }
  applyGridZoom();
}

function setAllAnimeStatusFilter(status) {
  var body = document.getElementById('dashSection-allAnime');
  if (!body) return;
  body._statusFilter = status;
  var q = document.getElementById('librarySearch');
  renderAllAnimeSection(libraryData, body, q ? q.value : '');
}
window.setAllAnimeStatusFilter = setAllAnimeStatusFilter;

function filterLibrary() {
  var q = document.getElementById('librarySearch');
  var body = document.getElementById('dashSection-allAnime');
  if (body) {
    renderAllAnimeSection(libraryData, body, q ? q.value : '');
  }
}

function sortLibrary(items, mode) {
  if (mode === 'default') return items;
  const sorted = [...items];
  switch (mode) {
    case 'pinyin':
      sorted.sort((a, b) => (a.pinyinTitle || '').localeCompare(b.pinyinTitle || ''));
      break;
    case 'importDate':
      sorted.sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
      break;
    case 'rating':
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
  }
  return applySeriesGrouping(sorted);
}

function applySeriesGrouping(sorted) {
  const seriesMap = new Map();
  for (const item of sorted) {
    if (!seriesMap.has(item.title)) seriesMap.set(item.title, []);
    seriesMap.get(item.title).push(item);
  }
  const multiSeasonTitles = new Set();
  for (const [title, items] of seriesMap) {
    if (items.length > 1) {
      multiSeasonTitles.add(title);
      items.sort((a, b) => (a.season || Infinity) - (b.season || Infinity));
    }
  }
  if (multiSeasonTitles.size === 0) return sorted;
  const result = [];
  const placed = new Set();
  for (const item of sorted) {
    if (placed.has(item.title)) continue;
    if (multiSeasonTitles.has(item.title)) {
      result.push(...seriesMap.get(item.title));
      placed.add(item.title);
    } else {
      result.push(item);
    }
  }
  return result;
}

// --- Context Menu ---
function showContextMenu(e, animeId) {
  e.preventDefault();
  e.stopPropagation();
  contextMenuAnimeId = animeId;
  const menu = document.getElementById('contextMenu');

  const anime = libraryData.find(function(a) { return a.id === animeId; });
  var title = '';
  var bangumiId = null;
  var myListStatus = null;
  if (anime) {
    title = anime.bangumiTitle || anime.title || '';
    bangumiId = anime.bangumiId || null;
    myListStatus = anime.myListStatus || null;
  }

  var statusItems = [
    { value: 'wish', label: '想看', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="' + (myListStatus === 'wish' ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>' },
    { value: 'watching', label: '在看', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="' + (myListStatus === 'watching' ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
    { value: 'completed', label: '看完', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' },
    { value: 'on_hold', label: '搁置', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>' },
  ];

  menu.innerHTML =
    '<div class="context-menu-item" id="ctxCopyTitle">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
      '<span>复制标题</span>' +
    '</div>' +
    (bangumiId ? '<div class="context-menu-item" id="ctxOpenBgm">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
      '<span>在 Bangumi 打开</span>' +
    '</div>' : '') +
    '<div class="context-menu-divider"></div>' +
    statusItems.map(function(s) {
      var cls = 'context-menu-item';
      if (s.value === myListStatus) cls += ' context-menu-item--active';
      return '<div class="' + cls + '" onclick="event.stopPropagation();contextSetStatus(\'' + animeId + '\', \'' + s.value + '\')">' +
        s.icon +
        '<span>' + s.label + '</span>' +
        (s.value === myListStatus ? '<span class="context-menu-check"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : '') +
      '</div>';
    }).join('') +
    '<div class="context-menu-divider"></div>' +
    '<div class="context-menu-item" id="ctxArchive">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>' +
      '<span>归档</span>' +
    '</div>' +
    '<div class="context-menu-item context-menu-danger" id="ctxDelete">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>' +
      '<span>移除</span>' +
    '</div>';

  // Bind event listeners
  document.getElementById('ctxDelete').addEventListener('click', contextDeleteAnime);
  document.getElementById('ctxArchive').addEventListener('click', contextArchiveAnime);
  document.getElementById('ctxCopyTitle').addEventListener('click', contextCopyTitle);
  if (bangumiId) {
    document.getElementById('ctxOpenBgm').addEventListener('click', contextOpenBgm);
  }

  // Position
  let x = e.clientX;
  let y = e.clientY;
  menu.classList.add('show');
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function contextCopyTitle() {
  const id = contextMenuAnimeId;
  hideContextMenu();
  if (!id) return;
  const anime = libraryData.find(function(a) { return a.id === id; });
  if (!anime) return;
  const title = anime.bangumiTitle || anime.title || '';
  if (!title) return;
  navigator.clipboard.writeText(title).then(function() {
    showToast('已复制「' + title + '」', 'success');
  }).catch(function() {
    showToast('复制失败', 'error');
  });
}

function contextOpenBgm() {
  const id = contextMenuAnimeId;
  hideContextMenu();
  if (!id) return;
  const anime = libraryData.find(function(a) { return a.id === id; });
  if (!anime || !anime.bangumiId) return;
  window.open('https://bgm.tv/subject/' + anime.bangumiId, '_blank', 'noopener');
}

function contextSetStatus(animeId, status) {
  setMyListItemStatus(animeId, status);
}

function hideContextMenu() {
  document.getElementById('contextMenu').classList.remove('show');
  contextMenuAnimeId = null;
}

async function contextDeleteAnime() {
  const animeId = contextMenuAnimeId;
  hideContextMenu();
  if (!animeId) return;
  const anime = libraryData.find(a => a.id === animeId);
  const title = anime ? anime.title : animeId;
  if (!(await showConfirm(`确定要彻底删除「${title}」吗？<br>数据将被清除，不可恢复。`))) return;
  try {
    await API.del(`/api/anime/${encodeURIComponent(animeId)}`);
    showToast('已删除，已归档到追番列表', 'success');
    loadLibrary();
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.context-menu')) hideContextMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
document.getElementById('ctxDelete').addEventListener('click', contextDeleteAnime);
document.getElementById('ctxArchive').addEventListener('click', contextArchiveAnime);

async function contextArchiveAnime() {
  const animeId = contextMenuAnimeId;
  hideContextMenu();
  if (!animeId) return;
  const anime = libraryData.find(a => a.id === animeId);
  const title = anime ? anime.title : animeId;
  if (!(await showConfirm(`将「${title}」归档到收藏？<br>条目将从资料库移除，在归档页保留记录。`))) return;
  try {
    // Create memory entry first, then delete from library
    await API.post('/api/memories', {
      animeId,
      rating: null,
      thoughts: '',
      notes: '',
    });
    await API.del(`/api/anime/${encodeURIComponent(animeId)}`);
    showToast('已归档', 'success');
    loadLibrary();
    if (typeof loadMyList === 'function') loadMyList();
  } catch (e) {
    showToast('归档失败: ' + e.message, 'error');
  }
}

function navigateToDetail(id, cardEl) {
  const img = cardEl.querySelector('img');
  let rect = null;
  let imgSrc = null;
  if (img) {
    rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) rect = null;
    else imgSrc = img.currentSrc || img.src;
  }
  showDetail(id, rect, imgSrc);
}

// --- Library Sync ---
let syncInProgress = false;

// --- Grid Zoom: wheel listener (delta-proportional) ---
// 监听在滚动容器 .main-content 上，避免 Chromium 合成器滚动拦截 preventDefault()
document.querySelector('.main-content').addEventListener('wheel', function(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  const grid = document.getElementById('libraryGrid');
  const mylistGrid = document.querySelector('#mylistView .grid-container');
  if (!grid || (!grid.contains(e.target) && (!mylistGrid || !mylistGrid.contains(e.target)))) return;
  e.preventDefault();
  // deltaY proportional: mouse notch ~100px → 0.08, trackpad light ~10px → 0.008
  const absDelta = Math.min(Math.abs(e.deltaY), 300);
  const zoomDelta = absDelta * 0.0008 * (e.deltaY > 0 ? -1 : 1);
  const newZoom = Math.max(GRID_ZOOM_MIN, Math.min(GRID_ZOOM_MAX, gridZoom + zoomDelta));
  if (newZoom !== gridZoom) {
    gridZoom = newZoom;
    localStorage.setItem('gridZoom', gridZoom);
    applyGridZoom();
    showZoomLevel();
  }
}, { passive: false });

// Apply persisted zoom on load
applyGridZoom();
