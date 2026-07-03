gsap.registerPlugin(Flip);

let currentAnime = null;
let watchCardVersion = 0;
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

// Sync from AppState for cross-module state
AppState.on('currentAnime', v => { currentAnime = v; });
AppState.on('isArchiveMode', v => { isArchiveMode = v; });
AppState.on('archiveMemoryData', v => { archiveMemoryData = v; });
AppState.on('detailSourceView', v => { detailSourceView = v; });

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
        AppState.set('currentAnime', currentAnime);
        renderDetail();
        showToast('播放已结束，进度已更新', 'success');
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
  isArchiveMode = false; AppState.set('isArchiveMode', false);
  isWishlistMode = false;
  archiveMemoryData = null; AppState.set('archiveMemoryData', null);
  detailSourceView = 'library'; AppState.set('detailSourceView', 'library');
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
      border-radius:16px;background:var(--bg-card);
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
      wrap.style.visibility = '';
      wrap.style.opacity = '1';
      wrap.style.transform = '';
      hero.remove();
    }
  });
}

function renderDetail() {
  if (!currentAnime) return;

  const anime = currentAnime;

  // ─── Cover ───
  const coverEl = document.getElementById('detailCover');
  if (anime.localCover) {
    coverEl.innerHTML = `<img src="/covers/${path.basename(anime.localCover)}?w=540&q=80" alt="${escAttr(anime.title)}">`;
  } else if (anime.coverUrl) {
    coverEl.innerHTML = `<img src="${escAttr(anime.coverUrl)}" alt="${escAttr(anime.title)}">`;
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
    const result = await API.post('/api/progress', { animeId, episodeNumber: epNumber, watched, progress: watched ? 999999 : 0 });
    if (currentAnime) {
      const ep = currentAnime.episodes.find(e => e.number === epNumber);
      if (ep) { ep.watched = result.episode.watched; ep.progress = result.episode.progress; }
      renderWatchCard(currentAnime);
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
  
  resultsEl.innerHTML = '<p style="text-align:center;color:var(--text2);padding:16px">搜索中...</p>';
  
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
    AppState.set('currentAnime', currentAnime);
    renderDetail();
    closeModal('syncModal');
    showToast('Bangumi 元数据获取成功', 'success');
  } catch (e) {
    showToast('获取失败: ' + e.message, 'error');
    resultsEl.innerHTML = '';
  }
}

async function deleteAnime() {
  if (!currentAnime) return;
  if (!(await showConfirm(`确定要彻底删除「${currentAnime.title}」吗？<br>数据将被清除，不可恢复。`))) return;

  try {
    await API.del(`/api/anime/${encodeURIComponent(currentAnime.id)}`);
    showToast('已删除', 'success');
    goBack();
    loadLibrary();
    loadDiscovery();
    loadMemories();
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}



