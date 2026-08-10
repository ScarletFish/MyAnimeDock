gsap.registerPlugin(Flip);

let currentAnime = null;

// Wishlist mode (set when viewing mylist wishlist items)
let isWishlistMode = false;

// Relations/Recommendations cache (30min TTL)
const _CACHE_TTL = 30 * 60 * 1000;
const _relationCache = createTimedCacheMap(_CACHE_TTL);
const _recCache = createTimedCacheMap(_CACHE_TTL);

// Character grid: large max-height for smooth CSS transition (replaces 'none')
const MAX_GRID_HEIGHT = 10000;

/**
 * 播放器关闭后自动将 App 窗口带回前台（Windows 前台锁限制时系统会闪烁任务栏兜底）。
 * 浏览器环境（无 Tauri API）直接无操作。
 */
function focusAppWindow() {
  if (!(window.__TAURI__ && window.__TAURI__.window)) return;
  try {
    var win = window.__TAURI__.window.getCurrentWindow();
    win.unminimize().then(function () { return win.setFocus(); }).catch(function () {});
  } catch (_) {}
}

function checkToggleOverflow(wrap, listSel, toggleSel) {
  if (!wrap) return;
  const list = wrap.querySelector(listSel);
  const toggle = wrap.querySelector(toggleSel);
  if (!list || !toggle) return;
  // 显示条件：内容有溢出（自动模式可折叠），或用户已手动切换过（始终可切换回）
  const hasOverflow = list.scrollHeight > list.clientHeight;
  const userToggled = wrap.dataset.userToggled === 'true';
  toggle.style.display = (hasOverflow || userToggled) ? 'inline-flex' : 'none';
}

function getCharGridRowHeight() {
  const grid = document.getElementById('detailCharGrid');
  if (!grid || !grid.children[0]) return 104; // fallback: 80px avatar + 16px padding + 8px gap
  const card = grid.children[0];
  const gap = 8; // matches CSS gap: 8px
  return card.offsetHeight + gap;
}

function initToggleChecks() {
  const tagsEl = document.getElementById('detailTags');
  const charWrap = document.getElementById('detailCharWrap');
  if (tagsEl) checkToggleOverflow(tagsEl, '.detail-tags-list', '.detail-tag-toggle');
  if (charWrap) checkToggleOverflow(charWrap, '.detail-char-grid', '.detail-char-toggle');
}

function toggleExpand(wrapId) {
  const wrap = document.getElementById(wrapId);
  const isExpanding = !wrap.classList.contains('expanded');
  wrap.classList.toggle('expanded');
  wrap.dataset.userToggled = 'true';

  // For character grid, manage maxHeight based on rows when manually toggling
  if (wrapId === 'detailCharWrap') {
    const grid = wrap.querySelector('.detail-char-grid');
    if (grid) {
      if (isExpanding) {
        grid.style.overflow = '';
        grid.style.maxHeight = MAX_GRID_HEIGHT + 'px';
      } else {
        // 折叠时恢复到动态平衡的行数（不固定为 2 行）
        measureAndBalance(wrap);
      }
    }
  }

  setTimeout(() => {
    if (wrapId === 'detailTags') checkToggleOverflow(wrap, '.detail-tags-list', '.detail-tag-toggle');
    if (wrapId === 'detailCharWrap') checkToggleOverflow(wrap, '.detail-char-grid', '.detail-char-toggle');
  }, 50);
}

function expandTags() {
  const tagsEl = document.getElementById('detailTags');
  const allTags = tagsEl._allTags;
  if (!allTags) return;
  const studioHtml = tagsEl._studioHtml || '';
  tagsEl.innerHTML = `<div class="detail-tags-list">${studioHtml}${allTags.map(t => `<span class="tag-pill"${t.desc ? ` data-tooltip="${escAttr(t.desc)}" data-tooltip-rich` : ''}>${escHtml(t.name)}</span>`).join('')}</div>`;
}
let detailSourceView = 'library';

// Sync from AppState for cross-module state
AppState.on('currentAnime', v => { currentAnime = v; });
AppState.on('detailSourceView', v => { detailSourceView = v; });

function resetDetailEnter() {
  clearTimeout(charResizeTimer);
  // 阻止过渡回退动画（class 移除时 opacity→0 的过渡）
  document.querySelectorAll('.detail-banner-right > *, .detail-char-card, #episodeHeatmap, #watchStats')
    .forEach(el => {
      el.style.transition = 'none';
      el.style.transitionDelay = '';
    });
  const viewEl = document.getElementById('detailView');
  if (viewEl) {
    viewEl.classList.remove('detail-enter-active', 'show-content');
  }
  const hero = document.getElementById('heroCover');
  if (hero) hero.remove();
  const wrap = document.getElementById('detailCover');
  if (wrap) {
    wrap.style.opacity = '';
    wrap.style.transform = '';
    wrap.style.visibility = '';
  }
  // Clean up any stale nav ripples
  document.querySelectorAll('.detail-ripple').forEach(el => el.remove());
}

// 全局 mpv-status SSE 监听已移至 app.js（startGlobalMpvStatus），
// 详情页不再自行建立连接；保留 startDetailRefresh/stopDetailRefresh 作为兼容占位。
function startDetailRefresh() {}
function stopDetailRefresh() {}

/**
 * 全局播放结束回调（由 app.js 的 onGlobalMpvStatus 调用）。
 * 仅当当前详情页展示的正是播放结束的番时才消费事件（返回 true），
 * 否则返回 false，由全局逻辑兜底（toast + pending 标记）。
 */
window.handleDetailPlaybackEnded = function (endedAnimeId) {
  if (!currentAnime) return false;
  if (endedAnimeId && currentAnime.id !== endedAnimeId) return false;
  API.get(`/api/anime/${encodeURIComponent(currentAnime.id)}`).then(updated => {
    currentAnime = updated;
    AppState.set('currentAnime', currentAnime);
    renderDetail();
    checkAndShowFinishConfirm(currentAnime);
    var _allDone = currentAnime.episodes && currentAnime.episodes.length > 0
      && currentAnime.episodes.every(function(e) { return e.watched; });
    if (_allDone && currentAnime.myListStatus === 'completed') {
      showToast(t('detail.playEndedAllWatched'), 'success');
      return;
    }
    showToast(t('detail.playEndedUpdated'), 'success');
  });
  return true;
};

async function showDetail(id, fromRect, fromSrc, sourceView = 'library') {
  isWishlistMode = false;
  detailSourceView = sourceView; AppState.set('detailSourceView', sourceView);

  resetDetailEnter();
  stopDetailRefresh();
  try {
    currentAnime = await API.get(`/api/anime/${encodeURIComponent(id)}`);
    renderDetail();

    if (fromRect) {
      const viewEl = document.getElementById('detailView');
      viewEl.classList.add('detail-enter-active');
      showView('detail');
      animateHeroCoverFlip(fromRect, fromSrc);
    } else {
      const viewEl = document.getElementById('detailView');
      viewEl.classList.add('detail-enter-active');
      showView('detail');
      const wrap = document.getElementById('detailCover');
      wrap.style.opacity = '1';
      wrap.style.transform = 'scale(1)';
      setEntranceDelays(0.04 /* banner间隔 */, 0 /* 基础偏移 */);
      viewEl.classList.add('show-content');
    }

    document.getElementById('headerTitle').textContent = currentAnime.bangumiTitle || currentAnime.title;
    startDetailRefresh();

    // 播放结束于其他页面 → 回到该番详情页时补弹"标记看完"确认
    if (window.pendingFinishAnimeId === id) {
      window.pendingFinishAnimeId = null;
      checkAndShowFinishConfirm(currentAnime);
    }

    // Auto-play from continue watching section
    if (typeof pendingAutoPlay !== 'undefined' && pendingAutoPlay === id) {
      pendingAutoPlay = null;
      const ep = findWatchEpisode(currentAnime);
      if (ep) {
        setTimeout(() => playEpisode(ep.filePath, ep.progress), 400);
      }
    }
  } catch (e) {
    showToast(t('detail.loadFailed', { error: e.message }), 'error');
  }
}

/**
 * 设置 CSS transition-delay 分波参数（不触发过渡，由后续 addClass('show-content') 触发）。
 * 必须在 addClass('show-content') 之前调用。
 * @param {number} bannerStep - banner 每子项间隔（Flip 0.08, 无 Flip 0.06）
 * @param {number} baseOffset - 基础偏移（Flip 0.35 在 Flip 期间播放，无 Flip 0）
 */
function setEntranceDelays(bannerStep, baseOffset) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reduceMotion === 'true') return;

  // 恢复 CSS transition 属性（resetDetailEnter 设了 transition:none）
  document.querySelectorAll('.detail-banner-right > *, .detail-char-card, #episodeHeatmap, #watchStats')
    .forEach(el => el.style.transition = '');

  const b = baseOffset || 0;
  // banner-right children：从 b 开始，每项间隔 bannerStep
  document.querySelectorAll('.detail-banner-right > *').forEach((el, i) => {
    el.style.transitionDelay = `${b + i * bannerStep}s`;
  });

  // heatmap：0.10s 开始 → 0.35s (Flip完成) 结束 (0.10+0.25=0.35)
  const heatEl = document.getElementById('episodeHeatmap');
  if (heatEl) heatEl.style.transitionDelay = `${b + 0.06}s`;

  // char-cards：center-out
  const cards = document.querySelectorAll('.detail-char-card');
  const center = (cards.length - 1) / 2;
  cards.forEach((card, i) => {
    card.style.transitionDelay = `${b + 0.12 + Math.abs(i - center) * 0.02}s`;
  });

  // watch-stats
  const stEl = document.getElementById('watchStats');
  if (stEl) stEl.style.transitionDelay = `${b + 0.18}s`;
}

function animateHeroCoverFlip(fromRect, fromSrc) {
  const viewEl = document.getElementById('detailView');
  const wrap = document.getElementById('detailCover');
  const img = wrap.querySelector('img');

  const toRect = wrap.getBoundingClientRect();

  // Hide real cover during animation
  wrap.style.visibility = 'hidden';
  wrap.style.opacity = '0';

  // Create overlay at card position (First)
  const hero = document.createElement('div');
  hero.id = 'heroCover';
    hero.style.cssText = `
      position:fixed;z-index:100;pointer-events:none;overflow:hidden;
      left:${fromRect.left}px;top:${fromRect.top}px;
      width:${fromRect.width}px;height:${fromRect.height}px;
      border-radius:16px;background:var(--bg-card);
    `;

  if (fromSrc) {
    const clone = document.createElement('img');
    clone.src = fromSrc;
    clone.alt = '';
    clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    hero.appendChild(clone);
  } else if (img) {
    const clone = document.createElement('img');
    clone.src = img.src;
    clone.alt = img.alt || '';
    clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    hero.appendChild(clone);
  } else {
    // Gray cover fallback: show placeholder
    hero.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-card);font-size:2rem;font-weight:700;color:var(--fg-muted)">' + (wrap.textContent?.trim()?.[0] || '?') + '</div>';
  }
  document.body.appendChild(hero);

  const state = Flip.getState(hero);

  // Move hero to detail position (Last)
  hero.style.left = toRect.left + 'px';
  hero.style.top = toRect.top + 'px';
  hero.style.width = toRect.width + 'px';
  hero.style.height = toRect.height + 'px';

  // 设 stagger delay 后再触发，transition 与 Flip 同步播放
  setEntranceDelays(0.05 /* banner间隔 */, 0.04 /* 基础偏移 */);

  viewEl.classList.add('show-content');

  Flip.from(state, {
    duration: 0.35,
    ease: 'power2.out',
    absolute: true,
    onComplete: () => {
      wrap.style.visibility = '';
      wrap.style.opacity = '1';
      wrap.style.transform = '';
      hero.remove();
    }
  });
}

function renderDetail() {
  if (!currentAnime) return;

  // Update title bar with anime title
  if (typeof setTitlebarContext === 'function') {
    setTitlebarContext('detail', currentAnime.bangumiTitle || currentAnime.title || '');
  }

  const anime = currentAnime;

  // ─── Cover ───
  const coverEl = document.getElementById('detailCover');
  if (anime.localCover) {
    coverEl.innerHTML = `<img src="/covers/${path.basename(anime.localCover)}?w=540&q=80" alt="${escAttr(anime.title)}">`;
  } else {
    const initial = (anime.bangumiTitle || anime.title || '?')[0].toUpperCase();
    coverEl.innerHTML = `<div class="gray-cover"><span class="gray-cover-text">${escHtml(initial)}</span></div>`;
  }

  // ─── AniList Banner Background (full-width, top of view) ───
  const detailView = document.getElementById('detailView');
  const existingBg = detailView.querySelector('.detail-banner-bg');
  if (existingBg) existingBg.remove();
  if (anime.anilistBanner && anime.anilistBanner !== '__none__') {
    const bannerBg = document.createElement('div');
    bannerBg.className = 'detail-banner-bg';
    const bannerImg = document.createElement('img');
    bannerImg.className = 'detail-banner-bg-img';
    // anilistBanner is now always a local path (or null/'__none__') → use /banners/ route
    bannerImg.src = `/banners/${path.basename(anime.anilistBanner)}`;
    bannerImg.alt = '';
    // Very wide banners (ratio > 2.5): shift upward to keep face visible
    bannerImg.onload = function() {
      if (this.naturalWidth / this.naturalHeight > 2.5) this.style.objectPosition = 'center 25%';
    };
    // Fallback: if the banner fails to load, hide it and fall back to no-banner layout
    bannerImg.onerror = function() {
      bannerBg.remove();
      detailView.classList.add('detail-no-banner');
    };
    bannerBg.appendChild(bannerImg);
    detailView.insertBefore(bannerBg, detailView.querySelector('.detail-content'));
  }
  detailView.classList.toggle('detail-no-banner', !anime.anilistBanner || anime.anilistBanner === '__none__');

  document.getElementById('detailTitle').textContent = anime.bangumiTitle || anime.title;

  // ─── Alias (Japanese/Romaji) ───
  const aliasEl = document.getElementById('detailAlias');
  const aliases = [];
  if (anime.bangumiTitleJp) aliases.push(anime.bangumiTitleJp);
  if (anime.romajiTitle) aliases.push(anime.romajiTitle);
  aliasEl.textContent = aliases.join(' / ') || '';
  aliasEl.style.display = aliases.length ? '' : 'none';

  // ─── Info panel ───
  const infoLine = document.getElementById('detailInfoLine');
  const leftParts = [];
  if (anime.rating) leftParts.push(`<span class="info-rating-num">★ ${anime.rating}</span>`);
  if (anime.ratingRank) leftParts.push(`<span class="info-rating-sub">#${anime.ratingRank}</span>`);
  if (anime.ratingTotal) leftParts.push(`<span class="info-rating-sub">${t('detail.ratingPeople', { count: anime.ratingTotal })}</span>`);

  const rightParts = [];
  const s = anime.matchedSeason || anime.season;
  if (s && s > 1) {
    const mismatch = anime.season && anime.matchedSeason && anime.season !== anime.matchedSeason;
    rightParts.push(`<span class="tag-pill tag-pill--secondary${mismatch ? ' tag-pill--warn' : ''}">S${s}${mismatch ? ' ⚠' : ''}</span>`);
  }
  if (anime.date) rightParts.push(`<span class="tag-pill tag-pill--secondary">${anime.date}</span>`);
  if (anime.platform) rightParts.push(`<span class="tag-pill tag-pill--secondary">${escHtml(anime.platform)}</span>`);
  infoLine.innerHTML =
    (leftParts.length ? `<span class="info-left">${leftParts.join('')}</span>` : '') +
    (rightParts.length ? `<span class="info-tags">${rightParts.join('')}</span>` : '');
  infoLine.style.display = leftParts.length || rightParts.length ? '' : 'none';

  // ─── Tags（AniList 固定词库）───
  const tagsEl = document.getElementById('detailTags');
  const studios = anime.anilistStudios || [];
  let tags = (anime.anilistTags || [])
    .filter(t => !t.isGeneralSpoiler)          // 滤剧透
    .map(t => {
      const d = ANILIST_TAG_DATA[t.name];
      return {
        name: d?.zh || t.name,
        desc: d?.descZh || d?.descEn || '',
        rank: t.rank,
      };
    })
    .sort((a, b) => b.rank - a.rank);          // rank 降序
  const studioHtml = studios.length ? `<span class="tag-pill tag-pill--studio">${t('detail.studioLabel')} ${escHtml(studios[0])}</span>` : '';
  if (studios.length || tags.length) {
    const MAX_TAGS = 4;
    const shown = tags.slice(0, MAX_TAGS);
    const remaining = tags.length - MAX_TAGS;
    let html = studioHtml + shown.map(tag => `<span class="tag-pill"${tag.desc ? ` data-tooltip="${escAttr(tag.desc)}" data-tooltip-rich` : ''}>${escHtml(tag.name)}</span>`).join('');
    if (remaining > 0) {
      html += `<span class="tag-pill tag-pill--more" onclick="expandTags()">+${remaining}</span>`;
    }
    tagsEl.innerHTML = `<div class="detail-tags-list">${html}</div>`;
    tagsEl.style.display = '';
    tagsEl._allTags = tags;
    tagsEl._studioHtml = studioHtml;
  } else {
    tagsEl.style.display = 'none';
  }

  renderSummary(anime);

  // ─── Actions & metadata ───
  const syncModal = document.getElementById('syncModal');
  if (syncModal) syncModal.classList.remove('show');

  const fetchBtn = document.getElementById('btnFetchBangumi');
  const deleteBtn = document.getElementById('btnDeleteAnime');

  if (fetchBtn) { fetchBtn.style.display = 'inline-flex'; fetchBtn.disabled = false; }
  if (deleteBtn) deleteBtn.style.display = 'inline-flex';

  // ─── Cover play button ───
  renderPlayButton(anime);

  // ─── Right column modules ───
  if (isWishlistMode) {
    renderWishlistDetail(anime);
  } else {
    document.getElementById('archiveDetail').style.display = 'none';
    document.getElementById('episodeHeatmap').style.display = '';
    document.getElementById('detailCharacters').style.display = '';
    renderEpisodeHeatmap(anime);
    renderCharacters(anime);
    // Watch stats loads fast (in-memory API), render early to fill space
    renderWatchStats(anime);
    fetchAndRenderRelations(anime.id);
    fetchAndRenderRecommendations(anime.id);
  }

  // Reset character grid manual-toggle state for new anime
  const charWrapForReset = document.getElementById('detailCharWrap');
  if (charWrapForReset) delete charWrapForReset.dataset.userToggled;

  setTimeout(initToggleChecks, 100);
  setTimeout(initToggleChecks, 300);
  setTimeout(initToggleChecks, 600);
  requestAnimationFrame(autoExpandCharacters);
}

function autoExpandCharacters() {
  const charWrap = document.getElementById('detailCharWrap');
  if (!charWrap) return;
  if (charWrap.dataset.userToggled === 'true') return;
  measureAndBalance(charWrap);
  updateToggleVisibility(charWrap);
}

function measureAndBalance(wrap) {
  const grid = wrap.querySelector('.detail-char-grid');
  const rowH = getCharGridRowHeight();
  const totalItems = grid.children.length;
  const maxRows = Math.ceil(totalItems / 3);
  const targetRows = Math.min(3, maxRows);

  if (targetRows >= maxRows) {
    wrap.classList.add('expanded');
    grid.style.overflow = '';
    grid.style.maxHeight = MAX_GRID_HEIGHT + 'px';
  } else {
    wrap.classList.remove('expanded');
    grid.style.overflow = 'hidden';
    grid.style.maxHeight = (rowH * targetRows) + 'px';
  }
}



function updateToggleVisibility(wrap) {
  checkToggleOverflow(wrap, '.detail-char-grid', '.detail-char-toggle');
}

function waitForCharImages(grid) {
  const imgs = grid.querySelectorAll('.detail-char-avatar');
  if (!imgs.length) return Promise.resolve();
  const timeout = new Promise(r => setTimeout(r, 3000));
  const loadAll = Promise.all(Array.from(imgs).map(img =>
    img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
  ));
  return Promise.race([loadAll, timeout]);
}

// ─── Window resize → reflow character auto-expand ───
let charResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(charResizeTimer);
  charResizeTimer = setTimeout(() => {
    if (currentAnime && document.getElementById('detailView')?.classList.contains('hidden') === false) {
      const wrap = document.getElementById('detailCharWrap');
      if (wrap && wrap.dataset.userToggled !== 'true') {
        autoExpandCharacters();
      }
    }
  }, 300);
});

function renderWishlistDetail(anime) {
  // Hide interactive modules
  document.getElementById('episodeHeatmap').style.display = 'none';
  document.getElementById('detailCharacters').style.display = 'none';
  document.getElementById('watchStats').style.display = 'none';
  document.getElementById('archiveDetail').style.display = 'none';

  // Hide action buttons
  const fetchBtn = document.getElementById('btnFetchBangumi');
  const deleteBtn = document.getElementById('btnDeleteAnime');
  if (fetchBtn) fetchBtn.style.display = 'none';
  if (deleteBtn) deleteBtn.style.display = 'none';

  const layoutEl = document.querySelector('.detail-layout');
  if (layoutEl) layoutEl.classList.remove('detail-layout--archive');

  // Show wishlist info in the right column
  document.getElementById('archiveDetail').style.display = 'block';
  const archiveEl = document.getElementById('archiveDetail');
  archiveEl.innerHTML = `
    <div class="archive-magazine-essay">
      <div class="archive-magazine-thoughts text-sm text-content leading-[1.7]">${t('detail.wishlistNoLocal')}</div>
    </div>
    <div class="archive-magazine-meta">
      ${anime.rating ? `
        <div class="archive-magazine-stat">
          <span class="archive-magazine-stat-value">★ ${anime.rating}</span>
          <span class="archive-magazine-stat-label">${t('detail.ratingLabel')}</span>
        </div>` : ''}
      <div class="archive-magazine-stat">
        <span class="archive-magazine-stat-value">${t('detail.wishlistLabel')}</span>
        <span class="archive-magazine-stat-label">${t('detail.sourceLabel')}</span>
      </div>
    </div>
    <div class="wishlist-detail-actions mt-4">
      <a class="btn btn-primary" href="${(typeof window.getBangumiFrontendUrl === 'function' ? window.getBangumiFrontendUrl() : 'https://bgm.tv')}/subject/${anime.bangumiId}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        ${t('detail.openInBangumi')}
      </a>
    </div>
  `;
}

/**
 * 统一定位目标剧集：lastPlayedEp（未完全看完）→ 第一个未观看 → 第一集（回头看）。
 * 返回 { episode, allWatched }，供播放按钮和自动播放共用。
 */
function findTargetEpisode(anime) {
  if (!anime.episodes || anime.episodes.length === 0) return null;
  // 1. 上次播放的剧集（如果未完全看完：未标记 watched 或还有进度）
  if (anime.lastPlayedEp) {
    var ep = anime.episodes.find(function(e) { return e.number === anime.lastPlayedEp; });
    if (ep && (!ep.watched || ep.progress > 0)) {
      return { episode: ep, allWatched: false };
    }
  }
  // 2. 第一个未观看
  for (var i = 0; i < anime.episodes.length; i++) {
    if (!anime.episodes[i].watched) {
      return { episode: anime.episodes[i], allWatched: false };
    }
  }
  // 3. 全部看完 → 第一集（重新看）
  return { episode: anime.episodes[0], allWatched: true };
}

// @deprecated 使用 findTargetEpisode 替代
function findWatchEpisode(anime) {
  var r = findTargetEpisode(anime);
  return r ? r.episode : null;
}

/**
 * 检查当前动漫是否有刚播完的剧集需要弹窗确认标记看完。
 * 条件：lastPlayedEp 的进度 > 90% 且未标记 watched。
 */
function findPendingFinishConfirm(anime) {
  if (!anime.lastPlayedEp || !anime.episodes) return null;
  var ep = anime.episodes.find(function(e) { return e.number === anime.lastPlayedEp; });
  if (!ep || ep.watched) return null;
  if (ep.progress > 0 && ep.duration > 0 && ep.progress / ep.duration > 0.9) return ep;
  return null;
}

/**
 * 滚动剧集列表到指定集之后的第一个未观看剧集。
 */
function scrollToNextUnwatched(anime, afterEpNumber) {
  var grid = document.getElementById('episodeHeatmapGrid');
  if (!grid || !anime.episodes) return;
  var nextEp = null;
  for (var i = 0; i < anime.episodes.length; i++) {
    var e = anime.episodes[i];
    if (e.number > afterEpNumber && !e.watched) { nextEp = e; break; }
  }
  if (!nextEp) {
    // 全部看完 → 滚动到最后一集
    nextEp = anime.episodes[anime.episodes.length - 1];
  }
  var idx = anime.episodes.indexOf(nextEp);
  if (idx === -1) return;
  var card = grid.querySelector('.episode-card[data-index="' + idx + '"]');
  if (!card) return;
  requestAnimationFrame(function() {
    var cs = getComputedStyle(grid);
    var gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
    var step = (grid.querySelector('.episode-card') || card).offsetWidth + gap;
    grid.scrollTo({ left: Math.max(0, idx * step), behavior: 'smooth' });
  });
}

/**
 * 弹窗：是否标记当前集已看完。
 * 匹配项目现有 modal 样式（同 showConfirm），简洁大气。
 */
function showFinishConfirm(anime, ep) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '9999';

    var total = anime.episodes ? anime.episodes.length : '?';
    overlay.innerHTML =
      '<div class="modal" style="max-width:340px;padding:var(--space-6) var(--space-8) var(--space-5);text-align:center">' +
        '<p class="text-content" style="margin:0 0 var(--space-1);font-weight:600;font-size:17px">' + t('detail.episodeXofY', { number: ep.number, total: total }) + '</p>' +
        '<p class="text-content" style="margin:0 0 var(--space-5);font-size:14px;color:var(--fg-muted)">' + t('detail.markWatchedConfirm') + '</p>' +
        '<div class="modal-actions flex items-center justify-center" style="gap:var(--space-3);padding:0">' +
          '<button class="btn btn-ghost confirm-cancel" style="flex:1;justify-content:center">' + t('detail.cancel') + '</button>' +
          '<button class="btn btn-primary confirm-ok" style="flex:1;justify-content:center">' + t('detail.mark') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('show'); });

    function close(result) {
      overlay.classList.remove('show');
      setTimeout(function() { overlay.remove(); }, 200);
      resolve(result);
    }

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('.confirm-cancel').addEventListener('click', function() { close(false); });
    overlay.querySelector('.confirm-ok').addEventListener('click', function() { close(true); });
    overlay.querySelector('.confirm-ok').focus();
  });
}

function renderSummary(anime) {
  const el = document.getElementById('detailSummary');
  if (!el) return;
  let text = anime.summary || '';
  if (text && /[\u4e00-\u9fff]/.test(text)) {
    // Has Chinese characters — try to keep only Chinese portion
    // Bangumi often concatenates: "中文简介\n---\n日文简介" or "中文[简介原文]日文"
    // Step 1: split by Bangumi-specific marker
    const parts = text.split(/\[?简介原文\]?/);
    if (parts.length > 1) {
      text = parts[0].trim();
    } else {
      // Step 2: try \n---\n separator (common Bangumi pattern)
      const dashed = text.split(/\n---+\n/);
      if (dashed.length > 1) {
        text = dashed[0].trim();
      } else {
        // Step 3: split paragraphs, keep only Chinese paragraphs
        // A 型：纯中文段 → 保留
        // B 型：纯日文段（平假名主导，汉字占比 ≤30%）→ 过滤
        // C 型：中日混合段（汉字占比 >30%，如「中文（日本語）──署名」）→ 全文保留
        const paragraphs = text.split(/\n+/).filter(p => p.trim());
        const cn = [];
        for (let p of paragraphs) {
          const hiragana = (p.match(/[\u3040-\u309f]/g) || []).length;
          const katakana = (p.match(/[\u30a0-\u30ff]/g) || []).length;
          const hanCount = (p.match(/[\u4e00-\u9fff]/g) || []).length;
          const meaningful = p.replace(/\s/g, '').length;
          // 没有汉字也没有假名 → 非中文（可能是英文）
          if (hanCount === 0 && hiragana === 0 && katakana === 0) continue;
          // 片假名主导且汉字很少 → 日文
          if (katakana >= 8 && hanCount < 3) continue;
          // 有平假名且汉字占比 ≤30% → 纯日文原文，过滤
          if (hiragana >= 3 && hiragana / meaningful > 0.4) continue;
          // 其余（纯中文 / 中日混合）→ 保留
          cn.push(p.trim());
        }
        if (cn.length > 0) text = cn.join('\n');
      }
    }
  }
  el.textContent = text || t('detail.noSummary');
}

// ─── Key staff roles to display (filtered) ───
const KEY_STAFF_ROLES = ['原作', '监督', '导演', '系列构成', '脚本', '音乐', '动画制作', '角色设计', '人物设定', '制作', '製作', 'author', 'editor', 'producer', 'storyboard', 'director'];

function renderCharacters(anime) {
  const container = document.getElementById('detailCharacters');
  const grid = document.getElementById('detailCharGrid');
  const staffSection = document.getElementById('detailStaffSection');
  const staffList = document.getElementById('detailStaffList');

  const chars = anime.characters || [];
  const persons = anime.persons || [];

  // Render characters
  if (!grid) return;
  if (!chars.length) {
    container.style.display = 'none';
  } else {
    container.style.display = '';

    grid.innerHTML = chars.slice(0, 24).map(c => {
      const name = escHtml(c.nameCn || c.name);
      const cv = c.actors && c.actors[0]
        ? escHtml(c.actors[0].nameCn || c.actors[0].name)
        : null;
      const img = c.image
        ? `<img class="detail-char-avatar" src="${escAttr(c.image)}" alt="" loading="lazy" decoding="async">`
        : `<div class="detail-char-avatar-placeholder">${name.charAt(0)}</div>`;
      return `<div class="detail-char-card">
        ${img}
        <div class="detail-char-info">
          <div class="detail-char-name">${name}</div>
          ${cv ? `<div class="detail-char-cv">${cv}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    const needsClipping = grid.children.length > 6;
    if (needsClipping) {
      grid.style.maxHeight = grid.scrollHeight + 'px';
    }

    waitForCharImages(grid).then(() => {
      const detailView = document.getElementById('detailView');
      if (detailView && detailView.classList.contains('hidden')) return;
      const wrap = document.getElementById('detailCharWrap');
      if (!wrap || wrap.dataset.userToggled === 'true') return;

      if (needsClipping) {
        autoExpandCharacters();
      } else {
        grid.style.maxHeight = '';
        grid.style.overflow = '';
      }
    });
  }

  // Render staff (skip if elements don't exist)
  if (!staffSection || !staffList) return;

  const filtered = persons.filter(p => {
    // 制作公司（动画制作/制作）已在 tag 行以「製」标注展示，staff 区跳过避免重复
    if (p.roleName === '动画制作' || p.roleName === '制作') return false;
    return (p.roleName && p.roleName !== '出版社') || (p.jobs && p.jobs.length > 0);
  });
  // Deduplicate by role (each role appears once)
  const roleMap = new Map();
  for (const p of filtered) {
    const role = p.roleName || p.jobs[0] || '';
    if (!role || roleMap.has(role)) continue;
    roleMap.set(role, p);
  }
  const keyJobs = Array.from(roleMap.values()).sort((a, b) => {
    const aRole = a.roleName || a.jobs[0] || '';
    const bRole = b.roleName || b.jobs[0] || '';
    return aRole.localeCompare(bRole);
  });

  const hasStaff = keyJobs.length > 0;
  staffSection.style.display = hasStaff ? '' : 'none';
  if (!hasStaff) return;

  staffList.innerHTML = keyJobs.map(p => {
    const role = escHtml(p.roleName || p.jobs[0] || t('detail.staffFallbackRole'));
    const name = escHtml(p.nameCn || p.name);
    return `<span class="detail-staff-role">${role}</span><span class="detail-staff-name">${name}</span>`;
  }).join('');
}

function renderPlayButton(anime) {
  var btn = document.getElementById('btnPlayAnime');
  var textEl = document.getElementById('btnPlayText');
  if (!btn || !textEl) return;

  // Hide in wishlist mode or no episodes
  if (isWishlistMode || !anime.episodes || anime.episodes.length === 0) {
    btn.style.display = 'none';
    return;
  }

  btn.style.display = 'inline-flex';

  // Unified target logic
  var result = findTargetEpisode(anime);
  var targetEp = result.episode;
  var allWatched = result.allWatched;

  // 根据有无观看历史推断状态
  // 全新→开始播放 / 有进度或有历史→继续播放 / 全部看完→重新播放
  var hasViewHistory = anime.episodes.some(function(e) { return e.watched || e.progress > 0; });
  if (allWatched) {
    textEl.textContent = t('detail.replay');
  } else if (targetEp.progress > 0 || hasViewHistory) {
    textEl.textContent = t('detail.continue');
  } else {
    textEl.textContent = t('detail.startPlay');
  }

  // Store target for onclick handler (avoids inline JS string escaping)
  btn.dataset.path = targetEp.filePath;
  btn.dataset.pos = targetEp.progress || 0;
  btn.dataset.epIdx = anime.episodes.indexOf(targetEp);
}

function playEpisodeFromCover() {
  const btn = document.getElementById('btnPlayAnime');
  if (!btn || !btn.dataset.path) return;
  playEpisode(btn.dataset.path, parseFloat(btn.dataset.pos) || 0);

  // Scroll episode list to show target at the left edge
  const epIdx = parseInt(btn.dataset.epIdx);
  if (!isNaN(epIdx)) {
    const grid = document.getElementById('episodeHeatmapGrid');
    if (grid) {
      const card = grid.querySelector(`.episode-card[data-index="${epIdx}"]`);
      if (card) {
        const cs = getComputedStyle(grid);
        const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
        const step = card.offsetWidth + gap;
        const targetScroll = Math.max(0, epIdx * step);
        grid.scrollTo({ left: targetScroll, behavior: 'smooth' });
      }
    }
  }
}

  async function playEpisode(filePath, position = 0) {
    try {
      await API.post('/api/play', { filePath, position });
      showToast(t('detail.playing'), 'info');
    } catch (e) {
      showToast(t('detail.playFailed', { error: e.message }), 'error');
    }
  }

// ─── Finish confirmation (track dismissed to avoid repeated popups) ───
var _dismissedFinishConfirm = new Set();

/**
 * 检查刚播完的剧集是否需要弹窗确认标记看完。
 * 模式：prompt（弹窗确认，默认）/ auto（自动标记）/ off（不处理）；存量 on/off 迁移
 * 仅在 detail 页面调用（需要 currentAnime）。
 */
async function checkAndShowFinishConfirm(anime) {
  if (!anime) return;
  // 模式：prompt（弹窗确认，默认）/ auto（自动标记）/ off（不处理）；存量 on/off 迁移
  var mode = localStorage.getItem('myAnimDock_finishConfirm') || 'prompt';
  if (mode === 'on') mode = 'prompt';
  if (mode === 'off') return;
  var ep = findPendingFinishConfirm(anime);
  if (!ep) return;
  var key = anime.id + ':' + ep.number;
  if (mode === 'prompt') {
    if (_dismissedFinishConfirm.has(key)) return;
    var finished = await showFinishConfirm(anime, ep);
    if (!finished) { _dismissedFinishConfirm.add(key); return; }
  }
  // auto 模式或用户确认 → 标记看完
  try {
    await API.post('/api/progress', {
      animeId: anime.id,
      episodeNumber: ep.number,
      watched: true,
      progress: 0
    });
    currentAnime = await API.get('/api/anime/' + encodeURIComponent(anime.id));
    AppState.set('currentAnime', currentAnime);
    renderDetail();
    scrollToNextUnwatched(currentAnime, ep.number);
    showToast(t('detail.markedWatched', { number: ep.number }), 'success');
  } catch (e) {
    showToast(t('detail.markFailed', { error: e.message }), 'error');
  }
}

async function toggleWatched(animeId, epNumber, watched) {
  try {
    const result = await API.post('/api/progress', { animeId, episodeNumber: epNumber, watched, progress: watched ? undefined : 0 });
    if (currentAnime) {
      const ep = currentAnime.episodes.find(e => e.number === epNumber);
      if (ep) { ep.watched = result.episode.watched; ep.progress = result.episode.progress; }
      renderPlayButton(currentAnime);
      renderEpisodeHeatmap(currentAnime, false);
      renderWatchStats(currentAnime);
    }
  } catch (e) {
    showToast(t('detail.actionFailed', { error: e.message }), 'error');
  }
}

function syncBangumiMetadata() {
  if (!currentAnime) return;
  const modal = document.getElementById('syncModal');
  const input = document.getElementById('syncKeyword');
  const results = document.getElementById('syncSearchResults');
  if (!modal || !input) return;
  input.value = (currentAnime.specialSuffix || currentAnime.bangumiTitle || currentAnime.title).replace(/[~～]/g, '').trim();
  results.innerHTML = '';
  openModal('syncModal');
  input.focus();
}

async function searchBangumiWithKeyword() {
  if (!currentAnime) return;
  const keyword = document.getElementById('syncKeyword').value.trim();
  const resultsEl = document.getElementById('syncSearchResults');
  
  if (!keyword) {
    showToast(t('detail.enterKeyword'), 'warning');
    return;
  }
  
  resultsEl.innerHTML = '<p class="text-center p-4 text-content">' + t('detail.searching') + '</p>';
  
  try {
    const result = await API.post('/api/bangumi/search', { keyword });
    if (result.results && result.results.length > 0) {
      showSearchResults(result.results, currentAnime.id);
    } else {
      resultsEl.innerHTML = '<p class="search-result-empty">' + t('detail.noSearchResults') + '</p>';
    }
  } catch (e) {
    showToast(t('detail.searchFailed', { error: e.message }), 'error');
    resultsEl.innerHTML = '<p class="search-result-empty">' + t('detail.searchFailedEmpty') + '</p>';
  }
}

function showSearchResults(results, animeId) {
  const el = document.getElementById('syncSearchResults');
  if (!results || results.length === 0) {
    el.innerHTML = '<p class="search-result-empty">' + t('detail.noSearchResults') + '</p>';
    return;
  }
  el.innerHTML = '<h4 class="m-0 mb-3 text-content">' + t('detail.selectSubject') + '</h4>' +
    results.map(r => `
      <div class="search-result-item" onclick="attachBangumiSubject('${animeId}', ${r.id})">
        <img class="search-result-cover" src="${r.images?.small || r.images?.grid || ''}" alt=""
          loading="lazy" decoding="async" onerror="this.style.display='none'">
        <div class="search-result-info">
          <div class="search-result-title">${escHtml(r.name_cn || r.name)}</div>
          <div class="search-result-subtitle">${escHtml(r.name)}</div>
          <div class="search-result-meta">${r.date || ''}${r.rating?.score ? ' · ★' + r.rating.score.toFixed(1) : ''}</div>
        </div>
        <button class="btn btn-primary search-result-btn">${t('detail.select')}</button>
      </div>
    `).join('');
}

async function attachBangumiSubject(animeId, subjectId) {
  const resultsEl = document.getElementById('syncSearchResults');
  resultsEl.innerHTML = '<p class="text-center p-4 text-content">' + t('detail.fetchingMetadata') + '</p>';
  try {
    const result = await API.post('/api/bangumi/fetch', { animeId, subjectId });
    currentAnime = result.anime;
    AppState.set('currentAnime', currentAnime);
    renderDetail();
    closeModal('syncModal');
    if (typeof loadLibrary === 'function') loadLibrary();
    showToast(t('detail.metadataSuccess'), 'success');
  } catch (e) {
    showToast(t('detail.fetchFailed', { error: e.message }), 'error');
    resultsEl.innerHTML = '';
  }
}

async function deleteAnime() {
  if (!currentAnime) return;
  if (!(await showConfirm(t('detail.deleteConfirm', { title: currentAnime.title })))) return;

  try {
    await API.del(`/api/anime/${encodeURIComponent(currentAnime.id)}`);
    showToast(t('detail.deleted'), 'success');
    goBack();
    loadLibrary();
    loadDiscovery();
    if (typeof loadMyList === 'function') loadMyList();
  } catch (e) {
    showToast(t('detail.deleteFailed', { error: e.message }), 'error');
  }
}


// ─── Relations + Recommendations (on-demand) ───

async function fetchAndRenderRelations(animeId) {
  const container = document.getElementById('detailRelations');
  const scrollEl = document.getElementById('relationScroll');
  if (!container || !scrollEl) return;

  const cached = _relationCache.get(animeId);
  if (cached) {
    if (cached.data.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
    scrollEl.innerHTML = cached.html;

    initScrollDots({
      scroll: scrollEl,
      cardSelector: '.relation-card',
      total: cached.data.length,
      dotsParent: container.querySelector('.detail-section-header'),
    });
    return;
  }

  try {
    container.style.display = 'none';
    scrollEl.innerHTML = '';
    const res = await API.get('/api/anime/' + encodeURIComponent(animeId) + '/relations');
    const relations = res.relations || [];
    if (relations.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
    const badgeColors = { SEQUEL: '#22c55e', PREQUEL: '#f59e0b', SIDE_STORY: '#6366f1', SPIN_OFF: '#ec4899' };
    scrollEl.innerHTML = relations.map(r => {
      const cover = r.coverImage?.large || '';
      const label = r.relationType || '';
      const title = r.title?.native || r.title?.romaji || r.title?.english || 'Unknown';
      const color = badgeColors[label] || '#6b7280';
      const click = r.inLibrary && r.localId
        ? `onclick="showDetail('${r.localId.replace(/'/g, "\\'")}',null,null,'library')"`
        : `onclick="openExternalUrl('https://anilist.co/anime/${r.id}')"`;
      return `<div class="relation-card" ${click}>
        <div class="relation-card-cover">
          <div class="relation-card-img"${cover ? ' style="background-image:url(' + cover.replace(/\)/g,'%29') + ')"' : ''}></div>
          <span class="relation-badge" style="background:${color}">${escHtml(label)}</span>
        </div>
        <div class="relation-card-title">${escHtml(title)}</div>
      </div>`;
    }).join('');

    initScrollDots({
      scroll: scrollEl,
      cardSelector: '.relation-card',
      total: relations.length,
      dotsParent: container.querySelector('.detail-section-header'),
    });

    _relationCache.set(animeId, { data: relations, html: scrollEl.innerHTML });
  } catch (e) {
    container.style.display = 'none';
  }
}

async function fetchAndRenderRecommendations(animeId) {
  const container = document.getElementById('detailRecommendations');
  const scrollEl = document.getElementById('recommendationScroll');
  if (!container || !scrollEl) return;

  const cached = _recCache.get(animeId);
  if (cached) {
    if (cached.data.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
    scrollEl.innerHTML = cached.html;

    initScrollDots({
      scroll: scrollEl,
      cardSelector: '.relation-card',
      total: cached.data.length,
      dotsParent: container.querySelector('.detail-section-header'),
    });
    return;
  }

  try {
    container.style.display = 'none';
    scrollEl.innerHTML = '';
    const res = await API.get('/api/anime/' + encodeURIComponent(animeId) + '/recommendations');
    const recs = res.recommendations || [];
    if (recs.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
scrollEl.innerHTML = recs.map(r => {
      const cover = r.coverImage?.large || '';
      const title = r.title?.native || r.title?.romaji || r.title?.english || 'Unknown';
      const rating = r.averageScore ? `★ ${r.averageScore}` : '';
      const click = r.inLibrary && r.localId
        ? `onclick="showDetail('${r.localId.replace(/'/g, "\\'")}',null,null,'library')"`
        : `onclick="openExternalUrl('https://anilist.co/anime/${r.id}')"`;
      return `<div class="relation-card" ${click}>
        <div class="relation-card-cover">
          <div class="relation-card-img"${cover ? ' style="background-image:url(' + cover.replace(/\)/g,'%29') + ')"' : ''}></div>
          ${rating ? `<span class="relation-badge relation-badge--rating">${escHtml(rating)}</span>` : ''}
        </div>
        <div class="relation-card-title">${escHtml(title)}</div>
      </div>`;
    }).join('');

    initScrollDots({
      scroll: scrollEl,
      cardSelector: '.relation-card',
      total: recs.length,
      dotsParent: container.querySelector('.detail-section-header'),
    });

    _recCache.set(animeId, { data: recs, html: scrollEl.innerHTML });
  } catch (e) {
    container.style.display = 'none';
  }
}

// ─── ESM exports for onclick handlers ───
window.playEpisodeFromCover = playEpisodeFromCover;
window.syncBangumiMetadata = syncBangumiMetadata;
window.deleteAnime = deleteAnime;
window.searchBangumiWithKeyword = searchBangumiWithKeyword;
window.toggleExpand = toggleExpand;
window.animateHeroCoverFlip = animateHeroCoverFlip;



