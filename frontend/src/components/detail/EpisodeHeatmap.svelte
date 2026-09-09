<script>
  // ─── 剧集横向滚动列表（声明式）───
  // 根元素保留 id="svelte-episodeHeatmapGrid"（CSS/选择器契约）。
  // 缩略图全量预加载：首帧可见的立即加载，其余动画结束后（350ms）批量加载（见 loadVisibleThumbs）。
  // 写 inline style，满足 detail-episodes.css:88 opacity 规则。
  import { onMount, onDestroy } from 'svelte';
  import { initScrollDots } from '../../lib/scroll-dots.js';
  import { tr } from '../../lib/anime-utils.js';
  import { __debug } from '../../lib/debug.js';
  import { watchThumb, onWarmMiss } from '../../lib/thumb-manager.js';

  let { anime = null, episodes = [], lastPlayedEp = null, onPlay, onToggleWatched, onDeleteEpisode } = $props();

  let gridEl = $state(null);

  // ─── Warm-miss 汇总（调试旁路：202 计数一次性打，不逐张刷屏）───
  let warmMissCount = 0;
  let _warmMissFirstLogged = false;
  let _warmMissTimer = null;
  let _unregWarmMiss = null;

  function handleWarmMiss() {
    if (!__debug.enabled) return; // 调试关闭时零额外工作
    warmMissCount++;
    if (!_warmMissFirstLogged) {
      _warmMissFirstLogged = true;
      __debug.log('heatmap', 'warm-miss', { count: warmMissCount, ms: __debug.ms() });
    }
    if (_warmMissTimer === null) {
      _warmMissTimer = setTimeout(() => {
        _warmMissTimer = null;
        if (warmMissCount > 0) __debug.log('heatmap', 'warm-miss', { count: warmMissCount, ms: __debug.ms() });
      }, 2000);
    }
  }

  function handleCardClick(ep) {
    if (!ep.missing) {
      // 正常集：播放
      onPlay(ep.filePath, ep.progress || 0);
      return;
    }
    // 缺失集：单击 → 父组件弹确认框后删除
    onDeleteEpisode?.(ep.number);
  }

  function handleCardContext(e, ep) {
    e.preventDefault();
    e.stopPropagation();
    // 缺失集：右键不操作
    if (ep.missing) return;
    onToggleWatched(ep.number, !ep.watched);
  }

  // 暴露给父组件：滚动到指定索引（playEpisodeFromCover 用）
  export function scrollToIndex(idx) {
    if (!gridEl || idx < 0) return;
    const card = gridEl.querySelector('.episode-card[data-index="' + idx + '"]');
    if (!card) return;
    const cs = getComputedStyle(gridEl);
    const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
    const step = card.offsetWidth + gap;
    gridEl.scrollTo({ left: Math.max(0, idx * step), behavior: 'smooth' });
  }

  // 暴露给父组件：滚动到指定集之后的第一个未观看（checkAndShowFinishConfirm 用）
  export function scrollToNextUnwatched(a, afterEpNumber) {
    if (!gridEl || !a.episodes) return;
    let nextEp = null;
    for (let i = 0; i < a.episodes.length; i++) {
      const e = a.episodes[i];
      if (e.number > afterEpNumber && !e.watched) { nextEp = e; break; }
    }
    if (!nextEp) nextEp = a.episodes[a.episodes.length - 1];
    const idx = a.episodes.indexOf(nextEp);
    if (idx === -1) return;
    scrollToIndex(idx);
  }

  // 滚动到目标剧集：lastPlayedEp 有进度→滚到它；已看完→滚到下一未观看；没有→不动
  // 暴露给父组件：数据刷新后重定位
  export function scrollToLastPosition() {
    if (!gridEl) return -1;
    let scrollEp = null;
    if (lastPlayedEp) {
      const lastEp = episodes.find((e) => e.number === lastPlayedEp);
      if (lastEp && (!lastEp.watched || lastEp.progress > 0)) scrollEp = lastEp;
      else if (lastEp) { for (let i = 0; i < episodes.length; i++) { if (!episodes[i].watched) { scrollEp = episodes[i]; break; } } }
    }
    if (!scrollEp) return -1;
    const scrollIdx = episodes.indexOf(scrollEp);
    if (scrollIdx === -1) return -1;
    requestAnimationFrame(() => {
      if (!gridEl) return;
      const card = gridEl.querySelector('.episode-card[data-index="' + scrollIdx + '"]');
      if (!card) return;
      const cs = getComputedStyle(gridEl);
      const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
      const step = (gridEl.querySelector('.episode-card') || card).offsetWidth + gap;
      gridEl.scrollLeft = Math.max(0, scrollIdx * step);
    });
    return scrollIdx;
  }

  // 每次渲染/数据刷新后重定位到目标剧集。
  // onMount 只跑一次，重进入详情页组件不重建，定位必须挂在 $effect 上。
  // 双 rAF：等容器可见 + scroll-dots 写完 --cols（布局稳定）后再定位 ——
  // 否则 display:none 恢复首帧按旧布局换算，scrollLeft 会逐次塌缩减半。
  let settleRun = 0;
  $effect(() => {
    const eps = episodes;
    if (!gridEl || !eps || eps.length === 0) return;
    const _lastEp = lastPlayedEp; // 依赖：lastPlayedEp 变化也重定位
    const runId = ++settleRun;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (settleRun !== runId) return;
      const startIdx = scrollToLastPosition();
      loadVisibleThumbs(startIdx);
      __debug.log('heatmap', 'schedule-load-all', { ms: __debug.ms(), n: episodes.length });
      setTimeout(() => {
        __debug.log('heatmap', 'load-all-thumbs', { ms: __debug.ms(), n: episodes.length });
        loadAllThumbs();
      }, 350);
    }));
  });

  onMount(() => {
    __debug.log('heatmap', 'mount', { ms: __debug.ms(), eps: episodes.length });
    // Warm-miss 汇总监听（只能在 onMount 注册，onDestroy 注销）
    warmMissCount = 0;
    _warmMissFirstLogged = false;
    if (_warmMissTimer !== null) { clearTimeout(_warmMissTimer); _warmMissTimer = null; }
    _unregWarmMiss = onWarmMiss(handleWarmMiss);
    if (!gridEl) return;
    // I4: 每次渲染重置滚动位置（真实定位见上方 $effect，双 rAF 等布局稳定）
    gridEl.scrollLeft = 0;
    initScrollDots({
      scroll: gridEl,
      cardSelector: '.episode-card',
      total: episodes.length,
      dotsParent: document.querySelector('#svelte-episodeHeatmap .episode-list-header'),
    });
  });

  onDestroy(() => {
    if (_unregWarmMiss) { _unregWarmMiss(); _unregWarmMiss = null; }
    if (_warmMissTimer !== null) { clearTimeout(_warmMissTimer); _warmMissTimer = null; }
  });

  // 按当前集数索引加载视口内卡片（最精准，不依赖几何测量）。
  // startIdx 为 scrollToLastPosition 定位的目标索引；无观看记录时为 -1（视口在最左）。
  // 加载 0..startIdx+视口 的全部前序：入场动画 / scrollToIndex 平滑滚动经过的卡片都有图，
  // 杜绝空白占位。350ms 后的 loadAllThumbs 会跳过已加载项（data-src 已移除），
  // 首帧提前发的请求只是时间提前，总量不变（本地缓存命中 4-22ms）。
  function loadVisibleThumbs(startIdx) {
    if (!gridEl) return;
    const cards = Array.from(gridEl.querySelectorAll('.episode-card'));
    if (cards.length === 0) return;
    const cs = getComputedStyle(gridEl);
    const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
    const step = cards[0].offsetWidth + gap;
    const visibleCount = Math.max(1, Math.ceil(gridEl.clientWidth / step));
    const to = Math.min(cards.length, (startIdx >= 0 ? startIdx : 0) + visibleCount + 1);
    for (let i = 0; i < to; i++) {
      const bg = cards[i].querySelector('.episode-card-bg[data-src]');
      if (bg) applyThumb(bg);
    }
  }

  function loadAllThumbs() {
    if (!gridEl) return;
    gridEl.querySelectorAll('.episode-card-bg[data-src]').forEach((bg) => applyThumb(bg));
  }

  // 缩略图改为「就绪才加载」：warm 触发服务端调度（202 不挂等），由 thumb-manager 轮询
  // status 直到 ready/missing 后才设置 src，避免生成中误判缺失。
  function applyThumb(el) {
    const src = el.dataset.src;
    if (!src) return;
    const filePath = el.dataset.path;
    if (!filePath) return;
    watchThumb({
      path: filePath,
      time: el.dataset.time || 'mid',
      onReady: (url) => {
        el.removeAttribute('data-src');
        el.src = url;
      },
      onMissing: () => {
        el.removeAttribute('data-src');
        el.closest('.episode-card-thumb')?.classList.add('is-missing');
      },
    });
  }
</script>

<div class="episode-list-scroll" id="svelte-episodeHeatmapGrid" bind:this={gridEl}>
  {#if episodes.length === 0}
    <p class="text-content-muted p-4 text-center">{tr('detail.noEpisodeInfo')}</p>
  {:else}
    {#each episodes as ep, idx (ep.number)}
      {@const epTitle = ep.fileName || tr('detail.episodeNumber', { number: ep.number })}
      {@const thumbUrl = '/api/thumbnail?path=' + encodeURIComponent(ep.filePath) + '&time=mid'}
      {@const epNum = String(ep.number).padStart(2, '0')}
      {@const epPct = ep.progress > 0 && !ep.watched && ep.duration > 0 ? Math.min(100, Math.max(0, Math.round(ep.progress / ep.duration * 100))) : 0}
      {@const isMissing = !!ep.missing}
      <div
        class="episode-card{isMissing ? ' is-missing-card' : ''}"
        data-index={idx}
        data-ep={ep.number}
        onclick={() => handleCardClick(ep)}
        oncontextmenu={(e) => handleCardContext(e, ep)}
      >
        <div class="episode-card-thumb{isMissing ? ' is-missing' : ''}">
          {#if !isMissing}
            <img class="episode-card-bg" data-src={thumbUrl} data-path={ep.filePath} data-time="mid" alt=""
                 onload={(e) => e.currentTarget.removeAttribute('data-src')}
                 onerror={(e) => e.currentTarget.removeAttribute('data-src')} />
          {/if}
          <div class="episode-card-missing" aria-hidden="true">
            <!-- 默认占位：花瓣 -->
            <svg class="episode-card-missing-petal" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
              <g transform="rotate(0 24 24)"><ellipse cx="24" cy="15" rx="6.5" ry="11"/></g>
              <g transform="rotate(72 24 24)"><ellipse cx="24" cy="15" rx="6.5" ry="11"/></g>
              <g transform="rotate(144 24 24)"><ellipse cx="24" cy="15" rx="6.5" ry="11"/></g>
              <g transform="rotate(216 24 24)"><ellipse cx="24" cy="15" rx="6.5" ry="11"/></g>
              <g transform="rotate(288 24 24)"><ellipse cx="24" cy="15" rx="6.5" ry="11"/></g>
              <circle cx="24" cy="24" r="4.2" fill="var(--bg-surface)"/>
            </svg>
            <!-- hover 可删信号：垃圾桶取代花瓣（点击卡片弹确认框） -->
            <svg class="episode-card-missing-trash" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </div>
          <div class="episode-card-overlay"></div>
          <div class="episode-card-num">{epNum}</div>
          {#if ep.watched && !isMissing}
            <div class="episode-card-watched">{tr('detail.watchedTag')}</div>
          {/if}
          {#if epPct > 0 && !isMissing}
            <div class="episode-card-progress-bar"><div class="episode-card-progress-fill" style="width: {epPct}%"></div></div>
          {/if}
          {#if !isMissing}
            <button class="episode-card-play" onclick={(e) => { e.stopPropagation(); onPlay(ep.filePath, ep.progress || 0); }}>
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
            </button>
          {/if}
        </div>
        <div class="episode-card-info">
          <div class="episode-card-title" data-tooltip={epTitle}>{epTitle}</div>
        </div>
      </div>
    {/each}
  {/if}
</div>
