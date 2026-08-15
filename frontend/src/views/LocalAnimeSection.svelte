<script>
  // ─── LocalAnimeSection（Svelte 迁移 Chunk C）───
  // Library 的「本地动漫模块」投影组件。只认 props，不查全局数组。
  import { onDestroy, tick } from 'svelte';
  import StatusSection from '../components/StatusSection.svelte';
  import AnimeCard from '../components/AnimeCard.svelte';
  import { STATUS_LABELS, ANIME_SORT_OPTIONS, sortAnimeItems } from '../lib/sort.js';
  import { STATUS_SECTIONS_LIBRARY, getCardTitleVisible, navigateToDetail } from '../lib/anime-utils.js';
  import { Select } from 'bits-ui';

  let {
    items,
    gridCols,
    onOpenDetail = (item, e) => navigateToDetail(item.id, e.currentTarget, 'library'),
    onOpenContextMenu,
    onOpenStatus,
  } = $props();

  // ─── i18n 辅助（复用全局 t()，回退文案）───
  function tr(key, fallback, options) {
    return typeof globalThis.t === 'function' ? globalThis.t(key, options) : fallback;
  }

  // ─── 排序 ───
  let sortMode = $state(localStorage.getItem('librarySort') || 'name');
  // bits-ui Select 内部管理 open/键盘导航/焦点；这里仅持久化选择。
  $effect(() => {
    localStorage.setItem('librarySort', sortMode);
  });

  // ─── 状态分区 ───
  const sections = $derived(
    STATUS_SECTIONS_LIBRARY.map((status) => ({
      status,
      label: STATUS_LABELS[status] || status,
      items: sortAnimeItems(
        items.filter((a) => (a.myListStatus || 'wish') === status),
        sortMode
      ),
    }))
  );

  // ─── 卡片级：状态网格卡片 ScrollTrigger 视口渐显（原 Library.svelte 逻辑迁入）───
  // 适配动态网格（auto-fit 列数/卡片数不定）：每个网格建一个 ScrollTrigger，
  // 网格进入视口时卡片交错渐显（once:true）。数据重载/排序后先 kill 旧触发器再重建。
  let cardTriggers = [];
  $effect(() => {
    void sections;
    const gsap = globalThis.gsap;
    if (!gsap || !gsap.ScrollTrigger) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    tick().then(() => {
      // 清理旧触发器，避免重复触发/泄漏
      cardTriggers.forEach((t) => t.kill());
      cardTriggers = [];
      if (reduce) return; // 减少动态效果：跳过动画，卡片直接显示
      const scroller = document.querySelector('.main-content');
      if (!scroller) return;
      const grids = document.querySelectorAll('#svelte-libraryView .status-section .grid-container');
      grids.forEach((grid) => {
        const cards = grid.querySelectorAll('.anime-card');
        if (!cards.length) return;
        const tween = gsap.fromTo(
          cards,
          { autoAlpha: 0, y: 24 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.5,
            ease: 'power2.out',
            stagger: 0.05,
            scrollTrigger: { trigger: grid, start: 'top 92%', once: true, scroller },
          }
        );
        if (tween.scrollTrigger) cardTriggers.push(tween.scrollTrigger);
      });
    });
  });

  onDestroy(() => {
    cardTriggers.forEach((t) => t.kill());
    cardTriggers = [];
  });
</script>

<div class="dashboard-section" data-section="localLibrary">
  <div class="dashboard-section-header">
    <span class="dashboard-section-title">{tr('library.localAnime')}</span>
    <div class="library-sort-bar">
      <Select.Root type="single" bind:value={sortMode}>
        <Select.Trigger class="library-sort-trigger" aria-label={tr('mylist.sort')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M6 12h12M9 18h6"/></svg>
        </Select.Trigger>
        <Select.Content class="library-sort-menu" align="end">
          {#each ANIME_SORT_OPTIONS as o (o.key)}
            <Select.Item value={o.key}>
              {#snippet child(p)}
                <div {...p.props} class="library-sort-option" class:active={p.selected}>{o.label}</div>
              {/snippet}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>
  <div class="dashboard-section-body">
    {#each sections as cfg}
      {#if cfg.items.length > 0}
        <StatusSection variant="library" label={cfg.label} items={cfg.items} {gridCols}>
          {#snippet children(item)}
            <AnimeCard
              {item}
              alwaysShowTitle={getCardTitleVisible('library')}
              onClick={onOpenDetail}
              onContextMenu={onOpenContextMenu}
              onMore={onOpenStatus}
            />
          {/snippet}
        </StatusSection>
      {/if}
    {/each}
  </div>
</div>