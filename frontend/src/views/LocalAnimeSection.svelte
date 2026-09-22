<script>
  // ─── LocalAnimeSection ───
  // Library 的「本地动漫模块」投影组件。只认 props，不查全局数组。
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import StatusSection from '../components/StatusSection.svelte';
  import AnimeCard from '../components/AnimeCard.svelte';
  import { getStatusLabels, getAnimeSortOptions, sortAnimeItems } from '../lib/sort.js';
  import { STATUS_SECTIONS_LIBRARY, navigateToDetail, tr } from '../lib/anime-utils.js';
  import { cardTitleLibrary, librarySortMode } from '../lib/ui-state.js';
  import { createScrollAnim } from '../lib/scroll-anim.js';
  import { libraryOpen } from './Library.svelte';
  import { Select } from 'bits-ui';

  let {
    items,
    gridCols,
    onOpenDetail = (item, e) => navigateToDetail(item.id, e.currentTarget, 'library'),
    onOpenContextMenu,
    onOpenStatus,
  } = $props();

  // ─── 卡片标题常显（响应 Settings 变更）───
  let alwaysShowTitle = $state(false);
  const unsubCardTitle = cardTitleLibrary.subscribe((v) => { alwaysShowTitle = v; });
  onDestroy(unsubCardTitle);

  // ─── 排序（绑定全局 store，Detail 左右导航依赖此值）───
  let sortMode = $state(get(librarySortMode));
  const unsubSort = librarySortMode.subscribe((v) => { sortMode = v; });
  onDestroy(unsubSort);
  // bits-ui Select 内部管理 open/键盘导航/焦点；变更写回 store。
  $effect(() => {
    librarySortMode.set(sortMode);
  });

  // ─── 状态分区 ───
  const sections = $derived(
    STATUS_SECTIONS_LIBRARY.map((status) => ({
      status,
      label: getStatusLabels()[status] || status,
      items: sortAnimeItems(
        items.filter((a) => (a.status ?? 'wish') === status),
        sortMode
      ),
    }))
  );

  // ─── 卡片级：网格卡片 ScrollTrigger.batch 视口波状渐显 ───
  // 每卡一个 trigger（once:true 进视口即自毁），同一批进入视口的卡片按 stagger 波状显现，
  // 滚动驱动、无时间 stagger。数据签名（各分区 id 列表，含排序变化）未变时不重建——
  // 切走再切回不重播；数据重载/排序后 kill 旧 trigger 再重建。
  // Library 视图隐藏（class:hidden / display:none）期间不建 trigger，否则位置算错。
  const cardAnim = createScrollAnim();
  let cardSig = '';
  $effect(() => {
    if (!$libraryOpen) return;
    const sig = sections
      .map((s) => `${s.status}:${s.items.map((a) => a.id).join(',')}`)
      .join('|');
    if (sig === cardSig) return;
    cardSig = sig;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gsap = globalThis.gsap;
    if (!gsap || !gsap.ScrollTrigger) return;
    tick().then(() => {
      const root = document.getElementById('svelte-libraryView');
      if (!root) return;
      cardAnim.build({ cards: root.querySelectorAll('.status-section .anime-card') });
    });
  });
  // 视图隐藏：kill 全部 trigger 并清除隐藏态内联样式（切走再切回内容直接可见）
  $effect(() => {
    if ($libraryOpen) return;
    cardAnim.kill();
  });

  onDestroy(() => {
    cardAnim.kill();
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
          {#each getAnimeSortOptions() as o (o.key)}
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
              alwaysShowTitle={alwaysShowTitle}
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