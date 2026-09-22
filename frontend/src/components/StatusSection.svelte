<script>
  // ─── StatusSection ───
  // 通用状态分区容器。variant 只映射 class 名，不碰样式。
  // 达到 WINDOW_LIMIT 项后网格切换为窗口化渲染（WindowedGrid），
  // 滚动窗口内只保留可见行 + overscan；未达标走原全量渲染。
  import WindowedGrid from './WindowedGrid.svelte';

  let {
    label,
    items,
    count,
    gridCols,
    variant = 'library',
    children,
  } = $props();

  let resolvedCount = $derived(count ?? items.length);
</script>

<div class={variant === 'library' ? 'status-section' : 'mylist-section'}>
  <div class={variant === 'library' ? 'status-section-header' : 'mylist-section-header'}>
    <span class={variant === 'library' ? 'status-section-title' : 'mylist-section-title'}>{label}</span>
    <span class={variant === 'library' ? 'status-section-count' : 'mylist-section-count'}>{resolvedCount}</span>
  </div>
  {#if items.length >= 60}
    <WindowedGrid {items} {children} />
  {:else}
    <div class="grid-container" style="grid-template-columns:{gridCols}">
      {#each items as item (item.id)}{@render children(item)}{/each}
    </div>
  {/if}
</div>