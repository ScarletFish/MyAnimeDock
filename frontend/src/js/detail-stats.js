// ─── Episode List (full-width horizontal scroll) ───

let watchStatsVersion = 0;
let _episodeThumbObserver = null;
let _wsTooltip = null;

function wsTooltip() {
  if (!_wsTooltip) {
    _wsTooltip = document.createElement('div');
    _wsTooltip.className = 'stats-tooltip';
    document.body.appendChild(_wsTooltip);
  }
  return _wsTooltip;
}

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const isDark = document.documentElement.getAttribute('data-theme-mode') !== 'light';
  return {
    isDark,
    bg: style.getPropertyValue('--bg-surface').trim() || '#1a1a2e',
    text: isDark ? '#ede8e2' : '#2c2418',
    muted: style.getPropertyValue('--fg-muted').trim() || (isDark ? '#8a7a70' : '#6b6763'),
    accent: style.getPropertyValue('--accent').trim() || '#e9407a',
    accentRgb: style.getPropertyValue('--accent-rgb').trim() || '233,64,122',
    border: isDark ? 'rgba(237,232,226,0.1)' : 'rgba(44,36,24,0.1)',
    gridLine: isDark ? 'rgba(237,232,226,0.08)' : 'rgba(44,36,24,0.08)'
  };
}

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
  grid.scrollLeft = 0;

  initScrollDots({
    scroll: grid,
    cardSelector: '.episode-card',
    total: anime.episodes.length,
    dotsParent: document.querySelector('.episode-list-header'),
  });

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
    thumbEls.forEach(el => {
      const src = el.getAttribute('data-src');
      if (src) { el.style.backgroundImage = `url("${src}")`; el.removeAttribute('data-src'); }
    });
  }

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

// ─── Watch Stats (Modern: donut + D3 area chart, side by side) ───

function renderWatchStats(anime) {
  const version = ++watchStatsVersion;
  const module = document.getElementById('watchStats');
  const container = document.getElementById('watchStatsContent');
  if (!module || !container) return;

  container.innerHTML = '<div class="stats-loading">加载中...</div>';
  module.style.display = '';

  const watchedEp = (anime.episodes || []).filter(e => e.watched).length;
  const totalEp = anime.totalEpisodes || anime.eps || (anime.episodes ? anime.episodes.length : 0);
  const hasWatched = watchedEp > 0;

  if (!hasWatched) {
    module.style.display = 'none';
    return;
  }

  // Build grid layout: donut left + chart right
  container.innerHTML = `
    <div class="ws-grid">
      <div class="ws-donut-wrap" id="wsDonut_${version}"></div>
      <div class="ws-right" id="wsRight_${version}">
        <div class="ws-chart" id="wsChartInner_${version}"></div>
      </div>
    </div>
  `;

  // Always render donut (has data)
  renderWsDonut(document.getElementById('wsDonut_' + version), {
    totalEp, watchedEp
  }, version);

  // Fetch sessions for area chart
  const chartInner = document.getElementById('wsChartInner_' + version);
  const rightCol = document.getElementById('wsRight_' + version);

  API.get(`/api/anime/${encodeURIComponent(anime.id)}/sessions`).then(data => {
    if (version !== watchStatsVersion) return;

    const dailyEntries = Object.entries(data);
    const totalMinutes = dailyEntries.reduce((s, [, v]) => s + v, 0);

    if (totalMinutes === 0) {
      // No duration data — donut stays with episodes only
      rightCol.style.display = 'none';
      return;
    }

    // Aggregate into weeks
    const weekMap = new Map();
    for (const [dateStr, mins] of dailyEntries) {
      if (mins === 0) continue;
      const d = new Date(dateStr + 'T00:00:00');
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((day + 6) % 7));
      const key = mon.toISOString().slice(0, 10);
      if (!weekMap.has(key)) weekMap.set(key, { start: mon, minutes: 0 });
      weekMap.get(key).minutes += mins;
    }
    const sortedWeeks = [...weekMap.values()].sort((a, b) => a.start - b.start);

    if (sortedWeeks.length === 0) {
      updateDonutDuration(version, totalMinutes);
      rightCol.style.display = 'none';
      return;
    }

    updateDonutDuration(version, totalMinutes);
    rightCol.style.display = '';
    renderWsChart(chartInner, sortedWeeks, version);
  }).catch(() => {
    if (version !== watchStatsVersion) return;
    rightCol.style.display = 'none';
  });
}

function updateDonutDuration(version, totalMinutes) {
  const el = document.getElementById('wsDur_' + version);
  if (!el) return;
  el.textContent = fmtPlain(totalMinutes);
}

function fmtPlain(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return m + 'm';
  if (m === 0) return h + 'h';
  return h + 'h ' + Math.round(m / 6) + 'm';
}

// ─── Donut Chart ───

function renderWsDonut(container, data, version) {
  const tc = getThemeColors();
  const { totalEp, watchedEp } = data;
  const pct = totalEp > 0 ? watchedEp / totalEp : 0;

  const rect = container.getBoundingClientRect();
  const size = Math.max(Math.min(rect.width || 200, 220), 140);
  const outerR = size * 0.38;
  const innerR = outerR * 0.72;

  const svg = d3.select(container).append('svg')
    .attr('width', size)
    .attr('height', size)
    .attr('viewBox', '0 0 ' + size + ' ' + size)
    .append('g')
    .attr('transform', 'translate(' + (size / 2) + ',' + (size / 2) + ')');

  const tau = 2 * Math.PI;
  const arc = d3.arc().innerRadius(innerR).outerRadius(outerR).cornerRadius(3);

  // Background ring
  svg.append('path')
    .attr('d', arc({ startAngle: 0, endAngle: tau }))
    .attr('fill', tc.gridLine);

  // Progress ring (from top, clockwise)
  const progressAngle = Math.min(pct * tau, tau);
  svg.append('path')
    .attr('d', arc({ startAngle: -tau / 4, endAngle: -tau / 4 + progressAngle }))
    .attr('fill', tc.accent);

  // Drop shadow filter on progress ring
  svg.append('filter')
    .attr('id', 'wsGlow_' + version)
    .append('feDropShadow')
    .attr('dx', '0').attr('dy', '1').attr('stdDeviation', '3')
    .attr('flood-color', tc.accent).attr('flood-opacity', '0.25');

  // Center: episode progress (large)
  svg.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '-0.15em')
    .attr('fill', tc.text)
    .attr('font-size', '1.4rem')
    .attr('font-weight', '700')
    .text(watchedEp + '/' + totalEp);

  // Center: duration (small)
  svg.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '1.1em')
    .attr('fill', tc.muted)
    .attr('font-size', '0.95rem')
    .attr('id', 'wsDur_' + version)
    .text('');
}

// ─── Area Chart ───

function renderWsChart(container, weeks, version) {
  const tc = getThemeColors();

  // Measure container after layout settled
  const rect = container.getBoundingClientRect();
  const margin = { top: 10, right: 10, bottom: 26, left: 34 };
  const width = Math.max(rect.width - margin.left - margin.right, 120);
  const height = Math.max(rect.height - margin.top - margin.bottom, 80);

  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand()
    .domain(weeks.map((_, i) => i))
    .range([0, width])
    .padding(0.25);

  const y = d3.scaleLinear()
    .domain([0, d3.max(weeks, d => d.minutes) || 1])
    .nice()
    .range([height, 0]);

  // Grid lines
  svg.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(2).tickSize(-width).tickFormat(''))
    .selectAll('line')
    .attr('stroke', tc.gridLine);
  svg.selectAll('.grid .domain').remove();

  // Gradient
  const gradId = 'wsGrad_' + version;
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
  grad.append('stop').attr('offset', '0%').attr('stop-color', tc.accent).attr('stop-opacity', 0.35);
  grad.append('stop').attr('offset', '100%').attr('stop-color', tc.accent).attr('stop-opacity', 0.04);

  // Semi-transparent bars
  svg.selectAll('.bar')
    .data(weeks)
    .join('rect')
    .attr('x', (_, i) => x(i))
    .attr('y', d => y(d.minutes))
    .attr('width', x.bandwidth())
    .attr('height', d => height - y(d.minutes))
    .attr('fill', tc.accent)
    .attr('opacity', 0.12)
    .attr('rx', 2);

  // Area
  const area = d3.area()
    .x((_, i) => x(i) + x.bandwidth() / 2)
    .y0(height)
    .y1(d => y(d.minutes))
    .curve(d3.curveMonotoneX);

  svg.append('path')
    .datum(weeks)
    .attr('fill', `url(#${gradId})`)
    .attr('d', area);

  // Line
  const line = d3.line()
    .x((_, i) => x(i) + x.bandwidth() / 2)
    .y(d => y(d.minutes))
    .curve(d3.curveMonotoneX);

  svg.append('path')
    .datum(weeks)
    .attr('fill', 'none')
    .attr('stroke', tc.accent)
    .attr('stroke-width', 2)
    .attr('d', line);

  // Dots
  svg.selectAll('.dot')
    .data(weeks)
    .join('circle')
    .attr('cx', (_, i) => x(i) + x.bandwidth() / 2)
    .attr('cy', d => y(d.minutes))
    .attr('r', 3)
    .attr('fill', tc.accent)
    .attr('stroke', tc.bg)
    .attr('stroke-width', 2);

  // Hover zones
  svg.selectAll('.hz')
    .data(weeks)
    .join('rect')
    .attr('x', (_, i) => x(i))
    .attr('y', 0)
    .attr('width', x.bandwidth())
    .attr('height', height)
    .attr('fill', 'transparent')
    .on('mousemove', (evt, d) => {
      const tip = wsTooltip();
      tip.innerHTML = `<b>${(d.start.getMonth() + 1)}/${d.start.getDate()}</b><br>${d.minutes} 分钟`;
      tip.style.display = 'block';
      const pad = 12;
      let l = evt.clientX + pad;
      let t = evt.clientY - tip.offsetHeight - pad;
      if (l + tip.offsetWidth > window.innerWidth - pad) l = evt.clientX - tip.offsetWidth - pad;
      if (t < pad) t = evt.clientY + pad;
      tip.style.left = l + 'px';
      tip.style.top = t + 'px';
    })
    .on('mouseleave', () => { if (_wsTooltip) _wsTooltip.style.display = 'none'; });

  // X axis
  const labelInt = weeks.length > 8 ? Math.ceil(weeks.length / 5) : 1;
  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickSize(0).tickFormat((_, i) => {
      if (i % labelInt === 0 || i === weeks.length - 1) {
        return (weeks[i].start.getMonth() + 1) + '/' + weeks[i].start.getDate();
      }
      return '';
    }))
    .selectAll('text')
    .attr('fill', tc.muted)
    .attr('font-size', '0.7rem')
    .attr('dy', '1em');
  svg.selectAll('.domain').attr('stroke', tc.border);

  // Y axis
  svg.append('g')
    .call(d3.axisLeft(y).ticks(3).tickFormat(d => d >= 60 ? (d / 60).toFixed(0) + 'h' : d + 'm'))
    .selectAll('text')
    .attr('fill', tc.muted)
    .attr('font-size', '0.7rem');
  svg.selectAll('.domain').attr('stroke', tc.border);
}

// Re-render on theme change
document.addEventListener('themechanged', () => {
  const detailView = document.getElementById('detailView');
  if (detailView && !detailView.classList.contains('hidden') && typeof currentAnime !== 'undefined' && currentAnime) {
    renderWatchStats(currentAnime);
  }
});
