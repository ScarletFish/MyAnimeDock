<script>
  // ─── WindowedGrid ───
  // 行级窗口化网格：只渲染视口可见行 + overscan 缓冲，滚动时替换。
  // 覆盖：Mylist 5 状态组 + Library 本地动漫库（共用 StatusSection 的两个视图）。
  // 滚动容器固定 .main-content（唯一滚动容器，与 scroll-anim 同源）。
  // 列数由容器宽度反算（calcGridColCount，与 CSS auto-fit minmax 同源）；
  // 行高 = 卡宽 × 4/3 + rowGap（卡片 aspect-ratio 3/4）。
  // 动画约定：不在此处理滚动换卡动画——动画只在数据签名变化时对当时 DOM 内卡片建
  // trigger（视图层已有），窗口滚动换出的新卡直接可见（符合确认的"不重建动画"）。
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import {
    GRID_CARD_MIN,
    GRID_CARD_MAX,
    calcGridColCount,
    readScale,
  } from '../lib/grid.js';

  let { items, children } = $props();

  let containerEl = $state(null); // 网格容器（量宽 + 量 rowGap）
  let width = $state(0);
  let cols = $state(1);
  let rowH = $state(0);
  let colTemplate = $state(''); // 行内 grid-template-columns（minmax 像素值，量测后固化）
  let virtualizer = $state(null); // tanstack store（Readable），不可直接 $ 订阅，见下
  let vItems = $state([]); // 订阅镜像：虚拟行
  let vTotal = $state(0); // 订阅镜像：总高

  // ─── 容器尺寸监听 ───
  // display:none（Library class:hidden）期间宽为 0 → 不量不渲；切回显示后 RO 自动触发重算。
  $effect(() => {
    const el = containerEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const scale = readScale();
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
      const m = calcGridColCount(w, gap, scale);
      width = w;
      cols = m.cols;
      rowH = Math.round(m.cardW * (4 / 3) + gap);
      colTemplate = `repeat(${m.cols}, minmax(${Math.round(GRID_CARD_MIN * scale)}px, ${Math.round(GRID_CARD_MAX * scale)}px))`;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // ─── 行数 = ceil(items / cols) ───
  const rows = $derived(cols > 0 ? Math.ceil(items.length / cols) : 0);

  // ─── 量测完成后创建 virtualizer ───
  // getScrollElement 用 document.querySelector 每次读取（#866 workaround：不依赖 $state 元素）。
  $effect(() => {
    if (virtualizer || !containerEl || width <= 0 || rows <= 0) return;
    virtualizer = createVirtualizer({
      count: rows,
      getScrollElement: () => document.querySelector('.main-content'),
      estimateSize: () => rowH,
      overscan: 3,
      getItemKey: (i) => i,
    });
  });

  // ─── rows / rowH 变化 → setOptions 同步（含 count 重渲染修复 #969）───
  $effect(() => {
    if (!virtualizer) return;
    virtualizer.setOptions({ count: rows, estimateSize: () => rowH });
  });

  // ─── 订阅镜像：滚动/窗口变化时同步 vItems/vTotal 到 runes ───
  $effect(() => {
    if (!virtualizer) return;
    const unsub = virtualizer.subscribe((v) => {
      vItems = v.getVirtualItems();
      vTotal = v.getTotalSize();
    });
    return unsub;
  });
</script>

<div
  class="grid-container"
  bind:this={containerEl}
  style="
    grid-template-columns: none;
    position: relative;
    height: {vTotal}px;
  "
>
  {#each vItems as row (row.key)}
    {@const rowStart = row.index * cols}
    <div
      class="grid-container"
      style="
        position: absolute;
        top: {row.start}px;
        left: 0;
        right: 0;
        grid-template-columns: {colTemplate};
        align-items: flex-start;
      "
    >
      {#each items.slice(rowStart, rowStart + cols) as item (item.id)}
        {@render children(item)}
      {/each}
    </div>
  {/each}
</div>