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
    muted: style.getPropertyValue('--fg-muted').trim() || (isDark ? '#8a7a70' : '#6b6763'),
    accent: style.getPropertyValue('--accent').trim() || '#e9407a',
    accentRgb: style.getPropertyValue('--accent-rgb').trim() || '233,64,122',
    border: isDark ? 'rgba(237,232,226,0.1)' : 'rgba(44,36,24,0.1)',
    gridLine: isDark ? 'rgba(237,232,226,0.08)' : 'rgba(44,36,24,0.08)',
    fontBody: style.getPropertyValue('--font-body').trim() || "'DM Sans', 'Noto Sans SC', 'Noto Sans JP', sans-serif",
    fontMono: style.getPropertyValue('--font-mono').trim() || "'JetBrains Mono', monospace"
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

    const list = entries.map(([name, count]) => {
      const d = window.ANILIST_TAG_DATA && window.ANILIST_TAG_DATA[name];
      const word = (d && d.zh) || name;
      const weight = 18 + ((count - minCount) / range) * 25;
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

  const fontFamily = "'Noto Sans SC', 'Noto Sans JP', 'DM Sans', sans-serif";

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
    minSize: 6,
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
  const width = Math.max(rect.width - 32, 300) - margin.left - margin.right;
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
      showTooltip(evt, `<b>${d.label}</b><br>${t('stats.hours', { hours })}`);
    })
    .on('mouseleave', hideTooltip);

  // X axis (month labels → body)
  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickSize(0))
    .selectAll('text')
    .attr('fill', tc.muted)
    .attr('font-family', tc.fontBody)
    .attr('font-size', '0.938rem')
    .attr('dy', '1em');
  svg.selectAll('.domain').attr('stroke', tc.border);

  // Y axis (time values → mono)
  svg.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => d >= 60 ? (d / 60).toFixed(0) + 'h' : d + 'm'))
    .selectAll('text')
    .attr('fill', tc.muted)
    .attr('font-family', tc.fontMono)
    .attr('font-size', '0.938rem');
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
  const rgb = tc.accentRgb.split(',').map(Number);

  // data: score = bin index + 1
  const data = labels.map((label, i) => ({ label, score: i + 1, count: bins[i] || 0 }));

  // Weighted average anchor
  const weighted = data.reduce((s, d) => s + d.score * d.count, 0);
  const avg = total > 0 ? weighted / total : 0;

  // Mode = the score with the most titles
  const maxCount = d3.max(data, d => d.count) || 0;
  const modeSet = new Set(data.filter(d => maxCount > 0 && d.count === maxCount).map(d => d.score));

  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'rating-chart';

  // ── Top anchor: average + star badge ──
  const head = document.createElement('div');
  head.className = 'rating-chart-head';
  const badge = document.createElement('span');
  badge.className = 'rating-chart-badge';
  badge.textContent = '★';
  const avgEl = document.createElement('span');
  avgEl.className = 'rating-chart-avg';
  avgEl.textContent = avg.toFixed(1);
  const avgLabel = document.createElement('span');
  avgLabel.className = 'rating-chart-avg-label';
  avgLabel.textContent = t('stats.avgRating');
  head.appendChild(badge);
  head.appendChild(avgEl);
  head.appendChild(avgLabel);
  wrap.appendChild(head);

  // ── Rows: ★ score · horizontal bar · count/pct ──
  const rows = document.createElement('div');
  rows.className = 'rating-chart-rows';

  data.forEach(d => {
    const pct = total > 0 ? (d.count / total) * 100 : 0;
    const widthPct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;

    // Higher score → brighter accent-tinted bar
    const t = (d.score - 1) / Math.max(data.length - 1, 1);
    const mix = 0.35 + t * 0.65;
    const neutral = tc.isDark ? 90 : 205;
    const r = Math.round(rgb[0] * mix + neutral * (1 - mix));
    const g = Math.round(rgb[1] * mix + neutral * (1 - mix));
    const b = Math.round(rgb[2] * mix + neutral * (1 - mix));
    const color = `rgb(${r},${g},${b})`;

    const row = document.createElement('div');
    row.className = 'rating-row' + (modeSet.has(d.score) ? ' rating-row--mode' : '');

    const scoreEl = document.createElement('span');
    scoreEl.className = 'rating-row-score';
    scoreEl.textContent = '★ ' + d.score;

    const track = document.createElement('div');
    track.className = 'rating-row-track';
    const bar = document.createElement('div');
    bar.className = 'rating-row-bar';
    bar.style.width = widthPct + '%';
    bar.style.background = modeSet.has(d.score) ? tc.accent : color;
    track.appendChild(bar);

    const countEl = document.createElement('span');
    countEl.className = 'rating-row-count';
    countEl.textContent = `${d.count}`;

    row.appendChild(scoreEl);
    row.appendChild(track);
    row.appendChild(countEl);

    row.addEventListener('mousemove', evt => {
      showTooltip(evt, `<b>${d.score} ${t('stats.scoreUnit')}</b><br>${t('stats.titleCount', { count: d.count, pct: pct.toFixed(1) })}`);
    });
    row.addEventListener('mouseleave', hideTooltip);

    rows.appendChild(row);
  });

  wrap.appendChild(rows);
  container.appendChild(wrap);
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
      { key: 'spring', label: t('stats.spring'), color: '#4ade80' },
      { key: 'summer', label: t('stats.summer'), color: '#facc15' },
      { key: 'autumn', label: t('stats.autumn'), color: '#f97316' },
      { key: 'winter', label: t('stats.winter'), color: '#60a5fa' }
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

  const data = items.map(d => ({ ...d }));
  const total = data.reduce((s, v) => s + v.count, 0) + unknownCount;
  if (unknownCount > 0) {
    data.push({ key: 'unknown', label: t('common.unknown'), color: tc.muted, count: unknownCount });
  }

  const labelFor = d => (d.key === 'unknown' ? t('common.unknown') : t('stats.seasonLabel', { name: d.label }));

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'season-chart';

  const main = document.createElement('div');
  main.className = 'season-chart-main';

  // ── Donut ──
  const donutWrap = document.createElement('div');
  donutWrap.className = 'season-chart-donut';

  const size = 260;
  const outerR = size * 0.38;
  const innerR = outerR * 0.68;

  const svg = d3.select(donutWrap).append('svg')
    .attr('width', size)
    .attr('height', size)
    .attr('viewBox', `0 0 ${size} ${size}`)
    .append('g')
    .attr('transform', `translate(${size / 2},${size / 2})`);

  const pie = d3.pie().value(d => d.count).sort(null).padAngle(0.02);
  const arc = d3.arc().innerRadius(innerR).outerRadius(outerR).cornerRadius(3);

  svg.selectAll('path')
    .data(pie(data))
    .join('path')
    .attr('d', arc)
    .attr('fill', d => d.data.color)
    .attr('stroke', tc.bg)
    .attr('stroke-width', 1.5)
    .style('cursor', 'pointer')
    .on('mousemove', (evt, d) => {
      const pct = total > 0 ? ((d.data.count / total) * 100).toFixed(1) : '0';
      showTooltip(evt, `<b>${labelFor(d.data)}</b><br>${t('stats.titleCount', { count: d.data.count, pct })}`);
    })
    .on('mouseleave', hideTooltip);

  // Center total (hero number → mono)
  svg.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '-0.15em')
    .attr('fill', tc.text)
    .attr('font-family', tc.fontMono)
    .attr('font-size', '1.5rem')
    .attr('font-weight', '700')
    .text(total);
  svg.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '1.5em')
    .attr('fill', tc.muted)
    .attr('font-family', tc.fontBody)
    .attr('font-size', '0.938rem')
    .text(t('stats.total'));

  main.appendChild(donutWrap);

  // ── Legend ──
  const legend = document.createElement('div');
  legend.className = 'season-chart-legend';

  data.forEach(d => {
    const item = document.createElement('div');
    item.className = 'season-legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'season-legend-swatch';
    swatch.style.background = d.color;

    const name = document.createElement('span');
    name.className = 'season-legend-name';
    name.textContent = labelFor(d);

    const value = document.createElement('span');
    value.className = 'season-legend-value';
    value.textContent = `${d.count}`;

    item.appendChild(swatch);
    item.appendChild(name);
    item.appendChild(value);
    legend.appendChild(item);
  });

  main.appendChild(legend);
  wrap.appendChild(main);

  // Unknown hint
  if (unknownCount > 0) {
    const hint = document.createElement('div');
    hint.className = 'season-chart-hint';
    hint.textContent = t('stats.unknownSeason', { count: unknownCount });
    wrap.appendChild(hint);
  }

  container.appendChild(wrap);
}

// ─── Tag Co-occurrence (D3 Chord Diagram) ───

function loadChordChart() {
  const container = document.getElementById('chordChartContainer');
  const loadingEl = document.getElementById('chordLoading');
  const emptyEl = document.getElementById('chordEmpty');
  if (!container) return;

  loadingEl.style.display = '';
  emptyEl.style.display = 'none';
  container.innerHTML = '';
  container.style.display = 'none';

  API.get('/api/stats/tag-cooccurrence').then(data => {
    loadingEl.style.display = 'none';
    const tags = data.tags || [];
    const matrix = data.matrix || [];
    if (tags.length < 2 || matrix.length < 2) {
      emptyEl.style.display = '';
      return;
    }
    container.style.display = '';
    renderChordChart(container, tags, matrix);
  }).catch(err => {
    loadingEl.style.display = 'none';
    emptyEl.style.display = '';
    console.error('Chord chart load error:', err);
  });
}

function tagZh(name) {
  const d = window.ANILIST_TAG_DATA && window.ANILIST_TAG_DATA[name];
  return (d && d.zh) || name;
}

function renderChordChart(container, tags, matrix) {
  const tc = getThemeColors();
  const rect = container.parentElement.getBoundingClientRect();

  // 标签空间按最长标签宽度预留，保证完整显示不裁剪（CJK 全角 ≈ 字号，拉丁 ≈ 0.6 字号）
  const fontSize = 15; // --text-sm ≈ 0.938rem（与下方渲染字号一致）
  const maxLabelW = tags.reduce((mx, name) => {
    let w = 0;
    for (const ch of tagZh(name)) {
      w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? fontSize : fontSize * 0.6;
    }
    return Math.max(mx, w);
  }, 0);
  const labelPad = 14; // 标签与圆环间距 + 边距
  const minRadius = 130; // 圆环最小半径

  const required = minRadius + labelPad + maxLabelW;
  const size = Math.min(Math.max(rect.width - 32, required * 2, 320), 720);
  const outerRadius = size / 2 - labelPad - maxLabelW;
  const innerRadius = outerRadius - 26;

  container.innerHTML = '';
  const svg = d3.select(container).append('svg')
    .attr('width', size)
    .attr('height', size)
    .attr('viewBox', `0 0 ${size} ${size}`)
    .style('max-width', '100%')
    .style('height', 'auto')
    .append('g')
    .attr('transform', `translate(${size / 2},${size / 2})`);

  const chord = d3.chord()
    .padAngle(0.05)
    .sortSubgroups(d3.descending);

  const chords = chord(matrix);

  // Color scale: accent-tinted gradient across groups
  const rgb = tc.accentRgb.split(',').map(Number);
  const color = (i) => {
    const t = i / Math.max(tags.length - 1, 1);
    const mix = 0.35 + t * 0.5;
    const r = Math.round(rgb[0] * mix + (tc.isDark ? 60 : 200) * (1 - mix));
    const g = Math.round(rgb[1] * mix + (tc.isDark ? 60 : 200) * (1 - mix));
    const b = Math.round(rgb[2] * mix + (tc.isDark ? 60 : 200) * (1 - mix));
    return `rgb(${r},${g},${b})`;
  };

  // Ribbons (co-occurrence flows)
  const ribbon = d3.ribbon().radius(innerRadius);
  svg.append('g')
    .attr('fill-opacity', 0.6)
    .selectAll('path')
    .data(chords)
    .join('path')
    .attr('d', ribbon)
    .attr('fill', d => color(d.source.index))
    .attr('stroke', tc.bg)
    .attr('stroke-width', 0.5)
    .style('cursor', 'pointer')
    .on('mousemove', (evt, d) => {
      const a = tagZh(tags[d.source.index]);
      const b = tagZh(tags[d.target.index]);
      showTooltip(evt, `<b>${a} × ${b}</b><br>${t('stats.chordPair', { count: d.source.value })}`);
    })
    .on('mouseleave', hideTooltip);

  // Arcs (groups)
  const arc = d3.arc()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius);

  const group = svg.append('g')
    .selectAll('g')
    .data(chords.groups)
    .join('g');

  group.append('path')
    .attr('d', arc)
    .attr('fill', d => color(d.index))
    .attr('stroke', tc.bg)
    .attr('stroke-width', 1.5)
    .style('cursor', 'pointer')
    .on('mousemove', (evt, d) => {
      showTooltip(evt, `<b>${tagZh(tags[d.index])}</b><br>${t('stats.chordCooccur', { count: d.value })}`);
    })
    .on('mouseleave', hideTooltip);

  // Labels (radial, space reserved so long names like "LGBTQ+主题" display fully)
  group.append('text')
    .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
    .attr('dy', '.35em')
    .attr('transform', d => `rotate(${(d.angle * 180 / Math.PI - 90)}) translate(${outerRadius + 12})` + (d.angle > Math.PI ? ' rotate(180)' : ''))
    .attr('text-anchor', d => d.angle > Math.PI ? 'end' : 'start')
    .attr('fill', tc.text)
    .attr('font-family', tc.fontBody)
    .attr('font-size', '0.938rem')
    .attr('font-weight', '600')
    .text(d => tagZh(tags[d.index]));
}

// ─── ESM exports for onclick handlers ───
window.loadStats = loadStats;
window.loadActivityChart = loadActivityChart;
window.loadRatingChart = loadRatingChart;
window.loadSeasonChart = loadSeasonChart;
window.loadChordChart = loadChordChart;

// ─── Theme change ───

document.addEventListener('themechanged', () => {
  const view = document.getElementById('statsView');
  if (view && !view.classList.contains('hidden')) {
    loadStats();
    loadActivityChart();
    loadRatingChart();
    loadSeasonChart();
    loadChordChart();
  }
});
