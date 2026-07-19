// ─── Detail Navigation (invisible edge hot zones) ───

let detailNavReady = false;

function initDetailNav() {
  if (detailNavReady) return;
  detailNavReady = true;

  const navOverlay = document.getElementById('detailNavOverlay');
  document.getElementById('navLeft')?.addEventListener('click', (e) => {
    createRipple(e, e.currentTarget);
    goPrev();
  });
  document.getElementById('navRight')?.addEventListener('click', (e) => {
    createRipple(e, e.currentTarget);
    goNext();
  });

  // Mouse side button (XButton1 / browser back)
  document.addEventListener('mouseup', (e) => {
    if (currentView !== 'detail') return;
    if (e.button === 3) {
      e.preventDefault();
      createRippleAt(e.clientX, e.clientY, navOverlay);
      goBack();
    }
  });

  // Keyboard: ArrowLeft / ArrowRight, Escape
  document.addEventListener('keydown', (e) => {
    if (currentView !== 'detail') return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    if (e.key === 'Escape')     { goBack(); }
  });
}

function findCurrentLibraryIndex() {
  if (!currentAnime) return -1;
  if (typeof libraryData === 'undefined' || !libraryData.length) return -1;
  return libraryData.findIndex(a => a.id === currentAnime.id);
}

let isSliding = false;

function goPrev() {
  if (isSliding) return;
  if (detailSourceView === 'mylist' && typeof mylistData !== 'undefined' && mylistData.length > 0) {
    const idx = mylistData.findIndex(i => i.id === currentAnime.id);
    if (idx === -1) return;
    const prevIdx = idx === 0 ? mylistData.length - 1 : idx - 1;
    const prev = mylistData[prevIdx];
if (prev) {
        slideToAnime(prev.id, 'prev');
      }
      return;
    }
    const idx = findCurrentLibraryIndex();
    if (idx === -1) return;
    const prevIdx = idx === 0 ? libraryData.length - 1 : idx - 1;
    const prev = libraryData[prevIdx];
    if (prev) {
      slideToAnime(prev.id, 'prev');
    }
}

function goNext() {
  if (isSliding) return;
  if (detailSourceView === 'mylist' && typeof mylistData !== 'undefined' && mylistData.length > 0) {
    const idx = mylistData.findIndex(i => i.id === currentAnime.id);
    if (idx === -1) return;
    const nextIdx = idx === mylistData.length - 1 ? 0 : idx + 1;
    const next = mylistData[nextIdx];
if (next) {
        slideToAnime(next.id, 'next');
      }
      return;
    }
    const idx = findCurrentLibraryIndex();
    if (idx === -1) return;
    const nextIdx = idx === libraryData.length - 1 ? 0 : idx + 1;
    const next = libraryData[nextIdx];
    if (next) {
      slideToAnime(next.id, 'next');
    }
}

async function slideToAnime(id, direction) {
  if (isSliding) return;
  isSliding = true;

  const layout = document.querySelector('.detail-layout');
  const navOverlay = document.getElementById('detailNavOverlay');
  if (navOverlay) navOverlay.style.pointerEvents = 'none';

  // Parallel: start data fetch + exit animation at same time
  resetDetailEnter();
  stopDetailRefresh();
  const loadPromise = loadAnimeData(id);
  const exitPromise = layout ? new Promise(resolve => {
    gsap.to(layout, {
      x: direction === 'prev' ? 60 : -60,
      opacity: 0,
      duration: 0.15,
      ease: 'power2.in',
      onComplete: resolve
    });
  }) : Promise.resolve();

  const [loadOk] = await Promise.all([loadPromise, exitPromise]);
  if (!loadOk) return; // error already handled in loadAnimeData

  // Re-render with entrance stagger（同步细节页入场方式）
  const viewEl = document.getElementById('detailView');
  viewEl.classList.add('detail-enter-active');
  renderDetail();
  showView('detail');
  const wrap = document.getElementById('detailCover');
  if (wrap) {
    wrap.style.opacity = '1';
    wrap.style.transform = 'scale(1)';
  }
  document.getElementById('headerTitle').textContent = currentAnime.bangumiTitle || currentAnime.title;
  if (!isWishlistMode) startDetailRefresh();

  // 内容分波入场（替代 GSAP 滑入）
  setEntranceDelays(0.04, 0);
  viewEl.classList.add('show-content');

  isSliding = false;
  if (navOverlay) navOverlay.style.pointerEvents = '';
}

async function loadAnimeData(id) {
  try {
    if (detailSourceView === 'mylist' && typeof mylistData !== 'undefined') {
      const item = mylistData.find(i => i.id === id);
      if (!item) throw new Error('条目不存在');
      if (item.source === 'wishlist') {
        isWishlistMode = true;
        currentAnime = {
          id: item.id,
          title: item.title,
          bangumiTitle: item.bangumiTitle || item.title,
          localCover: null,
          coverUrl: item.coverUrl || '',
          rating: item.rating || null,
          summary: item.summary || '',
          bangumiId: item.bangumiId,
          season: null,
          episodes: [],
          downloaded: false,
        };
        AppState.set('currentAnime', currentAnime);
      } else {
        isWishlistMode = false;
        currentAnime = await API.get(`/api/anime/${encodeURIComponent(id)}`);
        AppState.set('currentAnime', currentAnime);
      }
    } else {
      currentAnime = await API.get(`/api/anime/${encodeURIComponent(id)}`);
      AppState.set('currentAnime', currentAnime);
    }
    return true;
  } catch (e) {
    showToast('加载详情失败: ' + e.message, 'error');
    isSliding = false;
    const navOverlay = document.getElementById('detailNavOverlay');
    if (navOverlay) navOverlay.style.pointerEvents = '';
    return false;
  }
}

function createRipple(e, zone) {
  const rect = zone.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.8;
  const x = (e.clientX || rect.left + rect.width / 2) - rect.left;
  const y = (e.clientY || rect.top + rect.height / 2) - rect.top;
  spawnRipple(zone, x, y, size);
}

function createRippleAt(cx, cy, container) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const size = 120;
  const x = cx - rect.left - size / 2;
  const y = cy - rect.top - size / 2;
  spawnRipple(container, x + size / 2, y + size / 2, size * 2);
}

function spawnRipple(parent, x, y, size) {
  const el = document.createElement('div');
  el.className = 'detail-ripple';
  el.style.cssText = `width:${size}px;height:${size}px;left:${x - size/2}px;top:${y - size/2}px;`;
  parent.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// Init on DOMContentLoaded (safe to call multiple times)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDetailNav);
} else {
  initDetailNav();
}
