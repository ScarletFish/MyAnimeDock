// Library view logic
let libraryData = [];
let contextMenuAnimeId = null;
let cardScrollTrigger = null;
let cardTween = null;

// MyList status labels
const MYLIST_STATUS_LABELS = {
  watching: '当前观看',
  wish: '计划中',
  completed: '已完成',
  on_hold: '搁置',
  dropped: '抛弃'
};

// Grid zoom
const GRID_ZOOM_MIN = 0.5;
const GRID_ZOOM_MAX = 2.0;
const GRID_BASE_SIZE = 170;
let gridZoom = parseFloat(localStorage.getItem('gridZoom') || '1');

function applyGridZoom() {
  const grid = document.getElementById('libraryGrid');
  if (!grid) return;
  const size = Math.round(GRID_BASE_SIZE * gridZoom);
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
    renderLibrary();
  } catch (e) {
    // Tauri 初始加载时（frontendDist，非 server 源）静默失败
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载资料库失败: ' + e.message);
  }
}

function renderLibrary(filter = '') {
  const grid = document.getElementById('libraryGrid');
  const empty = document.getElementById('libraryEmpty');
  const paragraphs = empty.querySelectorAll('p');

  let filtered = libraryData.filter(a => a.myListStatus === 'watching');

  if (filter) {
    const q = filter.toLowerCase();
    filtered = filtered.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.bangumiTitle && a.bangumiTitle.toLowerCase().includes(q)) ||
      (a.pinyinTitle && a.pinyinTitle.toLowerCase().includes(q))
    );
  }

  const sortMode = document.getElementById('librarySort').value;
  filtered = sortLibrary(filtered, sortMode);

  if (filtered.length === 0) {
    killCardAnimations();
    grid.innerHTML = '';
    if (filter) {
      paragraphs[0].textContent = '未检索到结果';
      paragraphs[1].textContent = `没有匹配"${filter}"的动漫`;
    } else {
      paragraphs[0].textContent = '资料库为空';
      paragraphs[1].textContent = '设置媒体目录后自动导入动漫';
    }
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = filtered.map((anime) => {
    const coverSrc = anime.localCover ? `/covers/${path.basename(anime.localCover)}?w=400&q=75` : '';
    const id = escAttr(anime.id);
    const mylistLabel = anime.myListStatus ? MYLIST_STATUS_LABELS[anime.myListStatus] : null;
    const moreBtn = `<div class="card-more-btn" onclick="event.stopPropagation();toggleStatusPopover(event, '${id}')" title="设置状态">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
      </svg>
    </div>`;
    return `
      <div class="anime-card" onclick="navigateToDetail('${id}', this)" oncontextmenu="showContextMenu(event, '${id}')">
        ${coverSrc
          ? `<img src="${coverSrc}" decoding="async" alt="${escAttr(anime.title)}">`
          : `<div class="gray-cover"><svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div>`
        }
        ${moreBtn}
        <div class="overlay">
          <h3>${escHtml(anime.bangumiTitle || anime.title)}</h3>
          <div class="meta">
            ${anime.rating ? `<span class="rating-badge">★ ${anime.rating}</span>` : ''}
            ${anime.season ? `<span class="season-badge">S${anime.season}</span>` : ''}
            ${mylistLabel ? `<span class="mylist-badge ${anime.myListStatus}">${mylistLabel}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const cards = grid.querySelectorAll('.anime-card');
  if (cards.length === 0) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  killCardAnimations();

  const scroller = document.querySelector('.main-content');
  const scrollerRect = scroller.getBoundingClientRect();

  const visible = [];
  const hidden = [];
  cards.forEach(card => {
    const r = card.getBoundingClientRect();
    if (r.bottom > scrollerRect.top && r.top < scrollerRect.bottom) visible.push(card);
    else hidden.push(card);
  });

  visible.forEach(card => {
    card.style.animation = 'cardReveal 300ms var(--ease-out) forwards';
  });

  if (hidden.length > 0) {
    gsap.set(hidden, { opacity: 0, y: 24, scale: 0.97 });
    cardScrollTrigger = ScrollTrigger.create({
      scroller: '.main-content',
      trigger: grid,
      start: 'top bottom',
      once: true,
      onEnter: () => {
        cardTween = gsap.to(hidden, {
          opacity: 1, y: 0, scale: 1,
          stagger: 0.03,
          duration: 0.35,
          ease: 'back.out(1.4)',
          onComplete: () => { cardTween = null; }
        });
      }
    });
  }
  applyGridZoom();
}

function filterLibrary() {
  const q = document.getElementById('librarySearch').value;
  renderLibrary(q);
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
  // Restore default library context menu items
  menu.innerHTML = `
    <div class="context-menu-item" id="ctxArchive">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 8v13H3V8"></path>
        <path d="M1 3h22v5H1z"></path>
        <path d="M10 12h4"></path>
      </svg>
      归档
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item context-menu-danger" id="ctxDelete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"></path>
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
      </svg>
      移除
    </div>`;
  // Re-bind event listeners after restoring content
  document.getElementById('ctxDelete').addEventListener('click', contextDeleteAnime);
  document.getElementById('ctxArchive').addEventListener('click', contextArchiveAnime);
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
    showToast('已删除');
    loadLibrary();
  } catch (e) {
    showToast('删除失败: ' + e.message);
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
    showToast('已归档');
    loadLibrary();
    if (typeof loadMyList === 'function') loadMyList();
  } catch (e) {
    showToast('归档失败: ' + e.message);
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
