<script module>
  // ─── Detail 视图（Svelte 迁移版）───
  // 渐进迁移：把 index.html 的 #detailView + src/js/detail*.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  // 挂载由 orchestrator 统一处理（本文件不修改 App.svelte）。
  import { writable } from 'svelte/store';

  // 跨组件打开开关：orchestrator 可 bind 此 store 或调用 openDetail()。
  export const detailOpen = writable(false);

  // 打开参数（id / 来源卡片 rect / 来源封面 / 来源视图）
  let pendingOpen = null;

  /**
   * 打开详情视图（与 vanilla showDetail 签名兼容）。
   * 供 orchestrator / 内联 onclick 桥接调用。
   */
  export function openDetail(id, fromRect, fromSrc, sourceView = 'library') {
    pendingOpen = { id, fromRect, fromSrc, sourceView };
    detailOpen.set(true);
  }

  // 桥接：让 index.html 内联 onclick 能打开 Svelte 版详情（迁移期间共存）。
  if (typeof window !== 'undefined') window.openDetail = openDetail;
</script>

<script>
  import { onMount } from 'svelte';
  import { showToast } from '../components/Toast.svelte';
  import { initScrollDots } from '../lib/scroll-dots.js';

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
    async post(url, data) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async del(url) {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };

  // ─── XSS 防护 / 路径工具（本地实现）───
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const path = { basename(p) { return p ? p.split(/[\\/]/).pop() : ''; } };

  // ─── TTL 缓存（本地实现）───
  function createTimedCacheMap(ttlMs) {
    const _map = new Map();
    return {
      get(key) {
        const entry = _map.get(key);
        if (!entry || Date.now() - entry.ts >= ttlMs) return null;
        return entry.data;
      },
      set(key, data) { _map.set(key, { data, ts: Date.now() }); },
      clear(key) { if (key) _map.delete(key); else _map.clear(); },
    };
  }

  // ─── 确认弹窗（桥接全局 showConfirm，回退 true）───
  function showConfirm(message) {
    if (typeof window.showConfirm === 'function') return window.showConfirm(message);
    return Promise.resolve(true);
  }

  // ─── 打开外部 URL（Tauri-safe）───
  function openExternalUrl(url) {
    if (window.__TAURI__?.shell?.open) {
      window.__TAURI__.shell.open(url).catch(() => {});
    } else {
      window.open(url, '_blank');
    }
  }

  // ─── 状态 ───
  let anime = $state(null);
  let isWishlistMode = $state(false);
  let detailSourceView = $state('library');
  let enterActive = $state(false);
  let showContent = $state(false);
  let noBanner = $state(false);
  let headerTitle = $state('');
  let coverHtml = $state('');
  let bannerHtml = $state('');
  let title = $state('');
  let alias = $state('');
  let aliasVisible = $state(false);
  let infoLineHtml = $state('');
  let infoLineVisible = $state(false);
  let tagsHtml = $state('');
  let tagsVisible = $state(false);
  let summary = $state('');
  let episodeCount = $state('');
  let episodeGridHtml = $state('');
  let episodeHeatmapVisible = $state(true);
  let charGridHtml = $state('');
  let detailCharactersVisible = $state(true);
  let watchStatsHtml = $state('');
  let watchStatsVisible = $state(false);
  let relationsHtml = $state('');
  let relationsVisible = $state(false);
  let recsHtml = $state('');
  let recsVisible = $state(false);
  let archiveHtml = $state('');
  let archiveVisible = $state(false);
  let playBtnVisible = $state(false);
  let playBtnText = $state('');
  let fetchBtnVisible = $state(true);
  let deleteBtnVisible = $state(true);
  let syncOpen = $state(false);
  let syncKeyword = $state('');
  let syncResultsHtml = $state('');
  let renderVersion = $state(0);

  // 非响应式内部状态
  let _allTags = null;
  let _studioHtml = '';
  let _relationCache = createTimedCacheMap(30 * 60 * 1000);
  let _recCache = createTimedCacheMap(30 * 60 * 1000);
  let _dismissedFinishConfirm = new Set();
  let _wsData = null;
  let watchStatsVersion = 0;
  let _episodeThumbObserver = null;
  let _wsTooltip = null;
  let charResizeTimer = null;
  let isSliding = false;
  let playBtnPath = '';
  let playBtnPos = 0;
  let playBtnEpIdx = -1;
  let relationsCount = 0;
  let recsCount = 0;
  const MAX_GRID_HEIGHT = 10000;

  // ─── 打开时加载 ───
  $effect(() => {
    if ($detailOpen && pendingOpen) {
      const { id, fromRect, fromSrc, sourceView } = pendingOpen;
      detailSourceView = sourceView || 'library';
      loadAndShow(id, fromRect, fromSrc);
    }
  });

  async function loadAndShow(id, fromRect, fromSrc) {
    resetDetailEnter();
    try {
      anime = await api.get('/api/anime/' + encodeURIComponent(id));
      renderDetail();
      enterActive = true;
      if (fromRect) {
        animateHeroCoverFlip(fromRect, fromSrc);
      } else {
        showContent = true;
        setEntranceDelays(0.04, 0);
      }
      headerTitle = anime.bangumiTitle || anime.title;
      if (window.pendingFinishAnimeId === id) {
        window.pendingFinishAnimeId = null;
        checkAndShowFinishConfirm(anime);
      }
      if (globalThis.pendingAutoPlay === id) {
        globalThis.pendingAutoPlay = null;
        const ep = findWatchEpisode(anime);
        if (ep) setTimeout(() => playEpisode(ep.filePath, ep.progress), 400);
      }
    } catch (e) {
      showToast(tr('detail.loadFailed', '加载失败：{error}', { error: e.message }), 'error');
    }
  }

  // ─── 渲染主入口 ───
  function renderDetail() {
    if (!anime) return;
    if (typeof window.setTitlebarContext === 'function') {
      window.setTitlebarContext('detail', anime.bangumiTitle || anime.title || '');
    }
    const a = anime;

    // Cover
    if (a.localCover) {
      coverHtml = `<img src="/covers/${path.basename(a.localCover)}?w=540&q=80" alt="${escAttr(a.title)}">`;
    } else {
      const initial = (a.bangumiTitle || a.title || '?')[0].toUpperCase();
      coverHtml = `<div class="gray-cover"><span class="gray-cover-text">${escHtml(initial)}</span></div>`;
    }

    // Banner background
    if (a.anilistBanner && a.anilistBanner !== '__none__') {
      bannerHtml = `<img class="detail-banner-bg-img" src="/banners/${path.basename(a.anilistBanner)}" alt="">`;
      noBanner = false;
    } else {
      bannerHtml = '';
      noBanner = true;
    }

    title = a.bangumiTitle || a.title;

    // Alias
    const aliases = [];
    if (a.bangumiTitleJp) aliases.push(a.bangumiTitleJp);
    if (a.romajiTitle) aliases.push(a.romajiTitle);
    alias = aliases.join(' / ') || '';
    aliasVisible = aliases.length > 0;

    // Info line
    const leftParts = [];
    if (a.rating) leftParts.push(`<span class="info-rating-num">★ ${a.rating}</span>`);
    if (a.ratingRank) leftParts.push(`<span class="info-rating-sub">#${a.ratingRank}</span>`);
    if (a.ratingTotal) leftParts.push(`<span class="info-rating-sub">${tr('detail.ratingPeople', '{count} 人评分', { count: a.ratingTotal })}</span>`);
    const rightParts = [];
    const s = a.matchedSeason || a.season;
    if (s && s > 1) {
      const mismatch = a.season && a.matchedSeason && a.season !== a.matchedSeason;
      rightParts.push(`<span class="tag-pill tag-pill--secondary${mismatch ? ' tag-pill--warn' : ''}">S${s}${mismatch ? ' ⚠' : ''}</span>`);
    }
    if (a.date) rightParts.push(`<span class="tag-pill tag-pill--secondary">${a.date}</span>`);
    if (a.platform) rightParts.push(`<span class="tag-pill tag-pill--secondary">${escHtml(a.platform)}</span>`);
    infoLineHtml =
      (leftParts.length ? `<span class="info-left">${leftParts.join('')}</span>` : '') +
      (rightParts.length ? `<span class="info-tags">${rightParts.join('')}</span>` : '');
    infoLineVisible = leftParts.length || rightParts.length;

    // Tags
    const studios = a.anilistStudios || [];
    let tags = (a.anilistTags || [])
      .filter((t) => !t.isGeneralSpoiler)
      .map((t) => {
        const d = (globalThis.ANILIST_TAG_DATA || {})[t.name];
        return { name: d?.zh || t.name, desc: d?.descZh || d?.descEn || '', rank: t.rank };
      })
      .sort((x, y) => y.rank - x.rank);
    const studioHtml = studios.length ? `<span class="tag-pill tag-pill--studio">${tr('detail.studioLabel', '制作')} ${escHtml(studios[0])}</span>` : '';
    if (studios.length || tags.length) {
      const MAX_TAGS = 4;
      const shown = tags.slice(0, MAX_TAGS);
      const remaining = tags.length - MAX_TAGS;
      let html = studioHtml + shown.map((tag) => `<span class="tag-pill"${tag.desc ? ` data-tooltip="${escAttr(tag.desc)}" data-tooltip-rich` : ''}>${escHtml(tag.name)}</span>`).join('');
      if (remaining > 0) html += `<span class="tag-pill tag-pill--more" onclick="expandTags()">+${remaining}</span>`;
      tagsHtml = `<div class="detail-tags-list">${html}</div>`;
      tagsVisible = true;
      _allTags = tags;
      _studioHtml = studioHtml;
    } else {
      tagsHtml = '';
      tagsVisible = false;
    }

    summary = renderSummaryText(a);

    // Actions
    fetchBtnVisible = true;
    deleteBtnVisible = true;
    renderPlayButton(a);

    // Modules
    if (isWishlistMode) {
      renderWishlistDetail(a);
    } else {
      archiveVisible = false;
      episodeHeatmapVisible = true;
      detailCharactersVisible = true;
      renderEpisodeHeatmap(a);
      renderCharacters(a);
      renderWatchStats(a);
      fetchAndRenderRelations(a.id);
      fetchAndRenderRecommendations(a.id);
    }

    renderVersion++;
  }

  // ─── 摘要处理 ───
  function renderSummaryText(a) {
    let text = a.summary || '';
    if (text && /[\u4e00-\u9fff]/.test(text)) {
      const parts = text.split(/\[?简介原文\]?/);
      if (parts.length > 1) {
        text = parts[0].trim();
      } else {
        const dashed = text.split(/\n---+\n/);
        if (dashed.length > 1) {
          text = dashed[0].trim();
        } else {
          const paragraphs = text.split(/\n+/).filter((p) => p.trim());
          const cn = [];
          for (let p of paragraphs) {
            const hiragana = (p.match(/[\u3040-\u309f]/g) || []).length;
            const katakana = (p.match(/[\u30a0-\u30ff]/g) || []).length;
            const hanCount = (p.match(/[\u4e00-\u9fff]/g) || []).length;
            const meaningful = p.replace(/\s/g, '').length;
            if (hanCount === 0 && hiragana === 0 && katakana === 0) continue;
            if (katakana >= 8 && hanCount < 3) continue;
            if (hiragana >= 3 && hiragana / meaningful > 0.4) continue;
            cn.push(p.trim());
          }
          if (cn.length > 0) text = cn.join('\n');
        }
      }
    }
    return text || tr('detail.noSummary', '暂无简介');
  }

  // ─── 播放按钮 ───
  function findTargetEpisode(a) {
    if (!a.episodes || a.episodes.length === 0) return null;
    if (a.lastPlayedEp) {
      const ep = a.episodes.find((e) => e.number === a.lastPlayedEp);
      if (ep && (!ep.watched || ep.progress > 0)) return { episode: ep, allWatched: false };
    }
    for (let i = 0; i < a.episodes.length; i++) {
      if (!a.episodes[i].watched) return { episode: a.episodes[i], allWatched: false };
    }
    return { episode: a.episodes[0], allWatched: true };
  }
  function findWatchEpisode(a) {
    const r = findTargetEpisode(a);
    return r ? r.episode : null;
  }

  function renderPlayButton(a) {
    if (isWishlistMode || !a.episodes || a.episodes.length === 0) {
      playBtnVisible = false;
      return;
    }
    playBtnVisible = true;
    const result = findTargetEpisode(a);
    const targetEp = result.episode;
    const allWatched = result.allWatched;
    const hasViewHistory = a.episodes.some((e) => e.watched || e.progress > 0);
    if (allWatched) playBtnText = tr('detail.replay', '重新播放');
    else if (targetEp.progress > 0 || hasViewHistory) playBtnText = tr('detail.continue', '继续播放');
    else playBtnText = tr('detail.startPlay', '开始播放');
    playBtnPath = targetEp.filePath;
    playBtnPos = targetEp.progress || 0;
    playBtnEpIdx = a.episodes.indexOf(targetEp);
  }

  async function playEpisode(filePath, position = 0) {
    try {
      await api.post('/api/play', { filePath, position });
      showToast(tr('detail.playing', '正在播放'), 'info');
    } catch (e) {
      showToast(tr('detail.playFailed', '播放失败：{error}', { error: e.message }), 'error');
    }
  }

  async function playEpisodeFromCover() {
    if (!playBtnPath) return;
    await playEpisode(playBtnPath, playBtnPos);
    if (playBtnEpIdx >= 0) {
      const grid = document.getElementById('svelte-episodeHeatmapGrid');
      if (grid) {
        const card = grid.querySelector(`.episode-card[data-index="${playBtnEpIdx}"]`);
        if (card) {
          const cs = getComputedStyle(grid);
          const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
          const step = card.offsetWidth + gap;
          grid.scrollTo({ left: Math.max(0, playBtnEpIdx * step), behavior: 'smooth' });
        }
      }
    }
  }

  // ─── 剧集列表 ───
  function renderEpisodeHeatmap(a) {
    if (!a.episodes || a.episodes.length === 0) {
      episodeGridHtml = '<p class="text-content-muted p-4 text-center">' + tr('detail.noEpisodeInfo', '暂无剧集信息') + '</p>';
      episodeCount = '';
      return;
    }
    const localCount = a.episodes.length;
    const totalCount = a.totalEpisodes || a.eps;
    episodeCount = totalCount
      ? tr('detail.episodeCountTotal', '{localCount}/{totalCount}', { localCount, totalCount })
      : tr('detail.episodeCountLocal', '共 {localCount} 集', { localCount });
    episodeGridHtml = a.episodes.map((ep, idx) => {
      const epTitle = ep.fileName || tr('detail.episodeNumber', '第 {number} 集', { number: ep.number });
      const thumbUrl = '/api/thumbnail?path=' + encodeURIComponent(ep.filePath) + '&time=mid';
      const epNum = String(ep.number).padStart(2, '0');
      return `<div class="episode-card" data-index="${idx}" data-ep="${ep.number}" data-path="${escAttr(ep.filePath)}" data-pos="${ep.progress || 0}">
        <div class="episode-card-thumb">
          <div class="episode-card-bg" data-src="${escAttr(thumbUrl)}"></div>
          <div class="episode-card-overlay"></div>
          <div class="episode-card-num">${epNum}</div>
          <button class="episode-card-play" data-path="${escAttr(ep.filePath)}" data-pos="${ep.progress || 0}">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
          </button>
        </div>
        <div class="episode-card-info">
          <div class="episode-card-title" data-tooltip="${escAttr(epTitle)}">${escHtml(epTitle)}</div>
        </div>
      </div>`;
    }).join('');
  }

  // ─── 角色 ───
  function renderCharacters(a) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      detailCharactersVisible = false;
      charGridHtml = '';
      return;
    }
    const chars = a.characters || [];
    if (!chars.length) {
      detailCharactersVisible = false;
      charGridHtml = '';
      return;
    }
    detailCharactersVisible = true;
    charGridHtml = chars.slice(0, 24).map((c) => {
      const name = escHtml(c.nameCn || c.name);
      const cv = c.actors && c.actors[0] ? escHtml(c.actors[0].nameCn || c.actors[0].name) : null;
      const img = c.image
        ? `<img class="detail-char-avatar" src="${escAttr(c.image)}" alt="" loading="lazy" decoding="async" onerror="charAvatarFallback()">`
        : `<div class="detail-char-avatar-placeholder">${name.charAt(0)}</div>`;
      return `<div class="detail-char-card">
        ${img}
        <div class="detail-char-info">
          <div class="detail-char-name">${name}</div>
          ${cv ? `<div class="detail-char-cv">${cv}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function charAvatarFallback() {
    detailCharactersVisible = false;
  }

  // ─── 观看统计 ───
  function renderWatchStats(a) {
    const watchedEp = (a.episodes || []).filter((e) => e.watched).length;
    const totalEp = a.totalEpisodes || a.eps || (a.episodes ? a.episodes.length : 0);
    if (watchedEp <= 0) {
      watchStatsVisible = false;
      _wsData = null;
      return;
    }
    watchStatsVisible = true;
    watchStatsHtml = `<div class="ws-grid"><div class="ws-donut-wrap"></div><div class="ws-right"><div class="ws-chart"></div></div></div>`;
    _wsData = { watchedEp, totalEp, animeId: a.id };
  }

  function fmtPlain(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return m + 'm';
    if (m === 0) return h + 'h';
    return h + 'h ' + Math.round(m / 6) + 'm';
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

  function buildWatchStats() {
    const module = document.getElementById('svelte-watchStats');
    const container = document.getElementById('svelte-watchStatsContent');
    if (!module || !container || !_wsData) return;
    const version = ++watchStatsVersion;
    const { watchedEp, totalEp, animeId } = _wsData;
    const donutEl = container.querySelector('.ws-donut-wrap');
    const rightCol = container.querySelector('.ws-right');
    const chartInner = container.querySelector('.ws-chart');
    const d3 = globalThis.d3;
    if (donutEl && d3) renderWsDonut(donutEl, { totalEp, watchedEp }, version);
    api.get('/api/anime/' + encodeURIComponent(animeId) + '/sessions').then((data) => {
      if (version !== watchStatsVersion) return;
      const dailyEntries = Object.entries(data);
      const totalMinutes = dailyEntries.reduce((s, [, v]) => s + v, 0);
      if (totalMinutes === 0) { if (rightCol) rightCol.style.display = 'none'; return; }
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
        if (rightCol) rightCol.style.display = 'none';
        return;
      }
      updateDonutDuration(version, totalMinutes);
      if (rightCol) rightCol.style.display = '';
      if (chartInner && d3) renderWsChart(chartInner, sortedWeeks, version);
    }).catch(() => {
      if (version !== watchStatsVersion) return;
      if (rightCol) rightCol.style.display = 'none';
    });
  }

  function updateDonutDuration(version, totalMinutes) {
    const el = document.getElementById('wsDur_' + version);
    if (el) el.textContent = fmtPlain(totalMinutes);
  }

  function renderWsDonut(container, data, version) {
    const d3 = globalThis.d3;
    const tc = getThemeColors();
    const { totalEp, watchedEp } = data;
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
    svg.append('filter').attr('id', 'wsGlow_' + version).append('feDropShadow')
      .attr('dx', '0').attr('dy', '1').attr('stdDeviation', '3')
      .attr('flood-color', tc.accent).attr('flood-opacity', '0.25');
    svg.append('text').attr('text-anchor', 'middle').attr('dy', '-0.15em').attr('fill', tc.text)
      .attr('font-size', '1.4rem').attr('font-weight', '700').text(watchedEp + '/' + totalEp);
    svg.append('text').attr('text-anchor', 'middle').attr('dy', '1.1em').attr('fill', tc.muted)
      .attr('font-size', '0.95rem').attr('id', 'wsDur_' + version).text('');
  }

  function renderWsChart(container, weeks, version) {
    const d3 = globalThis.d3;
    const tc = getThemeColors();
    const rect = container.getBoundingClientRect();
    const margin = { top: 10, right: 10, bottom: 26, left: 34 };
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
        tip.innerHTML = `<b>${(d.start.getMonth() + 1)}/${d.start.getDate()}</b><br>${tr('detail.minutes', '{minutes} 分钟', { minutes: d.minutes })}`;
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
      .selectAll('text').attr('fill', tc.muted).attr('font-size', '0.7rem').attr('dy', '1em');
    svg.selectAll('.domain').attr('stroke', tc.border);
    svg.append('g').call(d3.axisLeft(y).ticks(3).tickFormat((d) => d >= 60 ? (d / 60).toFixed(0) + 'h' : d + 'm'))
      .selectAll('text').attr('fill', tc.muted).attr('font-size', '0.7rem');
    svg.selectAll('.domain').attr('stroke', tc.border);
  }

  // ─── 关联 / 推荐 ───
  async function fetchAndRenderRelations(animeId) {
    const cached = _relationCache.get(animeId);
    if (cached) {
      if (cached.data.length === 0) { relationsVisible = false; return; }
      relationsVisible = true;
      relationsHtml = cached.html;
      relationsCount = cached.data.length;
      return;
    }
    try {
      relationsVisible = false;
      relationsHtml = '';
      const res = await api.get('/api/anime/' + encodeURIComponent(animeId) + '/relations');
      const relations = res.relations || [];
      if (relations.length === 0) { relationsVisible = false; return; }
      relationsVisible = true;
      const badgeColors = { SEQUEL: '#22c55e', PREQUEL: '#f59e0b', SIDE_STORY: '#6366f1', SPIN_OFF: '#ec4899' };
      const html = relations.map((r) => {
        const cover = r.coverImage?.large || '';
        const label = r.relationType || '';
        const rTitle = r.title?.native || r.title?.romaji || r.title?.english || 'Unknown';
        const color = badgeColors[label] || '#6b7280';
        const click = r.inLibrary && r.localId
          ? `onclick="openDetail('${r.localId.replace(/'/g, "\\'")}',null,null,'library')"`
          : `onclick="openExternalUrl('https://anilist.co/anime/${r.id}')"`;
        return `<div class="relation-card" ${click}>
          <div class="relation-card-cover">
            <div class="relation-card-img"${cover ? ' style="background-image:url(&quot;' + cover.replace(/"/g, '%22') + '&quot;)"' : ''}></div>
            <span class="relation-badge" style="background:${color}">${escHtml(label)}</span>
          </div>
          <div class="relation-card-title">${escHtml(rTitle)}</div>
        </div>`;
      }).join('');
      relationsHtml = html;
      relationsCount = relations.length;
      _relationCache.set(animeId, { data: relations, html });
    } catch (e) {
      relationsVisible = false;
    }
  }

  async function fetchAndRenderRecommendations(animeId) {
    const cached = _recCache.get(animeId);
    if (cached) {
      if (cached.data.length === 0) { recsVisible = false; return; }
      recsVisible = true;
      recsHtml = cached.html;
      recsCount = cached.data.length;
      return;
    }
    try {
      recsVisible = false;
      recsHtml = '';
      const res = await api.get('/api/anime/' + encodeURIComponent(animeId) + '/recommendations');
      const recs = res.recommendations || [];
      if (recs.length === 0) { recsVisible = false; return; }
      recsVisible = true;
      const html = recs.map((r) => {
        const cover = r.coverImage?.large || '';
        const rTitle = r.title?.native || r.title?.romaji || r.title?.english || 'Unknown';
        const rating = r.averageScore ? `★ ${r.averageScore}` : '';
        const click = r.inLibrary && r.localId
          ? `onclick="openDetail('${r.localId.replace(/'/g, "\\'")}',null,null,'library')"`
          : `onclick="openExternalUrl('https://anilist.co/anime/${r.id}')"`;
        return `<div class="relation-card" ${click}>
          <div class="relation-card-cover">
            <div class="relation-card-img"${cover ? ' style="background-image:url(&quot;' + cover.replace(/"/g, '%22') + '&quot;)"' : ''}></div>
            ${rating ? `<span class="relation-badge relation-badge--rating">${escHtml(rating)}</span>` : ''}
          </div>
          <div class="relation-card-title">${escHtml(rTitle)}</div>
        </div>`;
      }).join('');
      recsHtml = html;
      recsCount = recs.length;
      _recCache.set(animeId, { data: recs, html });
    } catch (e) {
      recsVisible = false;
    }
  }

  // ─── 心愿单详情 ───
  function renderWishlistDetail(a) {
    episodeHeatmapVisible = false;
    detailCharactersVisible = false;
    watchStatsVisible = false;
    archiveVisible = false;
    fetchBtnVisible = false;
    deleteBtnVisible = false;
    const bgmUrl = (typeof window.getBangumiFrontendUrl === 'function' ? window.getBangumiFrontendUrl() : 'https://bgm.tv');
    archiveVisible = true;
    archiveHtml = `
      <div class="archive-magazine-essay">
        <div class="archive-magazine-thoughts text-sm text-content leading-[1.7]">${tr('detail.wishlistNoLocal', '该条目暂无本地文件')}</div>
      </div>
      <div class="archive-magazine-meta">
        ${a.rating ? `<div class="archive-magazine-stat"><span class="archive-magazine-stat-value">★ ${a.rating}</span><span class="archive-magazine-stat-label">${tr('detail.ratingLabel', '评分')}</span></div>` : ''}
        <div class="archive-magazine-stat"><span class="archive-magazine-stat-value">${tr('detail.wishlistLabel', '心愿单')}</span><span class="archive-magazine-stat-label">${tr('detail.sourceLabel', '来源')}</span></div>
      </div>
      <div class="wishlist-detail-actions mt-4">
        <a class="btn btn-primary" href="${bgmUrl}/subject/${a.bangumiId}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          ${tr('detail.openInBangumi', '在 Bangumi 打开')}
        </a>
      </div>`;
  }

  // ─── 标记看完 / 进度 ───
  function findPendingFinishConfirm(a) {
    if (!a.lastPlayedEp || !a.episodes) return null;
    const ep = a.episodes.find((e) => e.number === a.lastPlayedEp);
    if (!ep || ep.watched) return null;
    if (ep.progress > 0 && ep.duration > 0 && ep.progress / ep.duration > 0.9) return ep;
    return null;
  }

  function showFinishConfirm(a, ep) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.zIndex = '9999';
      const total = a.episodes ? a.episodes.length : '?';
      overlay.innerHTML =
        '<div class="modal" style="max-width:340px;padding:var(--space-6) var(--space-8) var(--space-5);text-align:center">' +
          '<p class="text-content" style="margin:0 0 var(--space-1);font-weight:600;font-size:17px">' + tr('detail.episodeXofY', '第 {number}/{total} 集', { number: ep.number, total }) + '</p>' +
          '<p class="text-content" style="margin:0 0 var(--space-5);font-size:14px;color:var(--fg-muted)">' + tr('detail.markWatchedConfirm', '标记该集为已看完？') + '</p>' +
          '<div class="modal-actions flex items-center justify-center" style="gap:var(--space-3);padding:0">' +
            '<button class="btn btn-ghost confirm-cancel" style="flex:1;justify-content:center">' + tr('detail.cancel', '取消') + '</button>' +
            '<button class="btn btn-primary confirm-ok" style="flex:1;justify-content:center">' + tr('detail.mark', '标记') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      function close(result) {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 200);
        resolve(result);
      }
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
      overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
      overlay.querySelector('.confirm-ok').focus();
    });
  }

  async function checkAndShowFinishConfirm(a) {
    if (!a) return;
    let mode = localStorage.getItem('myAnimDock_finishConfirm') || 'prompt';
    if (mode === 'on') mode = 'prompt';
    if (mode === 'off') return;
    const ep = findPendingFinishConfirm(a);
    if (!ep) return;
    const key = a.id + ':' + ep.number;
    if (mode === 'prompt') {
      if (_dismissedFinishConfirm.has(key)) return;
      const finished = await showFinishConfirm(a, ep);
      if (!finished) { _dismissedFinishConfirm.add(key); return; }
    }
    try {
      await api.post('/api/progress', { animeId: a.id, episodeNumber: ep.number, watched: true, progress: 0 });
      anime = await api.get('/api/anime/' + encodeURIComponent(a.id));
      renderDetail();
      scrollToNextUnwatched(anime, ep.number);
      showToast(tr('detail.markedWatched', '已标记第 {number} 集看完', { number: ep.number }), 'success');
    } catch (e) {
      showToast(tr('detail.markFailed', '标记失败：{error}', { error: e.message }), 'error');
    }
  }

  function scrollToNextUnwatched(a, afterEpNumber) {
    const grid = document.getElementById('svelte-episodeHeatmapGrid');
    if (!grid || !a.episodes) return;
    let nextEp = null;
    for (let i = 0; i < a.episodes.length; i++) {
      const e = a.episodes[i];
      if (e.number > afterEpNumber && !e.watched) { nextEp = e; break; }
    }
    if (!nextEp) nextEp = a.episodes[a.episodes.length - 1];
    const idx = a.episodes.indexOf(nextEp);
    if (idx === -1) return;
    const card = grid.querySelector('.episode-card[data-index="' + idx + '"]');
    if (!card) return;
    requestAnimationFrame(() => {
      const cs = getComputedStyle(grid);
      const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
      const step = (grid.querySelector('.episode-card') || card).offsetWidth + gap;
      grid.scrollTo({ left: Math.max(0, idx * step), behavior: 'smooth' });
    });
  }

  async function toggleWatched(animeId, epNumber, watched) {
    try {
      const result = await api.post('/api/progress', { animeId, episodeNumber: epNumber, watched, progress: watched ? undefined : 0 });
      if (anime) {
        const ep = anime.episodes.find((e) => e.number === epNumber);
        if (ep) { ep.watched = result.episode.watched; ep.progress = result.episode.progress; }
        renderPlayButton(anime);
        renderEpisodeHeatmap(anime);
        renderWatchStats(anime);
        renderVersion++;
      }
    } catch (e) {
      showToast(tr('detail.actionFailed', '操作失败：{error}', { error: e.message }), 'error');
    }
  }

  // ─── 同步元数据 ───
  function syncBangumiMetadata() {
    if (!anime) return;
    syncKeyword = (anime.specialSuffix || anime.bangumiTitle || anime.title).replace(/[~～]/g, '').trim();
    syncResultsHtml = '';
    syncOpen = true;
  }

  async function searchBangumiWithKeyword() {
    if (!anime) return;
    const keyword = syncKeyword.trim();
    if (!keyword) { showToast(tr('detail.enterKeyword', '请输入搜索关键词'), 'warning'); return; }
    syncResultsHtml = '<p class="text-center p-4 text-content">' + tr('detail.searching', '搜索中...') + '</p>';
    try {
      const result = await api.post('/api/bangumi/search', { keyword });
      if (result.results && result.results.length > 0) showSearchResults(result.results, anime.id);
      else syncResultsHtml = '<p class="search-result-empty">' + tr('detail.noSearchResults', '没有找到相关结果') + '</p>';
    } catch (e) {
      showToast(tr('detail.searchFailed', '搜索失败：{error}', { error: e.message }), 'error');
      syncResultsHtml = '<p class="search-result-empty">' + tr('detail.searchFailedEmpty', '搜索失败') + '</p>';
    }
  }

  function showSearchResults(results, animeId) {
    if (!results || results.length === 0) {
      syncResultsHtml = '<p class="search-result-empty">' + tr('detail.noSearchResults', '没有找到相关结果') + '</p>';
      return;
    }
    syncResultsHtml = '<h4 class="m-0 mb-3 text-content">' + tr('detail.selectSubject', '选择条目') + '</h4>' +
      results.map((r) => `
        <div class="search-result-item" onclick="attachBangumiSubject('${animeId}', ${r.id})">
          <img class="search-result-cover" src="${r.images?.small || r.images?.grid || ''}" alt=""
            loading="lazy" decoding="async" onerror="this.style.display='none'">
          <div class="search-result-info">
            <div class="search-result-title">${escHtml(r.name_cn || r.name)}</div>
            <div class="search-result-subtitle">${escHtml(r.name)}</div>
            <div class="search-result-meta">${r.date || ''}${r.rating?.score ? ' · ★' + r.rating.score.toFixed(1) : ''}</div>
          </div>
          <button class="btn btn-primary search-result-btn">${tr('detail.select', '选择')}</button>
        </div>
      `).join('');
  }

  async function attachBangumiSubject(animeId, subjectId) {
    syncResultsHtml = '<p class="text-center p-4 text-content">' + tr('detail.fetchingMetadata', '正在获取元数据...') + '</p>';
    try {
      const result = await api.post('/api/bangumi/fetch', { animeId, subjectId });
      anime = result.anime;
      renderDetail();
      syncOpen = false;
      if (typeof window.loadLibrary === 'function') window.loadLibrary();
      showToast(tr('detail.metadataSuccess', '元数据同步成功'), 'success');
    } catch (e) {
      showToast(tr('detail.fetchFailed', '获取失败：{error}', { error: e.message }), 'error');
      syncResultsHtml = '';
    }
  }

  // ─── 删除 ───
  async function deleteAnime() {
    if (!anime) return;
    const ok = await showConfirm(tr('detail.deleteConfirm', '确定移除「{title}」？', { title: anime.title }));
    if (!ok) return;
    try {
      await api.del('/api/anime/' + encodeURIComponent(anime.id));
      showToast(tr('detail.deleted', '已移除'), 'success');
      goBack();
      if (typeof window.loadLibrary === 'function') window.loadLibrary();
      if (typeof window.loadDiscovery === 'function') window.loadDiscovery();
      if (typeof window.loadMyList === 'function') window.loadMyList();
    } catch (e) {
      showToast(tr('detail.deleteFailed', '移除失败：{error}', { error: e.message }), 'error');
    }
  }

  // ─── 导航 ───
  function goBack() {
    if (typeof window.stopDetailRefresh === 'function') window.stopDetailRefresh();
    const target = detailSourceView || 'library';
    if (typeof window.showView === 'function') window.showView(target);
  }

  function findCurrentLibraryIndex() {
    if (!anime) return -1;
    const ld = globalThis.libraryData;
    if (!ld || !ld.length) return -1;
    return ld.findIndex((a) => a.id === anime.id);
  }

  function goPrev() {
    if (isSliding) return;
    if (detailSourceView === 'mylist' && globalThis.mylistData && globalThis.mylistData.length > 0) {
      const idx = globalThis.mylistData.findIndex((i) => i.id === anime.id);
      if (idx === -1) return;
      const prevIdx = idx === 0 ? globalThis.mylistData.length - 1 : idx - 1;
      const prev = globalThis.mylistData[prevIdx];
      if (prev) slideToAnime(prev.id, 'prev');
      return;
    }
    const idx = findCurrentLibraryIndex();
    if (idx === -1) return;
    const prevIdx = idx === 0 ? globalThis.libraryData.length - 1 : idx - 1;
    const prev = globalThis.libraryData[prevIdx];
    if (prev) slideToAnime(prev.id, 'prev');
  }

  function goNext() {
    if (isSliding) return;
    if (detailSourceView === 'mylist' && globalThis.mylistData && globalThis.mylistData.length > 0) {
      const idx = globalThis.mylistData.findIndex((i) => i.id === anime.id);
      if (idx === -1) return;
      const nextIdx = idx === globalThis.mylistData.length - 1 ? 0 : idx + 1;
      const next = globalThis.mylistData[nextIdx];
      if (next) slideToAnime(next.id, 'next');
      return;
    }
    const idx = findCurrentLibraryIndex();
    if (idx === -1) return;
    const nextIdx = idx === globalThis.libraryData.length - 1 ? 0 : idx + 1;
    const next = globalThis.libraryData[nextIdx];
    if (next) slideToAnime(next.id, 'next');
  }

  async function loadAnimeData(id) {
    try {
      if (detailSourceView === 'mylist' && globalThis.mylistData) {
        const item = globalThis.mylistData.find((i) => i.id === id);
        if (!item) throw new Error('条目不存在');
        if (item.source === 'wishlist') {
          isWishlistMode = true;
          anime = {
            id: item.id,
            title: item.title,
            bangumiTitle: item.bangumiTitle || item.title,
            localCover: null,
            coverUrl: item.coverUrl || '',
            rating: item.rating || null,
            summary: item.summary || '',
            bangumiId: item.bangumiId,
            season: null,
            episodes: [],
            downloaded: false,
          };
        } else {
          isWishlistMode = false;
          anime = await api.get('/api/anime/' + encodeURIComponent(id));
        }
      } else {
        anime = await api.get('/api/anime/' + encodeURIComponent(id));
      }
      return true;
    } catch (e) {
      showToast(tr('detail.loadFailed', '加载失败：{error}', { error: e.message }), 'error');
      isSliding = false;
      return false;
    }
  }

  async function slideToAnime(id, direction) {
    if (isSliding) return;
    isSliding = true;
    const layout = document.querySelector('.detail-layout');
    const navOverlay = document.getElementById('svelte-detailNavOverlay');
    if (navOverlay) navOverlay.style.pointerEvents = 'none';
    resetDetailEnter();
    const loadPromise = loadAnimeData(id);
    const exitPromise = layout && globalThis.gsap ? new Promise((resolve) => {
      globalThis.gsap.to(layout, { x: direction === 'prev' ? 60 : -60, opacity: 0, duration: 0.15, ease: 'power2.in', onComplete: resolve });
    }) : Promise.resolve();
    const [loadOk] = await Promise.all([loadPromise, exitPromise]);
    if (!loadOk) return;
    enterActive = true;
    renderDetail();
    showContent = true;
    headerTitle = anime.bangumiTitle || anime.title;
    setEntranceDelays(0.04, 0);
    isSliding = false;
    if (navOverlay) navOverlay.style.pointerEvents = '';
  }

  function onNavLeft(e) { createRipple(e, e.currentTarget); goPrev(); }
  function onNavRight(e) { createRipple(e, e.currentTarget); goNext(); }

  // ─── Ripple ───
  function createRipple(e, zone) {
    const rect = zone.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.8;
    const x = (e.clientX || rect.left + rect.width / 2) - rect.left;
    const y = (e.clientY || rect.top + rect.height / 2) - rect.top;
    spawnRipple(zone, x, y, size);
  }
  function createRippleAt(cx, cy, container) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const size = 120;
    const x = cx - rect.left - size / 2;
    const y = cy - rect.top - size / 2;
    spawnRipple(container, x + size / 2, y + size / 2, size * 2);
  }
  function spawnRipple(parent, x, y, size) {
    const el = document.createElement('div');
    el.className = 'detail-ripple';
    el.style.cssText = `width:${size}px;height:${size}px;left:${x - size / 2}px;top:${y - size / 2}px;`;
    parent.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  // ─── 入场动画 ───
  function resetDetailEnter() {
    clearTimeout(charResizeTimer);
    document.querySelectorAll('.detail-banner-right > *, .detail-char-card, #episodeHeatmap, #watchStats')
      .forEach((el) => { el.style.transition = 'none'; el.style.transitionDelay = ''; });
    enterActive = false;
    showContent = false;
    const hero = document.getElementById('svelte-heroCover');
    if (hero) hero.remove();
    const wrap = document.getElementById('svelte-detailCover');
    if (wrap) { wrap.style.opacity = ''; wrap.style.transform = ''; wrap.style.visibility = ''; }
    document.querySelectorAll('.detail-ripple').forEach((el) => el.remove());
  }

  function setEntranceDelays(bannerStep, baseOffset) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.documentElement.dataset.reduceMotion === 'true') return;
    document.querySelectorAll('.detail-banner-right > *, .detail-char-card, #episodeHeatmap, #watchStats')
      .forEach((el) => { el.style.transition = ''; });
    const b = baseOffset || 0;
    document.querySelectorAll('.detail-banner-right > *').forEach((el, i) => {
      el.style.transitionDelay = `${b + i * bannerStep}s`;
    });
    const heatEl = document.getElementById('svelte-episodeHeatmap');
    if (heatEl) heatEl.style.transitionDelay = `${b + 0.06}s`;
    const cards = document.querySelectorAll('.detail-char-card');
    const center = (cards.length - 1) / 2;
    cards.forEach((card, i) => { card.style.transitionDelay = `${b + 0.12 + Math.abs(i - center) * 0.02}s`; });
    const stEl = document.getElementById('svelte-watchStats');
    if (stEl) stEl.style.transitionDelay = `${b + 0.18}s`;
  }

  function animateHeroCoverFlip(fromRect, fromSrc) {
    const viewEl = document.getElementById('svelte-detailView');
    const wrap = document.getElementById('svelte-detailCover');
    const img = wrap ? wrap.querySelector('img') : null;
    const toRect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    if (wrap) { wrap.style.visibility = 'hidden'; wrap.style.opacity = '0'; }
    const hero = document.createElement('div');
    hero.id = 'svelte-heroCover';
    hero.style.cssText = `
      position:fixed;z-index:100;pointer-events:none;overflow:hidden;
      left:${fromRect.left}px;top:${fromRect.top}px;
      width:${fromRect.width}px;height:${fromRect.height}px;
      border-radius:16px;background:var(--bg-card);
    `;
    if (fromSrc) {
      const clone = document.createElement('img');
      clone.src = fromSrc; clone.alt = '';
      clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      hero.appendChild(clone);
    } else if (img) {
      const clone = document.createElement('img');
      clone.src = img.src; clone.alt = img.alt || '';
      clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      hero.appendChild(clone);
    } else {
      hero.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-card);font-size:2rem;font-weight:700;color:var(--fg-muted)">' + (wrap?.textContent?.trim()?.[0] || '?') + '</div>';
    }
    document.body.appendChild(hero);
    const Flip = globalThis.Flip;
    const gsap = globalThis.gsap;
    if (Flip && gsap) {
      const state = Flip.getState(hero);
      hero.style.left = toRect.left + 'px';
      hero.style.top = toRect.top + 'px';
      hero.style.width = toRect.width + 'px';
      hero.style.height = toRect.height + 'px';
      setEntranceDelays(0.05, 0.04);
      showContent = true;
      Flip.from(state, {
        duration: 0.35, ease: 'power2.out', absolute: true,
        onComplete: () => {
          if (wrap) { wrap.style.visibility = ''; wrap.style.opacity = '1'; wrap.style.transform = ''; }
          hero.remove();
        },
      });
    } else {
      hero.remove();
      if (wrap) { wrap.style.visibility = ''; wrap.style.opacity = '1'; }
      showContent = true;
      setEntranceDelays(0.04, 0);
    }
  }

  // ─── 角色展开 / 折叠 ───
  function checkToggleOverflow(wrap, listSel, toggleSel) {
    if (!wrap) return;
    const list = wrap.querySelector(listSel);
    const toggle = wrap.querySelector(toggleSel);
    if (!list || !toggle) return;
    const hasOverflow = list.scrollHeight > list.clientHeight;
    const userToggled = wrap.dataset.userToggled === 'true';
    toggle.style.display = (hasOverflow || userToggled) ? 'inline-flex' : 'none';
  }

  function getCharGridRowHeight() {
    const grid = document.getElementById('svelte-detailCharGrid');
    if (!grid || !grid.children[0]) return 104;
    const card = grid.children[0];
    return card.offsetHeight + 8;
  }

  function initToggleChecks() {
    const tagsEl = document.getElementById('svelte-detailTags');
    const charWrap = document.getElementById('svelte-detailCharWrap');
    if (tagsEl) checkToggleOverflow(tagsEl, '.detail-tags-list', '.detail-tag-toggle');
    if (charWrap) checkToggleOverflow(charWrap, '.detail-char-grid', '.detail-char-toggle');
  }

  function toggleExpand(wrapId) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    const isExpanding = !wrap.classList.contains('expanded');
    wrap.classList.toggle('expanded');
    wrap.dataset.userToggled = 'true';
    if (wrapId === 'svelte-detailCharWrap') {
      const grid = wrap.querySelector('.detail-char-grid');
      if (grid) {
        if (isExpanding) {
          grid.style.overflow = '';
          grid.style.maxHeight = MAX_GRID_HEIGHT + 'px';
        } else {
          measureAndBalance(wrap);
        }
      }
    }
    setTimeout(() => {
      if (wrapId === 'svelte-detailTags') checkToggleOverflow(wrap, '.detail-tags-list', '.detail-tag-toggle');
      if (wrapId === 'svelte-detailCharWrap') checkToggleOverflow(wrap, '.detail-char-grid', '.detail-char-toggle');
    }, 50);
  }

  function expandTags() {
    const tagsEl = document.getElementById('svelte-detailTags');
    if (!tagsEl || !_allTags) return;
    const studioHtml = _studioHtml || '';
    tagsHtml = `<div class="detail-tags-list">${studioHtml}${_allTags.map((t) => `<span class="tag-pill"${t.desc ? ` data-tooltip="${escAttr(t.desc)}" data-tooltip-rich` : ''}>${escHtml(t.name)}</span>`).join('')}</div>`;
  }

  function autoExpandCharacters() {
    const charWrap = document.getElementById('svelte-detailCharWrap');
    if (!charWrap) return;
    if (charWrap.dataset.userToggled === 'true') return;
    measureAndBalance(charWrap);
    updateToggleVisibility(charWrap);
  }

  function measureAndBalance(wrap) {
    const grid = wrap.querySelector('.detail-char-grid');
    const rowH = getCharGridRowHeight();
    const totalItems = grid.children.length;
    const maxRows = Math.ceil(totalItems / 3);
    const targetRows = Math.min(3, maxRows);
    if (targetRows >= maxRows) {
      wrap.classList.add('expanded');
      grid.style.overflow = '';
      grid.style.maxHeight = MAX_GRID_HEIGHT + 'px';
    } else {
      wrap.classList.remove('expanded');
      grid.style.overflow = 'hidden';
      grid.style.maxHeight = (rowH * targetRows) + 'px';
    }
  }

  function updateToggleVisibility(wrap) {
    checkToggleOverflow(wrap, '.detail-char-grid', '.detail-char-toggle');
  }

  function waitForCharImages(grid) {
    const imgs = grid.querySelectorAll('.detail-char-avatar');
    if (!imgs.length) return Promise.resolve();
    const timeout = new Promise((r) => setTimeout(r, 3000));
    const loadAll = Promise.all(Array.from(imgs).map((img) =>
      img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
    ));
    return Promise.race([loadAll, timeout]);
  }

  // ─── 渲染后 DOM 操作 ───
  $effect(() => {
    if (renderVersion > 0) postRender();
  });

  function postRender() {
    if (!anime) return;
    initToggleChecks();
    setTimeout(initToggleChecks, 100);
    setTimeout(initToggleChecks, 300);
    setTimeout(initToggleChecks, 600);

    // Episode grid
    const grid = document.getElementById('svelte-episodeHeatmapGrid');
    if (grid) {
      initScrollDots({ scroll: grid, cardSelector: '.episode-card', total: anime.episodes?.length || 0, dotsParent: document.querySelector('.episode-list-header') });
      // scroll to target
      let scrollEp = null;
      if (anime.lastPlayedEp) {
        const lastEp = anime.episodes.find((e) => e.number === anime.lastPlayedEp);
        if (lastEp && (!lastEp.watched || lastEp.progress > 0)) scrollEp = lastEp;
        else if (lastEp) { for (let i = 0; i < anime.episodes.length; i++) { if (!anime.episodes[i].watched) { scrollEp = anime.episodes[i]; break; } } }
      }
      if (scrollEp) {
        const scrollIdx = anime.episodes.indexOf(scrollEp);
        const scrollCard = grid.querySelector('.episode-card[data-index="' + scrollIdx + '"]');
        if (scrollCard) {
          requestAnimationFrame(() => {
            const cs = getComputedStyle(grid);
            const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
            const step = (grid.querySelector('.episode-card') || scrollCard).offsetWidth + gap;
            grid.scrollLeft = Math.max(0, scrollIdx * step);
          });
        }
      }
      // thumb observer
      if (_episodeThumbObserver) _episodeThumbObserver.disconnect();
      const thumbEls = grid.querySelectorAll('.episode-card-bg[data-src]');
      if ('IntersectionObserver' in window && thumbEls.length > 0) {
        _episodeThumbObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const el = entry.target;
              const src = el.getAttribute('data-src');
              if (src) { el.style.backgroundImage = 'url("' + src + '")'; el.removeAttribute('data-src'); }
              _episodeThumbObserver.unobserve(el);
            }
          }
        }, { root: grid, rootMargin: '100px' });
        thumbEls.forEach((el) => _episodeThumbObserver.observe(el));
      } else {
        thumbEls.forEach((el) => { const src = el.getAttribute('data-src'); if (src) { el.style.backgroundImage = 'url("' + src + '")'; el.removeAttribute('data-src'); } });
      }
      // event delegation
      grid.onclick = (e) => {
        const card = e.target.closest('.episode-card');
        if (!card) return;
        const playBtn = e.target.closest('.episode-card-play');
        if (playBtn) { e.stopPropagation(); playEpisode(playBtn.dataset.path, parseFloat(playBtn.dataset.pos) || 0); return; }
        playEpisode(card.dataset.path, parseFloat(card.dataset.pos) || 0);
      };
      grid.oncontextmenu = (e) => {
        const card = e.target.closest('.episode-card');
        if (!card) return;
        e.preventDefault();
        e.stopPropagation();
        const epNumber = parseInt(card.dataset.ep);
        const ep = anime.episodes.find((x) => x.number === epNumber);
        if (!ep) return;
        toggleWatched(anime.id, epNumber, !ep.watched);
      };
    }

    // Character grid
    const charGrid = document.getElementById('svelte-detailCharGrid');
    if (charGrid) {
      charGrid.querySelectorAll('.detail-char-avatar').forEach((img) => { img.onerror = () => charAvatarFallback(); });
      waitForCharImages(charGrid).then(() => {
        if ($detailOpen) autoExpandCharacters();
      });
    }

    // Watch stats
    buildWatchStats();

    // Relations / recommendations scroll dots
    const relScroll = document.getElementById('svelte-relationScroll');
    if (relScroll) initScrollDots({ scroll: relScroll, cardSelector: '.relation-card', total: relationsCount, dotsParent: document.querySelector('#svelte-detailRelations .detail-section-header') });
    const recScroll = document.getElementById('svelte-recommendationScroll');
    if (recScroll) initScrollDots({ scroll: recScroll, cardSelector: '.relation-card', total: recsCount, dotsParent: document.querySelector('#svelte-detailRecommendations .detail-section-header') });

    requestAnimationFrame(autoExpandCharacters);
  }

  // ─── 全局播放结束回调（桥接 app.js）───
  window.handleDetailPlaybackEnded = function (endedAnimeId) {
    if (!anime) return false;
    if (endedAnimeId && anime.id !== endedAnimeId) return false;
    api.get('/api/anime/' + encodeURIComponent(anime.id)).then((updated) => {
      anime = updated;
      renderDetail();
      checkAndShowFinishConfirm(anime);
      const allDone = anime.episodes && anime.episodes.length > 0 && anime.episodes.every((e) => e.watched);
      if (allDone && anime.myListStatus === 'completed') {
        showToast(tr('detail.playEndedAllWatched', '全部剧集已看完'), 'success');
        return;
      }
      showToast(tr('detail.playEndedUpdated', '观看进度已更新'), 'success');
    });
    return true;
  };

  // ─── 桥接内联 onclick 用到的全局函数 ───
  if (typeof window !== 'undefined') {
    window.expandTags = expandTags;
    window.charAvatarFallback = charAvatarFallback;
    window.attachBangumiSubject = attachBangumiSubject;
    window.openExternalUrl = openExternalUrl;
  }

  // ─── 键盘 / 鼠标 / 窗口监听 ───
  onMount(() => {
    function onMouseUp(e) {
      if (!globalThis.currentView || globalThis.currentView !== 'detail') return;
      if (e.button === 3) {
        e.preventDefault();
        createRippleAt(e.clientX, e.clientY, document.getElementById('svelte-detailNavOverlay'));
        goBack();
      }
    }
    function onKey(e) {
      if (!globalThis.currentView || globalThis.currentView !== 'detail') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'Escape') { goBack(); }
    }
    function onResize() {
      clearTimeout(charResizeTimer);
      charResizeTimer = setTimeout(() => {
        if (anime && $detailOpen) {
          const wrap = document.getElementById('svelte-detailCharWrap');
          if (wrap && wrap.dataset.userToggled !== 'true') autoExpandCharacters();
        }
      }, 300);
    }
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  });
</script>

<section
  class="view"
  id="svelte-detailView"
  class:hidden={!$detailOpen}
  class:detail-enter-active={enterActive}
  class:show-content={showContent}
  class:detail-no-banner={noBanner}
>
  <div class="detail-nav-overlay" id="svelte-detailNavOverlay">
    <div class="detail-nav-zone detail-nav-left" id="navLeft" onclick={onNavLeft}>
      <svg class="detail-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </div>
    <div class="detail-nav-zone detail-nav-right" id="navRight" onclick={onNavRight}>
      <svg class="detail-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  </div>
  <div class="detail-content">
    <div id="headerTitle" style="display:none">{headerTitle}</div>
    {#if bannerHtml}
      <div class="detail-banner-bg">{@html bannerHtml}</div>
    {/if}
    <div class="detail-banner">
      <div class="detail-banner-left">
        <div class="detail-cover-wrap" id="svelte-detailCover">{@html coverHtml}</div>
        <div class="detail-actions">
          <button class="btn btn-outline" id="btnPlayAnime" style:display={playBtnVisible ? 'inline-flex' : 'none'} onclick={playEpisodeFromCover}><span id="btnPlayText">{playBtnText}</span></button>
          <button class="btn btn-ghost" id="btnFetchBangumi" style:display={fetchBtnVisible ? 'inline-flex' : 'none'} onclick={syncBangumiMetadata}>{tr('common.sync', '同步')}</button>
          <button class="btn btn-danger" id="btnDeleteAnime" style:display={deleteBtnVisible ? 'inline-flex' : 'none'} onclick={deleteAnime}>{tr('common.remove', '移除')}</button>
        </div>
      </div>
      <div class="detail-banner-right">
        <h1 id="detailTitle">{title}</h1>
        <div id="detailAlias" class="detail-alias" style:display={aliasVisible ? '' : 'none'}>{alias}</div>
        <div class="detail-info-line" id="detailInfoLine" style:display={infoLineVisible ? '' : 'none'}>{@html infoLineHtml}</div>
        <div class="detail-tags" id="svelte-detailTags" style:display={tagsVisible ? '' : 'none'}>{@html tagsHtml}</div>
        <p id="detailSummary" class="detail-summary">{summary}</p>
      </div>
    </div>
    <div class="episode-list-section hscroll-section" id="svelte-episodeHeatmap" style:display={episodeHeatmapVisible ? '' : 'none'}>
      <div class="episode-list-header">
        <div class="episode-header-left">
          <h3>{tr('detail.episodeList', '剧集列表')}</h3>
          <span class="episode-count" id="episodeCount">{episodeCount}</span>
        </div>
      </div>
      <div class="episode-list-scroll" id="svelte-episodeHeatmapGrid">{@html episodeGridHtml}</div>
    </div>

    <div class="detail-characters" id="detailCharacters" style:display={detailCharactersVisible ? '' : 'none'}>
      <div class="detail-section-header">
        <h3>{tr('detail.characters', '角色·声优')}</h3>
      </div>
      <div class="detail-char-wrap" id="svelte-detailCharWrap">
        <div class="detail-char-grid" id="svelte-detailCharGrid">{@html charGridHtml}</div>
        <button class="detail-char-toggle" onclick={() => toggleExpand('svelte-detailCharWrap')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
      </div>
    </div>
    <div class="watch-stats" id="svelte-watchStats" style:display={watchStatsVisible ? '' : 'none'}>
      <div class="ws-header"><h3>{tr('detail.watchStats', '观看统计')}</h3></div>
      <div class="ws-body" id="svelte-watchStatsContent">{@html watchStatsHtml}</div>
    </div>
    <div id="svelte-detailRelations" class="detail-section hscroll-section" style:display={relationsVisible ? '' : 'none'}>
      <div class="detail-section-header">
        <span class="detail-section-title">{tr('detail.related', '关联作品')}</span>
      </div>
      <div class="hscroll" id="svelte-relationScroll" style="gap: calc(0.75rem * var(--scale)); padding: calc(0.25rem * var(--scale)) 0 calc(0.5rem * var(--scale)) 0">{@html relationsHtml}</div>
    </div>
    <div id="svelte-detailRecommendations" class="detail-section hscroll-section" style:display={recsVisible ? '' : 'none'}>
      <div class="detail-section-header">
        <span class="detail-section-title">{tr('detail.recommendations', '推荐')}</span>
      </div>
      <div class="hscroll" id="svelte-recommendationScroll" style="gap: calc(0.75rem * var(--scale)); padding: calc(0.25rem * var(--scale)) 0 calc(0.5rem * var(--scale)) 0">{@html recsHtml}</div>
    </div>
    <div class="archive-magazine" id="archiveDetail" style:display={archiveVisible ? '' : 'none'}>{@html archiveHtml}</div>
  </div>
</section>

{#if syncOpen}
  <div class="modal-overlay" id="syncModal">
    <div class="modal modal--large">
      <h2>{tr('detail.syncMetadata', '同步元数据')}</h2>
      <div class="form-group">
        <label for="syncKeyword">{tr('detail.searchKeyword', '搜索关键词')}</label>
        <div class="flex gap-2">
          <input type="text" id="syncKeyword" placeholder={tr('detail.searchPlaceholder', '输入搜索词...')} class="flex-1 min-w-0" bind:value={syncKeyword}>
          <button class="btn btn-primary" onclick={searchBangumiWithKeyword}>{tr('common.search', '搜索')}</button>
        </div>
      </div>
      <div class="bangumi-search-results" id="syncSearchResults">{@html syncResultsHtml}</div>
      <button class="modal-close-btn" onclick={() => (syncOpen = false)}>✕</button>
    </div>
  </div>
{/if}