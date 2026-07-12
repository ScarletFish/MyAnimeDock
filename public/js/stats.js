// stats.js — Data visualization view
// Word cloud (wordcloud2.js) + D3 charts (activity, rating, season)

const WORDCLOUD_MAX_WORDS = 60;

// ─── Tooltip ───

let _tooltipEl = null;
function getTooltip() {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'stats-tooltip';
    document.body.appendChild(_tooltipEl);
  }
  return _tooltipEl;
}
function showTooltip(evt, html) {
  const tip = getTooltip();
  tip.innerHTML = html;
  tip.style.display = 'block';
  const pad = 12;
  let x = evt.clientX + pad;
  let y = evt.clientY - tip.offsetHeight - pad;
  if (x + tip.offsetWidth > window.innerWidth - pad) x = evt.clientX - tip.offsetWidth - pad;
  if (y < pad) y = evt.clientY + pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTooltip() {
  if (_tooltipEl) _tooltipEl.style.display = 'none';
}

// ─── Theme helpers ───

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const isDark = document.documentElement.getAttribute('data-theme-mode') !== 'light';
  return {
    isDark,
    bg: style.getPropertyValue('--bg-surface').trim() || '#1a1a2e',
    text: isDark ? '#ede8e2' : '#2c2418',
    muted: isDark ? 'rgba(237,232,226,0.5)' : 'rgba(44,36,24,0.5)',
    accent: style.getPropertyValue('--accent').trim() || '#e9407a',
    accentRgb: style.getPropertyValue('--accent-rgb').trim() || '233,64,122',
    border: isDark ? 'rgba(237,232,226,0.1)' : 'rgba(44,36,24,0.1)',
    gridLine: isDark ? 'rgba(237,232,226,0.08)' : 'rgba(44,36,24,0.08)'
  };
}

// ─── Word Cloud (unchanged) ───

function loadStats() {
  const canvas = document.getElementById('wordCloudCanvas');
  const loadingEl = document.getElementById('statsLoading');
  const emptyEl = document.getElementById('statsEmpty');
  const cardBody = document.querySelector('.stats-card--wordcloud .stats-card-body');

  canvas.style.display = 'none';
  loadingEl.style.display = '';
  emptyEl.style.display = 'none';
  if (cardBody) cardBody.classList.remove('stats-card-body--loaded');

  API.get('/api/stats/tags').then(data => {
    loadingEl.style.display = 'none';
    if (!data.tags || Object.keys(data.tags).length === 0) {
      emptyEl.style.display = '';
      return;
    }
    const entries = Object.entries(data.tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, WORDCLOUD_MAX_WORDS);

    if (entries.length === 0) {
      emptyEl.style.display = '';
      return;
    }

    const maxCount = entries[0][1];
    const minCount = entries[entries.length - 1][1];
    const range = Math.max(maxCount - minCount, 1);

    const list = entries.map(([word, count]) => {
      const weight = 8 + ((count - minCount) / range) * 47;
      return [word, Math.round(weight)];
    });

    renderWordCloud(canvas, list);
    if (cardBody) cardBody.classList.add('stats-card-body--loaded');
  }).catch(err => {
    loadingEl.style.display = 'none';
    emptyEl.style.display = '';
    console.error('Stats load error:', err);
  });
}

function renderWordCloud(canvas, list) {
  if (!canvas) return;

  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--accent').trim() || '#e9407a';
  const accentRgb = style.getPropertyValue('--accent-rgb').trim() || '233,64,122';
  const bgColor = style.getPropertyValue('--bg-surface').trim() || '#1a1a2e';
  const isDark = document.documentElement.getAttribute('data-theme-mode') !== 'light';

  const palette = generatePalette(accent, accentRgb, isDark, list.length);

  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.min(Math.max(rect.width - 32, 400), 1200);
  const h = 400;

  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = 'width:' + w + 'px;height:' + h + 'px;display:block;max-width:100%;border-radius:var(--radius-md)';

  const fontFamily = "'Noto Sans SC', 'DM Sans', sans-serif";

  WordCloud(canvas, {
    list: list,
    fontFamily: fontFamily,
    fontWeight: '600',
    color: function (word) {
      const idx = list.findIndex(e => e[0] === word);
      return palette[idx % palette.length];
    },
    backgroundColor: bgColor,
    weightFactor: function (w) { return w * 1.2; },
    rotateRatio: 0.4,
    minSize: 10,
    shape: 'circle',
    ellipticity: 1,
    shrinkToFit: true,
    shuffle: false,
    gridSize: 8,
    drawOutOfBound: false,
    hover: null,
    click: null
  });
}

function generatePalette(accent, accentRgb, isDark, count) {
  const rgb = accentRgb.split(',').map(Number);
  const [r, g, b] = rgb;
  const colors = [];
  const steps = Math.max(count, 6);

  if (isDark) {
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const mix = 0.3 + t * 0.5;
      colors.push(`rgb(${Math.round(r + (255 - r) * (1 - mix))},${Math.round(g + (255 - g) * (1 - mix))},${Math.round(b + (255 - b) * (1 - mix))})`);
    }
  } else {
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      colors.push(`rgb(${Math.round(r * (0.5 + t * 0.5))},${Math.round(g * (0.5 + t * 0.5))},${Math.round(b * (0.5 + t * 0.5))})`);
    }
  }
  return colors;
}

// ─── Watch Activity (D3 Area Chart) ───

function loadActivityChart() {
  const container = document.getElementById('activityChartContainer');
  const loadingEl = document.getElementById('activityLoading');
  const emptyEl = document.getElementById('activityEmpty');
  if (!container) return;

  loadingEl.style.display = '';
  emptyEl.style.display = 'none';
  container.innerHTML = '';
  container.style.display = 'none';

  API.get('/api/stats/watch-activity').then(data => {
    loadingEl.style.display = 'none';
    const months = data.months || [];
    const totalMinutes = months.reduce((s, m) => s + m.minutes, 0);
    if (totalMinutes === 0) {
      emptyEl.style.display = '';
      return;
    }
    container.style.display = '';
    renderActivityChart(container, months);
  }).catch(err => {
    loadingEl.style.display = 'none';
    emptyEl.style.display = '';
    console.error('Activity chart load error:', err);
  });
}

function renderActivityChart(container, months) {
  const tc = getThemeColors();
  const rect = container.parentElement.getBoundingClientRect();
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const width = Math.min(Math.max(rect.width - 32, 300), 800) - margin.left - margin.right;
  const height = 220 - margin.top - margin.bottom;

  container.innerHTML = '';
  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand()
    .domain(months.map(d => d.label))
    .range([0, width])
    .padding(0.3);

  const y = d3.scaleLinear()
    .domain([0, d3.max(months, d => d.minutes) || 1])
    .nice()
    .range([height, 0]);

  // Grid lines
  svg.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(''))
    .selectAll('line')
    .attr('stroke', tc.gridLine);
  svg.selectAll('.grid .domain').remove();

  // Gradient
  const gradientId = 'activityGrad';
  const defs = svg.append('defs');
  const gradient = defs.append('linearGradient')
    .attr('id', gradientId)
    .attr('x1', '0').attr('y1', '0')
    .attr('x2', '0').attr('y2', '1');
  gradient.append('stop').attr('offset', '0%').attr('stop-color', tc.accent).attr('stop-opacity', 0.4);
  gradient.append('stop').attr('offset', '100%').attr('stop-color', tc.accent).attr('stop-opacity', 0.05);

  // Area
  const area = d3.area()
    .x(d => x(d.label) + x.bandwidth() / 2)
    .y0(height)
    .y1(d => y(d.minutes))
    .curve(d3.curveMonotoneX);

  svg.append('path')
    .datum(months)
    .attr('fill', `url(#${gradientId})`)
    .attr('d', area);

  // Line
  const line = d3.line()
    .x(d => x(d.label) + x.bandwidth() / 2)
    .y(d => y(d.minutes))
    .curve(d3.curveMonotoneX);

  svg.append('path')
    .datum(months)
    .attr('fill', 'none')
    .attr('stroke', tc.accent)
    .attr('stroke-width', 2.5)
    .attr('d', line);

  // Bars
  svg.selectAll('.bar')
    .data(months)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', d => x(d.label))
    .attr('y', d => y(d.minutes))
    .attr('width', x.bandwidth())
    .attr('height', d => height - y(d.minutes))
    .attr('fill', tc.accent)
    .attr('opacity', 0.25)
    .attr('rx', 3);

  // Dots
  svg.selectAll('.dot')
    .data(months)
    .join('circle')
    .attr('cx', d => x(d.label) + x.bandwidth() / 2)
    .attr('cy', d => y(d.minutes))
    .attr('r', 4)
    .attr('fill', tc.accent)
    .attr('stroke', tc.bg)
    .attr('stroke-width', 2);

  // Hover rects
  svg.selectAll('.hover-rect')
    .data(months)
    .join('rect')
    .attr('x', d => x(d.label))
    .attr('y', 0)
    .attr('width', x.bandwidth())
    .attr('height', height)
    .attr('fill', 'transparent')
    .on('mousemove', (evt, d) => {
      const hours = (d.minutes / 60).toFixed(1);
      showTooltip(evt, `<b>${d.label}</b><br>${hours} 小时`);
    })
    .on('mouseleave', hideTooltip);

  // X axis
  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickSize(0))
    .selectAll('text')
    .attr('fill', tc.muted)
    .attr('font-size', '0.75rem')
    .attr('dy', '1em');
  svg.selectAll('.domain').attr('stroke', tc.border);

  // Y axis
  svg.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => d >= 60 ? (d / 60).toFixed(0) + 'h' : d + 'm'))
    .selectAll('text')
    .attr('fill', tc.muted)
    .attr('font-size', '0.75rem');
  svg.selectAll('.domain').attr('stroke', tc.border);
}

// ─── Rating Distribution (D3 Histogram) ───

function loadRatingChart() {
  const container = document.getElementById('ratingChartContainer');
  const loadingEl = document.getElementById('ratingLoading');
  const emptyEl = document.getElementById('ratingEmpty');
  if (!container) return;

  loadingEl.style.display = '';
  emptyEl.style.display = 'none';
  container.innerHTML = '';
  container.style.display = 'none';

  API.get('/api/stats/ratings').then(data => {
    loadingEl.style.display = 'none';
    const bins = data.bins || [];
    const total = bins.reduce((s, v) => s + v, 0);
    if (total === 0) {
      emptyEl.style.display = '';
      return;
    }
    container.style.display = '';
    renderRatingChart(container, data.labels, bins, total);
  }).catch(err => {
    loadingEl.style.display = 'none';
    emptyEl.style.display = '';
    console.error('Rating chart load error:', err);
  });
}

function renderRatingChart(container, labels, bins, total) {
  const tc = getThemeColors();
  const rect = container.parentElement.getBoundingClientRect();
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const width = Math.min(Math.max(rect.width - 32, 300), 800) - margin.left - margin.right;
  const height = 220 - margin.top - margin.bottom;

  container.innerHTML = '';
  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const data = labels.map((label, i) => ({ label, count: bins[i] }));

  const x = d3.scaleBand()
    .domain(labels)
    .range([0, width])
    .padding(0.2);

  const y = d3.scaleLinear()
    .domain([0, d3.max(bins) || 1])
    .nice()
    .range([height, 0]);

  // Grid lines
  svg.append('g')
    .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(''))
    .selectAll('line')
    .attr('stroke', tc.gridLine);
  svg.selectAll('.domain').remove();

  // Color scale: low bins灰, high bins亮
  const rgb = tc.accentRgb.split(',').map(Number);
  const barColors = data.map((_, i) => {
    const t = i / (data.length - 1);
    const mix = 0.3 + t * 0.7;
    const r = Math.round(rgb[0] * mix + (tc.isDark ? 80 : 180) * (1 - mix));
    const g = Math.round(rgb[1] * mix + (tc.isDark ? 80 : 180) * (1 - mix));
    const b = Math.round(rgb[2] * mix + (tc.isDark ? 80 : 180) * (1 - mix));
    return `rgb(${r},${g},${b})`;
  });

  // Bars
  svg.selectAll('.bar')
    .data(data)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', d => x(d.label))
    .attr('y', d => y(d.count))
    .attr('width', x.bandwidth())
    .attr('height', d => height - y(d.count))
    .attr('fill', (_, i) => barColors[i])
    .attr('rx', 3);

  // Hover rects
  svg.selectAll('.hover-rect')
    .data(data)
    .join('rect')
    .attr('x', d => x(d.label))
    .attr('y', 0)
    .attr('width', x.bandwidth())
    .attr('height', height)
    .attr('fill', 'transparent')
    .on('mousemove', (evt, d) => {
      const pct = ((d.count / total) * 100).toFixed(1);
      showTooltip(evt, `<b>${d.label}</b><br>${d.count} 部 (${pct}%)`);
    })
    .on('mouseleave', hideTooltip);

  // X axis
  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickSize(0))
    .selectAll('text')
    .attr('fill', tc.muted)
    .attr('font-size', '0.75rem')
    .attr('dy', '1em');
  svg.selectAll('.domain').attr('stroke', tc.border);

  // Y axis
  svg.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('d')))
    .selectAll('text')
    .attr('fill', tc.muted)
    .attr('font-size', '0.75rem');
  svg.selectAll('.domain').attr('stroke', tc.border);
}

// ─── Season Distribution (D3 Horizontal Bar Chart) ───

function loadSeasonChart() {
  const container = document.getElementById('seasonChartContainer');
  const loadingEl = document.getElementById('seasonChartLoading');
  const emptyEl = document.getElementById('seasonChartEmpty');
  if (!container) return;

  loadingEl.style.display = '';
  emptyEl.style.display = 'none';
  container.innerHTML = '';
  container.style.display = 'none';

  API.get('/api/stats/seasons').then(data => {
    loadingEl.style.display = 'none';
    const seasons = data.seasons || {};
    const entries = [
      { key: 'spring', label: '春', color: '#4ade80' },
      { key: 'summer', label: '夏', color: '#facc15' },
      { key: 'autumn', label: '秋', color: '#f97316' },
      { key: 'winter', label: '冬', color: '#60a5fa' }
    ];
    const items = entries.map(e => ({ ...e, count: seasons[e.key] || 0 }));
    const total = items.reduce((s, v) => s + v.count, 0) + (seasons.unknown || 0);

    if (total === 0) {
      emptyEl.style.display = '';
      return;
    }
    container.style.display = '';
    renderSeasonBars(container, items, seasons.unknown || 0);
  }).catch(err => {
    loadingEl.style.display = 'none';
    emptyEl.style.display = '';
    console.error('Season chart load error:', err);
  });
}

function renderSeasonBars(container, items, unknownCount) {
  const tc = getThemeColors();
  const rect = container.parentElement.getBoundingClientRect();
  const margin = { top: 10, right: 60, bottom: unknownCount > 0 ? 30 : 10, left: 40 };
  const width = Math.min(Math.max(rect.width - 32, 300), 800) - margin.left - margin.right;
  const barHeight = 36;
  const barGap = 12;
  const height = items.length * (barHeight + barGap) - barGap;

  container.innerHTML = '';
  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const maxVal = d3.max(items, d => d.count) || 1;

  const x = d3.scaleLinear()
    .domain([0, maxVal])
    .range([0, width]);

  const y = d3.scaleBand()
    .domain(items.map(d => d.label))
    .range([0, height])
    .padding(0.2);

  // Bars
  svg.selectAll('.bar')
    .data(items)
    .join('rect')
    .attr('x', 0)
    .attr('y', d => y(d.label))
    .attr('width', d => x(d.count))
    .attr('height', y.bandwidth())
    .attr('fill', d => d.color)
    .attr('rx', 4)
    .attr('opacity', 0.85);

  // Labels (season name)
  svg.selectAll('.label')
    .data(items)
    .join('text')
    .attr('x', d => x(d.count) + 8)
    .attr('y', d => y(d.label) + y.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('fill', tc.text)
    .attr('font-size', '0.875rem')
    .attr('font-weight', '600')
    .text(d => `${d.label} ${d.count}`);

  // Hover rects
  svg.selectAll('.hover-rect')
    .data(items)
    .join('rect')
    .attr('x', 0)
    .attr('y', d => y(d.label))
    .attr('width', d => Math.max(x(d.count), 10))
    .attr('height', y.bandwidth())
    .attr('fill', 'transparent')
    .on('mousemove', (evt, d) => {
      const total = items.reduce((s, v) => s + v.count, 0) + unknownCount;
      const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : '0';
      showTooltip(evt, `<b>${d.label}季</b><br>${d.count} 部 (${pct}%)`);
    })
    .on('mouseleave', hideTooltip);

  // Unknown hint
  if (unknownCount > 0) {
    svg.append('text')
      .attr('x', 0)
      .attr('y', height + 18)
      .attr('fill', tc.muted)
      .attr('font-size', '0.75rem')
      .text(`另有 ${unknownCount} 部未知季度`);
  }
}

// ─── Theme change ───

document.addEventListener('themechanged', () => {
  const view = document.getElementById('statsView');
  if (view && !view.classList.contains('hidden')) {
    loadStats();
    loadActivityChart();
    loadRatingChart();
    loadSeasonChart();
  }
});
