gsap.registerPlugin(Flip);

let currentAnime = null;
let watchCardVersion = 0;
let watchStatsVersion = 0;
let detailRefreshTimer = null;
let wasMpvActive = false;

// Archive mode flags (set by memory.js)
let isArchiveMode = false;
// Wishlist mode (set when viewing mylist wishlist items)
let isWishlistMode = false;

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
let archiveMemoryData = null;
let detailSourceView = 'library';

function resetDetailEnter() {
  clearTimeout(charResizeTimer);
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
  detailRefreshTimer = setInterval(async () => {
    if (!currentAnime) { stopDetailRefresh(); return; }
    try {
      const st = await API.get('/api/mpv-status');
      if (wasMpvActive && !st.active) {
        currentAnime = await API.get(`/api/anime/${encodeURIComponent(currentAnime.id)}`);
        renderDetail();
        showToast('播放已结束，进度已更新');
      }
      wasMpvActive = st.active;
    } catch (e) {}
  }, 2000);
}

function stopDetailRefresh() {
  if (detailRefreshTimer) { clearInterval(detailRefreshTimer); detailRefreshTimer = null; }
}

async function showDetail(id, fromRect, fromSrc) {
  // Reset archive mode when viewing library items
  isArchiveMode = false;
  isWishlistMode = false;
  archiveMemoryData = null;
  detailSourceView = 'library';
  // Remove archive magazine layout class if present
  const layoutEl = document.querySelector('.detail-layout');
  if (layoutEl) layoutEl.classList.remove('detail-layout--archive');

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
      showView('detail');
      const wrap = document.getElementById('detailCover');
      wrap.style.opacity = '1';
      wrap.style.transform = 'scale(1)';
    }

    document.getElementById('headerTitle').textContent = currentAnime.bangumiTitle || currentAnime.title;
    startDetailRefresh();
  } catch (e) {
    showToast('加载详情失败: ' + e.message);
  }
}

function animateHeroCoverFlip(fromRect, fromSrc) {
  const viewEl = document.getElementById('detailView');
  const wrap = document.getElementById('detailCover');
  const img = wrap.querySelector('img');
  if (!img) {
    wrap.style.opacity = '1';
    return;
  }

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
    border-radius:16px;
  `;

  const clone = document.createElement('img');
  clone.src = fromSrc || img.src;
  clone.alt = img.alt || '';
  clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  hero.appendChild(clone);
  document.body.appendChild(hero);

  const state = Flip.getState(hero);

  // Move hero to detail position (Last)
  hero.style.left = toRect.left + 'px';
  hero.style.top = toRect.top + 'px';
  hero.style.width = toRect.width + 'px';
  hero.style.height = toRect.height + 'px';

  viewEl.classList.add('show-content');

  Flip.from(state, {
    duration: 0.35,
    ease: 'power2.out',
    absolute: true,
    onComplete: () => {
      revealCover();
    }
  });

  function revealCover() {
    // Wait for the detail cover image to finish loading before revealing,
    // preventing a flash when the hero overlay disappears.
    if (img.complete) {
      wrap.style.visibility = '';
      wrap.style.opacity = '1';
      wrap.style.transform = '';
      hero.remove();
    } else {
      img.onload = img.onerror = () => {
        wrap.style.visibility = '';
        wrap.style.opacity = '1';
        wrap.style.transform = '';
        hero.remove();
      };
    }
  }
}

function renderDetail() {
  if (!currentAnime) return;

  const anime = currentAnime;

  // ─── Cover ───
  const coverEl = document.getElementById('detailCover');
  if (anime.localCover) {
    coverEl.innerHTML = `<img src="/covers/${path.basename(anime.localCover)}?w=540&q=80" alt="${escAttr(anime.title)}" decoding="async">`;
  } else if (anime.coverUrl) {
    coverEl.innerHTML = `<img src="${escAttr(anime.coverUrl)}" alt="${escAttr(anime.title)}" decoding="async">`;
  } else {
    coverEl.innerHTML = `<div class="gray-cover"><svg viewBox="0 0 24 24" width="64" height="64" fill="#555"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div>`;
  }

  document.getElementById('detailTitle').textContent = anime.bangumiTitle || anime.title;

  // ─── Info panel ───
  const infoLine = document.getElementById('detailInfoLine');
  const leftParts = [];
  if (anime.rating) leftParts.push(`<span class="info-rating-num">★ ${anime.rating}</span>`);
  if (anime.ratingRank) leftParts.push(`<span class="info-rating-sub">#${anime.ratingRank}</span>`);
  if (anime.ratingTotal) leftParts.push(`<span class="info-rating-sub">${anime.ratingTotal}人</span>`);

  const rightParts = [];
  const total = anime.totalSeasons;
  if (total && total > 1) {
    const s = anime.matchedSeason || anime.season || 1;
    const mismatch = anime.season && anime.matchedSeason && anime.season !== anime.matchedSeason;
    if (s !== 1 || mismatch) {
      rightParts.push(`<span class="info-tag${mismatch ? ' info-tag--warn' : ''}">S${s} / 共${total}季${mismatch ? ' ⚠' : ''}</span>`);
    } else {
      rightParts.push(`<span class="info-tag">共${total}季</span>`);
    }
  }
  if (anime.date) rightParts.push(`<span class="info-tag">${anime.date}</span>`);
  if (anime.platform) rightParts.push(`<span class="info-tag">${escHtml(anime.platform)}</span>`);
  infoLine.innerHTML =
    (leftParts.length ? `<span class="info-left">${leftParts.join('')}</span>` : '') +
    (rightParts.length ? `<span class="info-tags">${rightParts.join('')}</span>` : '');
  infoLine.style.display = leftParts.length || rightParts.length ? '' : 'none';

  // ─── Tags ───
  const tagsEl = document.getElementById('detailTags');
  const tags = (anime.tags || []).filter(t => {
    if (anime.platform && t === anime.platform) return false;
    if (/\d{4}(年|年\d{1,2}月|\-\d{2})/.test(t)) return false;
    if (/^\d{1,2}月$/.test(t)) return false;
    return true;
  });
  if (tags.length) {
    tagsEl.innerHTML = `<div class="detail-tags-list">${tags.map(t => `<span class="detail-tag">${escHtml(t)}</span>`).join('')}</div>` +
      `<button class="detail-tag-toggle" onclick="toggleExpand('detailTags')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>`;
    tagsEl.classList.remove('expanded');
    tagsEl.style.display = '';
    tagsEl._checkOverflow = () => checkToggleOverflow(tagsEl, '.detail-tags-list', '.detail-tag-toggle');
  } else {
    tagsEl.style.display = 'none';
  }

  renderSummary(anime);

  // ─── Actions & metadata ───
  const syncModal = document.getElementById('syncModal');
  if (syncModal) syncModal.classList.remove('show');

  const fetchBtn = document.getElementById('btnFetchBangumi');
  const deleteBtn = document.getElementById('btnDeleteAnime');
  const writeBtn = document.getElementById('btnWriteMemory');

  if (isArchiveMode) {
    if (fetchBtn) fetchBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (writeBtn) {
      writeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>编辑感想`;
      writeBtn.style.display = 'inline-flex';
    }
  } else {
    if (fetchBtn) { fetchBtn.style.display = 'inline-flex'; fetchBtn.disabled = false; }
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    if (writeBtn) {
      writeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>写感想`;
      writeBtn.style.display = 'inline-flex';
    }
  }

  // ─── Right column modules ───
  if (isArchiveMode) {
    renderArchiveDetail(anime);
  } else if (isWishlistMode) {
    renderWishlistDetail(anime);
  } else {
    document.getElementById('archiveDetail').style.display = 'none';
    document.getElementById('watchCard').style.display = '';
    document.getElementById('episodeHeatmap').style.display = '';
    document.getElementById('detailCharacters').style.display = '';
    document.getElementById('watchStats').style.display = '';
    // Remove archive layout class
    const layoutEl = document.querySelector('.detail-layout');
    if (layoutEl) layoutEl.classList.remove('detail-layout--archive');
    renderWatchCard(anime);
    renderEpisodeHeatmap(anime);
    renderCharacters(anime);
  }
  renderWatchStats(anime);

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
  if (!canAutoExpand(charWrap)) return;
  measureAndBalance(charWrap);
  updateToggleVisibility(charWrap);
}

function canAutoExpand(wrap) {
  if (!wrap) return false;
  if (wrap.dataset.userToggled === 'true') return false;

  const grid = wrap.querySelector('.detail-char-grid');
  if (!grid || grid.children.length <= 6) return false;

  const charWrapEl = wrap.closest('.detail-characters');
  if (!charWrapEl || charWrapEl.style.display === 'none') return false;

  const detailView = document.getElementById('detailView');
  if (detailView && detailView.classList.contains('hidden')) return false;

  const left = document.querySelector('.detail-left');
  const right = document.querySelector('.detail-right');
  if (!left || !right) return false;

  return true;
}

function measureAndBalance(wrap) {
  const grid = wrap.querySelector('.detail-char-grid');
  const left = document.querySelector('.detail-left');
  const right = document.querySelector('.detail-right');

  const rowH = getCharGridRowHeight();
  const totalItems = grid.children.length;
  const maxRows = Math.ceil(totalItems / 3);

  // 无损测量：用 grid.clientHeight（渲染盒高度）替代 scrollHeight，
  // 因为 right.scrollHeight 只包含 grid 的渲染盒高度，与 clientHeight 同坐标系。
  const gridRendered = grid.clientHeight;
  const rightFull = right.scrollHeight;
  const nonGridHeight = rightFull - gridRendered;
  const leftH = left.scrollHeight;

  const availableRows = (leftH - nonGridHeight) / rowH;
  const targetRows = Math.max(2, Math.min(Math.round(availableRows), maxRows));

  if (targetRows >= maxRows) {
    wrap.classList.add('expanded');
    grid.style.overflow = '';
  } else {
    wrap.classList.remove('expanded');
    grid.style.overflow = 'hidden';
  }

  const targetHeight = targetRows >= maxRows ? MAX_GRID_HEIGHT : rowH * targetRows;
  // Use CSS transition for max-height animation (GSAP CSSPlugin fails to set maxHeight on grid elements)
  grid.style.maxHeight = targetHeight + 'px';
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
    if (currentAnime && !isArchiveMode && document.getElementById('detailView')?.classList.contains('hidden') === false) {
      const wrap = document.getElementById('detailCharWrap');
      if (wrap && wrap.dataset.userToggled !== 'true') {
        autoExpandCharacters();
      }
    }
  }, 300);
});

function renderWishlistDetail(anime) {
  // Hide interactive modules
  document.getElementById('watchCard').style.display = 'none';
  document.getElementById('episodeHeatmap').style.display = 'none';
  document.getElementById('detailCharacters').style.display = 'none';
  document.getElementById('watchStats').style.display = 'none';
  document.getElementById('archiveDetail').style.display = 'none';

  // Hide action buttons
  const fetchBtn = document.getElementById('btnFetchBangumi');
  const deleteBtn = document.getElementById('btnDeleteAnime');
  const writeBtn = document.getElementById('btnWriteMemory');
  if (fetchBtn) fetchBtn.style.display = 'none';
  if (deleteBtn) deleteBtn.style.display = 'none';
  if (writeBtn) writeBtn.style.display = 'none';

  const layoutEl = document.querySelector('.detail-layout');
  if (layoutEl) layoutEl.classList.remove('detail-layout--archive');

  // Show wishlist info in the right column
  document.getElementById('archiveDetail').style.display = 'block';
  const archiveEl = document.getElementById('archiveDetail');
  archiveEl.innerHTML = `
    <div class="archive-magazine-essay">
      <div class="archive-magazine-thoughts" style="font-size:0.875rem;color:var(--text2);line-height:1.7">此条目来自愿望单，目前没有本地文件。</div>
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
    <div class="wishlist-detail-actions" style="margin-top:1rem">
      <a class="btn btn-primary" href="https://bgm.tv/subject/${anime.bangumiId}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        在 Bangumi 中打开
      </a>
    </div>
  `;
}

function renderArchiveDetail(anime) {
  // Switch layout to archive magazine mode
  const layoutEl = document.querySelector('.detail-layout');
  if (layoutEl) layoutEl.classList.add('detail-layout--archive');

  // Hide library right-column modules
  document.getElementById('watchCard').style.display = 'none';
  document.getElementById('episodeHeatmap').style.display = 'none';
  document.getElementById('detailCharacters').style.display = 'none';
  document.getElementById('watchStats').style.display = 'none';

  const archiveEl = document.getElementById('archiveDetail');
  archiveEl.style.display = 'block';

  const memory = archiveMemoryData || {};
  const thoughts = memory.thoughts || '';
  const notes = memory.notes || '';
  const rating = memory.rating || null;
  const dateStr = memory.watchedAt
    ? new Date(memory.watchedAt).toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric'
      })
    : '';

  // Essay / thoughts
  document.getElementById('archiveThoughts').textContent = thoughts || '暂无感想';

  // Rating
  document.getElementById('archiveRating').textContent = rating ? '★ ' + rating : '——';

  // Date
  document.getElementById('archiveDate').textContent = dateStr || '——';

  // Episode count
  const epCount = (anime.episodes && anime.episodes.length) || archiveMemoryData?.episodeCount || '—';
  document.getElementById('archiveEpisodes').textContent = epCount !== '—' ? '全 ' + epCount + ' 集' : '—';

  // Notes
  const notesEl = document.getElementById('archiveNotes');
  if (notes) {
    notesEl.style.display = 'block';
    document.getElementById('archiveNotesContent').textContent = notes;
  } else {
    notesEl.style.display = 'none';
  }
}

function findWatchEpisode(anime) {
  if (!anime.episodes || anime.episodes.length === 0) return null;
  let first = null;
  for (const ep of anime.episodes) {
    if (!first) first = ep;
    if (!ep.watched && ep.progress > 0) return ep;
  }
  for (const ep of anime.episodes) {
    if (!ep.watched) return ep;
  }
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
        const paragraphs = text.split(/\n+/).filter(p => p.trim());
        const cn = paragraphs.filter(p => {
          // 平假名是日文最可靠的特征 —— 中文文本几乎不含平假名
          const hiragana = (p.match(/[\u3040-\u309f]/g) || []).length;
          const katakana = (p.match(/[\u30a0-\u30ff]/g) || []).length;
          const hanCount = (p.match(/[\u4e00-\u9fff]/g) || []).length;
          // 有 ≥3 个平假名 → 日文
          if (hiragana >= 3) return false;
          // 有大量片假名但很少汉字 → 日文
          if (katakana >= 8 && hanCount < 3) return false;
          // 没有汉字也没有假名 → 非中文段落（可能是英文）
          if (hanCount === 0 && hiragana === 0 && katakana === 0) return false;
          // 有汉字且没有明显日文特征 → 中文
          return hanCount > 0;
        });
        if (cn.length > 0) text = cn.join('\n');
      }
    }
  }
  el.textContent = text || '暂无简介';
}

function renderWatchCard(anime) {
  const version = ++watchCardVersion;
  const ep = findWatchEpisode(anime);
  const bgEl = document.getElementById('watchCardBg');
  const labelEl = document.getElementById('watchCardLabel');
  const titleEl = document.getElementById('watchCardTitle');
  const progressWrap = document.getElementById('watchCardProgressWrap');
  const progressBar = document.getElementById('watchCardProgressBar');
  const btn = document.getElementById('watchCardBtn');
  const btnText = document.getElementById('watchCardBtnText');

  if (!ep) {
    labelEl.textContent = '已全部观看完毕';
    titleEl.textContent = '';
    progressWrap.style.display = 'none';
    btn.style.display = 'none';
    bgEl.style.backgroundImage = '';
    return;
  }

  const pct = ep.duration > 0 ? Math.min(100, Math.round(ep.progress / ep.duration * 100)) : 0;
  const thumbTime = ep.progress > 0 ? ep.progress : 60;
  const thumbUrl = `/api/thumbnail?path=${encodeURIComponent(ep.filePath)}&time=${thumbTime}`;

  // Show a neutral background first (reset)
  bgEl.style.backgroundImage = '';

  // Set video thumbnail as full card background with version guard
  // ★ 注意: 使用引号包裹 url() 防止路径中的 ) 破坏 CSS 解析
  const img = new Image();
  img.onload = () => {
    if (version === watchCardVersion) {
      bgEl.style.backgroundImage = `url("${thumbUrl}")`;
    }
  };
  img.onerror = () => {
    if (version === watchCardVersion && anime.localCover) {
      bgEl.style.backgroundImage = `url(/covers/${path.basename(anime.localCover)}?w=540&q=80)`;
    }
  };
  img.src = thumbUrl;

  if (ep.watched) {
    labelEl.textContent = '重温';
    btnText.textContent = '重新播放';
  } else if (ep.progress > 0) {
    labelEl.textContent = `继续播放 第 ${ep.number} 集`;
    btnText.textContent = '继续播放';
  } else {
    labelEl.textContent = `开始播放 第 ${ep.number} 集`;
    btnText.textContent = '开始播放';
  }
  titleEl.textContent = ep.fileName;
  progressWrap.style.display = 'block';
  progressBar.style.width = pct + '%';
  btn.style.display = 'inline-flex';
  btn.onclick = () => playEpisode(ep.filePath, ep.progress);
}

function renderEpisodeHeatmap(anime) {
  const grid = document.getElementById('episodeHeatmapGrid');
  const header = document.querySelector('.episode-heatmap-header h3');
  if (!anime.episodes || anime.episodes.length === 0) {
    grid.innerHTML = '<p class="heatmap-empty">暂无剧集信息</p>';
    header.textContent = '剧集列表';
    return;
  }
  const localCount = anime.episodes.length;
  const totalCount = anime.totalEpisodes || anime.eps;
  header.innerHTML = totalCount
    ? `剧集列表 · <span class="ep-count">${localCount} /${totalCount}集</span>`
    : `剧集列表 · <span class="ep-count">${localCount} 集</span>`;

  const cols = window.innerWidth < 768 ? 5 : 10;
  grid.innerHTML = anime.episodes.map((ep, i) => {
    let cls = 'unwatched', tip = `第${ep.number}集 · 未观看`;
    if (ep.watched) { cls = 'watched'; tip = `第${ep.number}集 · 已观看`; }
    else if (ep.progress > 0) { cls = 'watching'; tip = `第${ep.number}集 · 观看中 ${ep.duration > 0 ? Math.round(ep.progress / ep.duration * 100) + '%' : ''}`; }
    return `<button class="heatmap-cell ${cls}" data-tip="${tip}" data-ep="${ep.number}" data-path="${escAttr(ep.filePath)}" data-pos="${ep.progress}" tabindex="0"></button>`;
  }).join('');

  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  grid.querySelectorAll('.heatmap-cell').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path;
      const pos = parseFloat(el.dataset.pos) || 0;
      playEpisode(path, pos);
    });
    // Right-click to toggle watched status
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentAnime) return;
      const epNumber = parseInt(el.dataset.ep);
      const ep = currentAnime.episodes.find(e => e.number === epNumber);
      if (!ep) return;
      toggleWatched(currentAnime.id, epNumber, !ep.watched);
    });
  });
}

// ─── Window resize → reflow heatmap ───
let heatmapResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(heatmapResizeTimer);
  heatmapResizeTimer = setTimeout(() => {
    if (currentAnime && !isArchiveMode && document.getElementById('detailView').classList.contains('hidden') === false) {
      renderEpisodeHeatmap(currentAnime);
    }
  }, 200);
});

// ─── Key staff roles to display (filtered) ───
const KEY_STAFF_ROLES = ['原作', '监督', '导演', '系列构成', '脚本', '音乐', '动画制作', '角色设计', '人物设定', '制作', '製作'];

function renderCharacters(anime) {
  const container = document.getElementById('detailCharacters');
  const grid = document.getElementById('detailCharGrid');
  const staffSection = document.getElementById('detailStaffSection');
  const staffList = document.getElementById('detailStaffList');

  if (!grid) return;
  const chars = anime.characters || [];
  const persons = anime.persons || [];

  if (!chars.length) {
    container.style.display = 'none';
    return;
  }

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

  // 小网格（≤6 项 = ≤2 行）：不需要截断，让它们自然渲染
  // 大网格（>6 项）：锁定初始高度，后续由 auto-expand 计算平衡行数
  const needsClipping = grid.children.length > 6;
  if (needsClipping) {
    grid.style.maxHeight = grid.scrollHeight + 'px';
  }

  // 等待角色头像加载完成后重新校准
  waitForCharImages(grid).then(() => {
    const detailView = document.getElementById('detailView');
    if (detailView && detailView.classList.contains('hidden')) return;
    const wrap = document.getElementById('detailCharWrap');
    if (!wrap || wrap.dataset.userToggled === 'true') return;

    if (needsClipping) {
      autoExpandCharacters();
    } else {
      // 小网格：移除可能的 max-height 残留，确保完整显示
      grid.style.maxHeight = '';
      grid.style.overflow = '';
    }
  });

  // Render staff (filtered by key roles)
  const filtered = persons.filter(p =>
    p.jobs && p.jobs.some(j => KEY_STAFF_ROLES.includes(j))
  );
  const deduped = [];
  const seen = new Set();
  for (const p of filtered) {
    const name = p.nameCn || p.name;
    if (seen.has(name)) continue;
    seen.add(name);
    deduped.push(p);
  }
  const keyJobs = deduped.sort((a, b) => {
    const ai = KEY_STAFF_ROLES.indexOf(a.jobs[0]);
    const bi = KEY_STAFF_ROLES.indexOf(b.jobs[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const hasStaff = keyJobs.length > 0;
  staffSection.style.display = hasStaff ? '' : 'none';
  if (!hasStaff) return;

  staffList.innerHTML = keyJobs.map(p => {
    const role = escHtml(p.jobs[0]);
    const name = escHtml(p.nameCn || p.name);
    return `<span class="detail-staff-role">${role}</span><span class="detail-staff-name">${name}</span>`;
  }).join('');
}

function renderWatchStats(anime) {
  const version = ++watchStatsVersion;
  const module = document.getElementById('watchStats');
  const canvas = document.getElementById('watchStatsChart');
  const ctx = canvas.getContext('2d');
  const isLight = document.documentElement.getAttribute('data-theme-mode') === 'light';

  API.get(`/api/anime/${encodeURIComponent(anime.id)}/sessions`).then(data => {
    if (version !== watchStatsVersion) return;

    const dailyEntries = Object.entries(data);
    const totalMinutes = dailyEntries.reduce((s, [, v]) => s + v, 0);

    if (totalMinutes === 0) {
      module.style.display = 'none';
      return;
    }

    module.style.display = '';
    canvas.style.display = 'block';

    // Aggregate into weeks (Mon-Sun)
    const weeks = [];
    const weekMap = new Map();
    for (const [dateStr, mins] of dailyEntries) {
      const d = new Date(dateStr + 'T00:00:00');
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((day + 6) % 7));
      const key = mon.toISOString().slice(0, 10);
      if (!weekMap.has(key)) {
        weekMap.set(key, { start: mon, minutes: 0 });
      }
      weekMap.get(key).minutes += mins;
    }
    const sortedWeeks = [...weekMap.values()].sort((a, b) => a.start - b.start);

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width - 2;
    const H = 300;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const PAD = { top: 24, right: 24, bottom: 44, left: 56 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;

    const maxVal = Math.max(1, ...sortedWeeks.map(w => w.minutes));
    const n = sortedWeeks.length;
    const stepX = n > 1 ? cw / (n - 1) : cw;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    const gridLines = 4;
    ctx.strokeStyle = isLight ? 'rgba(44,36,24,0.08)' : 'rgba(237,232,226,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridLines; i++) {
      const y = PAD.top + (ch / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = isLight ? 'rgba(44,36,24,0.4)' : 'rgba(237,232,226,0.4)';
    ctx.font = '11px DM Sans, Noto Sans SC, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridLines; i++) {
      const y = PAD.top + (ch / gridLines) * i;
      const val = Math.round(maxVal - (maxVal / gridLines) * i);
      ctx.fillText(val + '分钟', PAD.left - 8, y);
    }

    // Compute points
    function getXY(w, i) {
      const x = n > 1 ? PAD.left + i * stepX : PAD.left + cw / 2;
      const y = PAD.top + ch - (w.minutes / maxVal) * ch;
      return [x, y];
    }

    // Animate
    const animDuration = 600;
    const startTime = performance.now();

    function drawChart(progress) {
      ctx.clearRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = isLight ? 'rgba(44,36,24,0.08)' : 'rgba(237,232,226,0.06)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= gridLines; i++) {
        const y = PAD.top + (ch / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
      }

      // Y labels
      ctx.fillStyle = isLight ? 'rgba(44,36,24,0.4)' : 'rgba(237,232,226,0.4)';
      ctx.font = '11px DM Sans, Noto Sans SC, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= gridLines; i++) {
        const y = PAD.top + (ch / gridLines) * i;
        const val = Math.round(maxVal - (maxVal / gridLines) * i);
        ctx.fillText(val + '分钟', PAD.left - 8, y);
      }

      const pts = sortedWeeks.map((w, i) => getXY(w, i));
      const visibleCount = Math.max(1, Math.ceil(pts.length * progress));
      const visPts = pts.slice(0, visibleCount);

      // Area fill
      if (visPts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(visPts[0][0], PAD.top + ch);
        ctx.lineTo(visPts[0][0], visPts[0][1]);
        for (let i = 1; i < visPts.length; i++) {
          const [px, py] = visPts[i - 1];
          const [cx, cy] = visPts[i];
          const mx = (px + cx) / 2;
          ctx.bezierCurveTo(mx, py, mx, cy, cx, cy);
        }
        ctx.lineTo(visPts[visPts.length - 1][0], PAD.top + ch);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + ch);
        grad.addColorStop(0, 'rgba(225,58,90,0.30)');
        grad.addColorStop(1, 'rgba(225,58,90,0.02)');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Line
      if (visPts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(visPts[0][0], visPts[0][1]);
        for (let i = 1; i < visPts.length; i++) {
          const [px, py] = visPts[i - 1];
          const [cx, cy] = visPts[i];
          const mx = (px + cx) / 2;
          ctx.bezierCurveTo(mx, py, mx, cy, cx, cy);
        }
        ctx.strokeStyle = 'rgba(225,58,90,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Dots + x-axis labels
      const labelInterval = n > 8 ? Math.ceil(n / 6) : 1;
      visPts.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(225,58,90,0.9)';
        ctx.fill();

        if (i % labelInterval === 0 || i === visPts.length - 1) {
          const d = sortedWeeks[i].start;
          const label = (d.getMonth() + 1) + '/' + d.getDate();
          ctx.fillStyle = isLight ? 'rgba(44,36,24,0.35)' : 'rgba(237,232,226,0.35)';
          ctx.font = '10px DM Sans, Noto Sans SC, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, x, H - PAD.bottom + 8);
        }
      });
    }

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      drawChart(1);
    } else {
      function animate(now) {
        if (version !== watchStatsVersion) return;
        const t = Math.min(1, (now - startTime) / animDuration);
        const ease = 1 - Math.pow(1 - t, 3);
        drawChart(ease);
        if (t < 1) requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
    }

  }).catch(() => {
    if (version !== watchStatsVersion) return;
    module.style.display = 'none';
  });
}

async function playEpisode(filePath, position = 0) {
  try {
    await API.post('/api/play', { filePath, position });
    showToast('正在播放...');
  } catch (e) {
    showToast('播放失败: ' + e.message);
  }
}

async function toggleWatched(animeId, epNumber, watched) {
  try {
    const result = await API.post('/api/progress', { animeId, episodeNumber: epNumber, watched, progress: watched ? 999999 : 0 });
    if (currentAnime) {
      const ep = currentAnime.episodes.find(e => e.number === epNumber);
      if (ep) { ep.watched = result.episode.watched; ep.progress = result.episode.progress; }
      renderWatchCard(currentAnime);
      renderEpisodeHeatmap(currentAnime);
      renderWatchStats(currentAnime);
    }
  } catch (e) {
    showToast('操作失败: ' + e.message);
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
  modal.classList.add('show');
  input.focus();
  // Click overlay (outside modal content) to close
  modal.onclick = function(e) {
    if (e.target === this) closeSyncModal();
  };
}

function closeSyncModal() {
  const modal = document.getElementById('syncModal');
  if (modal) modal.classList.remove('show');
}

async function searchBangumiWithKeyword() {
  if (!currentAnime) return;
  const keyword = document.getElementById('syncKeyword').value.trim();
  const resultsEl = document.getElementById('syncSearchResults');
  
  if (!keyword) {
    showToast('请输入搜索关键词');
    return;
  }
  
  resultsEl.innerHTML = '<p style="text-align:center;color:var(--text2);padding:16px">搜索中...</p>';
  
  try {
    const result = await API.post('/api/bangumi/search', { keyword });
    if (result.results && result.results.length > 0) {
      showSearchResults(result.results, currentAnime.id);
    } else {
      resultsEl.innerHTML = '<p class="search-result-empty">未找到匹配结果</p>';
    }
  } catch (e) {
    showToast('搜索失败: ' + e.message);
    resultsEl.innerHTML = '<p class="search-result-empty">搜索失败</p>';
  }
}

function showSearchResults(results, animeId) {
  const el = document.getElementById('syncSearchResults');
  if (!results || results.length === 0) {
    el.innerHTML = '<p class="search-result-empty">未找到匹配结果</p>';
    return;
  }
  el.innerHTML = '<h4 style="margin:0 0 12px 0;color:var(--text1)">请选择匹配的条目：</h4>' +
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
  resultsEl.innerHTML = '<p style="text-align:center;color:var(--text2);padding:16px">正在获取元数据...</p>';
  try {
    const result = await API.post('/api/bangumi/fetch', { animeId, subjectId });
    currentAnime = result.anime;
    renderDetail();
    closeSyncModal();
    showToast('Bangumi 元数据获取成功');
  } catch (e) {
    showToast('获取失败: ' + e.message);
    resultsEl.innerHTML = '';
  }
}

async function deleteAnime() {
  if (!currentAnime) return;
  if (!(await showConfirm(`确定要彻底删除「${currentAnime.title}」吗？<br>数据将被清除，不可恢复。`))) return;

  try {
    await API.del(`/api/anime/${encodeURIComponent(currentAnime.id)}`);
    showToast('已删除');
    goBack();
    loadLibrary();
  } catch (e) {
    showToast('删除失败: ' + e.message);
  }
}

// ─── Detail Navigation (invisible edge hot zones) ───

let detailNavReady = false;

function initDetailNav() {
  if (detailNavReady) return;
  detailNavReady = true;

  const navOverlay = document.getElementById('detailNavOverlay');
  document.getElementById('navBack')?.addEventListener('click', (e) => {
    createRipple(e, e.currentTarget);
    goBack();
  });
  document.getElementById('navTop')?.addEventListener('click', (e) => {
    createRipple(e, e.currentTarget);
    goBack();
  });
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

function findCurrentMemoryIndex() {
  if (!currentAnime) return -1;
  if (typeof memoriesData === 'undefined' || !memoriesData.length) return -1;
  return memoriesData.findIndex(m => m.animeId === currentAnime.id);
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
      showToast(`← ${prev.bangumiTitle || prev.title}`);
      slideToAnime(prev.id, 'prev');
    }
    return;
  }
  if (isArchiveMode) {
    const idx = findCurrentMemoryIndex();
    if (idx === -1) return;
    const prevIdx = idx === 0 ? memoriesData.length - 1 : idx - 1;
    const prev = memoriesData[prevIdx];
    if (prev) {
      showToast(`← ${prev.bangumiTitle || prev.title}`);
      slideToAnime(prev.animeId, 'prev');
    }
    return;
  }
  const idx = findCurrentLibraryIndex();
  if (idx === -1) return;
  const prevIdx = idx === 0 ? libraryData.length - 1 : idx - 1;
  const prev = libraryData[prevIdx];
  if (prev) {
    showToast(`← ${prev.bangumiTitle || prev.title}`);
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
      showToast(`${next.bangumiTitle || next.title} →`);
      slideToAnime(next.id, 'next');
    }
    return;
  }
  if (isArchiveMode) {
    const idx = findCurrentMemoryIndex();
    if (idx === -1) return;
    const nextIdx = idx === memoriesData.length - 1 ? 0 : idx + 1;
    const next = memoriesData[nextIdx];
    if (next) {
      showToast(`${next.bangumiTitle || next.title} →`);
      slideToAnime(next.animeId, 'next');
    }
    return;
  }
  const idx = findCurrentLibraryIndex();
  if (idx === -1) return;
  const nextIdx = idx === libraryData.length - 1 ? 0 : idx + 1;
  const next = libraryData[nextIdx];
  if (next) {
    showToast(`${next.bangumiTitle || next.title} →`);
    slideToAnime(next.id, 'next');
  }
}

async function slideToAnime(id, direction) {
  if (isSliding) return;
  isSliding = true;
  document.body.style.pointerEvents = 'none';

  const layout = document.querySelector('.detail-layout');

  // 1. Exit animation: slide + fade out
  if (layout) {
    await new Promise(resolve => {
      gsap.to(layout, {
        x: direction === 'prev' ? 60 : -60,
        opacity: 0,
        duration: 0.15,
        ease: 'power2.in',
        onComplete: resolve
      });
    });
  }

  // 2. Load new data and re-render
  resetDetailEnter();
  stopDetailRefresh();
  try {
    if (detailSourceView === 'mylist' && typeof mylistData !== 'undefined') {
      const item = mylistData.find(i => i.id === id);
      if (!item) throw new Error('条目不存在');
      if (item.source === 'wishlist') {
        isWishlistMode = true;
        isArchiveMode = false;
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
      } else {
        isWishlistMode = false;
        isArchiveMode = false;
        currentAnime = await API.get(`/api/anime/${encodeURIComponent(id)}`);
      }
    } else if (isArchiveMode) {
      const memory = memoriesData.find(m => m.animeId === id);
      if (!memory) throw new Error('归档记录不存在');
      archiveMemoryData = memory;
      currentAnime = {
        id: memory.animeId,
        title: memory.title,
        bangumiTitle: memory.bangumiTitle || memory.title,
        localCover: memory.coverLocal,
        rating: memory.rating || null,
        summary: memory.thoughts || '暂无简介',
        season: null,
        episodes: [],
        downloaded: false,
      };
    } else {
      currentAnime = await API.get(`/api/anime/${encodeURIComponent(id)}`);
    }
    renderDetail();
    showView('detail');
    const wrap = document.getElementById('detailCover');
    if (wrap) {
      wrap.style.opacity = '1';
      wrap.style.transform = 'scale(1)';
    }
    document.getElementById('headerTitle').textContent = currentAnime.bangumiTitle || currentAnime.title;
    if (!isArchiveMode && !isWishlistMode) startDetailRefresh();
  } catch (e) {
    showToast('加载详情失败: ' + e.message);
    isSliding = false;
    document.body.style.pointerEvents = '';
    return;
  }

  // 3. Enter animation: slide + fade in from opposite direction
  if (layout) {
    gsap.set(layout, {
      x: direction === 'prev' ? -50 : 50,
      opacity: 0
    });
    gsap.to(layout, {
      x: 0,
      opacity: 1,
      duration: 0.2,
      ease: 'power2.out',
      onComplete: () => {
        isSliding = false;
        document.body.style.pointerEvents = '';
      }
    });
  } else {
    isSliding = false;
    document.body.style.pointerEvents = '';
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