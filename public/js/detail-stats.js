// ─── Episode Heatmap ───

let watchStatsVersion = 0;

function renderEpisodeHeatmap(anime, animate) {
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
    const animAttr = animate !== false ? ` style="--i:${i}"` : '';
    return `<button class="heatmap-cell ${cls}"${animAttr} data-tip="${tip}" data-ep="${ep.number}" data-path="${escAttr(ep.filePath)}" data-pos="${ep.progress}" tabindex="0"></button>`;
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
      if (!anime) return;
      const epNumber = parseInt(el.dataset.ep);
      const ep = anime.episodes.find(e => e.number === epNumber);
      if (!ep) return;
      toggleWatched(anime.id, epNumber, !ep.watched);
    });
  });
}

// ─── Window resize → reflow heatmap ───
let heatmapResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(heatmapResizeTimer);
  heatmapResizeTimer = setTimeout(() => {
    if (currentAnime && document.getElementById('detailView').classList.contains('hidden') === false) {
      renderEpisodeHeatmap(currentAnime, false);
    }
  }, 200);
});

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

// Re-render canvas-based charts on theme change
document.addEventListener('themechanged', () => {
  const detailView = document.getElementById('detailView');
  if (detailView && !detailView.classList.contains('hidden') && currentAnime) {
    renderWatchStats(currentAnime);
  }
});
