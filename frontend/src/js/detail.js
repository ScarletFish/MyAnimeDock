gsap.registerPlugin(Flip);

let currentAnime = null;
let detailRefreshTimer = null, detailRefreshES = null;
let wasMpvActive = false;

// Wishlist mode (set when viewing mylist wishlist items)
let isWishlistMode = false;

// Relations/Recommendations cache (30min TTL)
const _CACHE_TTL = 30 * 60 * 1000;
const _relationCache = createTimedCacheMap(_CACHE_TTL);
const _recCache = createTimedCacheMap(_CACHE_TTL);

// Character grid: large max-height for smooth CSS transition (replaces 'none')
const MAX_GRID_HEIGHT = 10000;

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
    tagsEl.innerHTML = `<div class="detail-tags-list">${allTags.map(t => `<span class="tag-pill">${escHtml(t)}</span>`).join('')}</div>`;
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

function startDetailRefresh() {
  stopDetailRefresh();
  wasMpvActive = false;

  function onMpvStatus(active) {
    if (!currentAnime) { stopDetailRefresh(); return; }
    if (wasMpvActive && !active) {
      // mpv 刚结束 → 刷新数据
      API.get(`/api/anime/${encodeURIComponent(currentAnime.id)}`).then(updated => {
        currentAnime = updated;
        AppState.set('currentAnime', currentAnime);
        renderDetail();
        var _allDone = currentAnime.episodes && currentAnime.episodes.length > 0
          && currentAnime.episodes.every(function(e) { return e.watched; });
        if (_allDone && currentAnime.myListStatus === 'completed') {
          showToast('播放已结束，已看完所有剧集', 'success');
          return;
        }
        showToast('播放已结束，进度已更新', 'success');
      });
    }
    wasMpvActive = active;
  }

  // SSE 事件流（被动接收，无需轮询）
  var es = new EventSource('/api/events/mpv-status');
  es.onmessage = function(e) {
    try { onMpvStatus(JSON.parse(e.data).active); } catch (_) {}
  };
  es.onerror = function() {
    // EventSource 会自动重连，无需处理
  };
  detailRefreshES = es;

  // 先用一次 HTTP 查询兜底（页面刚加载时 SSE 可能有延迟，以及 SSE 不支持时的降级）
  API.get('/api/mpv-status').then(function(st) { onMpvStatus(st.active); }).catch(function() {});
}

function stopDetailRefresh() {
  if (detailRefreshES) { detailRefreshES.close(); detailRefreshES = null; }
}

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

    // Auto-play from continue watching section
    if (typeof pendingAutoPlay !== 'undefined' && pendingAutoPlay === id) {
      pendingAutoPlay = null;
      const ep = findWatchEpisode(currentAnime);
      if (ep) {
        setTimeout(() => playEpisode(ep.filePath, ep.progress), 400);
      }
    }
  } catch (e) {
    showToast('加载详情失败: ' + e.message, 'error');
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
  } else if (anime.coverUrl) {
    coverEl.innerHTML = `<img src="${escAttr(anime.coverUrl)}" alt="${escAttr(anime.title)}">`;
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
    // Remote URL (http/https) → use directly; local path → use /banners/ route
    bannerImg.src = anime.anilistBanner.startsWith('http')
      ? anime.anilistBanner
      : `/banners/${path.basename(anime.anilistBanner)}`;
    bannerImg.alt = '';
    // Very wide banners (ratio > 2.5): shift upward to keep face visible
    bannerImg.onload = function() {
      if (this.naturalWidth / this.naturalHeight > 2.5) this.style.objectPosition = 'center 25%';
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
  if (anime.ratingTotal) leftParts.push(`<span class="info-rating-sub">${anime.ratingTotal}人</span>`);

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

  // ─── Tags ───
  const tagsEl = document.getElementById('detailTags');
  let tags = (anime.tags || []).filter(t => {
    if (anime.platform && t === anime.platform) return false;
    if (/\d{4}(年|年\d{1,2}月|\-\d{2})/.test(t)) return false;
    if (/^\d{1,2}月$/.test(t)) return false;
    return true;
  });
  // Sort: production company first (contains 制作 or common studio names)
  const studioKeywords = ['制作', '动画', 'studio', 'Production', 'Works'];
  tags.sort((a, b) => {
    const aIsStudio = studioKeywords.some(k => a.toLowerCase().includes(k.toLowerCase()));
    const bIsStudio = studioKeywords.some(k => b.toLowerCase().includes(k.toLowerCase()));
    if (aIsStudio && !bIsStudio) return -1;
    if (!aIsStudio && bIsStudio) return 1;
    return 0;
  });
  if (tags.length) {
    const MAX_TAGS = 4;
    const shown = tags.slice(0, MAX_TAGS);
    const remaining = tags.length - MAX_TAGS;
    let html = shown.map(t => `<span class="tag-pill">${escHtml(t)}</span>`).join('');
    if (remaining > 0) {
      html += `<span class="tag-pill tag-pill--more" onclick="expandTags()">+${remaining}</span>`;
    }
    tagsEl.innerHTML = `<div class="detail-tags-list">${html}</div>`;
    tagsEl.style.display = '';
    tagsEl._allTags = tags;
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
      <div class="archive-magazine-thoughts text-sm text-content leading-[1.7]">此条目来自愿望单，目前没有本地文件。</div>
    </div>
    <div class="archive-magazine-meta">
      ${anime.rating ? `
        <div class="archive-magazine-stat">
          <span class="archive-magazine-stat-value">★ ${anime.rating}</span>
          <span class="archive-magazine-stat-label">评分</span>
        </div>` : ''}
      <div class="archive-magazine-stat">
        <span class="archive-magazine-stat-value">愿望单</span>
        <span class="archive-magazine-stat-label">来源</span>
      </div>
    </div>
    <div class="wishlist-detail-actions mt-4">
      <a class="btn btn-primary" href="https://bgm.tv/subject/${anime.bangumiId}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        在 Bangumi 中打开
      </a>
    </div>
  `;
}

function findWatchEpisode(anime) {
  if (!anime.episodes || anime.episodes.length === 0) return null;
  // Last played episode (recency-based, derived from play sessions)
  if (anime.lastPlayedEp) {
    const ep = anime.episodes.find(e => e.number === anime.lastPlayedEp);
    if (ep && (!ep.watched || ep.progress > 0)) return ep;
  }
  // No play record: pick first unwatched
  for (const ep of anime.episodes) {
    if (!ep.watched) return ep;
  }
  // All watched — nothing to continue
  return null;
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
  el.textContent = text || '暂无简介';
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

  const filtered = persons.filter(p =>
    (p.roleName && p.roleName !== '出版社') || (p.jobs && p.jobs.length > 0)
  );
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
    const role = escHtml(p.roleName || p.jobs[0] || '职员');
    const name = escHtml(p.nameCn || p.name);
    return `<span class="detail-staff-role">${role}</span><span class="detail-staff-name">${name}</span>`;
  }).join('');
}

function renderPlayButton(anime) {
  const btn = document.getElementById('btnPlayAnime');
  const textEl = document.getElementById('btnPlayText');
  if (!btn || !textEl) return;

  // Hide in wishlist mode or no episodes
  if (isWishlistMode || !anime.episodes || anime.episodes.length === 0) {
    btn.style.display = 'none';
    return;
  }

  btn.style.display = 'inline-flex';

  // Find target episode: last played → first unwatched → first episode (rewatch)
  let targetEp = null;
  let allWatched = false;

  // Last played episode (recency-based)
  if (anime.lastPlayedEp) {
    targetEp = anime.episodes.find(e => e.number === anime.lastPlayedEp);
    if (targetEp && (targetEp.watched && targetEp.progress === 0)) targetEp = null;
  }
  if (!targetEp) {
    for (const ep of anime.episodes) {
      if (!ep.watched) { targetEp = ep; break; }
    }
  }
  if (!targetEp) {
    targetEp = anime.episodes[0];
    allWatched = true;
  }

  // Set button text
  if (allWatched) {
    textEl.textContent = '重新播放';
  } else if (targetEp.progress > 0) {
    textEl.textContent = '继续播放';
  } else {
    textEl.textContent = '开始播放';
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
    showToast('正在播放...', 'info');
  } catch (e) {
    showToast('播放失败: ' + e.message, 'error');
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
    showToast('操作失败: ' + e.message, 'error');
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
    showToast('请输入搜索关键词', 'warning');
    return;
  }
  
  resultsEl.innerHTML = '<p class="text-center p-4 text-content">搜索中...</p>';
  
  try {
    const result = await API.post('/api/bangumi/search', { keyword });
    if (result.results && result.results.length > 0) {
      showSearchResults(result.results, currentAnime.id);
    } else {
      resultsEl.innerHTML = '<p class="search-result-empty">未找到匹配结果</p>';
    }
  } catch (e) {
    showToast('搜索失败: ' + e.message, 'error');
    resultsEl.innerHTML = '<p class="search-result-empty">搜索失败</p>';
  }
}

function showSearchResults(results, animeId) {
  const el = document.getElementById('syncSearchResults');
  if (!results || results.length === 0) {
    el.innerHTML = '<p class="search-result-empty">未找到匹配结果</p>';
    return;
  }
  el.innerHTML = '<h4 class="m-0 mb-3 text-content">请选择匹配的条目：</h4>' +
    results.map(r => `
      <div class="search-result-item" onclick="attachBangumiSubject('${animeId}', ${r.id})">
        <img class="search-result-cover" src="${r.images?.small || r.images?.grid || ''}" alt=""
          loading="lazy" decoding="async" onerror="this.style.display='none'">
        <div class="search-result-info">
          <div class="search-result-title">${escHtml(r.name_cn || r.name)}</div>
          <div class="search-result-subtitle">${escHtml(r.name)}</div>
          <div class="search-result-meta">${r.date || ''}${r.rating?.score ? ' · ★' + r.rating.score.toFixed(1) : ''}</div>
        </div>
        <button class="btn btn-primary search-result-btn">选择</button>
      </div>
    `).join('');
}

async function attachBangumiSubject(animeId, subjectId) {
  const resultsEl = document.getElementById('syncSearchResults');
  resultsEl.innerHTML = '<p class="text-center p-4 text-content">正在获取元数据...</p>';
  try {
    const result = await API.post('/api/bangumi/fetch', { animeId, subjectId });
    currentAnime = result.anime;
    AppState.set('currentAnime', currentAnime);
    renderDetail();
    closeModal('syncModal');
    if (typeof loadLibrary === 'function') loadLibrary();
    showToast('Bangumi 元数据获取成功', 'success');
  } catch (e) {
    showToast('获取失败: ' + e.message, 'error');
    resultsEl.innerHTML = '';
  }
}

async function deleteAnime() {
  if (!currentAnime) return;
  if (!(await showConfirm(`确定移出「${currentAnime.title}」？<br>仅从库中移除，不影响本地文件。`))) return;

  try {
    await API.del(`/api/anime/${encodeURIComponent(currentAnime.id)}`);
    showToast('已删除', 'success');
    goBack();
    loadLibrary();
    loadDiscovery();
    if (typeof loadMyList === 'function') loadMyList();
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
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
        : `onclick="window.open('https://anilist.co/anime/${r.id}','_blank')"`;
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
        : `onclick="window.open('https://anilist.co/anime/${r.id}','_blank')"`;
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



