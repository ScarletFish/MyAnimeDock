<script>
  // ─── 剧集横向滚动列表（声明式）───
  // 根元素保留 id="svelte-episodeHeatmapGrid"（CSS/选择器契约）。
  // 懒加载背景用 lazyBg action（写 inline style，满足 detail-episodes.css:88 opacity 规则）。
  import { onMount } from 'svelte';
  import { initScrollDots } from '../../lib/scroll-dots.js';
  import { lazyBg } from '../../lib/lazy-bg.js';

  let { anime = null, episodes = [], lastPlayedEp = null, onPlay, onToggleWatched } = $props();

  let gridEl = $state(null);

  function tr(key, fallback, options) {
    return typeof globalThis.t === 'function' ? globalThis.t(key, options) : fallback;
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
  // 暴露给父组件：数据刷新后重定位（vanilla renderEpisodeHeatmap 的对应行为）
  export function scrollToLastPosition() {
    if (!gridEl) return;
    let scrollEp = null;
    if (lastPlayedEp) {
      const lastEp = episodes.find((e) => e.number === lastPlayedEp);
      if (lastEp && (!lastEp.watched || lastEp.progress > 0)) scrollEp = lastEp;
      else if (lastEp) { for (let i = 0; i < episodes.length; i++) { if (!episodes[i].watched) { scrollEp = episodes[i]; break; } } }
    }
    if (!scrollEp) return;
    const scrollIdx = episodes.indexOf(scrollEp);
    if (scrollIdx === -1) return;
    requestAnimationFrame(() => {
      if (!gridEl) return;
      const card = gridEl.querySelector('.episode-card[data-index="' + scrollIdx + '"]');
      if (!card) return;
      const cs = getComputedStyle(gridEl);
      const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 14;
      const step = (gridEl.querySelector('.episode-card') || card).offsetWidth + gap;
      gridEl.scrollLeft = Math.max(0, scrollIdx * step);
    });
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
    scrollToLastPosition();
  });
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
          <div class="episode-card-bg" data-src={thumbUrl} use:lazyBg></div>
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