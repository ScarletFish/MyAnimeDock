// MetaMatch — 批量元数据匹配审查工作台
// ========================================

let mmItems = [];           // All items being processed
let mmFiltered = [];        // Currently filtered/visible items
let mmFilter = 'all';       // Current filter: all | matched | failed | pending
let mmSelectedId = null;    // Currently selected animeId
let mmSyncInProgress = false;
let mmFixResults = [];      // Search results cache for the fix panel

// ─── Public API ───

async function mmLoadData() {
  try {
    mmItems = [];
    mmFilter = 'all';
    mmSelectedId = null;
    mmSyncInProgress = false;

    // Load library data
    const libData = await API.get('/api/library');
    if (!libData || libData.length === 0) {
      mmShowEmpty('资料库为空，请先导入动漫');
      return;
    }

    // Build items list — only show items needing sync OR already synced for review
    mmItems = libData.map(a => ({
      animeId: a.id,
      title: a.title || a.folderName || a.bangumiTitle || '未知',
      folderName: a.folderName || a.title || '',
      parsedSeason: a.parsedSeason || 1,
      episodeCount: a.episodes ? a.episodes.length : 0,
      status: a.bangumiId ? 'matched' : 'pending',
      error: null,
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
  } catch (e) {
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载资料库失败: ' + e.message);
    mmShowEmpty('加载资料库失败: ' + e.message + '· 请检查服务器是否运行');
  }
}

function mmShowEmpty(msg) {
  const grid = document.getElementById('mmGrid');
  const empty = document.getElementById('mmEmpty');
  const stats = document.getElementById('mmStats');
  const progress = document.getElementById('mmProgressWrap');
  const panelEmpty = document.getElementById('mmPanelEmpty');
  const panelContent = document.getElementById('mmPanelContent');
  const startBtn = document.getElementById('mmStartBtn');
  const retryBtn = document.getElementById('mmRetryBtn');

  if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }
  if (empty) { empty.style.display = 'flex'; const p = empty.querySelector('p'); if (p) p.textContent = msg || '没有需要匹配的条目'; }
  if (stats) stats.style.display = 'none';
  if (progress) progress.style.display = 'none';
  if (startBtn) startBtn.style.display = 'none';
  if (retryBtn) retryBtn.style.display = 'none';
  if (panelEmpty) panelEmpty.style.display = 'flex';
  if (panelContent) panelContent.style.display = 'none';
}

// ─── Filter & Search ───

function mmSetFilter(filter) {
  mmFilter = filter;
  document.querySelectorAll('.mm-filter-btn').forEach(b => {
    b.classList.toggle('mm-filter-btn--active', b.dataset.mmfilter === filter);
  });
  mmApplyFilters();
}

function mmFilterGrid() {
  mmApplyFilters();
}

function mmApplyFilters() {
  const searchVal = (document.getElementById('mmGridSearch')?.value || '').toLowerCase().trim();

  mmFiltered = mmItems.filter(item => {
    // Status filter
    if (mmFilter !== 'all' && item.status !== mmFilter) return false;
    // Text search
    if (searchVal) {
      const searchable = [
        item.title,
        item.folderName,
        item.bangumiTitle,
        item.meta?.bangumiTitle,
        item.meta?.bangumiTitleJp,
      ].filter(Boolean).map(s => s.toLowerCase()).join(' ');
      if (!searchable.includes(searchVal)) return false;
    }
    return true;
  });

  mmRenderCards();
}

// ─── Render Cards ───

function mmRenderCards() {
  const grid = document.getElementById('mmGrid');
  const empty = document.getElementById('mmEmpty');
  const stats = document.getElementById('mmStats');
  const startBtn = document.getElementById('mmStartBtn');
  const retryBtn = document.getElementById('mmRetryBtn');

  if (!grid) return;

  // Show/hide empty state
  if (mmFiltered.length === 0) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    if (empty) {
      empty.style.display = 'flex';
      const p = empty.querySelector('p');
      if (p) {
        p.textContent = mmItems.length === 0 ? '资料库为空' :
          (mmFilter === 'all' ? '没有条目' :
            `没有 ${ {matched:'已匹配',failed:'失败',pending:'待处理'}[mmFilter] || '' } 的条目`);
      }
    }
    if (stats) stats.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.style.display = 'flex';
  if (stats) stats.style.display = 'flex';

  // Show/hide buttons
  const hasPending = mmItems.some(i => i.status === 'pending');
  const hasFailed = mmItems.some(i => i.status === 'failed');
  startBtn.style.display = hasPending && !mmSyncInProgress ? '' : 'none';
  retryBtn.style.display = hasFailed && !mmSyncInProgress ? '' : 'none';

  // Build cards HTML
  let html = '';
  mmFiltered.forEach((item, i) => {
    const isSelected = item.animeId === mmSelectedId;
    const statusClass = 'mm-card--' + item.status;
    const selectedClass = isSelected ? 'mm-card--selected' : '';
    const animDelay = `animation-delay:${(i % 20) * 30}ms`;

    // Badge
    let badge = '';
    if (item.status === 'matched') {
      badge = `<span class="mm-card-badge mm-card-badge--success">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6L9 17l-5-5"/></svg> 已匹配</span>`;
    } else if (item.status === 'failed') {
      badge = `<span class="mm-card-badge mm-card-badge--error">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> 失败</span>`;
    } else if (item.status === 'matching') {
      badge = `<span class="mm-card-badge mm-card-badge--warn">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> 匹配中</span>`;
    } else {
      badge = `<span class="mm-card-badge mm-card-badge--muted">待处理</span>`;
    }

    // Thumbnail
    let thumbHtml = '';
    if (item.coverUrl && item.meta) {
      thumbHtml = `<img src="${escAttr(item.coverUrl)}" alt="" loading="lazy" onerror="this.outerHTML='<span style=font-size:16px;font-weight:700>${escHtml((item.title||'?')[0].toUpperCase())}</span>'">`;
    } else {
      thumbHtml = `<span style="font-size:16px;font-weight:700;color:var(--fg-muted)">${escHtml((item.title||'?')[0].toUpperCase())}</span>`;
    }

    const subParts = [];
    if (item.parsedSeason) subParts.push(`S${item.parsedSeason}`);
    if (item.episodeCount) subParts.push(`${item.episodeCount} 集`);
    if (item.meta?.bangumiTitle && item.meta.bangumiTitle !== item.title) subParts.push(item.meta.bangumiTitle);

    const pulseEl = item.status === 'matching' ? '<div class="mm-card-pulse"></div>' : '';

    html += `
      <div class="mm-card ${statusClass} ${selectedClass}" data-id="${item.animeId}" style="${animDelay}" onclick="mmSelectCard('${item.animeId}')">
        ${pulseEl}
        <div class="mm-card-thumb">${thumbHtml}</div>
        <div class="mm-card-body">
          <div class="mm-card-title">${escHtml(item.title)}</div>
          <div class="mm-card-sub">${escHtml(subParts.join(' · ') || '—')}</div>
        </div>
        ${badge}
      </div>`;
  });

  grid.innerHTML = html;
  mmUpdateStats();
}

// ─── Stats ───

function mmUpdateStats() {
  const total = mmItems.length;
  const matched = mmItems.filter(i => i.status === 'matched').length;
  const failed = mmItems.filter(i => i.status === 'failed').length;
  const matching = mmItems.filter(i => i.status === 'matching').length;
  const pending = mmItems.filter(i => i.status === 'pending').length;

  document.getElementById('mmStatTotal').textContent = total;
  document.getElementById('mmStatMatched').textContent = matched;
  document.getElementById('mmStatFailed').textContent = failed;
  document.getElementById('mmStatMatching').textContent = matching;
  document.getElementById('mmStatPending').textContent = pending;
}

function mmUpdateProgress() {
  const wrap = document.getElementById('mmProgressWrap');
  const fill = document.getElementById('mmProgressFill');
  const text = document.getElementById('mmProgressText');
  if (!wrap || !fill || !text) return;

  const total = mmItems.length;
  const done = mmItems.filter(i => i.status === 'matched' || i.status === 'failed').length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  fill.style.width = pct + '%';
  text.textContent = `${done} / ${total}`;

  // Hide when complete
  if (done === total && total > 0) {
    setTimeout(() => { wrap.style.display = 'none'; }, 800);
  }
}

// ─── UI Refresh ───

function mmUpdateUI() {
  mmApplyFilters();
  mmUpdateStats();
  mmUpdateProgress();

  // Clear panel selection if item no longer exists
  if (mmSelectedId && !mmItems.some(i => i.animeId === mmSelectedId)) {
    mmSelectedId = null;
    mmShowPanelEmpty();
  } else if (mmSelectedId) {
    const item = mmItems.find(i => i.animeId === mmSelectedId);
    if (item) mmRenderPanel(item);
  }
}

// ─── Card Selection ───

function mmSelectCard(animeId) {
  if (mmSyncInProgress) return;
  mmSelectedId = animeId;
  mmApplyFilters(); // re-render cards to show selection

  // Scroll the selected card into view
  const card = document.querySelector(`.mm-card[data-id="${animeId}"]`);
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const item = mmItems.find(i => i.animeId === animeId);
  if (item) mmRenderPanel(item);
}

function mmShowPanelEmpty() {
  const empty = document.getElementById('mmPanelEmpty');
  const content = document.getElementById('mmPanelContent');
  if (empty) empty.style.display = 'flex';
  if (content) content.style.display = 'none';
}

// ─── Panel Rendering ───

function mmRenderPanel(item) {
  const empty = document.getElementById('mmPanelEmpty');
  const content = document.getElementById('mmPanelContent');
  if (empty) empty.style.display = 'none';
  if (!content) return;
  content.style.display = 'flex';

  // Cover
  let coverHtml = '';
  if (item.meta?.coverUrl) {
    coverHtml = `<img src="${escAttr(item.meta.coverUrl)}" alt="" onerror="this.outerHTML='<div class=mm-panel-cover-fallback>${escHtml((item.title||'?')[0].toUpperCase())}</div>'">`;
  } else {
    coverHtml = `<div class="mm-panel-cover-fallback">${escHtml((item.title||'?')[0].toUpperCase())}</div>`;
  }

  // Match info
  let matchHtml = '';
  if (item.status === 'matched' && item.meta) {
    const mc = item.meta.coverUrl ? `<img src="${escAttr(item.meta.coverUrl)}" alt="">` : '';
    matchHtml = `
      <div class="mm-panel-label">当前匹配</div>
      <div class="mm-panel-match-info mm-panel-match-info--success">
        <div class="mm-panel-match-cover">${mc}</div>
        <div class="mm-panel-match-text">
          <div class="mm-panel-match-title">${escHtml(item.meta.bangumiTitle || '—')}</div>
          <div class="mm-panel-match-score">${item.meta.bangumiTitleJp ? escHtml(item.meta.bangumiTitleJp) + ' · ' : ''}<strong>⭐ ${item.meta.rating || '—'}</strong> · ${escHtml(item.meta.metadataSource || '—')}</div>
        </div>
      </div>`;
  } else if (item.status === 'failed') {
    matchHtml = `
      <div class="mm-panel-label">当前匹配</div>
      <div class="mm-panel-match-info mm-panel-match-info--error">
        <div class="mm-panel-match-cover"></div>
        <div class="mm-panel-match-text">
          <div class="mm-panel-match-title" style="color:var(--error)">匹配失败</div>
          <div class="mm-panel-match-score">${escHtml(item.error || '未找到匹配结果 · 尝试修正关键词')}</div>
        </div>
      </div>`;
  } else if (item.status === 'matching') {
    matchHtml = `
      <div class="mm-panel-label">当前匹配</div>
      <div class="mm-panel-match-info" style="border-left:3px solid var(--warning)">
        <div class="mm-panel-match-cover"></div>
        <div class="mm-panel-match-text">
          <div class="mm-panel-match-title" style="color:var(--warning)">匹配中...</div>
          <div class="mm-panel-match-score">正在搜索元数据，请稍候</div>
        </div>
      </div>`;
  } else {
    matchHtml = `
      <div class="mm-panel-label">当前匹配</div>
      <div class="mm-panel-match-info" style="border-left:3px solid var(--fg-muted)">
        <div class="mm-panel-match-cover"></div>
        <div class="mm-panel-match-text">
          <div class="mm-panel-match-title" style="color:var(--fg-muted)">待处理</div>
          <div class="mm-panel-match-score">点击「开始匹配」批量处理</div>
        </div>
      </div>`;
  }

  // Fix section (only for pending/failed, not during sync)
  let fixHtml = '';
  if ((item.status === 'failed' || item.status === 'pending') && !mmSyncInProgress) {
    fixHtml = `
      <div class="mm-panel-divider"></div>
      <div>
        <div class="mm-panel-label">搜索修正</div>
        <div class="mm-fix-search">
          <input type="text" id="mmFixKeyword" placeholder="输入搜索词..." onkeydown="if(event.key==='Enter')mmSearchForFix('${item.animeId}')">
          <button class="btn btn-primary" style="padding:9px 14px;font-size:0.844rem" onclick="mmSearchForFix('${item.animeId}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </button>
        </div>
        <div class="mm-fix-results" id="mmFixResults" style="margin-top:var(--space-2)"></div>
      </div>`;
  }

  const title = item.title || item.folderName || '—';
  const subParts = [];
  if (item.parsedSeason) subParts.push(`第 ${item.parsedSeason} 季`);
  if (item.episodeCount) subParts.push(`${item.episodeCount} 集`);
  if (item.bangumiTitle && item.bangumiTitle !== title) subParts.push(item.bangumiTitle);

  content.innerHTML = `
    <div class="mm-panel-cover">${coverHtml}</div>
    <div class="mm-panel-body">
      <div>
        <div class="mm-panel-title">${escHtml(title)}</div>
        <div class="mm-panel-meta-line">${escHtml(subParts.join(' · ') || '—')}</div>
      </div>
      ${matchHtml}
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
    showToast('请输入搜索关键词');
    return;
  }

  resultsDiv.innerHTML = `<div style="padding:var(--space-3);text-align:center;color:var(--fg-muted);font-size:0.8125rem">
    <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
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
      const coverSrc = r.coverUrl || '';
      const imgHtml = coverSrc ?
        `<img src="${escAttr(coverSrc)}" alt="" loading="lazy" onerror="this.style.display='none'">` :
        '';
      const sourceBadge = r.source === 'tmdb' ? 'TMDB' : 'Bangumi';
      return `
        <div class="mm-fix-result" onclick="mmApplyFix('${animeId}', ${i})">
          ${imgHtml}
          <div class="mm-fix-result-info">
            <div class="mm-fix-result-title">${escHtml(r.title || '—')}</div>
            <div class="mm-fix-result-meta">${sourceBadge}${r.year ? ' · ' + r.year : ''}${r.rating ? ' · ⭐ ' + r.rating : ''}</div>
          </div>
          <button class="btn" style="padding:4px 12px;font-size:0.75rem">应用</button>
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

  // Optimistic UI update
  item.status = 'matching';
  mmUpdateUI();

  try {
    // Fetch metadata using the selected subject
    const fetchResult = await API.post('/api/bangumi/fetch', {
      animeId,
      subjectId: result.id,
      source: result.source,
    });

    if (fetchResult?.meta) {
      item.status = 'matched';
      item.meta = fetchResult.meta;
      item.coverUrl = fetchResult.meta.coverUrl;
      item.error = null;
    } else {
      item.status = 'failed';
      item.error = '获取元数据返回空';
    }
  } catch (e) {
    item.status = 'failed';
    item.error = e.message;
    showToast('应用匹配失败: ' + e.message);
  }

  // Clear search results cache so next search fetches fresh
  mmFixResults = [];
  const resultsDiv = document.getElementById('mmFixResults');
  if (resultsDiv) resultsDiv.innerHTML = '';

  mmUpdateUI();
}

// ─── Sync: Start / Retry ───

async function mmStartSync() {
  if (mmSyncInProgress) return;

  const pendingItems = mmItems.filter(i => i.status === 'pending' || i.status === 'failed');
  if (pendingItems.length === 0) {
    showToast('没有需要匹配的条目');
    return;
  }

  mmSyncInProgress = true;
  document.getElementById('mmStartBtn').style.display = 'none';
  document.getElementById('mmRetryBtn').style.display = 'none';

  const progressWrap = document.getElementById('mmProgressWrap');
  progressWrap.style.display = 'flex';

  // Mark all as matching
  pendingItems.forEach(i => { i.status = 'matching'; });
  mmUpdateUI();

  const animeIds = pendingItems.map(i => i.animeId);
  let completed = 0;
  const total = animeIds.length;

  try {
    // Use SSE stream if available, fall back to batch POST
    if (typeof EventSource !== 'undefined' && await mmCanStream()) {
      await mmSyncViaSSE(animeIds);
    } else {
      await mmSyncViaBatch(animeIds);
    }
  } catch (e) {
    showToast('同步失败: ' + e.message);
    // Mark remaining matching items as pending
    mmItems.forEach(i => {
      if (i.status === 'matching') i.status = 'pending';
    });
  }

  mmSyncInProgress = false;
  mmUpdateUI();

  const hasFailed = mmItems.some(i => i.status === 'failed');
  if (hasFailed) {
    document.getElementById('mmRetryBtn').style.display = '';
    showToast('部分条目匹配失败，请手动修正');
  } else {
    showToast('全部匹配完成');
  }
}

async function mmCanStream() {
  try {
    const res = await fetch('/api/library/sync/stream', { method: 'OPTIONS' });
    return res.ok;
  } catch {
    return false;
  }
}

async function mmSyncViaSSE(animeIds) {
  return new Promise((resolve) => {
    const url = '/api/library/sync/stream?ids=' + encodeURIComponent(JSON.stringify(animeIds));
    const es = new EventSource(url);

    es.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        const item = mmItems.find(i => i.animeId === data.animeId);
        if (!item) return;

        if (data.success) {
          item.status = 'matched';
          item.meta = data.meta || null;
          item.coverUrl = data.meta?.coverUrl || null;
          item.error = null;
        } else {
          item.status = 'failed';
          item.error = data.error || '未知错误';
        }
        mmUpdateUI();
      } catch (_) {}
    });

    function cleanup() {
      es.close();
      // Mark any remaining 'matching' items as 'failed'
      let changed = false;
      mmItems.forEach(i => {
        if (i.status === 'matching') {
          i.status = 'failed';
          i.error = i.error || '连接断开，匹配中断';
          changed = true;
        }
      });
      if (changed) mmUpdateUI();
      resolve();
    }

    es.addEventListener('done', cleanup);
    es.addEventListener('error', cleanup);

    // Timeout fallback
    setTimeout(cleanup, 120000);
  });
}

async function mmSyncViaBatch(animeIds) {
  const result = await API.post('/api/library/sync', { animeIds });

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
        // Apply meta to library data — fetch library again for consistency
        item.status = 'matched';
        item.meta = r.meta;
        item.coverUrl = r.meta.coverUrl || null;
        item.error = null;
      } else {
        item.status = 'failed';
        item.error = '无元数据返回';
      }
    } else {
      item.status = 'failed';
      item.error = r.error || '未知错误';
    }
  }
}

async function mmRetryFailed() {
  const failedItems = mmItems.filter(i => i.status === 'failed');
  if (failedItems.length === 0) {
    showToast('没有失败条目');
    return;
  }

  // Reset failed items to pending
  failedItems.forEach(i => {
    i.status = 'pending';
    i.error = null;
  });
  mmUpdateUI();
  mmStartSync();
}

// ─── Expose globals ───
window.mmLoadData = mmLoadData;
window.mmSetFilter = mmSetFilter;
window.mmFilterGrid = mmFilterGrid;
window.mmSelectCard = mmSelectCard;
window.mmStartSync = mmStartSync;
window.mmRetryFailed = mmRetryFailed;
window.mmSearchForFix = mmSearchForFix;
window.mmApplyFix = mmApplyFix;
