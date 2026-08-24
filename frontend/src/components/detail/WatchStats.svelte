<script>
  import { onMount } from 'svelte';
  import { tr } from '../../lib/anime-utils.js';
  import * as d3 from 'd3';
  import { API as api } from '../../lib/api.js';

  let { anime = null } = $props();

  let containerEl = $state(null);
  let watchStatsVersion = 0;
  let _wsTooltip = null;

  function fmtDuration(seconds) {
    if (seconds < 60) return Math.round(seconds) + 's';
    const m = Math.round(seconds / 60);
    if (m < 60) return m + 'min';
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? h + 'h ' + rm + 'min' : h + 'h';
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
      gridLine: isDark ? 'rgba(237,232,226,0.08)' : 'rgba(44,36,24,0.08)',
      border: isDark ? 'rgba(237,232,226,0.1)' : 'rgba(44,36,24,0.1)',
    };
  }

  function wsTooltip() {
    if (!_wsTooltip) {
      _wsTooltip = document.createElement('div');
      _wsTooltip.className = 'stats-tooltip';
      document.body.appendChild(_wsTooltip);
    }
    return _wsTooltip;
  }

  function renderDonut(container, totalEp, watchedEp, totalSecs, version) {
    const tc = getThemeColors();
    const pct = totalEp > 0 ? watchedEp / totalEp : 0;
    const rect = container.getBoundingClientRect();
    const size = Math.max(Math.min(rect.width || 200, 220), 140);
    const outerR = size * 0.38;
    const innerR = outerR * 0.72;
    const svg = d3.select(container).append('svg')
      .attr('width', size).attr('height', size)
      .attr('viewBox', '0 0 ' + size + ' ' + size)
      .append('g').attr('transform', 'translate(' + (size / 2) + ',' + (size / 2) + ')');
    const tau = 2 * Math.PI;
    const arc = d3.arc().innerRadius(innerR).outerRadius(outerR).cornerRadius(3);
    svg.append('path').attr('d', arc({ startAngle: 0, endAngle: tau })).attr('fill', tc.gridLine);
    const progressAngle = Math.min(pct * tau, tau);
    svg.append('path').attr('d', arc({ startAngle: -tau / 4, endAngle: -tau / 4 + progressAngle })).attr('fill', tc.accent);
    svg.append('text').attr('text-anchor', 'middle').attr('dy', '-0.15em').attr('fill', tc.text)
      .attr('font-size', '1.4rem').attr('font-weight', '700').text(watchedEp + '/' + totalEp);
    svg.append('text').attr('text-anchor', 'middle').attr('dy', '1.1em').attr('fill', tc.muted)
      .attr('font-size', '1.016rem').text(fmtDuration(totalSecs));
  }

  function renderChart(container, weeks, version) {
    const tc = getThemeColors();
    const rect = container.getBoundingClientRect();
    const margin = { top: 10, right: 10, bottom: 26, left: 50 };
    const width = Math.max(rect.width - margin.left - margin.right, 120);
    const height = Math.max(rect.height - margin.top - margin.bottom, 80);
    const svg = d3.select(container).append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
    const x = d3.scaleBand().domain(weeks.map((_, i) => i)).range([0, width]).padding(0.25);
    const y = d3.scaleLinear().domain([0, d3.max(weeks, (d) => d.minutes) || 1]).nice().range([height, 0]);
    svg.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(2).tickSize(-width).tickFormat(''))
      .selectAll('line').attr('stroke', tc.gridLine);
    svg.selectAll('.grid .domain').remove();
    const gradId = 'wsGrad_' + version;
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
    grad.append('stop').attr('offset', '0%').attr('stop-color', tc.accent).attr('stop-opacity', 0.35);
    grad.append('stop').attr('offset', '100%').attr('stop-color', tc.accent).attr('stop-opacity', 0.04);
    svg.selectAll('.bar').data(weeks).join('rect')
      .attr('x', (_, i) => x(i)).attr('y', (d) => y(d.minutes))
      .attr('width', x.bandwidth()).attr('height', (d) => height - y(d.minutes))
      .attr('fill', tc.accent).attr('opacity', 0.12).attr('rx', 2);
    const area = d3.area().x((_, i) => x(i) + x.bandwidth() / 2).y0(height).y1((d) => y(d.minutes)).curve(d3.curveMonotoneX);
    svg.append('path').datum(weeks).attr('fill', 'url(#' + gradId + ')').attr('d', area);
    const line = d3.line().x((_, i) => x(i) + x.bandwidth() / 2).y((d) => y(d.minutes)).curve(d3.curveMonotoneX);
    svg.append('path').datum(weeks).attr('fill', 'none').attr('stroke', tc.accent).attr('stroke-width', 2).attr('d', line);
    svg.selectAll('.dot').data(weeks).join('circle')
      .attr('cx', (_, i) => x(i) + x.bandwidth() / 2).attr('cy', (d) => y(d.minutes))
      .attr('r', 3).attr('fill', tc.accent).attr('stroke', tc.bg).attr('stroke-width', 2);
    svg.selectAll('.hz').data(weeks).join('rect')
      .attr('x', (_, i) => x(i)).attr('y', 0).attr('width', x.bandwidth()).attr('height', height)
      .attr('fill', 'transparent')
      .on('mousemove', (evt, d) => {
        const tip = wsTooltip();
        tip.innerHTML = '<b>' + (d.start.getMonth() + 1) + '/' + d.start.getDate() + '</b><br>' + tr('detail.minutes', { minutes: d.minutes });
        tip.style.display = 'block';
        const pad = 12;
        let l = evt.clientX + pad;
        let ty = evt.clientY - tip.offsetHeight - pad;
        if (l + tip.offsetWidth > window.innerWidth - pad) l = evt.clientX - tip.offsetWidth - pad;
        if (ty < pad) ty = evt.clientY + pad;
        tip.style.left = l + 'px';
        tip.style.top = ty + 'px';
      })
      .on('mouseleave', () => { if (_wsTooltip) _wsTooltip.style.display = 'none'; });
    const labelInt = weeks.length > 8 ? Math.ceil(weeks.length / 5) : 1;
    svg.append('g').attr('transform', 'translate(0,' + height + ')')
      .call(d3.axisBottom(x).tickSize(0).tickFormat((_, i) => {
        if (i % labelInt === 0 || i === weeks.length - 1) return (weeks[i].start.getMonth() + 1) + '/' + weeks[i].start.getDate();
        return '';
      }))
      .selectAll('text').attr('fill', tc.muted).attr('font-size', '0.938rem').attr('dy', '1em');
    svg.selectAll('.domain').attr('stroke', tc.border);
    svg.append('g').call(d3.axisLeft(y).ticks(3).tickFormat((d) => {
      const v = Math.round(d);
      if (v >= 60) return Math.round(v / 60) + 'h';
      return v + 'min';
    })).selectAll('text').attr('fill', tc.muted).attr('font-size', '0.938rem');
    svg.selectAll('.domain').attr('stroke', tc.border);
  }

  function build() {
    if (!containerEl || !anime) return;
    const watchedEp = (anime.episodes || []).filter((e) => e.watched).length;
    const totalEp = anime.totalEpisodes || anime.eps || (anime.episodes ? anime.episodes.length : 0);
    if (watchedEp <= 0) { containerEl.innerHTML = ''; return; }
    const version = ++watchStatsVersion;
    containerEl.innerHTML = '<div class="ws-grid"><div class="ws-donut-wrap" id="wsDonut_' + version + '"></div><div class="ws-right" id="wsRight_' + version + '"><div class="ws-chart" id="wsChartInner_' + version + '"></div></div></div>';
    const donutEl = document.getElementById('wsDonut_' + version);
    const rightCol = document.getElementById('wsRight_' + version);
    const chartInner = document.getElementById('wsChartInner_' + version);

    api.get('/api/anime/' + encodeURIComponent(anime.id) + '/sessions').then((sessions) => {
      if (version !== watchStatsVersion) return;
      let totalSecs = 0;
      const dayMap = new Map();
      for (const s of sessions) {
        const secs = Math.max(0, s.duration || 0);
        totalSecs += secs;
        if (secs <= 0) continue;
        const d = new Date(s.startTime);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        dayMap.set(key, (dayMap.get(key) || 0) + secs);
      }

      if (donutEl) renderDonut(donutEl, totalEp, watchedEp, totalSecs, version);

      if (dayMap.size === 0 || totalSecs === 0) {
        if (rightCol) rightCol.style.display = 'none';
        return;
      }

      const weekMap = new Map();
      for (const [dateStr, secs] of dayMap) {
        const d = new Date(dateStr + 'T00:00:00');
        const day = d.getDay();
        const mon = new Date(d);
        mon.setDate(d.getDate() - ((day + 6) % 7));
        const key = mon.toISOString().slice(0, 10);
        if (!weekMap.has(key)) weekMap.set(key, { start: mon, minutes: 0 });
        weekMap.get(key).minutes += Math.round(secs / 60);
      }
      const sortedWeeks = [...weekMap.values()].filter((w) => w.minutes > 0).sort((a, b) => a.start - b.start);
      if (sortedWeeks.length === 0) {
        if (rightCol) rightCol.style.display = 'none';
        return;
      }
      if (rightCol) rightCol.style.display = '';
      if (chartInner && d3) renderChart(chartInner, sortedWeeks, version);
    }).catch(() => {
      if (version !== watchStatsVersion) return;
      if (rightCol) rightCol.style.display = 'none';
    });
  }

  $effect(() => {
    if (anime) build();
  });

  onMount(() => {
    const onThemeChanged = () => { if (anime) build(); };
    document.addEventListener('themechanged', onThemeChanged);
    return () => document.removeEventListener('themechanged', onThemeChanged);
  });
</script>

<div class="ws-body" id="svelte-watchStatsContent" bind:this={containerEl}></div>
