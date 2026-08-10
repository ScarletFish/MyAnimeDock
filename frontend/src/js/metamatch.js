// MetaMatch — 批量元数据匹配审查工作台 (v2: Bento + List)
// ============================================================

let mmItems = [];
let mmFiltered = [];
let mmFilter = 'all';
let mmSelectedId = null;
let mmSyncInProgress = false;
let mmFixResults = [];
let mmSelectedIds = new Set();
let mmSelectionOrder = []; // tracks selection order for panel cycling
let mmSyncCancelled = false;
let mmSyncResolve = null;       // stored resolve() so mmCancelSync can force-resolve the promise
let mmSSESource = null;
let mmUIThrottleTimer = null;
let mmPanelOpen = false;
let mmSyncLog = [];
let mmNeedsRefresh = false;

// ─── Modal Open / Close ───

function mmOpenModal() {
  const modal = document.getElementById('metaMatchModal');
  if (!modal) return;
  openModal(modal, {
    onClose: function() {
      // 同步中关闭弹窗 → 确认对话框
      if (mmSyncInProgress) {
        if (!confirm(t('metamatch.confirmAbort'))) {
          // 用户取消关闭 → 重新显示弹窗
          modal.classList.add('show');
          document.body.style.overflow = 'hidden';
          return;
        }
      }
      mmClosePanel();
      mmSelectedId = null;
      mmSelectedIds.clear();
      mmSelectionOrder = [];
      const wasSyncing = mmSyncInProgress;
      mmSyncInProgress = false;
      mmSyncCancelled = true;
      mmSyncLog = [];
      if (mmSSESource) { mmSSESource.close(); mmSSESource = null; }
      if (mmSyncResolve) { mmSyncResolve(); mmSyncResolve = null; }
      if (wasSyncing) {
        showToast(t('metamatch.matchInterrupted'), 'warning');
      }
      if (mmNeedsRefresh && typeof loadLibrary === 'function') {
        mmNeedsRefresh = false;
        loadLibrary();
      }
    }
  });
  mmLoadModalData();
}

// ─── Public API ───

function mmFilterSummary(text) {
  if (!text) return '';
  if (/[\u4e00-\u9fff]/.test(text)) {
    const parts = text.split(/\[?简介原文\]?/);
    if (parts.length > 1) {
      text = parts[0].trim();
    } else {
      const paragraphs = text.split(/\n+/).filter(p => p.trim());
      const cn = paragraphs.filter(p => /[\u4e00-\u9fff]/.test(p));
      if (cn.length > 0) text = cn.join('\n');
    }
  }
  return text;
}

async function mmLoadModalData() {
  try {
    mmItems = [];
    mmFilter = 'all';
    mmSelectedId = null;
    mmSyncInProgress = false;
    mmSelectedIds.clear();
    mmSelectionOrder = [];
    document.getElementById('mmPanelContent').style.display = 'none';

    const libData = await API.get('/api/library');
    if (!libData || libData.length === 0) {
      mmShowEmpty(t('metamatch.emptyLibraryImport'));
      return;
    }

    mmItems = libData.map(a => ({
      animeId: a.id,
      title: a.title || a.folderName || a.bangumiTitle || t('metamatch.unknown'),
      folderName: a.folderName || a.title || '',
      specialSuffix: a.specialSuffix || null,
      parsedSeason: a.matchedSeason || a.season || (a.specialSuffix ? null : 1),
      episodeCount: a.episodes ? a.episodes.length : 0,
      status: (a.bangumiId && a.bangumiTitle) ? 'matched' : 'pending',
      error: null,
      pinyinTitle: a.pinyinTitle || '',
      matchedSeason: a.matchedSeason || null,
      meta: a.bangumiId ? {
        bangumiId: a.bangumiId,
        bangumiTitle: a.bangumiTitle,
        bangumiTitleJp: a.bangumiTitleJp,
        summary: a.summary,
        coverUrl: a.localCover,
        localCover: a.localCover,
        rating: a.rating,
        metadataSource: a.metadataSource,
      } : null,
      coverUrl: a.localCover || null,
      localCover: a.localCover || null,
      bangumiTitle: a.bangumiTitle,
      season: a.matchedSeason || a.season,
      anilistId: a.anilistId,
      anilistBanner: a.anilistBanner || null,
      anilistTitleEn: a.anilistTitleEn || null,
      anilistTags: a.anilistTags || null,
      anilistCover: a.anilistCover || null,
    }));

    mmUpdateUI();
    mmUpdateBatchBar();
} catch (e) {
      if (!window.location.origin.startsWith('http')) return;
      showToast(t('metamatch.loadLibraryFailed', { error: e.message }), 'error');
      mmShowEmpty(t('metamatch.loadLibraryFailedHint', { error: e.message }));
    }
}

function mmShowEmpty(msg) {
  const list = document.getElementById('mmGrid');
  const empty = document.getElementById('mmEmpty');
  const panelContent = document.getElementById('mmPanelContent');

  if (list) { list.innerHTML = ''; list.style.display = 'none'; }
  if (empty) { empty.style.display = 'flex'; const p = empty.querySelector('p'); if (p) p.textContent = msg || t('metamatch.noPendingItems'); }
  if (panelContent) panelContent.style.display = 'none';
  const panel = document.getElementById('mmPanel');
  if (panel) panel.classList.remove('open');
}

// ─── Filter & Search ───

function mmSetFilter(filter) {
  mmFilter = filter;
  document.querySelectorAll('.mm-filter-dot').forEach(b => {
    b.classList.toggle('mm-filter-dot--active', b.dataset.mmfilter === filter);
  });
  mmApplyFilters();
}

function mmFilterGrid() {
  mmApplyFilters();
}

function mmApplyFilters() {
  const searchVal = (document.getElementById('mmGridSearch')?.value || '').toLowerCase().trim();

  mmFiltered = mmItems.filter(item => {
    if (mmFilter !== 'all' && item.status !== mmFilter) return false;
    if (searchVal) {
      const searchable = [
        item.title,
        item.folderName,
        item.bangumiTitle,
        item.pinyinTitle,
        item.meta?.bangumiTitle,
        item.meta?.bangumiTitleJp,
      ].filter(Boolean).map(s => s.toLowerCase()).join(' ');
      if (!searchable.includes(searchVal)) return false;
    }
    return true;
  });

  const statusOrder = { pending: 0, failed: 1, matching: 2, matched: 3 };
  mmFiltered.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 4;
    const sb = statusOrder[b.status] ?? 4;
    if (sa !== sb) return sa - sb;
    return mmItems.indexOf(a) - mmItems.indexOf(b);
  });

  mmRenderList();
}

// ─── Render List ───

function mmRenderList() {
  const list = document.getElementById('mmGrid');
  const empty = document.getElementById('mmEmpty');
  if (!list) return;

  if (mmFiltered.length === 0) {
    list.innerHTML = '';
    list.style.display = 'none';
    if (empty) {
      empty.style.display = 'flex';
      const p = empty.querySelector('p');
      if (p) {
        p.textContent = mmItems.length === 0 ? t('metamatch.libraryEmpty') :
          (mmFilter === 'all' ? t('metamatch.noItems') :
            t('metamatch.noItemsForFilter', { filter: { matched: t('metamatch.statusMatched'), failed: t('metamatch.statusFailed'), pending: t('metamatch.statusPending') }[mmFilter] || '' }));
      }
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  list.style.display = 'flex';

  let html = '';
  mmFiltered.forEach((item, i) => {
    const isSelected = item.animeId === mmSelectedId;
    const isBatchSelected = mmSelectedIds.has(item.animeId);
    const animDelay = `animation-delay:${Math.min(i, 30) * 18}ms`;

    const rowClasses = ['mm-row'];
    if (isSelected) rowClasses.push('mm-row--selected');
    if (item.status === 'matching') rowClasses.push('mm-row--matching');
    if (isBatchSelected) rowClasses.push('mm-row--batch');

    const dotClass = `mm-row-dot mm-row-dot--${item.status}`;

    const subParts = [];
    if (item.parsedSeason) subParts.push(`S${item.parsedSeason}`);
    if (item.episodeCount) subParts.push(t('metamatch.episodeCount', { n: item.episodeCount }));

    // Season chain info — only show for S2+ or specials
    let seasonBadge = '';
    if (item.matchedSeason != null && item.matchedSeason > 1) {
      const seasonMismatch = item.parsedSeason && item.matchedSeason !== item.parsedSeason;
      seasonBadge = `<span class="mm-row-season${seasonMismatch ? ' mm-row-season--mismatch' : ''}">S${item.matchedSeason}${seasonMismatch ? ' ⚠' : ''}</span>`;
    }

    const badgeLabels = { matched: t('metamatch.statusMatched'), failed: t('metamatch.statusFailed'), matching: t('metamatch.statusMatching'), pending: t('metamatch.statusPending') };

    // Match preview on the row
    let matchPreview = '';
    if (item.status === 'matched' && item.meta) {
      const mTitle = item.meta.bangumiTitle || '';
      const mJp = item.meta.bangumiTitleJp || '';
      const mRating = item.meta.rating ? `<span class="mm-row-rating">★ ${escHtml(String(item.meta.rating))}</span>` : '';
      const metaParts = [];
      if (mJp) metaParts.push(`<span class="mm-row-match-jp">${escHtml(mJp)}</span>`);
      if (mRating) metaParts.push(mRating);
      const metaLine = metaParts.length
        ? `<div class="mm-row-match-meta">${metaParts.join('<span class="mm-row-match-sep">&middot;</span>')}</div>`
        : '';
      matchPreview = `
        <div class="mm-row-match">
          <span class="mm-row-match-title">${escHtml(mTitle)}</span>
          ${metaLine}
        </div>`;
    } else if (item.status === 'failed') {
      matchPreview = `<div class="mm-row-match mm-row-match--error">${escHtml(item.error || t('metamatch.matchFailed'))}</div>`;
    } else if (item.status === 'matching') {
      matchPreview = `<div class="mm-row-match mm-row-match--pending">${t('metamatch.matchingDots')}</div>`;
    } else {
      matchPreview = `<div class="mm-row-match mm-row-match--pending">${t('metamatch.pendingMatch')}</div>`;
    }

    html += `
      <div class="${rowClasses.join(' ')}" data-id="${item.animeId}" style="${animDelay}" onclick="mmRowClick(event, '${item.animeId}')">
        <div class="${dotClass}"></div>
        <div class="mm-row-info">
          <div class="mm-row-title">${escHtml(item.title)}</div>
          <div class="mm-row-sub">${escHtml(subParts.join(' · ') || '—')}${seasonBadge}</div>
        </div>
        ${matchPreview}
        <span class="mm-row-badge mm-row-badge--${item.status}">${badgeLabels[item.status]}</span>
      </div>`;
  });

  list.innerHTML = html;
  mmUpdateStats();
}

// ─── Stats ───

function mmUpdateStats() {
  const total = mmItems.length;
  const matched = mmItems.filter(i => i.status === 'matched').length;
  const failed = mmItems.filter(i => i.status === 'failed').length;
  const matching = mmItems.filter(i => i.status === 'matching').length;
  const pending = mmItems.filter(i => i.status === 'pending').length;

  const animate = (el, val) => {
    if (el && el.textContent !== String(val)) {
      el.textContent = val;
      el.style.transform = 'scale(1.15)';
      setTimeout(() => { el.style.transform = ''; }, 200);
    }
  };

  animate(document.getElementById('mmStatTotal'), total);
  animate(document.getElementById('mmStatMatched'), matched);
  animate(document.getElementById('mmStatFailed'), failed);
  animate(document.getElementById('mmStatMatching'), matching);
  animate(document.getElementById('mmStatPending'), pending);
}

function mmUpdateProgress() {
  const wrap = document.getElementById('mmProgressWrap');
  const fill = document.getElementById('mmProgressFill') || document.getElementById('mmModalProgress');
  const text = document.getElementById('mmProgressText');
  if (!fill) return;

  const total = mmItems.length;
  const done = mmItems.filter(i => i.status === 'matched' || i.status === 'failed').length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  fill.style.width = pct + '%';
  if (text) text.textContent = `${done} / ${total}`;
}

// ─── UI Refresh ───

function mmUpdateUIImmediate() {
  mmApplyFilters();
  mmUpdateStats();
  mmUpdateProgress();

  if (mmSelectedId && !mmItems.some(i => i.animeId === mmSelectedId)) {
    mmSelectedId = null;
    mmHideSyncLog();
    mmClosePanel();
  } else if (mmSelectedId) {
    const item = mmItems.find(i => i.animeId === mmSelectedId);
    if (item) mmRenderPanel(item);
  }

  // Update row states in-place without full re-render when possible
  document.querySelectorAll('.mm-row').forEach(row => {
    const id = row.dataset.id;
    const item = mmItems.find(i => i.animeId === id);
    if (!item) return;

    row.classList.toggle('mm-row--selected', id === mmSelectedId);
    row.classList.toggle('mm-row--matching', item.status === 'matching');

    const dot = row.querySelector('.mm-row-dot');
    if (dot) {
      dot.className = `mm-row-dot mm-row-dot--${item.status}`;
    }

    const badge = row.querySelector('.mm-row-badge');
    if (badge) {
      const labels = { matched: t('metamatch.statusMatched'), failed: t('metamatch.statusFailed'), matching: t('metamatch.statusMatching'), pending: t('metamatch.statusPending') };
      badge.className = `mm-row-badge mm-row-badge--${item.status}`;
      badge.textContent = labels[item.status];
    }
  });
}

function mmUpdateUI() {
  if (!mmSyncInProgress) {
    mmUpdateUIImmediate();
    return;
  }
  // Throttle during sync: max once per 300ms
  if (mmUIThrottleTimer) return;
  mmUIThrottleTimer = setTimeout(() => {
    mmUIThrottleTimer = null;
    mmUpdateUIImmediate();
  }, 300);
}

// ─── Batch Selection ───

function mmToggleSelect(animeId) {
  if (mmSelectedIds.has(animeId)) {
    mmSelectedIds.delete(animeId);
    const idx = mmSelectionOrder.indexOf(animeId);
    if (idx !== -1) mmSelectionOrder.splice(idx, 1);
    // If deselected item is shown in panel → switch to most recently selected or close
    if (mmPanelOpen && animeId === mmSelectedId) {
      if (mmSelectionOrder.length > 0) {
        mmSelectForPanel(mmSelectionOrder[mmSelectionOrder.length - 1]);
      } else {
        mmDeselectPanel();
      }
    }
  } else {
    mmSelectedIds.add(animeId);
    mmSelectionOrder.push(animeId);
    // 新增选中时让详情面板跟随最后点击的条目
    mmSelectForPanel(animeId);
  }
  mmUpdateBatchBar();
  mmUpdateRowSelection();
}

function mmSelectForPanel(animeId) {
  mmSelectedId = animeId;
  document.querySelectorAll('.mm-row').forEach(row => {
    row.classList.toggle('mm-row--selected', row.dataset.id === animeId);
  });
  const row = document.querySelector(`.mm-row[data-id="${animeId}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const item = mmItems.find(i => i.animeId === animeId);
  if (item) {
    mmHideSyncLog();
    const panelContent = document.getElementById('mmPanelContent');
    if (panelContent) panelContent.style.display = 'block';
    mmRenderPanel(item);
  }
}

function mmDeselectPanel() {
  mmSelectedId = null;
  document.querySelectorAll('.mm-row').forEach(row => row.classList.remove('mm-row--selected'));
  mmHideSyncLog();
  mmClosePanel();
}

function mmClearSelection() {
  mmSelectedIds.clear();
  mmSelectionOrder = [];
  if (mmPanelOpen) mmDeselectPanel();
  mmUpdateBatchBar();
  mmUpdateRowSelection();
}

function mmUpdateBatchBar() {
  const shiftTip = document.getElementById('mmShiftTip');
  if (shiftTip) shiftTip.style.display = mmSelectedIds.size === 1 ? '' : 'none';
  mmUpdateMainAction();
}

function mmUpdateRowSelection() {
  document.querySelectorAll('.mm-row').forEach(row => {
    const id = row.dataset.id;
    row.classList.toggle('mm-row--batch', mmSelectedIds.has(id));
  });
}

// ─── Smart Main Action Button ───

function mmUpdateMainAction() {
  const btn = document.getElementById('mmMainActionBtn');
  const cancelBtn = document.getElementById('mmCancelBtn');
  if (!btn) return;

  if (mmSyncInProgress) {
    btn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = '';
    return;
  }
  if (cancelBtn) cancelBtn.style.display = 'none';
  btn.style.display = '';
  btn.disabled = false;
  btn.classList.remove('disabled');

  const hasSelection = mmSelectedIds.size > 0;
  const hasPending = mmItems.some(i => i.status === 'pending');
  const hasFailed = mmItems.some(i => i.status === 'failed');

  if (!hasPending && !hasFailed) {
    btn.textContent = t('metamatch.allMatched');
    btn.className = 'btn';
    btn.classList.add('disabled');
    return;
  }

  if (hasSelection) {
    btn.textContent = t('metamatch.syncSelected', { n: mmSelectedIds.size });
    btn.className = 'btn btn-outline';
  } else if (hasFailed && !hasPending) {
    const cnt = mmItems.filter(i => i.status === 'failed').length;
    btn.textContent = t('metamatch.retryFailed', { n: cnt });
    btn.className = 'btn btn-outline';
  } else {
    btn.textContent = t('metamatch.autoMatchAll');
    btn.className = 'btn btn-outline';
  }
}

function mmMainAction() {
  if (mmSyncInProgress) return;

  // Priority 1: sync selected items
  if (mmSelectedIds.size > 0) {
    const ids = [...mmSelectedIds];
    mmSelectedIds.clear();
    mmSelectionOrder = [];
    ids.forEach(id => {
      const item = mmItems.find(i => i.animeId === id);
      if (item) { item.status = 'pending'; item.error = null; item.meta = null; }
    });
    mmUpdateUI();
    mmUpdateMainAction();
    mmMatchItems(ids);
    return;
  }

  // Priority 2: retry failed
  const failedItems = mmItems.filter(i => i.status === 'failed');
  if (failedItems.length > 0) {
    const ids = failedItems.map(i => i.animeId);
    failedItems.forEach(i => { i.status = 'pending'; i.error = null; });
    mmUpdateUI();
    mmUpdateMainAction();
    mmMatchItems(ids);
    return;
  }

  // Priority 3: match all pending
  mmMatchItems();
}

// ─── Panel Slide Animation ───

function mmOpenPanel() {
  const panel = document.getElementById('mmPanel');
  if (!panel || mmPanelOpen) return;
  mmPanelOpen = true;
  panel.classList.add('open');
}

function mmClosePanel(cb) {
  const panel = document.getElementById('mmPanel');
  if (!panel || !mmPanelOpen) {
    if (cb) cb();
    return;
  }
  mmPanelOpen = false;
  panel.classList.remove('open');
  if (cb) setTimeout(cb, 350);
}

// Click outside: close panel + deselect all
document.addEventListener('click', (e) => {
  if (e.target.closest('.mm-panel')) return;
  if (e.target.closest('.mm-row')) return;
  if (e.target.closest('.modal-m-filterbar')) return;
  if (e.target.closest('.modal-m-topbar')) return;
  if (mmPanelOpen) mmDeselectPanel();
  if (mmSelectedIds.size > 0) mmClearSelection();
});

// ─── Row Selection ───

function mmRowClick(event, animeId) {
  if (mmSyncInProgress) return;

  if (event.shiftKey) {
    mmToggleSelect(animeId);
    return;
  }

  // Single click: always select only this one
  if (mmSelectedIds.has(animeId) && mmSelectedIds.size === 1) {
    mmSelectedIds.clear();
    mmSelectionOrder = [];
    if (mmPanelOpen && mmSelectedId === animeId) mmDeselectPanel();
  } else {
    mmSelectedIds.clear();
    mmSelectionOrder = [];
    mmSelectedIds.add(animeId);
    mmSelectionOrder.push(animeId);
    mmSelectForPanel(animeId);
  }
  mmUpdateBatchBar();
  mmUpdateRowSelection();
}

// ─── Panel Rendering ───

function mmRenderPanel(item) {
  mmOpenPanel();
  const content = document.getElementById('mmPanelContent');
  if (!content) return;
  content.style.display = 'flex';

  // Cover with status overlay
  const coverAlt = escAttr(item.meta?.bangumiTitle || item.title || t('metamatch.coverAlt'));
  let coverHtml = '';
  const coverPath = item.meta?.localCover || item.localCover || item.coverUrl;
  if (coverPath) {
    // localCover 是本地绝对路径 → 转成 /covers/ 前缀；远程 URL 原样用
    const src = escAttr(coverPath.startsWith('http') ? coverPath : '/covers/' + path.basename(coverPath));
    coverHtml = `<img src="${src}" alt="${coverAlt}" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=mm-panel-cover-sm-fallback>${escHtml((item.title||'?')[0].toUpperCase())}</div>'">`;
  } else {
    coverHtml = `<div class="mm-panel-cover-sm-fallback">${escHtml((item.title||'?')[0].toUpperCase())}</div>`;
  }
  const statusLabels = { matched: t('metamatch.statusMatched'), failed: t('metamatch.statusFailed'), matching: t('metamatch.statusMatching'), pending: t('metamatch.statusPending') };
  const statusOverlay = `<div class="mm-panel-cover-status mm-panel-cover-status--${item.status}"><div class="mm-panel-status-dot"></div>${statusLabels[item.status]}</div>`;

  // Season info
  let seasonInfo = '';
  if (item.parsedSeason || item.episodeCount) {
    const parts = [];
    if (item.parsedSeason) parts.push(t('metamatch.seasonN', { n: item.parsedSeason }));
    if (item.episodeCount) parts.push(t('metamatch.episodeCount', { n: item.episodeCount }));
    seasonInfo = parts.join(' · ');
  }
  // Summary
  let summaryHtml = '';
  if (item.status === 'matched' && item.meta?.summary) {
    const filtered = mmFilterSummary(item.meta.summary);
    if (filtered) {
      summaryHtml = `
        <div>
          <div class="mm-panel-label">${t('metamatch.summaryLabel')}</div>
          <div class="mm-panel-summary">
            <div class="mm-panel-summary-text">${escHtml(filtered)}</div>
          </div>
        </div>`;
    }
  }

  // 双源数据完整性状态卡（Bangumi + AniList）
  let idInfoHtml = '';
  if (item.status === 'matched') {
    const bgmId = item.meta?.bangumiId;
    const bgmTitle = item.meta?.bangumiTitle;
    const bgmCover = item.meta?.localCover;
    const bgmOk = !!(bgmId && bgmTitle && bgmCover);

    const alId = item.anilistId;
    const banner = item.anilistBanner;
    const bannerDownloaded = !!banner && banner !== '__none__';
    // 无横幅（__none__）是"确认本来就没有"，不算缺失；只有未获取(null)才算缺失
    const bannerOk = bannerDownloaded || banner === '__none__';
    const alOk = (alId != null && alId !== -1) && bannerOk && !!item.anilistTags;

    // banner 单独一行：__none__=无横幅（中性）、本地路径=已下载（✓）、null=未获取
    let bannerState;
    if (banner === '__none__') bannerState = { cls: 'none', text: t('metamatch.noBanner') };
    else if (bannerDownloaded) bannerState = { cls: 'ok', text: t('metamatch.bannerFetched') };
    else bannerState = { cls: 'none', text: t('metamatch.noBanner') };

    const bgmBadge = `<span class="mm-status-badge ${bgmOk ? 'mm-status-badge--ok' : 'mm-status-badge--missing'}">${bgmOk ? t('metamatch.complete') : t('metamatch.missing')}</span>`;
    const alBadge = `<span class="mm-status-badge ${alOk ? 'mm-status-badge--ok' : 'mm-status-badge--missing'}">${alOk ? t('metamatch.complete') : t('metamatch.missing')}</span>`;

    idInfoHtml = `<div class="mm-panel-section">
      <div class="mm-panel-label">${t('metamatch.dataIntegrity')}</div>
      <div class="mm-panel-ids">
        <div class="mm-source-row">
          <div class="mm-source-head">
            <span class="mm-source-name">Bangumi</span>
            ${bgmBadge}
          </div>
          <div class="mm-source-meta">
            ${bgmId
              ? `<code class="mm-panel-id-value">${escHtml(String(bgmId))}</code><a class="mm-panel-id-link" href="https://bgm.tv/subject/${bgmId}" target="_blank" rel="noopener">${t('metamatch.open')}</a>`
              : `<span class="mm-panel-id-value">—</span>`}
          </div>
        </div>
        <div class="mm-source-row">
          <div class="mm-source-head">
            <span class="mm-source-name">AniList</span>
            ${alBadge}
          </div>
          <div class="mm-source-meta">
            ${alId != null && alId !== -1
              ? `<code class="mm-panel-id-value">${escHtml(String(alId))}</code><a class="mm-panel-id-link" href="https://anilist.co/anime/${alId}" target="_blank" rel="noopener">${t('metamatch.open')}</a>`
              : `<span class="mm-panel-id-value">—</span>`}
          </div>
        </div>
        <div class="mm-banner-row">
          <span class="mm-panel-id-label">${t('metamatch.bannerLabel')}</span>
          <span class="mm-banner-status mm-banner-status--${bannerState.cls}">${bannerState.text}</span>
        </div>
      </div>
    </div>`;
  }

  // Error
  let errorHtml = '';
  if (item.status === 'failed' && item.error) {
    errorHtml = `
      <div class="mm-panel-error">
        <div class="mm-panel-error-title">${t('metamatch.errorTitle')}</div>
        <div class="mm-panel-error-msg">${escHtml(item.error)}</div>
      </div>`;
  }

  // Keywords for pending
  let keywordsHtml = '';
  if (item.status === 'pending') {
    const keywords = [item.title, item.folderName].filter(Boolean);
    keywordsHtml = `
      <div>
        <div class="mm-panel-label">${t('metamatch.parseKeywords')}</div>
        <div class="mm-panel-keywords">
          ${keywords.map(kw => `<span class="mm-panel-keyword">${escHtml(kw)}</span>`).join('')}
        </div>
      </div>`;
  }

  // Fix search — unified section for all items
  let fixHtml = '';
  if (!mmSyncInProgress) {
    const defaultKeyword = (item.specialSuffix || item.title || item.folderName || '').replace(/[~～]/g, '').trim();
    const researchBtn = item.status === 'matched'
      ? `<button class="btn mm-fix-research-btn" onclick="mmStartResearch('${item.animeId}')" title="${t('metamatch.researchTitle')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
           ${t('metamatch.researchAgain')}</button>`
      : '';
    fixHtml = `
      <div class="mm-fix-section">
        <div class="mm-panel-label">${t('metamatch.fixMatch')}</div>
        ${researchBtn ? `<div class="mm-fix-research">${researchBtn}</div>` : ''}
        <div class="mm-fix-search">
          <input type="text" id="mmFixKeyword" placeholder="${t('metamatch.searchPlaceholder')}" value="${escAttr(defaultKeyword)}" onkeydown="if(event.key==='Enter')mmSearchForFix('${item.animeId}')">
          <button class="btn btn-primary mm-fix-search-btn" onclick="mmSearchForFix('${item.animeId}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </button>
        </div>
        <div class="mm-fix-results" id="mmFixResults"></div>
      </div>`;
  }

  content.innerHTML = `
    <div class="mm-panel-header-area">
      <div class="mm-panel-cover-sm">
        ${coverHtml}
        ${statusOverlay}
      </div>
      ${seasonInfo ? `
      <div class="mm-panel-key-info">
        <span class="mm-panel-key-text">${seasonInfo}</span>
      </div>
      ` : ''}
    </div>
    <div class="mm-panel-scroll">
      ${summaryHtml}
      ${idInfoHtml}
      ${errorHtml}
      ${keywordsHtml}
      ${fixHtml}
    </div>`;
}

// ─── Fix: Search for correction ───

async function mmSearchForFix(animeId) {
  const input = document.getElementById('mmFixKeyword');
  const resultsDiv = document.getElementById('mmFixResults');
  if (!input || !resultsDiv) return;

  const keyword = input.value.trim();
  if (!keyword) {
    showToast(t('metamatch.enterKeyword'), 'warning');
    return;
  }

  resultsDiv.innerHTML = `<div class="p-3 text-center text-content-muted text-[0.8125rem]">
    <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
    <span class="ml-1.5">${t('metamatch.searching')}</span></div>`;

  try {
    const result = await API.post('/api/bangumi/search', { keyword, sources: undefined });
    const results = result?.results || [];

    if (results.length === 0) {
      resultsDiv.innerHTML = `<div class="p-3 text-center text-content-muted text-[0.8125rem]">${t('metamatch.noResults')}</div>`;
      return;
    }

    mmFixResults = results;
    const typeMap = { 1: t('metamatch.typeBook'), 2: 'TV', 3: t('metamatch.typeAnime'), 4: 'OVA', 5: 'Web', 6: t('metamatch.typeLiveAction') };
    resultsDiv.innerHTML = `<div class="mm-fix-result-count">${t('metamatch.resultsCount', { n: results.length })}</div>` +
      results.map((r, i) => {
      const title = r.name_cn || r.name || r.title || '—';
      const subtitle = r.name || '';
      const coverSrc = r.images?.small || r.images?.grid || r.coverUrl || r.image?.large || r.image?.medium || '';
      const year = r.date || '';
      const rating = r.rating?.score ? r.rating.score.toFixed(1) : (r.score || '');
      const typeLabel = r.type ? (typeMap[r.type] || r.type) : '';
      return `
        <div class="search-result-item" onclick="mmApplyFix('${animeId}', ${i})">
          <img class="search-result-cover" src="${escAttr(coverSrc)}" alt=""
            loading="lazy" decoding="async" onerror="this.style.display='none'">
          <div class="search-result-info">
            <div class="search-result-title" data-tooltip="${escAttr(title)}">${escHtml(title)}</div>
            ${subtitle ? `<div class="search-result-subtitle" data-tooltip="${escAttr(subtitle)}">${escHtml(subtitle)}</div>` : ''}
            <div class="search-result-meta">${year}${rating ? ' · ★' + rating : ''}${typeLabel ? `<span class="result-type-badge">${escHtml(typeLabel)}</span>` : ''}</div>
          </div>
          <button class="btn btn-primary search-result-btn">${t('metamatch.select')}</button>
        </div>`;
    }).join('');
  } catch (e) {
    resultsDiv.innerHTML = `<div class="p-3 text-center text-error text-[0.8125rem]">${t('metamatch.searchFailed', { error: escHtml(e.message) })}</div>`;
  }
}

async function mmApplyFix(animeId, resultIndex) {
  const result = mmFixResults[resultIndex];
  if (!result) return;

  const item = mmItems.find(i => i.animeId === animeId);
  if (!item) return;

  // 显示简化日志面板
  mmSyncInProgress = true;
  mmSyncCancelled = false;
  mmSyncLog = [];
  mmUpdateMainAction();
  mmShowSyncLog();

  const title = result.name_cn || result.name || result.title || t('metamatch.unknown');
  mmAddSyncLogEntry(animeId, title, 'fetching', t('metamatch.fetchingMetadata'));
  item.status = 'matching';
  mmUpdateUI();

  try {
    const fetchResult = await API.post('/api/bangumi/fetch', {
      animeId,
      subjectId: result.id,
      source: result.source,
    });

    if (fetchResult?.anime) {
      const a = fetchResult.anime;
      item.status = 'matched';
      item.meta = {
        bangumiId: a.bangumiId,
        bangumiTitle: a.bangumiTitle,
        bangumiTitleJp: a.bangumiTitleJp,
        summary: a.summary,
        coverUrl: a.localCover,
        localCover: a.localCover,
        rating: a.rating,
        metadataSource: a.metadataSource,
      };
      item.coverUrl = a.localCover || item.coverUrl;
      item.error = null;
      if (a.matchedSeason != null) item.matchedSeason = a.matchedSeason;
      item.anilistId = a.anilistId;
      item.anilistBanner = a.anilistBanner || null;
      item.anilistTitleEn = a.anilistTitleEn || null;
      item.anilistTags = a.anilistTags || null;
      item.anilistCover = a.anilistCover || null;
      mmNeedsRefresh = true;
      mmAddSyncLogEntry(animeId, null, 'matched', a.bangumiTitle || title);
    } else {
      item.status = 'failed';
      item.error = t('metamatch.emptyFetchResult');
      mmAddSyncLogEntry(animeId, null, 'failed', t('metamatch.emptyFetchResult'));
    }
  } catch (e) {
    item.status = 'failed';
    item.error = e.message;
    mmAddSyncLogEntry(animeId, null, 'failed', e.message);
    showToast(t('metamatch.applyMatchFailed', { error: e.message }), 'error');
  }

  mmFixResults = [];
  const resultsDiv = document.getElementById('mmFixResults');
  if (resultsDiv) resultsDiv.innerHTML = '';

  mmSyncInProgress = false;
  mmUpdateUI();
  mmUpdateMainAction();

  // 显示简化日志摘要
  const matched = mmSyncLog.filter(e => e.status === 'matched').length;
  const failed = mmSyncLog.filter(e => e.status === 'failed').length;
  if (mmSyncLog.length > 0) {
    mmRenderSyncSummary(matched, failed, mmSyncLog.length);
  }

  if (matched > 0 && typeof loadLibrary === 'function') {
    loadLibrary();
    // 刷新 MetaMatch 弹窗数据，确保 anilistId/banner 等字段更新
    const prevSelectedId = mmSelectedId;
    mmLoadModalData().then(() => {
      if (prevSelectedId) {
        const item = mmItems.find(i => i.animeId === prevSelectedId);
        if (item) mmSelectForPanel(prevSelectedId);
      }
    });
  }
}

// ─── Sync: Unified Matching Function ───

/**
 * 统一匹配入口，支持单个/多个 ID，可选简化日志模式
 * @param {string|string[]} animeIds - 单个 animeId 或数组
 * @param {Object} [options] - 可选参数
 * @param {boolean} [options.simplified=false] - 简化日志模式（手动修正时使用）
 * @param {string} [options.subjectId] - 直接指定 Bangumi subjectId（跳过搜索）
 * @param {string} [options.source] - 数据源（配合 subjectId 使用）
 */
async function mmMatchItems(animeIds, options = {}) {
  if (mmSyncInProgress) return;

  const ids = animeIds ? (Array.isArray(animeIds) ? animeIds : [animeIds]) : [];
  let itemsToSync;
  if (ids.length > 0) {
    itemsToSync = mmItems.filter(i => ids.includes(i.animeId) && ['pending', 'failed'].includes(i.status));
  } else {
    itemsToSync = mmItems.filter(i => i.status === 'pending' || i.status === 'failed');
  }

  if (itemsToSync.length === 0) {
    showToast(t('metamatch.noPendingItems'), 'info');
    return;
  }

  mmSyncInProgress = true;
  mmSyncCancelled = false;
  mmSyncLog = [];
  mmUpdateMainAction();
  mmShowSyncLog();

  itemsToSync.forEach(i => { i.status = 'matching'; });
  mmUpdateUI();

  const syncIds = itemsToSync.map(i => i.animeId);

  try {
    await mmSyncViaSSE(syncIds, options);
  } catch (e) {
    if (!mmSyncCancelled) {
      showToast(t('metamatch.syncFailed', { error: e.message }), 'error');
    }
    mmItems.forEach(i => {
      if (i.status === 'matching') i.status = 'pending';
    });
  }

  // On cancellation: reset any items still stuck in 'matching'
  if (mmSyncCancelled) {
    mmItems.forEach(i => {
      if (i.status === 'matching') i.status = 'pending';
    });
    mmSyncLog.forEach(e => {
      if (e.status === 'searching' || e.status === 'fetching') { e.status = 'failed'; e.detail = t('metamatch.cancelled'); }
    });
    if (mmSyncLog.length > 0) mmRenderSyncLog();
  }

  mmSyncInProgress = false;
  mmUpdateUI();
  mmUpdateMainAction();

  // Show sync summary
  const matched = mmSyncLog.filter(e => e.status === 'matched').length;
  const failed = mmSyncLog.filter(e => e.status === 'failed').length;
  if (mmSyncLog.length > 0) {
    mmRenderSyncSummary(matched, failed, mmSyncLog.length);
  }

  if (!mmSyncCancelled && matched > 0 && typeof loadLibrary === 'function') {
    mmNeedsRefresh = true;
    loadLibrary();
    // 刷新 MetaMatch 弹窗数据，确保 anilistId/banner 等字段更新
    const prevSelectedId = mmSelectedId;
    mmLoadModalData().then(() => {
      if (prevSelectedId) {
        const item = mmItems.find(i => i.animeId === prevSelectedId);
        if (item) mmSelectForPanel(prevSelectedId);
      }
    });
  }
}

function mmCancelSync() {
  mmSyncCancelled = true;
  if (mmSSESource) {
    mmSSESource.close();
    mmSSESource = null;
  }
  // Force-resolve the pending mmSyncViaSSE promise — EventSource.close() does NOT fire 'error',
  // so cleanup() inside that Promise never runs and the Promise would hang forever.
  if (mmSyncResolve) {
    mmSyncResolve();
    mmSyncResolve = null;
  }
  mmUpdateMainAction();
}

// ─── Sync Log Functions ───

function mmAddSyncLogEntry(animeId, searchTerm, status, detail) {
  const existing = mmSyncLog.find(e => e.animeId === animeId);
  if (existing) {
    existing.status = status;
    existing.detail = detail;
  } else {
    mmSyncLog.push({ animeId, searchTerm, status, detail });
  }
  mmRenderSyncLog();
}

function mmRenderSyncLog() {
  const container = document.getElementById('mmSyncLogEntries');
  if (!container) return;
  container.innerHTML = mmSyncLog.map(e => {
    let iconHtml, titleCls, detailCls;
    if (e.status === 'searching') {
      iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
      titleCls = 'mm-panel-synclog-title--searching';
      detailCls = '';
    } else if (e.status === 'fetching') {
      iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
      titleCls = 'mm-panel-synclog-title--fetching';
      detailCls = '';
    } else if (e.status === 'matched') {
      iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      titleCls = 'mm-panel-synclog-title--matched';
      detailCls = 'mm-panel-synclog-detail--matched';
    } else {
      iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      titleCls = 'mm-panel-synclog-title--failed';
      detailCls = 'mm-panel-synclog-detail--failed';
    }
    const iconCls = 'mm-panel-synclog-icon mm-panel-synclog-icon--' + e.status;
    return '<div class="mm-panel-synclog-entry">' +
      '<div class="' + iconCls + '">' + iconHtml + '</div>' +
      '<div class="mm-panel-synclog-body">' +
        '<div class="mm-panel-synclog-title ' + titleCls + '">' + escHtml(e.searchTerm) + '</div>' +
        (e.detail ? '<div class="mm-panel-synclog-detail ' + detailCls + '">' + escHtml(e.detail) + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function mmShowSyncLog() {
  const panelContent = document.getElementById('mmPanelContent');
  const panelSyncLog = document.getElementById('mmPanelSyncLog');
  if (panelContent) panelContent.style.display = 'none';
  if (panelSyncLog) panelSyncLog.style.display = 'flex';
  mmOpenPanel();
}

function mmHideSyncLog() {
  const panelSyncLog = document.getElementById('mmPanelSyncLog');
  if (panelSyncLog) panelSyncLog.style.display = 'none';
}

function mmRenderSyncSummary(matched, failed, total) {
  const summary = document.getElementById('mmSyncLogSummary');
  if (!summary) return;
  summary.style.display = 'block';
  summary.innerHTML =
    '<div class="mm-panel-synclog-summary-stats">' +
      (matched > 0 ? '<div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--matched"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' + t('metamatch.matchedLabel') + ' <span class="num">' + matched + '</span></div>' : '') +
      (failed > 0 ? '<div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--failed"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' + t('metamatch.statusFailed') + ' <span class="num">' + failed + '</span></div>' : '') +
      '<div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--total">' + t('metamatch.totalLabel') + ' <span class="num">' + total + '</span></div>' +
    '</div>' +
    (failed === 0 ? '<div class="mm-panel-synclog-summary-msg">' + t('metamatch.allMatchedMsg') + '</div>' : '<div class="mm-panel-synclog-summary-msg">' + t('metamatch.retryFailedHint') + '</div>');
}

async function mmSyncViaSSE(animeIds, options = {}) {
  return new Promise((resolve) => {
    mmSyncResolve = resolve;
    const url = '/api/library/sync/stream?ids=' + encodeURIComponent(JSON.stringify(animeIds));
    const es = new EventSource(url);
    mmSSESource = es;
    const simplified = options.simplified || false;

    es.addEventListener('matching', (e) => {
      if (mmSyncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        if (!simplified) {
          mmAddSyncLogEntry(data.animeId, data.searchTerm, 'searching', t('metamatch.searchingMatch'));
        }
      } catch (_) {}
    });

    es.addEventListener('progress', (e) => {
      if (mmSyncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        const item = mmItems.find(i => i.animeId === data.animeId);
        if (!item) return;

        if (data.success) {
          item.status = 'matched';
          item.meta = data.meta || null;
          item.coverUrl = data.meta?.localCover || null;
          item.error = null;
          if (data.matchedSeason != null) item.matchedSeason = data.matchedSeason;
          // 服务端若在 progress 事件携带 anilist 字段则同步更新，保证状态卡实时一致
          if (data.anilistId != null) item.anilistId = data.anilistId;
          if (data.anilistBanner != null) item.anilistBanner = data.anilistBanner;
          if (data.anilistTitleEn != null) item.anilistTitleEn = data.anilistTitleEn;
          if (data.anilistTags != null) item.anilistTags = data.anilistTags;
          if (data.anilistCover != null) item.anilistCover = data.anilistCover;
          mmAddSyncLogEntry(data.animeId, null, 'matched', (data.meta?.bangumiTitle || data.meta?.title || t('metamatch.matched')));
        } else {
          item.status = 'failed';
          item.error = data.error || t('metamatch.unknownError');
          mmAddSyncLogEntry(data.animeId, null, 'failed', data.error || t('metamatch.unknownError'));
        }
        mmUpdateUI();
      } catch (_) {}
    });

    es.addEventListener('fetching', (e) => {
      if (mmSyncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        // matchSource 映射为中文描述（anilist/season 来自服务端新增事件）
        const sourceLabels = {
          'anilist': t('metamatch.sourceAnilist'),
          'season': t('metamatch.sourceSeason'),
        };
        const detail = sourceLabels[data.matchSource] || t('metamatch.fetchingMetadataSource', { source: data.matchSource || '?' });
        if (simplified) {
          // 简化模式：直接添加一条 fetching 日志
          mmAddSyncLogEntry(data.animeId, data.searchTerm || t('metamatch.matchedLabel'), 'fetching', detail);
        } else {
          // 完整模式：更新已有条目状态
          const existing = mmSyncLog.find(entry => entry.animeId === data.animeId);
          if (existing) {
            existing.status = 'fetching';
            existing.detail = detail;
          }
          mmRenderSyncLog();
        }
      } catch (_) {}
    });

    es.addEventListener('finalizing', (e) => {
      if (mmSyncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        // 在同步日志末尾添加一条收尾状态
        const msg = data.message || t('metamatch.finalizing');
        // 检查是否已有 finalizing 条目，避免重复
        const existing = mmSyncLog.find(entry => entry.animeId === '__finalizing__');
        if (existing) {
          existing.detail = msg;
        } else {
          mmSyncLog.push({ animeId: '__finalizing__', searchTerm: t('metamatch.finalizingShort'), status: 'fetching', detail: msg });
        }
        mmRenderSyncLog();
      } catch (_) {}
    });

    es.addEventListener('cancelled', () => {
      cleanup();
    });

    function cleanup() {
      es.close();
      mmSSESource = null;
      mmSyncResolve = null;
      // 移除收尾状态条目
      const fi = mmSyncLog.findIndex(e => e.animeId === '__finalizing__');
      if (fi !== -1) mmSyncLog.splice(fi, 1);
      if (!mmSyncCancelled) {
        let changed = false;
        mmItems.forEach(i => {
          if (i.status === 'matching') {
            i.status = 'failed';
            i.error = i.error || t('metamatch.connectionLost');
            changed = true;
          }
        });
        // Update any remaining searching/fetching entries as failed
        mmSyncLog.forEach(e => {
          if (e.status === 'searching' || e.status === 'fetching') {
            e.status = 'failed';
            e.detail = t('metamatch.connectionLost');
          }
        });
        if (mmSyncLog.length > 0) mmRenderSyncLog();
        if (changed) mmUpdateUI();
      }
      resolve();
    }

    es.addEventListener('done', cleanup);
    es.addEventListener('error', cleanup);
    setTimeout(cleanup, 120000);
  });
}

// ─── Re-search single item ───
// 直接调用 mmMatchItems，避免 mmUpdateUI 节流导致 sync log 被覆盖

async function mmStartResearch(animeId) {
  const item = mmItems.find(i => i.animeId === animeId);
  if (!item) return;

  item.status = 'pending';
  item.error = null;
  item.meta = null;
  // 不调用 mmUpdateUI()，由 mmMatchItems 内部统一处理 UI 更新
  mmMatchItems([animeId]);
}

// 手动触发后端批量补全缺失数据（双源：AniList + Bangumi）
async function mmBackfill() {
  if (mmSyncInProgress) return;
  const btn = document.getElementById('mmBackfillBtn');
  if (btn) { btn.disabled = true; btn.textContent = t('metamatch.backfilling'); }
  try {
    // 先查检测数量，提示用户有多少部缺失
    const status = await API.get('/api/library/backfill/status');
    const detected = status.total || 0;
    if (detected === 0) {
      showToast(t('metamatch.backfillNone'), 'info');
      return;
    }
    showToast(t('metamatch.backfillDetected', { n: detected }), 'info');
    const res = await API.post('/api/library/backfill');
    if (res.ok) {
      showToast(t('metamatch.backfillDone', { n: res.backfilled }), 'success');
      mmNeedsRefresh = true;
      mmLoadModalData();
    } else {
      showToast(t('metamatch.backfillFailed', { error: res.error || '' }), 'error');
    }
  } catch (e) {
    showToast(t('metamatch.backfillFailed', { error: e.message }), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('metamatch.backfill'); }
  }
}

// ─── Expose globals ───
window.mmOpenModal = mmOpenModal;
window.mmSetFilter = mmSetFilter;
window.mmFilterGrid = mmFilterGrid;
window.mmRowClick = mmRowClick;
window.mmMainAction = mmMainAction;
window.mmCancelSync = mmCancelSync;
window.mmSearchForFix = mmSearchForFix;
window.mmApplyFix = mmApplyFix;
window.mmStartResearch = mmStartResearch;
window.mmToggleSelect = mmToggleSelect;
window.mmMatchItems = mmMatchItems;
window.mmBackfill = mmBackfill;
