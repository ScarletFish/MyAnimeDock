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

// ─── Modal Open / Close ───

function mmOpenModal() {
  const modal = document.getElementById('metaMatchModal');
  if (!modal) return;
  openModal(modal, {
    onClose: function() {
      mmClosePanel();
      mmSelectedId = null;
      mmSelectedIds.clear();
      mmSelectionOrder = [];
      mmPanelOpen = false;
      mmSyncInProgress = false;
      mmSyncCancelled = true;
      mmSyncLog = [];
      if (mmSSESource) { mmSSESource.close(); mmSSESource = null; }
      if (mmSyncResolve) { mmSyncResolve(); mmSyncResolve = null; }
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
    mmPanelOpen = false;
    document.getElementById('mmPanelEmpty').style.display = 'flex';
    document.getElementById('mmPanelContent').style.display = 'none';
    document.getElementById('mmPanel').classList.remove('open');

    const libData = await API.get('/api/library');
    if (!libData || libData.length === 0) {
      mmShowEmpty('资料库为空，请先导入动漫');
      return;
    }

    mmItems = libData.map(a => ({
      animeId: a.id,
      title: a.title || a.folderName || a.bangumiTitle || '未知',
      folderName: a.folderName || a.title || '',
      specialSuffix: a.specialSuffix || null,
      parsedSeason: a.parsedSeason || 1,
      episodeCount: a.episodes ? a.episodes.length : 0,
      status: a.bangumiId ? 'matched' : 'pending',
      error: null,
      pinyinTitle: a.pinyinTitle || '',
      matchedSeason: a.matchedSeason || null,
      totalSeasons: a.totalSeasons || null,
      meta: a.bangumiId ? {
        bangumiId: a.bangumiId,
        bangumiTitle: a.bangumiTitle,
        bangumiTitleJp: a.bangumiTitleJp,
        summary: a.summary,
        coverUrl: a.coverUrl,
        localCover: a.localCover,
        rating: a.rating,
        metadataSource: a.metadataSource,
      } : null,
      coverUrl: a.coverUrl || a.localCover || null,
      localCover: a.localCover || null,
      bangumiTitle: a.bangumiTitle,
      season: a.parsedSeason,
    }));

    mmUpdateUI();
    mmUpdateBatchBar();
} catch (e) {
      if (window.location.origin !== 'http://localhost:3456') return;
      showToast('加载资料库失败: ' + e.message, 'error');
      mmShowEmpty('加载资料库失败: ' + e.message + ' · 请检查服务器是否运行');
    }
}

function mmShowEmpty(msg) {
  const list = document.getElementById('mmGrid');
  const empty = document.getElementById('mmEmpty');
  const panelEmpty = document.getElementById('mmPanelEmpty');
  const panelContent = document.getElementById('mmPanelContent');

  if (list) { list.innerHTML = ''; list.style.display = 'none'; }
  if (empty) { empty.style.display = 'flex'; const p = empty.querySelector('p'); if (p) p.textContent = msg || '没有需要匹配的条目'; }
  if (panelEmpty) panelEmpty.style.display = 'flex';
  if (panelContent) panelContent.style.display = 'none';
  mmPanelOpen = false;
  document.getElementById('mmPanel')?.classList.remove('open');
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
        p.textContent = mmItems.length === 0 ? '资料库为空' :
          (mmFilter === 'all' ? '没有条目' :
            `没有 ${ { matched: '已匹配', failed: '失败', pending: '待处理' }[mmFilter] || '' } 的条目`);
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
    if (item.episodeCount) subParts.push(`${item.episodeCount}集`);

    // Season chain info — only show for S2+ or specials
    let seasonBadge = '';
    if (item.matchedSeason != null && item.totalSeasons != null && item.totalSeasons > 1) {
      const seasonMismatch = item.parsedSeason && item.matchedSeason !== item.parsedSeason;
      if (item.matchedSeason !== 1 || seasonMismatch) {
        seasonBadge = `<span class="mm-row-season${seasonMismatch ? ' mm-row-season--mismatch' : ''}">S${item.matchedSeason}/${item.totalSeasons}${seasonMismatch ? ' ⚠' : ''}</span>`;
      }
    } else if (item.totalSeasons != null && item.totalSeasons > 1) {
      seasonBadge = `<span class="mm-row-season">共${item.totalSeasons}季</span>`;
    }

    const badgeLabels = { matched: '已匹配', failed: '失败', matching: '匹配中', pending: '待处理' };

    // Match preview on the row
    let matchPreview = '';
    if (item.status === 'matched' && item.meta) {
      const mTitle = item.meta.bangumiTitle || '';
      const mJp = item.meta.bangumiTitleJp || '';
      const mRating = item.meta.rating ? `<span class="mm-row-rating">★ ${escHtml(String(item.meta.rating))}</span>` : '';
      matchPreview = `
        <div class="mm-row-match">
          <span class="mm-row-match-title">${escHtml(mTitle)}</span>
          ${mJp ? `<span class="mm-row-match-jp">${escHtml(mJp)}</span>` : ''}
          ${mRating}
        </div>`;
    } else if (item.status === 'failed') {
      matchPreview = `<div class="mm-row-match mm-row-match--error">${escHtml(item.error || '匹配失败')}</div>`;
    } else if (item.status === 'matching') {
      matchPreview = `<div class="mm-row-match mm-row-match--pending">匹配中...</div>`;
    } else {
      matchPreview = `<div class="mm-row-match mm-row-match--pending">待匹配</div>`;
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
    mmShowPanelEmpty();
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
      const labels = { matched: '已匹配', failed: '失败', matching: '匹配中', pending: '待处理' };
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
    const empty = document.getElementById('mmPanelEmpty');
    if (empty) empty.style.display = 'none';
    if (panelContent) panelContent.style.display = 'block';
    mmRenderPanel(item);
  }
}

function mmDeselectPanel() {
  mmSelectedId = null;
  document.querySelectorAll('.mm-row').forEach(row => row.classList.remove('mm-row--selected'));
  mmHideSyncLog();
  mmShowPanelEmpty();
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
    btn.textContent = '全部已匹配';
    btn.className = 'btn';
    btn.classList.add('disabled');
    return;
  }

  if (hasSelection) {
    btn.textContent = '同步选中 (' + mmSelectedIds.size + ')';
    btn.className = 'btn btn-outline';
  } else if (hasFailed && !hasPending) {
    const cnt = mmItems.filter(i => i.status === 'failed').length;
    btn.textContent = '重试失败 (' + cnt + ')';
    btn.className = 'btn btn-outline';
  } else {
    btn.textContent = '自动匹配全部';
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
    mmStartSync(ids);
    return;
  }

  // Priority 2: retry failed
  const failedItems = mmItems.filter(i => i.status === 'failed');
  if (failedItems.length > 0) {
    const ids = failedItems.map(i => i.animeId);
    failedItems.forEach(i => { i.status = 'pending'; i.error = null; });
    mmUpdateUI();
    mmUpdateMainAction();
    mmStartSync(ids);
    return;
  }

  // Priority 3: match all pending
  mmStartSync();
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

function mmShowPanelEmpty() {
  mmHideSyncLog();
  mmClosePanel(() => {
    const empty = document.getElementById('mmPanelEmpty');
    const content = document.getElementById('mmPanelContent');
    if (empty) empty.style.display = 'flex';
    if (content) content.style.display = 'none';
  });
}

// ─── Panel Rendering ───

function mmRenderPanel(item) {
  mmOpenPanel();
  const empty = document.getElementById('mmPanelEmpty');
  const content = document.getElementById('mmPanelContent');
  if (empty) empty.style.display = 'none';
  if (!content) return;
  content.style.display = 'flex';

  const title = item.title || item.folderName || '—';

  // Small cover for header
  let coverHtml = '';
  if (item.meta?.coverUrl || item.coverUrl) {
    const src = escAttr(item.meta?.coverUrl || item.coverUrl);
    coverHtml = `<img src="${src}" alt="" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=mm-panel-cover-sm-fallback>${escHtml((item.title||'?')[0].toUpperCase())}</div>'">`;
  } else {
    coverHtml = `<div class="mm-panel-cover-sm-fallback">${escHtml((item.title||'?')[0].toUpperCase())}</div>`;
  }

  // Meta tags
  const metaParts = [];
  if (item.parsedSeason) metaParts.push(`S${item.parsedSeason}`);
  if (item.episodeCount) metaParts.push(`${item.episodeCount}集`);
  if (item.meta?.rating) metaParts.push(`★ ${item.meta.rating}`);
  if (item.meta?.metadataSource) metaParts.push(item.meta.metadataSource);
  if (item.meta?.bangumiId) metaParts.push(`ID:${item.meta.bangumiId}`);

  // Season chain info in header — only show for multi-season
  let seasonChainTag = '';
  if (item.matchedSeason != null && item.totalSeasons != null && item.totalSeasons > 1) {
    const seasonMismatch = item.parsedSeason && item.matchedSeason !== item.parsedSeason;
    if (item.matchedSeason !== 1 || seasonMismatch) {
      seasonChainTag = `<span class="mm-panel-meta-tag${seasonMismatch ? ' mm-panel-meta-tag--warn' : ''}">S${item.matchedSeason} / 共${item.totalSeasons}季${seasonMismatch ? ' ⚠' : ''}</span>`;
    }
  } else if (item.totalSeasons != null && item.totalSeasons > 1) {
    seasonChainTag = `<span class="mm-panel-meta-tag">共${item.totalSeasons}季</span>`;
  }

  // Status
  const statusLabels = { matched: '已匹配', failed: '匹配失败', matching: '匹配中...', pending: '待处理' };
  const statusHtml = `<div class="mm-panel-status mm-panel-status--${item.status}"><div class="mm-panel-status-dot"></div>${statusLabels[item.status]}</div>`;

  // Comparison — vertical stack
  let compareHtml = '';
  if (item.status === 'matched' && item.meta) {
    compareHtml = `
      <div class="mm-compare">
        <div class="mm-compare-side mm-compare-side--left">
          <div class="mm-compare-label">原始解析</div>
          <div class="mm-compare-title">${escHtml(item.title)}</div>
          <div class="mm-compare-sub">${escHtml(item.parsedSeason ? '第' + item.parsedSeason + '季' : '—')} · ${escHtml(String(item.episodeCount) + '集')}</div>
          <div class="mm-compare-sub" style="margin-top:4px;font-family:var(--font-mono);font-size:0.625rem;word-break:break-all;opacity:0.6">${escHtml(item.folderName || '')}</div>
        </div>
        <div class="mm-compare-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
        </div>
        <div class="mm-compare-side mm-compare-side--right">
          <div class="mm-compare-label">匹配结果</div>
          <div class="mm-compare-title">${escHtml(item.meta.bangumiTitle || '—')}</div>
          <div class="mm-compare-sub">${escHtml(item.meta.bangumiTitleJp || '—')}</div>
          ${item.meta.rating ? `<div class="mm-compare-rating">★ ${escHtml(String(item.meta.rating))}</div>` : ''}
        </div>
      </div>`;
  }

  // Summary
  let summaryHtml = '';
  if (item.status === 'matched' && item.meta?.summary) {
    const filtered = mmFilterSummary(item.meta.summary);
    if (filtered) {
      summaryHtml = `
        <div>
          <div class="mm-panel-label">简介</div>
          <div class="mm-panel-summary">${escHtml(filtered)}</div>
        </div>`;
    }
  }

  // Error
  let errorHtml = '';
  if (item.status === 'failed' && item.error) {
    errorHtml = `
      <div class="mm-panel-error">
        <div class="mm-panel-error-title">错误信息</div>
        <div class="mm-panel-error-msg">${escHtml(item.error)}</div>
      </div>`;
  }

  // Keywords for pending
  let keywordsHtml = '';
  if (item.status === 'pending') {
    const keywords = [item.title, item.folderName].filter(Boolean);
    keywordsHtml = `
      <div>
        <div class="mm-panel-label">解析关键词</div>
        <div class="mm-panel-keywords">
          ${keywords.map(kw => `<span class="mm-panel-keyword">${escHtml(kw)}</span>`).join('')}
        </div>
      </div>`;
  }

  // Actions
  let actionsHtml = '';
  if (!mmSyncInProgress) {
    if (item.status === 'matched') {
      actionsHtml = `<button class="btn" style="font-size:0.8125rem" onclick="mmStartResearch('${item.animeId}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        重新搜索</button>`;
    } else if (item.status === 'failed') {
      actionsHtml = `<button class="btn" style="font-size:0.8125rem" onclick="mmStartResearch('${item.animeId}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        重试匹配</button>`;
    }
  }

  // Fix search
  let fixHtml = '';
  if (!mmSyncInProgress) {
    const defaultKeyword = (item.specialSuffix || item.title || item.folderName || '').replace(/[~～]/g, '').trim();
    fixHtml = `
      <div class="mm-fix-section">
        <div class="mm-panel-label">手动搜索修正</div>
        <div class="mm-fix-search">
          <input type="text" id="mmFixKeyword" placeholder="输入搜索词..." value="${escAttr(defaultKeyword)}" onkeydown="if(event.key==='Enter')mmSearchForFix('${item.animeId}')">
          <button class="btn btn-primary" style="padding:7px 12px;font-size:0.8125rem" onclick="mmSearchForFix('${item.animeId}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </button>
        </div>
        <div class="mm-fix-results" id="mmFixResults"></div>
      </div>`;
  }

  content.innerHTML = `
    <div class="mm-panel-header-area">
      <div class="mm-panel-cover-sm">${coverHtml}</div>
      <div class="mm-panel-header-info">
        <div class="mm-panel-title">${escHtml(item.meta?.bangumiTitle || title)}</div>
        <div class="mm-panel-meta-row">
          ${metaParts.map(p => `<span class="mm-panel-meta-tag">${escHtml(p)}</span>`).join('')}
          ${seasonChainTag}
        </div>
        ${statusHtml}
      </div>
    </div>
    <div class="mm-panel-scroll">
      ${compareHtml}
      ${summaryHtml}
      ${errorHtml}
      ${keywordsHtml}
      ${actionsHtml ? `<div style="display:flex;gap:var(--space-2);flex-wrap:wrap">${actionsHtml}</div>` : ''}
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
    showToast('请输入搜索关键词', 'warning');
    return;
  }

  resultsDiv.innerHTML = `<div style="padding:var(--space-3);text-align:center;color:var(--fg-muted);font-size:0.8125rem">
    <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
    <span style="margin-left:6px">搜索中...</span></div>`;

  try {
    const result = await API.post('/api/bangumi/search', { keyword, sources: undefined });
    const results = result?.results || [];

    if (results.length === 0) {
      resultsDiv.innerHTML = `<div style="padding:var(--space-3);text-align:center;color:var(--fg-muted);font-size:0.8125rem">未找到结果</div>`;
      return;
    }

    mmFixResults = results;
    resultsDiv.innerHTML = results.map((r, i) => {
      const title = r.name_cn || r.name || r.title || '—';
      const subtitle = r.name || '';
      const coverSrc = r.images?.small || r.images?.grid || r.coverUrl || r.image?.large || r.image?.medium || '';
      const year = r.date || '';
      const rating = r.rating?.score ? r.rating.score.toFixed(1) : (r.score || '');
      return `
        <div class="search-result-item" onclick="mmApplyFix('${animeId}', ${i})">
          <img class="search-result-cover" src="${escAttr(coverSrc)}" alt=""
            loading="lazy" decoding="async" onerror="this.style.display='none'">
          <div class="search-result-info">
            <div class="search-result-title">${escHtml(title)}</div>
            ${subtitle ? `<div class="search-result-subtitle">${escHtml(subtitle)}</div>` : ''}
            <div class="search-result-meta">${year}${rating ? ' · ★' + rating : ''}</div>
          </div>
          <button class="btn btn-primary search-result-btn">选择</button>
        </div>`;
    }).join('');
  } catch (e) {
    resultsDiv.innerHTML = `<div style="padding:var(--space-3);text-align:center;color:var(--error);font-size:0.8125rem">搜索失败: ${escHtml(e.message)}</div>`;
  }
}

async function mmApplyFix(animeId, resultIndex) {
  const result = mmFixResults[resultIndex];
  if (!result) return;

  const item = mmItems.find(i => i.animeId === animeId);
  if (!item) return;

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
        coverUrl: a.coverUrl,
        localCover: a.localCover,
        rating: a.rating,
        metadataSource: a.metadataSource,
      };
      item.coverUrl = a.coverUrl || a.localCover || item.coverUrl;
      item.error = null;
      if (a.matchedSeason != null) item.matchedSeason = a.matchedSeason;
      if (a.totalSeasons != null) item.totalSeasons = a.totalSeasons;
    } else {
      item.status = 'failed';
      item.error = '获取元数据返回空';
    }
  } catch (e) {
    item.status = 'failed';
    item.error = e.message;
    showToast('应用匹配失败: ' + e.message, 'error');
  }

  mmFixResults = [];
  const resultsDiv = document.getElementById('mmFixResults');
  if (resultsDiv) resultsDiv.innerHTML = '';

  mmUpdateUI();
}

// ─── Sync: Start / Retry ───

async function mmStartSync(animeIds) {
  if (mmSyncInProgress) return;

  let itemsToSync;
  if (animeIds && animeIds.length > 0) {
    itemsToSync = mmItems.filter(i => animeIds.includes(i.animeId) && ['pending', 'failed'].includes(i.status));
  } else {
    itemsToSync = mmItems.filter(i => i.status === 'pending' || i.status === 'failed');
  }

  if (itemsToSync.length === 0) {
    showToast('没有需要匹配的条目', 'info');
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
    if (typeof EventSource !== 'undefined' && await mmCanStream()) {
      await mmSyncViaSSE(syncIds);
    } else {
      await mmSyncViaBatch(syncIds);
    }
  } catch (e) {
    if (!mmSyncCancelled) {
      showToast('同步失败: ' + e.message, 'error');
    }
    mmItems.forEach(i => {
      if (i.status === 'matching') i.status = 'pending';
    });
  }

  // On cancellation: reset any items still stuck in 'matching' (they were being processed
  // when EventSource was closed) and fix sync log entries
  if (mmSyncCancelled) {
    mmItems.forEach(i => {
      if (i.status === 'matching') i.status = 'pending';
    });
    mmSyncLog.forEach(e => {
      if (e.status === 'searching' || e.status === 'fetching') { e.status = 'failed'; e.detail = '已取消'; }
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
    loadLibrary();
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

async function mmCanStream() {
  try {
    const res = await fetch('/api/library/sync/stream', { method: 'OPTIONS' });
    return res.ok;
  } catch {
    return false;
  }
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
  const empty = document.getElementById('mmPanelEmpty');
  if (empty) empty.style.display = 'none';
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
      (matched > 0 ? '<div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--matched"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>匹配 <span class="num">' + matched + '</span></div>' : '') +
      (failed > 0 ? '<div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--failed"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>失败 <span class="num">' + failed + '</span></div>' : '') +
      '<div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--total">总计 <span class="num">' + total + '</span></div>' +
    '</div>' +
    (failed === 0 ? '<div class="mm-panel-synclog-summary-msg">所有条目均已成功匹配</div>' : '<div class="mm-panel-synclog-summary-msg">失败的条目可点击下方「仅重试失败项」重新匹配</div>');
}

async function mmSyncViaSSE(animeIds) {
  return new Promise((resolve) => {
    mmSyncResolve = resolve; // allow mmCancelSync to force-resolve when EventSource.close() doesn't fire 'error'
    const url = '/api/library/sync/stream?ids=' + encodeURIComponent(JSON.stringify(animeIds));
    const es = new EventSource(url);
    mmSSESource = es;

    es.addEventListener('matching', (e) => {
      if (mmSyncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        mmAddSyncLogEntry(data.animeId, data.searchTerm, 'searching', null);
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
          item.coverUrl = data.meta?.coverUrl || null;
          item.error = null;
          if (data.matchedSeason != null) item.matchedSeason = data.matchedSeason;
          if (data.totalSeasons != null) item.totalSeasons = data.totalSeasons;
          mmAddSyncLogEntry(data.animeId, null, 'matched', (data.meta?.bangumiTitle || data.meta?.title || '匹配成功'));
        } else {
          item.status = 'failed';
          item.error = data.error || '未知错误';
          mmAddSyncLogEntry(data.animeId, null, 'failed', data.error || '未知错误');
        }
        mmUpdateUI();
      } catch (_) {}
    });

    es.addEventListener('fetching', (e) => {
      if (mmSyncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        // Update sync log entry: searching → fetching
        const existing = mmSyncLog.find(entry => entry.animeId === data.animeId);
        if (existing) {
          existing.status = 'fetching';
          existing.detail = `正在获取元数据（${data.matchSource || '?'}）`;
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
      if (!mmSyncCancelled) {
        let changed = false;
        mmItems.forEach(i => {
          if (i.status === 'matching') {
            i.status = 'failed';
            i.error = i.error || '连接断开，匹配中断';
            changed = true;
          }
        });
        // Update any remaining searching/fetching entries as failed
        mmSyncLog.forEach(e => {
          if (e.status === 'searching' || e.status === 'fetching') {
            e.status = 'failed';
            e.detail = '连接断开，匹配中断';
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

async function mmSyncViaBatch(animeIds) {
  const controller = new AbortController();
  const checkCancel = setInterval(() => {
    if (mmSyncCancelled) controller.abort();
  }, 500);

  try {
    const result = await API.post('/api/library/sync', { animeIds }, controller.signal);

    if (!result?.results) {
      mmItems.forEach(i => {
        if (i.status === 'matching') i.status = 'failed';
      });
      return;
    }

    for (const r of result.results) {
      const item = mmItems.find(i => i.animeId === r.animeId);
      if (!item) continue;

      if (r.success) {
        if (r.skipped) {
          item.status = 'matched';
        } else if (r.meta) {
          item.status = 'matched';
          item.meta = r.meta;
          item.coverUrl = r.meta.coverUrl || null;
          item.error = null;
          if (r.matchedSeason != null) item.matchedSeason = r.matchedSeason;
          if (r.totalSeasons != null) item.totalSeasons = r.totalSeasons;
          mmAddSyncLogEntry(r.animeId, r.title || item.title || item.folderName || '未知', 'matched', r.meta.bangumiTitle || r.meta.title || '匹配成功');
        } else {
          item.status = 'failed';
          item.error = '无元数据返回';
          mmAddSyncLogEntry(r.animeId, r.title || item.title || item.folderName || '未知', 'failed', '无元数据返回');
        }
      } else {
        item.status = 'failed';
        item.error = r.error || '未知错误';
        mmAddSyncLogEntry(r.animeId, r.title || item.title || item.folderName || '未知', 'failed', r.error || '未知错误');
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      mmItems.forEach(i => {
        if (i.status === 'matching') i.status = 'pending';
      });
    } else {
      throw e;
    }
  } finally {
    clearInterval(checkCancel);
  }
}

// ─── Re-search single item ───

async function mmStartResearch(animeId) {
  const item = mmItems.find(i => i.animeId === animeId);
  if (!item) return;

  item.status = 'pending';
  item.error = null;
  item.meta = null;
  mmUpdateUI();

  mmSyncInProgress = true;
  mmUpdateMainAction();

  try {
    const result = await API.post('/api/library/sync', { animeIds: [animeId] });
    if (result?.results?.[0]) {
      const r = result.results[0];
      if (r.success && r.meta) {
        item.status = 'matched';
        item.meta = r.meta;
        item.coverUrl = r.meta.coverUrl || null;
        item.error = null;
      } else {
        item.status = 'failed';
        item.error = r.error || '匹配失败';
      }
    } else {
      item.status = 'failed';
      item.error = '无返回结果';
    }
  } catch (e) {
    item.status = 'failed';
    item.error = e.message;
    showToast('重新搜索失败: ' + e.message, 'error');
  }

  mmSyncInProgress = false;
  mmUpdateUI();
  mmUpdateMainAction();
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
