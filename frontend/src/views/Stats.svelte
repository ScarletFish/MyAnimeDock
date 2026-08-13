<script module>
  // ─── Stats 视图（Svelte 迁移版）───
  // 渐进迁移：把 index.html 的 #statsView + src/js/stats.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  // 挂载由 orchestrator 统一处理（与 Settings 相同：导出 statsOpen store，main.js/App 桥接）。
  import { writable } from 'svelte/store';

  // 跨组件打开开关：orchestrator 在 main.js 桥接 window.openStats → statsOpen.set(true)
  export const statsOpen = writable(false);
</script>

<script>
  import { onMount, tick } from 'svelte';

  // ─── i18n 辅助（复用全局 t()，回退文案）───
  function tr(key, fallback, options) {
    return typeof globalThis.t === 'function' ? globalThis.t(key, options) : fallback;
  }

  // ─── API 辅助（自包含，不复用全局 API）───
  const api = {
    async get(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };

  const WORDCLOUD_MAX_WORDS = 60;

  // ─── 状态 ───
  let wordcloudLoading = $state(true);
  let wordcloudEmpty = $state(false);
  let wordcloudLoaded = $state(false);

  let chordLoading = $state(true);
  let chordEmpty = $state(false);

  let activityLoading = $state(true);
  let activityEmpty = $state(false);

  let ratingLoading = $state(true);
  let ratingEmpty = $state(false);
  let ratingData = $state(null); // { avg, rows: [{score,count,pct,widthPct,color,isMode}] }

  let seasonLoading = $state(true);
  let seasonEmpty = $state(false);
  let seasonData = $state(null); // { items, unknown, total }

  // ─── 容器引用（d3/canvas 目标）───
  let wordCloudCanvas = $state(null);
  let chordContainer = $state(null);
  let activityContainer = $state(null);
  let seasonDonutEl = $state(null);

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

  // ─── Word Cloud ───
  async function loadStats(silent = false) {
    if (!silent) {
      wordcloudLoading = true;
      wordcloudEmpty = false;
      wordcloudLoaded = false;
    }
    try {
      const data = await api.get('/api/stats/tags');
      if (!data.tags || Object.keys(data.tags).length === 0) {
        if (!silent) { wordcloudLoading = false; wordcloudEmpty = true; }
        return;
      }
      const entries = Object.entries(data.tags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, WORDCLOUD_MAX_WORDS);
      if (entries.length === 0) {
        if (!silent) { wordcloudLoading = false; wordcloudEmpty = true; }
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
      if (!silent) { wordcloudLoading = false; wordcloudLoaded = true; }
      await tick();
      renderWordCloud(list);
    } catch (err) {
      if (!silent) { wordcloudLoading = false; wordcloudEmpty = true; }
      console.error('Stats load error:', err);
    }
  }

  function renderWordCloud(list) {
    const canvas = wordCloudCanvas;
    if (!canvas || typeof globalThis.WordCloud !== 'function') return;

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

    globalThis.WordCloud(canvas, {
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
        const norm = i / (steps - 1);
        const mix = 0.3 + norm * 0.5;
        colors.push(`rgb(${Math.round(r + (255 - r) * (1 - mix))},${Math.round(g + (255 - g) * (1 - mix))},${Math.round(b + (255 - b) * (1 - mix))})`);
      }
    } else {
      for (let i = 0; i < steps; i++) {
        const norm = i / (steps - 1);
        colors.push(`rgb(${Math.round(r * (0.5 + norm * 0.5))},${Math.round(g * (0.5 + norm * 0.5))},${Math.round(b * (0.5 + norm * 0.5))})`);
      }
    }
    return colors;
  }

  // ─── Watch Activity (D3 Area Chart) ───
  async function loadActivityChart(silent = false) {
    if (!silent) {
      activityLoading = true;
      activityEmpty = false;
    }
    try {
      const data = await api.get('/api/stats/watch-activity');
      const months = data.months || [];
      const totalMinutes = months.reduce((s, m) => s + m.minutes, 0);
      if (totalMinutes === 0) {
        if (!silent) { activityLoading = false; activityEmpty = true; }
        return;
      }
      if (!silent) activityLoading = false;
      await tick();
      renderActivityChart(months);
    } catch (err) {
      if (!silent) { activityLoading = false; activityEmpty = true; }
      console.error('Activity chart load error:', err);
    }
  }

  function renderActivityChart(months) {
    const container = activityContainer;
    if (!container || typeof globalThis.d3 === 'undefined') return;
    const d3 = globalThis.d3;
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

    svg.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(''))
      .selectAll('line')
      .attr('stroke', tc.gridLine);
    svg.selectAll('.grid .domain').remove();

    const gradientId = 'activityGrad';
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0').attr('y1', '0')
      .attr('x2', '0').attr('y2', '1');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', tc.accent).attr('stop-opacity', 0.4);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', tc.accent).attr('stop-opacity', 0.05);

    const area = d3.area()
      .x(d => x(d.label) + x.bandwidth() / 2)
      .y0(height)
      .y1(d => y(d.minutes))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(months)
      .attr('fill', `url(#${gradientId})`)
      .attr('d', area);

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

    svg.selectAll('.dot')
      .data(months)
      .join('circle')
      .attr('cx', d => x(d.label) + x.bandwidth() / 2)
      .attr('cy', d => y(d.minutes))
      .attr('r', 4)
      .attr('fill', tc.accent)
      .attr('stroke', tc.bg)
      .attr('stroke-width', 2);

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
        showTooltip(evt, `<b>${d.label}</b><br>${tr('stats.hours', '{hours} 小时', { hours })}`);
      })
      .on('mouseleave', hideTooltip);

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickSize(0))
      .selectAll('text')
      .attr('fill', tc.muted)
      .attr('font-family', tc.fontBody)
      .attr('font-size', '0.938rem')
      .attr('dy', '1em');
    svg.selectAll('.domain').attr('stroke', tc.border);

    svg.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => d >= 60 ? (d / 60).toFixed(0) + 'h' : d + 'm'))
      .selectAll('text')
      .attr('fill', tc.muted)
      .attr('font-family', tc.fontMono)
      .attr('font-size', '0.938rem');
    svg.selectAll('.domain').attr('stroke', tc.border);
  }

  // ─── Rating Distribution ───
  async function loadRatingChart(silent = false) {
    if (!silent) {
      ratingLoading = true;
      ratingEmpty = false;
      ratingData = null;
    }
    try {
      const data = await api.get('/api/stats/ratings');
      const bins = data.bins || [];
      const total = bins.reduce((s, v) => s + v, 0);
      if (total === 0) {
        if (!silent) { ratingLoading = false; ratingEmpty = true; }
        return;
      }
      if (!silent) ratingLoading = false;
      buildRatingData(data.labels || [], bins, total);
    } catch (err) {
      if (!silent) { ratingLoading = false; ratingEmpty = true; }
      console.error('Rating chart load error:', err);
    }
  }

  function buildRatingData(labels, bins, total) {
    const tc = getThemeColors();
    const rgb = tc.accentRgb.split(',').map(Number);
    const data = labels.map((label, i) => ({ label, score: i + 1, count: bins[i] || 0 }));
    const weighted = data.reduce((s, d) => s + d.score * d.count, 0);
    const avg = total > 0 ? weighted / total : 0;
    const maxCount = globalThis.d3 ? globalThis.d3.max(data, d => d.count) || 0 : Math.max(...data.map(d => d.count), 0);
    const modeSet = new Set(data.filter(d => maxCount > 0 && d.count === maxCount).map(d => d.score));

    const rows = data.map(d => {
      const pct = total > 0 ? (d.count / total) * 100 : 0;
      const widthPct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
      const norm = (d.score - 1) / Math.max(data.length - 1, 1);
      const mix = 0.35 + norm * 0.65;
      const neutral = tc.isDark ? 90 : 205;
      const r = Math.round(rgb[0] * mix + neutral * (1 - mix));
      const g = Math.round(rgb[1] * mix + neutral * (1 - mix));
      const b = Math.round(rgb[2] * mix + neutral * (1 - mix));
      return {
        score: d.score,
        count: d.count,
        pct,
        widthPct,
        isMode: modeSet.has(d.score),
        color: modeSet.has(d.score) ? tc.accent : `rgb(${r},${g},${b})`,
      };
    });

    ratingData = { avg, rows };
  }

  // ─── Season Distribution (Donut + Legend) ───
  async function loadSeasonChart(silent = false) {
    if (!silent) {
      seasonLoading = true;
      seasonEmpty = false;
      seasonData = null;
    }
    try {
      const data = await api.get('/api/stats/seasons');
      const seasons = data.seasons || {};
      const entries = [
        { key: 'spring', label: tr('stats.spring', '春'), color: '#4ade80' },
        { key: 'summer', label: tr('stats.summer', '夏'), color: '#facc15' },
        { key: 'autumn', label: tr('stats.autumn', '秋'), color: '#f97316' },
        { key: 'winter', label: tr('stats.winter', '冬'), color: '#60a5fa' }
      ];
      const items = entries.map(e => ({ ...e, count: seasons[e.key] || 0 }));
      const total = items.reduce((s, v) => s + v.count, 0) + (seasons.unknown || 0);
      if (total === 0) {
        if (!silent) { seasonLoading = false; seasonEmpty = true; }
        return;
      }
      if (!silent) seasonLoading = false;
      seasonData = { items, unknown: seasons.unknown || 0, total };
      await tick();
      renderSeasonDonut();
    } catch (err) {
      if (!silent) { seasonLoading = false; seasonEmpty = true; }
      console.error('Season chart load error:', err);
    }
  }

  function seasonLabel(d) {
    return d.key === 'unknown' ? tr('common.unknown', '未知') : tr('stats.seasonLabel', '{name}季', { name: d.label });
  }

  // season legend derived data（模板专用，依赖 seasonData）
  function seasonLegend() {
    if (!seasonData) return [];
    const items = [...seasonData.items];
    if (seasonData.unknown > 0) {
      items.push({ key: 'unknown', label: tr('common.unknown', '未知'), color: 'var(--fg-muted)', count: seasonData.unknown });
    }
    return items.map(d => ({ key: d.key, label: seasonLabel(d), color: d.color, count: d.count }));
  }

  function renderSeasonDonut() {
    const container = seasonDonutEl;
    if (!container || !seasonData || typeof globalThis.d3 === 'undefined') return;
    const d3 = globalThis.d3;
    const tc = getThemeColors();

    const data = [...seasonData.items];
    const total = seasonData.total;
    if (seasonData.unknown > 0) {
      data.push({ key: 'unknown', label: tr('common.unknown', '未知'), color: tc.muted, count: seasonData.unknown });
    }

    container.innerHTML = '';
    const size = 260;
    const outerR = size * 0.38;
    const innerR = outerR * 0.68;

    const svg = d3.select(container).append('svg')
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
        showTooltip(evt, `<b>${seasonLabel(d.data)}</b><br>${tr('stats.titleCount', '{count} 部 ({pct}%)', { count: d.data.count, pct })}`);
      })
      .on('mouseleave', hideTooltip);

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
      .text(tr('stats.total', '总数'));
  }

  // ─── Tag Co-occurrence (D3 Chord Diagram) ───
  async function loadChordChart(silent = false) {
    if (!silent) {
      chordLoading = true;
      chordEmpty = false;
    }
    try {
      const data = await api.get('/api/stats/tag-cooccurrence');
      const tags = data.tags || [];
      const matrix = data.matrix || [];
      if (tags.length < 2 || matrix.length < 2) {
        if (!silent) { chordLoading = false; chordEmpty = true; }
        return;
      }
      if (!silent) chordLoading = false;
      await tick();
      renderChordChart(tags, matrix);
    } catch (err) {
      if (!silent) { chordLoading = false; chordEmpty = true; }
      console.error('Chord chart load error:', err);
    }
  }

  function tagZh(name) {
    const d = window.ANILIST_TAG_DATA && window.ANILIST_TAG_DATA[name];
    return (d && d.zh) || name;
  }

  function renderChordChart(tags, matrix) {
    const container = chordContainer;
    if (!container || typeof globalThis.d3 === 'undefined') return;
    const d3 = globalThis.d3;
    const tc = getThemeColors();
    const rect = container.parentElement.getBoundingClientRect();

    const fontSize = 15;
    const maxLabelW = tags.reduce((mx, name) => {
      let w = 0;
      for (const ch of tagZh(name)) {
        w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? fontSize : fontSize * 0.6;
      }
      return Math.max(mx, w);
    }, 0);
    const labelPad = 14;
    const minRadius = 130;

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

    const rgb = tc.accentRgb.split(',').map(Number);
    const color = (i) => {
      const norm = i / Math.max(tags.length - 1, 1);
      const mix = 0.35 + norm * 0.5;
      const r = Math.round(rgb[0] * mix + (tc.isDark ? 60 : 200) * (1 - mix));
      const g = Math.round(rgb[1] * mix + (tc.isDark ? 60 : 200) * (1 - mix));
      const b = Math.round(rgb[2] * mix + (tc.isDark ? 60 : 200) * (1 - mix));
      return `rgb(${r},${g},${b})`;
    };

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
        showTooltip(evt, `<b>${a} × ${b}</b><br>${tr('stats.chordPair', '{count} 部同时包含', { count: d.source.value })}`);
      })
      .on('mouseleave', hideTooltip);

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
        showTooltip(evt, `<b>${tagZh(tags[d.index])}</b><br>${tr('stats.chordCooccur', '共现 {count} 次', { count: d.value })}`);
      })
      .on('mouseleave', hideTooltip);

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

  // ─── 打开时全部加载 + 主题切换静默重绘 ───
  // silent=true：切主题时只重绘颜色，不重置 loading（容器不塌缩，滚动位置不跳）。
  async function loadAll(silent = false) {
    loadStats(silent);
    loadActivityChart(silent);
    loadRatingChart(silent);
    loadSeasonChart(silent);
    loadChordChart(silent);
  }

  $effect(() => {
    if ($statsOpen) loadAll();
  });

  onMount(() => {
    const onThemeChanged = () => {
      if ($statsOpen) loadAll(true);
    };
    document.addEventListener('themechanged', onThemeChanged);
    return () => {
      document.removeEventListener('themechanged', onThemeChanged);
      if (_tooltipEl && _tooltipEl.parentNode) _tooltipEl.parentNode.removeChild(_tooltipEl);
      _tooltipEl = null;
    };
  });
</script>

{#if $statsOpen}
  <section class="view" id="svelte-statsView">
    <div class="view-header">
      <h1>{tr('stats.title', '统计')}</h1>
    </div>
    <div class="stats-grid" id="svelte-statsGrid">
      <!-- Card 1: Word Cloud -->
      <div class="stats-card stats-card--wordcloud" id="svelte-statsWordCloudCard">
        <div class="stats-card-header">
          <h2>{tr('stats.wordCloud', '分类词云')}</h2>
          <span class="stats-card-subtitle">{tr('stats.wordCloudSubtitle', 'Bangumi 类型标签聚合')}</span>
          <button class="stats-refresh-btn" onclick={loadStats} data-tooltip={tr('stats.refreshWordCloud', '刷新词云')} aria-label={tr('stats.refreshWordCloud', '刷新词云')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          </button>
        </div>
        <div class="stats-card-body" class:stats-card-body--loaded={wordcloudLoaded}>
          {#if wordcloudLoading}
            <div class="stats-loading" id="svelte-statsLoading">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <span>{tr('common.loading', '加载中…')}</span>
            </div>
          {:else if wordcloudEmpty}
            <div class="stats-empty" id="svelte-statsEmpty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              <p>{tr('stats.noTags', '暂无标签数据')}</p>
              <p class="empty-hint">{tr('stats.noTagsHint', '导入动漫并获取元数据后，标签词云将在此展示')}</p>
            </div>
          {:else}
            <canvas bind:this={wordCloudCanvas} id="svelte-wordCloudCanvas" width="800" height="400"></canvas>
          {/if}
        </div>
      </div>

      <!-- Card 2: Tag Co-occurrence (Chord) -->
      <div class="stats-card stats-card--chord" id="svelte-statsChordCard">
        <div class="stats-card-header">
          <h2>{tr('stats.chord', '类型交叉')}</h2>
          <span class="stats-card-subtitle">{tr('stats.chordSubtitle', '标签共现关系')}</span>
          <button class="stats-refresh-btn" onclick={loadChordChart} data-tooltip={tr('stats.refreshChart', '刷新图表')} aria-label={tr('stats.refreshChart', '刷新图表')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          </button>
        </div>
        <div class="stats-card-body" class:stats-card-body--loaded={!chordLoading && !chordEmpty}>
          {#if chordLoading}
            <div class="stats-loading" id="svelte-chordLoading">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <span>{tr('common.loading', '加载中…')}</span>
            </div>
          {:else if chordEmpty}
            <div class="stats-empty" id="svelte-chordEmpty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              <p>{tr('stats.noChord', '暂无交叉数据')}</p>
              <p class="empty-hint">{tr('stats.noChordHint', '导入动漫并获取元数据后，标签交叉关系将在此展示')}</p>
            </div>
          {:else}
            <div bind:this={chordContainer} id="svelte-chordChartContainer"></div>
          {/if}
        </div>
      </div>

      <!-- Card 3: Watch Activity -->
      <div class="stats-card stats-card--activity" id="svelte-statsActivityCard">
        <div class="stats-card-header">
          <h2>{tr('stats.activity', '观看活跃度')}</h2>
          <span class="stats-card-subtitle">{tr('stats.activitySubtitle', '最近 6 个月观看时长趋势')}</span>
          <button class="stats-refresh-btn" onclick={loadActivityChart} data-tooltip={tr('stats.refreshChart', '刷新图表')} aria-label={tr('stats.refreshChart', '刷新图表')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          </button>
        </div>
        <div class="stats-card-body" class:stats-card-body--loaded={!activityLoading && !activityEmpty}>
          {#if activityLoading}
            <div class="stats-loading" id="svelte-activityLoading">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <span>{tr('common.loading', '加载中…')}</span>
            </div>
          {:else if activityEmpty}
            <div class="stats-empty" id="svelte-activityEmpty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              <p>{tr('stats.noActivity', '暂无播放记录')}</p>
              <p class="empty-hint">{tr('stats.noActivityHint', '使用 mpv 播放视频后，活跃度趋势将在此展示')}</p>
            </div>
          {:else}
            <div bind:this={activityContainer} id="svelte-activityChartContainer"></div>
          {/if}
        </div>
      </div>

      <!-- Card 4: Rating Distribution -->
      <div class="stats-card stats-card--rating" id="svelte-statsRatingCard">
        <div class="stats-card-header">
          <h2>{tr('stats.rating', '评分分布')}</h2>
          <span class="stats-card-subtitle">{tr('stats.ratingSubtitle', 'Bangumi 评分偏好一览')}</span>
          <button class="stats-refresh-btn" onclick={loadRatingChart} data-tooltip={tr('stats.refreshChart', '刷新图表')} aria-label={tr('stats.refreshChart', '刷新图表')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          </button>
        </div>
        <div class="stats-card-body" class:stats-card-body--loaded={!ratingLoading && !ratingEmpty}>
          {#if ratingLoading}
            <div class="stats-loading" id="svelte-ratingLoading">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <span>{tr('common.loading', '加载中…')}</span>
            </div>
          {:else if ratingEmpty}
            <div class="stats-empty" id="svelte-ratingEmpty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              <p>{tr('stats.noRating', '暂无评分数据')}</p>
              <p class="empty-hint">{tr('stats.noRatingHint', '导入动漫并获取元数据后，评分分布将在此展示')}</p>
            </div>
          {:else if ratingData}
            <div class="rating-chart">
              <div class="rating-chart-head">
                <span class="rating-chart-badge">★</span>
                <span class="rating-chart-avg">{ratingData.avg.toFixed(1)}</span>
                <span class="rating-chart-avg-label">{tr('stats.avgRating', '平均分')}</span>
              </div>
              <div class="rating-chart-rows">
                {#each ratingData.rows as row (row.score)}
                  <div
                    class="rating-row"
                    class:rating-row--mode={row.isMode}
                    onmousemove={(e) => showTooltip(e, `<b>${row.score} ${tr('stats.scoreUnit', '分')}</b><br>${tr('stats.titleCount', '{count} 部 ({pct}%)', { count: row.count, pct: row.pct.toFixed(1) })}`)}
                    onmouseleave={hideTooltip}
                  >
                    <span class="rating-row-score">★ {row.score}</span>
                    <div class="rating-row-track"><div class="rating-row-bar" style="width:{row.widthPct}%;background:{row.color}"></div></div>
                    <span class="rating-row-count">{row.count}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- Card 5: Season Distribution -->
      <div class="stats-card stats-card--season" id="svelte-statsSeasonCard">
        <div class="stats-card-header">
          <h2>{tr('stats.season', '季度分布')}</h2>
          <span class="stats-card-subtitle">{tr('stats.seasonSubtitle', '所看番剧在哪个季度最突出')}</span>
          <button class="stats-refresh-btn" onclick={loadSeasonChart} data-tooltip={tr('stats.refreshChart', '刷新图表')} aria-label={tr('stats.refreshChart', '刷新图表')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          </button>
        </div>
        <div class="stats-card-body" class:stats-card-body--loaded={!seasonLoading && !seasonEmpty}>
          {#if seasonLoading}
            <div class="stats-loading" id="svelte-seasonChartLoading">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <span>{tr('common.loading', '加载中…')}</span>
            </div>
          {:else if seasonEmpty}
            <div class="stats-empty" id="svelte-seasonChartEmpty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              <p>{tr('stats.noSeason', '暂无季度数据')}</p>
              <p class="empty-hint">{tr('stats.noSeasonHint', '导入动漫并获取元数据后，季度分布将在此展示')}</p>
            </div>
          {:else if seasonData}
            <div class="season-chart">
              <div class="season-chart-main">
                <div class="season-chart-donut" bind:this={seasonDonutEl}></div>
                <div class="season-chart-legend">
                  {#each seasonLegend() as item (item.key)}
                    <div class="season-legend-item">
                      <span class="season-legend-swatch" style="background:{item.color}"></span>
                      <span class="season-legend-name">{item.label}</span>
                      <span class="season-legend-value">{item.count}</span>
                    </div>
                  {/each}
                </div>
              </div>
              {#if seasonData.unknown > 0}
                <div class="season-chart-hint">{tr('stats.unknownSeason', '另有 {count} 部未知季度', { count: seasonData.unknown })}</div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </section>
{/if}
