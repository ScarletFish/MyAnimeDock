// Library view logic
let libraryData = [];
let contextMenuAnimeId = null;
let cardScrollTrigger = null;
let cardTween = null;

gsap.registerPlugin(ScrollTrigger);

function initSortSelect() {
  const sel = document.getElementById('librarySort');
  sel.value = localStorage.getItem('librarySort') || 'default';
  sel.addEventListener('change', () => {
    localStorage.setItem('librarySort', sel.value);
    filterLibrary();
  });
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
    showToast('加载资料库失败: ' + e.message);
  }
}

function renderLibrary(filter = '') {
  const grid = document.getElementById('libraryGrid');
  const empty = document.getElementById('libraryEmpty');
  const paragraphs = empty.querySelectorAll('p');

  let filtered = libraryData;
  if (filter) {
    const q = filter.toLowerCase();
    filtered = libraryData.filter(a =>
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
    const downloaded = anime.downloaded;
    const id = escAttr(anime.id);
    return `
      <div class="anime-card" onclick="navigateToDetail('${id}', this)" oncontextmenu="showContextMenu(event, '${id}')">
        ${coverSrc
          ? `<img src="${coverSrc}" loading="lazy" decoding="async" alt="${escAttr(anime.title)}"${!downloaded ? ' style="filter:grayscale(100%) opacity(0.5)"' : ''}>`
          : `<div class="gray-cover"><svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div>`
        }
        <div class="overlay">
          <h3>${escHtml(anime.bangumiTitle || anime.title)}</h3>
          <div class="meta">
            ${anime.rating ? `<span class="rating-badge">★ ${anime.rating}</span>` : ''}
            ${anime.season ? `<span class="season-badge">S${anime.season}</span>` : ''}
            <span class="status-badge ${downloaded ? 'downloaded' : 'deleted'}">${downloaded ? '已下载' : '未下载'}</span>
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
  if (!confirm(`确定要从资料库移除「${title}」吗？\n观看记录将被保留。`)) return;
  try {
    await API.del(`/api/anime/${encodeURIComponent(animeId)}`);
    showToast('已移除');
    loadLibrary();
    loadMemories();
  } catch (e) {
    showToast('移除失败: ' + e.message);
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

async function syncLibrary() {
  if (syncInProgress) return;

  const needsSync = libraryData.filter(a => !a.bangumiId);
  if (needsSync.length === 0) {
    showToast('所有条目已有元数据，无需同步');
    return;
  }

  const btn = document.getElementById('btnSyncLibrary');
  const originalHtml = btn.innerHTML;
  syncInProgress = true;
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M23 4v6h-6"></path>
      <path d="M1 20v-6h6"></path>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>
    同步中...
  `;

  try {
    const animeIds = needsSync.map(a => a.id);
    const result = await API.post('/api/library/sync', { animeIds });

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const r of result.results) {
      if (r.success) {
        if (r.skipped) {
          skippedCount++;
        } else {
          successCount++;
          const idx = libraryData.findIndex(a => a.id === r.animeId);
          if (idx !== -1 && r.meta) {
            Object.assign(libraryData[idx], r.meta);
          }
        }
      } else {
        failCount++;
        console.error(`Sync failed for ${r.animeId}:`, r.error);
      }
    }

    renderLibrary(document.getElementById('librarySearch').value);

    let msg = `同步完成：成功 ${successCount}`;
    if (skippedCount) msg += `，跳过 ${skippedCount}`;
    if (failCount) msg += `，失败 ${failCount}`;
    showToast(msg);
  } catch (e) {
    showToast('同步失败: ' + e.message);
  } finally {
    syncInProgress = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}
