// Library view logic
let libraryData = [];
let contextMenuAnimeId = null;
let contextMenuCard = null;
let cardScrollTrigger = null;
let cardTween = null;

// Grid card sizing — matches detail cover size (240px × --scale)
const GRID_CARD_BASE = 240;

function applyGridZoom() {
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
  const size = Math.round(GRID_CARD_BASE * scale);
  document.querySelectorAll('#libraryDashboard .grid-container, #mylistView .grid-container').forEach(g => {
    g.style.gridTemplateColumns = `repeat(auto-fill, ${size}px)`;
    g.style.justifyContent = 'center';
  });
}

gsap.registerPlugin(ScrollTrigger);

function killCardAnimations() {
  if (cardTween) { cardTween.kill(); cardTween = null; }
  if (cardScrollTrigger) { cardScrollTrigger.kill(); cardScrollTrigger = null; }
}

async function loadLibrary(soft = false) {
  try {
    // Save scroll for in-place refresh (context menu delete/archive, etc.)
    // When called from showView (view switch), skip — showView already saved it
    if (!_libraryChangingView && currentView === 'library') {
      const mc = document.querySelector('.main-content');
      if (mc) libraryScrollTop = mc.scrollTop;
    }
    _libraryChangingView = false;
    var newData = await API.get('/api/library');

    // Soft refresh: preserve ALL DOM when data hasn't changed
    // No layout shift → scroll position stays exactly as saved
    // Only skip re-render if we have existing DOM (first load always re-renders)
    if (soft && libraryData.length > 0) {
      var oldIds = libraryData.map(function(a) { return a.id; }).sort().join(',');
      var newIds = newData.map(function(a) { return a.id; }).sort().join(',');
      if (oldIds === newIds) {
        libraryData = newData;
        // Refresh stats + continue section (data may have changed: progress, counts)
        var statsBody = document.getElementById('dashSection-stats');
        if (statsBody) await renderStatsSection(libraryData, statsBody);
        var contBody = document.getElementById('dashSection-continueWatch');
        if (contBody) renderContinueSection(libraryData, contBody);
        __debug.snapshot('loadLibrary soft — before restore');
        restoreLibraryScroll();
        return;
      }
    }

    libraryData = newData;
    await renderDashboard();     // 等所有异步 section（stats）加载完
    __debug.snapshot('loadLibrary hard — before restore');
    restoreLibraryScroll();      // 此时内容高度已稳定
  } catch (e) {
    // Tauri 初始加载时（frontendDist，非 server 源）静默失败
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载动漫库失败: ' + e.message, 'error');
  }
}

function restoreLibraryScroll() {
  if (currentView !== 'library') return;
  const mc = document.querySelector('.main-content');
  if (!mc) return;
  mc.scrollTop = libraryScrollTop;
  __debug.log('SCROLL', 'restored to', libraryScrollTop, '(max:', mc.scrollHeight - mc.clientHeight, ')');
}

function renderDashboard() {
  const container = document.getElementById('libraryDashboard');
  if (!container) return;

  // Empty state
  if (libraryData.length === 0) {
    container.innerHTML = '';
    const emptyState = document.createElement('div');
    emptyState.className = 'library-empty-state';
    emptyState.innerHTML =
      '<div class="library-empty-icon">' +
        '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="8" y="14" width="48" height="40" rx="4" stroke-opacity="0.6"/>' +
          '<path d="M8 26h48" stroke-opacity="0.3"/>' +
          '<rect x="16" y="34" width="12" height="14" rx="1" fill="currentColor" fill-opacity="0.06" stroke-opacity="0.5"/>' +
          '<rect x="32" y="34" width="12" height="14" rx="1" fill="currentColor" fill-opacity="0.06" stroke-opacity="0.5"/>' +
          '<path d="M22 40l4-2v4l-4-2z" fill="currentColor" fill-opacity="0.3" stroke="none"/>' +
          '<path d="M38 40l4-2v4l-4-2z" fill="currentColor" fill-opacity="0.3" stroke="none"/>' +
        '</svg>' +
      '</div>' +
      '<h2 class="library-empty-title">还没有导入动漫</h2>' +
      '<p class="library-empty-desc">先去发现页扫描你的动漫文件夹，<br>然后导入到资料库开始管理吧</p>' +
      '<div class="library-empty-actions">' +
        '<button class="btn btn-primary" onclick="showView(\'discovery\')">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>' +
          '去发现页' +
        '</button>' +
        '<button class="btn" onclick="openSettings()">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
          '设置媒体目录' +
        '</button>' +
      '</div>';
    container.appendChild(emptyState);
    return;
  }

  // 从 localStorage 读取布局配置（过滤禁用项 + 按顺序渲染）
  var layout = (typeof getDashboardLayout === 'function')
    ? getDashboardLayout()
    : [{ id: 'stats', enabled: true }, { id: 'continueWatch', enabled: true }, { id: 'localLibrary', enabled: true }];

  var sectionHTML = '';
  var sectionIds = [];
  layout.forEach(function(s) {
    if (!s.enabled) return;
    switch (s.id) {
      case 'stats':
        sectionIds.push('stats');
        sectionHTML += '<div class="dashboard-section" data-section="stats">' +
          '<div class="dashboard-section-header"><span class="dashboard-section-title">统计概览</span></div>' +
          '<div class="dashboard-section-body" id="dashSection-stats"></div></div>';
        break;
      case 'continueWatch':
        sectionIds.push('continueWatch');
        sectionHTML += '<div class="dashboard-section" data-section="continueWatch">' +
          '<div class="dashboard-section-header"><span class="dashboard-section-title">继续观看</span></div>' +
          '<div class="dashboard-section-body" id="dashSection-continueWatch"></div></div>';
        break;
      case 'localLibrary':
        sectionIds.push('localLibrary');
        sectionHTML += '<div class="dashboard-section" data-section="localLibrary">' +
          '<div class="dashboard-section-header"><span class="dashboard-section-title">本地动漫</span></div>' +
          '<div class="dashboard-section-body" id="dashSection-localLibrary"></div></div>';
        break;
    }
  });

  container.innerHTML = sectionHTML;

  // Render sections
  const promises = [];
  if (sectionIds.indexOf('stats') !== -1) {
    var statsBody = document.getElementById('dashSection-stats');
    if (statsBody) promises.push(renderStatsSection(libraryData, statsBody));
  }
  if (sectionIds.indexOf('continueWatch') !== -1) {
    var contBody = document.getElementById('dashSection-continueWatch');
    if (contBody) renderContinueSection(libraryData, contBody);
  }
  renderStatusGrids(libraryData);
  return Promise.all(promises);
}

function renderStatsSection(data, container) {
  container.innerHTML = '<div class="dashboard-stats-loading">加载中...</div>';

  return API.get('/api/stats').then(function(stats) {
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
        // Same thumbnail as detail page watch card: use progress position if available
        // Guard against corrupt 0-1 normalized data: treat <1s as invalid for regular videos
        var durationSafe = ep.duration > 0 ? ep.duration : 0;
        var thumbTime = 60; // default fallback: 1min in
        if (ep.progress > 0 && durationSafe > 0) {
          if (ep.progress >= 1 || ep.progress > durationSafe * 0.5) {
            // Sane seconds value, clamp to < duration
            thumbTime = Math.min(Math.round(ep.progress), durationSafe - 10);
          } else {
            // Suspicious (< 1s or less than half of duration for >2s content) → 25% in
            thumbTime = Math.round(durationSafe * 0.25);
          }
        }
        if (thumbTime <= 0) thumbTime = 60;
        thumbUrl = '/api/thumbnail?path=' + encodeURIComponent(ep.filePath) + '&time=' + thumbTime;
      }
      var coverSrc = a.localCover
        ? '/covers/' + path.basename(a.localCover)
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

function renderStatusGrids(data) {
  var container = document.getElementById('dashSection-localLibrary');
  if (!container) return;

  // Three status sections: filter null as wish (计划中)
  var sections = [
    { status: 'watching', label: '进行中' },
    { status: 'wish', label: '计划中' },
    { status: 'completed', label: '已完成' }
  ];

  container.innerHTML = sections.map(function(cfg) {
    var items = data.filter(function(a) {
      return (a.myListStatus || 'wish') === cfg.status;
    });
    if (items.length === 0) return '';
    var cardsHtml = items.map(function(a) { return renderAnimeCard(a); }).join('');
    return '<div class="status-section" id="statusSection-' + cfg.status + '">' +
      '<div class="status-section-header">' +
        '<span class="status-section-title">' + cfg.label + '</span>' +
        '<span class="status-section-count">' + items.length + '</span>' +
      '</div>' +
      '<div class="grid-container" id="libraryGrid-' + cfg.status + '">' + cardsHtml + '</div>' +
    '</div>';
  }).join('');

  // Apply grid columns
  applyGridZoom();

  // Card reveal: only below-fold cards get fade-in animation
  // (visible cards already display naturally — no flash)
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var scroller = document.querySelector('.main-content');
    var scrollerRect = scroller.getBoundingClientRect();
    sections.forEach(function(cfg) {
      var grid = document.getElementById('libraryGrid-' + cfg.status);
      if (!grid) return;
      Array.from(grid.children).forEach(function(card) {
        var r = card.getBoundingClientRect();
        if (!(r.bottom > scrollerRect.top && r.top < scrollerRect.bottom)) {
          card.style.animation = 'cardReveal 300ms var(--ease-out) forwards';
        }
      });
    });
  }
}

// --- Context Menu ---
function showContextMenu(e, animeId) {
  e.preventDefault();
  e.stopPropagation();
  contextMenuAnimeId = animeId;
  contextMenuCard = e.currentTarget;
  const menu = document.getElementById('contextMenu');

  const anime = libraryData.find(function(a) { return a.id === animeId; });
  var title = '';
  var bangumiId = null;
  if (anime) {
    title = anime.bangumiTitle || anime.title || '';
    bangumiId = anime.bangumiId || null;
  }

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
    '<div class="context-menu-item" onclick="event.stopPropagation();contextToggleStatus()">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
      '<span>标记状态</span>' +
    '</div>' +
    '<div class="context-menu-divider"></div>' +
    '<div class="context-menu-item context-menu-danger" id="ctxDelete">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>' +
      '<span>移除</span>' +
    '</div>';

  // Bind event listeners
  document.getElementById('ctxDelete').addEventListener('click', contextDeleteAnime);
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

async function contextOpenBgm() {
  const id = contextMenuAnimeId;
  hideContextMenu();
  if (!id) return;
  const anime = libraryData.find(function(a) { return a.id === id; });
  if (!anime || !anime.bangumiId) return;
  const url = 'https://bgm.tv/subject/' + anime.bangumiId;
  if (window.__TAURI__?.shell?.open) {
    try {
      await window.__TAURI__.shell.open(url);
    } catch (e) {
      showToast('打开浏览器失败', 'error');
    }
  } else {
    window.open(url, '_blank');
  }
}

function contextToggleStatus() {
  const id = contextMenuAnimeId;
  hideContextMenu();
  if (!id) return;
  if (typeof openStatusModal === 'function') {
    openStatusModal(null, id);
  }
}

function hideContextMenu() {
  document.getElementById('contextMenu').classList.remove('show');
  contextMenuAnimeId = null;
  contextMenuCard = null;
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
    showToast('已删除', 'success');
    loadLibrary();
    if (typeof loadMyList === 'function') loadMyList();
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

// Apply grid sizing on load
applyGridZoom();
