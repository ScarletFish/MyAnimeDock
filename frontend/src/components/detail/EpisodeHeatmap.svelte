<script>
  // ─── 剧集横向滚动列表（声明式）───
  // 根元素保留 id="svelte-episodeHeatmapGrid"（CSS/选择器契约）。
  // 缩略图全量预加载：首帧可见的立即加载，其余动画结束后（350ms）批量加载（见 loadVisibleThumbs）。
  // 写 inline style，满足 detail-episodes.css:88 opacity 规则。
  import { onMount } from 'svelte';
  import { initScrollDots } from '../../lib/scroll-dots.js';
  import { tr } from '../../lib/anime-utils.js';

  let { anime = null, episodes = [], lastPlayedEp = null, onPlay, onToggleWatched } = $props();

  let gridEl = $state(null);

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
  // 暴露给父组件：数据刷新后重定位（vanilla renderEpisodeHeatmap 的对应行为）
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

  onMount(() => {
    if (!gridEl) return;
    // I4: 每次渲染重置滚动位置
    gridEl.scrollLeft = 0;
    initScrollDots({
      scroll: gridEl,
      cardSelector: '.episode-card',
      total: episodes.length,
      dotsParent: document.querySelector('#svelte-episodeHeatmap .episode-list-header'),
    });
    // 剧集列表是首屏模块：按当前集数索引优先加载视口内的缩略图，其余延迟到
    // 封面入场动画结束后批量加载（本地缓存命中 4-22ms，滚动不再逐张等 IO 触发）。
    const startIdx = scrollToLastPosition();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        loadVisibleThumbs(startIdx);
        setTimeout(loadAllThumbs, 350);
      });
    });
  });

  // 按当前集数索引加载视口内卡片（最精准，不依赖几何测量）。
  // startIdx 为 scrollToLastPosition 定位的目标索引；无观看记录时为 -1（视口在最左）。
  function loadVisibleThumbs(startIdx) {
    if (!gridEl) return;
    const cards = Array.from(gridEl.querySelectorAll('.episode-card'));
    if (cards.length === 0) return;
    const cs = getComputedStyle(gridEl);
    const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
    const step = cards[0].offsetWidth + gap;
    const visibleCount = Math.max(1, Math.ceil(gridEl.clientWidth / step));
    // 往前多包含一集，避免往回滚动时缺图
    const from = Math.max(0, (startIdx >= 0 ? startIdx : 0) - 1);
    const to = Math.min(cards.length, from + visibleCount + 1);
    for (let i = from; i < to; i++) {
      const bg = cards[i].querySelector('.episode-card-bg[data-src]');
      if (bg) applyThumb(bg);
    }
  }

  function loadAllThumbs() {
    if (!gridEl) return;
    gridEl.querySelectorAll('.episode-card-bg[data-src]').forEach((bg) => applyThumb(bg));
  }

  function applyThumb(el) {
    const src = el.dataset.src;
    if (!src) return;
    el.style.backgroundImage = 'url("' + src + '")';
    el.removeAttribute('data-src');
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
      <div
        class="episode-card"
        data-index={idx}
        data-ep={ep.number}
        onclick={() => onPlay(ep.filePath, ep.progress || 0)}
        oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); onToggleWatched(ep.number, !ep.watched); }}
      >
        <div class="episode-card-thumb">
          <div class="episode-card-bg" data-src={thumbUrl}></div>
          <div class="episode-card-overlay"></div>
          <div class="episode-card-num">{epNum}</div>
          <button class="episode-card-play" onclick={(e) => { e.stopPropagation(); onPlay(ep.filePath, ep.progress || 0); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
          </button>
        </div>
        <div class="episode-card-info">
          <div class="episode-card-title" data-tooltip={epTitle}>{epTitle}</div>
        </div>
      </div>
    {/each}
  {/if}
</div>