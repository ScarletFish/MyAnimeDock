<script>
  // ─── StatusSection（Svelte 迁移 Chunk A）───
  // 通用状态分区容器。variant 只映射 class 名，不碰样式。
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
  <div class="grid-container" style="grid-template-columns:{gridCols}">
    {#each items as item (item.id)}{@render children(item)}{/each}
  </div>
</div>