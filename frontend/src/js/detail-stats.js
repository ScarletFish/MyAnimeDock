// ─── Episode List (full-width horizontal scroll) ───

let watchStatsVersion = 0;
let _episodeThumbObserver = null;

function renderEpisodeHeatmap(anime, animate) {
  const grid = document.getElementById('episodeHeatmapGrid');
  const header = document.querySelector('.episode-list-header h3');
  const countEl = document.getElementById('episodeCount');
  const dotsContainer = document.getElementById('episodeDots');

  if (!anime.episodes || anime.episodes.length === 0) {
    grid.innerHTML = '<p class="text-content-muted p-4 text-center">暂无剧集信息</p>';
    header.textContent = '剧集列表';
    if (countEl) countEl.textContent = '';
    if (dotsContainer) dotsContainer.innerHTML = '';
    return;
  }

  const localCount = anime.episodes.length;
  const totalCount = anime.totalEpisodes || anime.eps;
  header.textContent = '剧集列表';
  if (countEl) countEl.textContent = totalCount ? `${localCount} / ${totalCount}集` : `${localCount} 集`;

  // Build all episode cards in horizontal scroll (clean, no watched/status indicators)
  grid.innerHTML = anime.episodes.map((ep, idx) => {
    const title = ep.fileName || `第${ep.number}集`;
    const thumbUrl = `/api/thumbnail?path=${encodeURIComponent(ep.filePath)}&time=mid`;
    const epNum = String(ep.number).padStart(2, '0');

    return `<div class="episode-card" data-index="${idx}" data-ep="${ep.number}" data-path="${escAttr(ep.filePath)}" data-pos="${ep.progress || 0}">
      <div class="episode-card-thumb">
        <div class="episode-card-bg" data-src="${escAttr(thumbUrl)}"></div>
        <div class="episode-card-overlay"></div>
        <div class="episode-card-num">${epNum}</div>
        <button class="episode-card-play" data-path="${escAttr(ep.filePath)}" data-pos="${ep.progress || 0}" onclick="event.stopPropagation();playEpisode(this.dataset.path, parseFloat(this.dataset.pos) || 0)">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
        </button>
      </div>
      <div class="episode-card-info">
        <div class="episode-card-title" data-tooltip="${escAttr(title)}">${escHtml(title)}</div>
      </div>
    </div>`;
  }).join('');
  // Reset scroll immediately (prevents inheriting previous anime's scroll position)
  grid.scrollLeft = 0;

  // ─── Pagination dots (via shared component) ───
  initScrollDots({
    scroll: grid,
    cardSelector: '.episode-card',
    total: anime.episodes.length,
    dotsParent: document.querySelector('.episode-list-header'),
  });

  // Restore scroll to last-viewed episode
  const lastEp = anime.lastPlayedEp
    ? anime.episodes.find(e => e.number === anime.lastPlayedEp)
    : null;
  if (lastEp) {
    const lastIdx = anime.episodes.indexOf(lastEp);
    const card = grid.querySelector(`.episode-card[data-index="${lastIdx}"]`);
    if (card) {
      requestAnimationFrame(() => {
        const cs = getComputedStyle(grid);
        const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
        const step = grid.querySelector('.episode-card').offsetWidth + gap;
        grid.scrollLeft = Math.max(0, lastIdx * step);
      });
    }
  }

  // ─── Lazy-load thumbnails via IntersectionObserver ───
  if (_episodeThumbObserver) _episodeThumbObserver.disconnect();
  const thumbEls = grid.querySelectorAll('.episode-card-bg[data-src]');
  if ('IntersectionObserver' in window && thumbEls.length > 0) {
    _episodeThumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target;
          const src = el.getAttribute('data-src');
          if (src) {
            el.style.backgroundImage = `url("${src}")`;
            el.removeAttribute('data-src');
          }
          _episodeThumbObserver.unobserve(el);
        }
      }
    }, { root: grid, rootMargin: '100px' });
    thumbEls.forEach(el => _episodeThumbObserver.observe(el));
  } else {
    // Fallback: load all at once
    thumbEls.forEach(el => {
      const src = el.getAttribute('data-src');
      if (src) { el.style.backgroundImage = `url("${src}")`; el.removeAttribute('data-src'); }
    });
  }

  // Bind card events
  grid.querySelectorAll('.episode-card').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path;
      const pos = parseFloat(el.dataset.pos) || 0;
      playEpisode(path, pos);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!anime) return;
      const epNumber = parseInt(el.dataset.ep);
      const ep = anime.episodes.find(e => e.number === epNumber);
      if (!ep) return;
      toggleWatched(anime.id, epNumber, !ep.watched);
    });
  });
}

// ─── Watch Stats (GitHub-style Heatmap) ───

function renderWatchStats(anime) {
  const version = ++watchStatsVersion;
  const module = document.getElementById('watchStats');
  const grid = document.getElementById('heatmapGrid');
  const monthsEl = document.getElementById('heatmapMonths');
  const legendEl = document.getElementById('heatmapLegend');
  const emptyEl = document.getElementById('watchStatsEmpty');
  const heatmapEl = document.getElementById('watchHeatmap');

  API.get(`/api/anime/${encodeURIComponent(anime.id)}/sessions`).then(data => {
    if (version !== watchStatsVersion) return;

    const totalMinutes = Object.values(data).reduce((s, v) => s + v, 0);

    if (totalMinutes === 0) {
      module.style.display = 'none';
      return;
    }

    module.style.display = '';
    heatmapEl.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';

    // Build 90-day date array (today → 89 days ago)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: d, key, minutes: data[key] || 0 });
    }

    // Color level: 0=empty, 1-15=l1, 16-30=l2, 31-60=l3, 60+=l4
    function getLevel(m) {
      if (m <= 0) return '';
      if (m <= 15) return 'l1';
      if (m <= 30) return 'l2';
      if (m <= 60) return 'l3';
      return 'l4';
    }

    // Month labels: find where each month starts in the grid
    const monthLabels = [];
    let lastMonth = -1;
    days.forEach((d, i) => {
      const m = d.date.getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        monthLabels.push({ index: i, label: (m + 1) + '月' });
      }
    });

    // Render month labels
    // Each column = 7 cells, total columns = ceil(90/7) = 13
    const totalCols = Math.ceil(days.length / 7);
    monthsEl.innerHTML = monthLabels.map(ml => {
      const col = Math.floor(ml.index / 7);
      const pct = (col / totalCols * 100).toFixed(1);
      return `<span style="margin-left:${col === 0 ? 0 : '0'};flex:0 0 calc(${100 / totalCols}%)">${ml.label}</span>`;
    }).join('');

    // Render grid cells (7 rows × 13 columns, column-major)
    grid.innerHTML = '';
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    days.forEach((d, i) => {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell' + (getLevel(d.minutes) ? ' ' + getLevel(d.minutes) : '');
      if (!prefersReduced) {
        cell.style.animationDelay = (i * 12) + 'ms';
      }
      cell.addEventListener('mouseenter', (evt) => {
        const dateStr = `${d.date.getMonth() + 1}月${d.date.getDate()}日`;
        const timeStr = d.minutes > 0 ? `${d.minutes} 分钟` : '未观看';
        const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.date.getDay()];
        showTooltip(evt, `<b>${dateStr} ${weekDay}</b><br>${timeStr}`);
      });
      cell.addEventListener('mouseleave', hideTooltip);
      grid.appendChild(cell);
    });

    // Legend
    legendEl.innerHTML =
      '<span>少</span>' +
      '<div class="heatmap-cell" style="cursor:default;animation:none"></div>' +
      '<div class="heatmap-cell l1" style="cursor:default;animation:none"></div>' +
      '<div class="heatmap-cell l2" style="cursor:default;animation:none"></div>' +
      '<div class="heatmap-cell l3" style="cursor:default;animation:none"></div>' +
      '<div class="heatmap-cell l4" style="cursor:default;animation:none"></div>' +
      '<span>多</span>';

  }).catch(() => {
    if (version !== watchStatsVersion) return;
    module.style.display = 'none';
  });
}

// Re-render heatmap on theme change
document.addEventListener('themechanged', () => {
  const detailView = document.getElementById('detailView');
  if (detailView && !detailView.classList.contains('hidden') && currentAnime) {
    renderWatchStats(currentAnime);
  }
});
