// ─── Episode List (full-width horizontal scroll) ───

let watchStatsVersion = 0;

function renderEpisodeHeatmap(anime, animate) {
  const grid = document.getElementById('episodeHeatmapGrid');
  const header = document.querySelector('.episode-list-header h3');
  const countEl = document.getElementById('episodeCount');
  const dotsContainer = document.getElementById('episodeDots');

  if (!anime.episodes || anime.episodes.length === 0) {
    grid.innerHTML = '<p style="color:var(--fg-muted);padding:1rem;text-align:center">暂无剧集信息</p>';
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
        <div class="episode-card-bg" style="background-image:url('${escAttr(thumbUrl)}')"></div>
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

  // ─── Sliding-window dot navigation ───

  // Detect visible card count from actual rendered layout (CSS media query driven)
  function getVisibleCount() {
    const card = grid.querySelector('.episode-card');
    if (!card) return 4;
    const gap = parseFloat(getComputedStyle(grid).gap) || 14;
    return Math.round(grid.clientWidth / (card.offsetWidth + gap)) || 4;
  }
  let VISIBLE_COUNT = getVisibleCount();

  // Create dots container if not exists
  if (!dotsContainer) {
    const headerEl = document.querySelector('.episode-list-header');
    const dotsEl = document.createElement('div');
    dotsEl.className = 'episode-pagination-dots';
    dotsEl.id = 'episodeDots';
    headerEl.appendChild(dotsEl);
  }

  const dotsEl = document.getElementById('episodeDots');
  const totalEps = anime.episodes.length;

  let dotCount = 0;
  function rebuildDots() {
    // Each dot represents a window start position: [0..VISIBLE_COUNT-1], [1..VISIBLE_COUNT], ...
    // Total dots = totalEps - VISIBLE_COUNT + 1 (minimum 1)
    const newCount = Math.max(1, totalEps - VISIBLE_COUNT + 1);
    if (newCount === dotCount) return;
    dotCount = newCount;

    if (dotCount <= 1) {
      dotsEl.innerHTML = '';
    } else {
      dotsEl.innerHTML = Array.from({ length: dotCount }, (_, i) => {
        const label = `${i + 1}-${Math.min(i + VISIBLE_COUNT, totalEps)}`;
        return `<button class="episode-dot${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="第${label}集"></button>`;
      }).join('');
    }
  }
  rebuildDots();

  // Compute the pixel step between window positions (card width + gap)
  function getCardStep() {
    const card = grid.querySelector('.episode-card');
    if (!card) return 300;
    const cs = getComputedStyle(grid);
    const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
    return card.offsetWidth + gap;
  }

  // Scroll tracking: map scroll position → nearest window index
  let scrollTicking = false;
  function updateActiveDot() {
    // Check if card count changed (responsive layout switch via CSS media query)
    const newCount = getVisibleCount();
    if (newCount !== VISIBLE_COUNT) {
      VISIBLE_COUNT = newCount;
      rebuildDots();
    }
    if (dotCount <= 1) return;
    const step = getCardStep();
    if (!step) return;
    const scrollLeft = grid.scrollLeft;
    const nearestIdx = Math.round(scrollLeft / step);
    const clampedIdx = Math.max(0, Math.min(dotCount - 1, nearestIdx));

    dotsEl.querySelectorAll('.episode-dot').forEach(d => {
      d.classList.toggle('active', parseInt(d.dataset.index) === clampedIdx);
    });
  }

  // Throttled scroll handler
  grid.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => { updateActiveDot(); scrollTicking = false; });
      scrollTicking = true;
    }
  }, { passive: true });

  // Dot click → scroll to window start + highlight target card
  dotsEl.onclick = (e) => {
    const dot = e.target.closest('.episode-dot');
    if (!dot) return;
    const idx = parseInt(dot.dataset.index);
    const step = getCardStep();
    const scrollTarget = idx * step;

    grid.scrollTo({ left: scrollTarget, behavior: 'smooth' });

    // Force dot active immediately (before scroll event fires)
    dotsEl.querySelectorAll('.episode-dot').forEach(d => {
      d.classList.toggle('active', parseInt(d.dataset.index) === idx);
    });
  };

  // Initialize active dot
  requestAnimationFrame(updateActiveDot);

  // Restore scroll to last-viewed episode (align to left edge)
  const lastEp = [...anime.episodes].reverse().find(ep => ep.progress > 0);
  if (lastEp) {
    const lastIdx = anime.episodes.indexOf(lastEp);
    const card = grid.querySelector(`.episode-card[data-index="${lastIdx}"]`);
    if (card) {
      requestAnimationFrame(() => {
        const step = getCardStep();
        const targetScroll = Math.max(0, lastIdx * step);
        grid.scrollLeft = targetScroll;
        if (dotCount > 1) {
          const nearestIdx = Math.round(grid.scrollLeft / step);
          const clampedIdx = Math.max(0, Math.min(dotCount - 1, nearestIdx));
          dotsEl.querySelectorAll('.episode-dot').forEach(d => {
            d.classList.toggle('active', parseInt(d.dataset.index) === clampedIdx);
          });
        }
      });
    }
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

// ─── Watch Stats (Canvas Bar Chart) ───

function renderWatchStats(anime) {
  const version = ++watchStatsVersion;
  const module = document.getElementById('watchStats');
  const canvas = document.getElementById('watchStatsChart');
  const ctx = canvas.getContext('2d');
  const isLight = document.documentElement.getAttribute('data-theme-mode') === 'light';
  const rootStyle = getComputedStyle(document.documentElement);
  const accentRgb = rootStyle.getPropertyValue('--accent-rgb').trim() || '225,58,90';
  const secondaryRgb = rootStyle.getPropertyValue('--accent-secondary-rgb').trim() || '74,108,247';

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
    canvas.style.width = '';
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
    ctx.font = '11px DM Sans, Noto Sans SC, Noto Sans JP, sans-serif';
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
      ctx.font = '11px DM Sans, Noto Sans SC, Noto Sans JP, sans-serif';
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
        grad.addColorStop(0, `rgba(${accentRgb},0.30)`);
        grad.addColorStop(1, `rgba(${secondaryRgb},0.02)`);
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
        ctx.strokeStyle = `rgba(${accentRgb},0.9)`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Dots + x-axis labels
      const labelInterval = n > 8 ? Math.ceil(n / 6) : 1;
      visPts.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accentRgb},0.9)`;
        ctx.fill();

        if (i % labelInterval === 0 || i === visPts.length - 1) {
          const d = sortedWeeks[i].start;
          const label = (d.getMonth() + 1) + '/' + d.getDate();
          ctx.fillStyle = isLight ? 'rgba(44,36,24,0.35)' : 'rgba(237,232,226,0.35)';
          ctx.font = '10px DM Sans, Noto Sans SC, Noto Sans JP, sans-serif';
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

// Re-render canvas-based charts on theme change
document.addEventListener('themechanged', () => {
  const detailView = document.getElementById('detailView');
  if (detailView && !detailView.classList.contains('hidden') && currentAnime) {
    renderWatchStats(currentAnime);
  }
});
