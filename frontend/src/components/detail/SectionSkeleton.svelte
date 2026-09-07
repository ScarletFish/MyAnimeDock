<script>
  // ─── 详情区块骨架屏 ───
  // 纯静态占位（不发 API），供 LazySection 未触发时与 RelationList loading/failed 态复用，
  // 保持视觉无缝。variant: 'characters' | 'relations' | 'failed'。
  // title：relations/failed 变体的真实区块标题文案（如「关联作品」「推荐」）；有则骨架期直显标题
  //        （静态文案，不需懒加载），无则回退灰条（兼容 characters 等调用）。
  // failed：外部源无正常内容（获取失败或空数据）时的统一占位（云图标 + label，非骨架动画），
  //         复用 hscroll 外壳几何使内容区高度对齐封面行；不传 title 时回退灰条。
  // relations/failed 几何与真实横滑区块同源：读 --card-w + 容器宽，用 scroll-dots 的 computeColsFor
  // 算列数写回 --cols，并按同一几何推导封面卡高（aspect-ratio 3/4）设置失败态内容区 min-height，
  // 卡宽/卡高与真实一致，避免触发/加载时 layout shift。
  import { onMount, onDestroy } from 'svelte';
  import { computeColsFor } from '../../lib/scroll-dots.js';

  let { variant = 'characters', title = '', label = '' } = $props();

  let shellEl = $state(null);
  let failedBodyEl = $state(null);
  let ro = null;

  function syncGeometry() {
    if (!shellEl) return;
    const cs = getComputedStyle(shellEl);
    const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 12;
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const contentW = Math.max(0, shellEl.clientWidth - padX);
    if (contentW <= 0) return; // 容器隐藏（宽 0）时不覆盖，保持现有值
    const baselineW = parseFloat(cs.getPropertyValue('--card-w')) || 235;
    const cols = computeColsFor(shellEl, { baselineW });
    const cardW = (contentW - gap * (cols - 1)) / cols;
    const coverH = cardW * (4 / 3);
    const prev = shellEl.style.getPropertyValue('--cols');
    if (String(cols) !== prev) shellEl.style.setProperty('--cols', String(cols));
    // 失败态内容区高度对齐封面行（aspect-ratio 3/4 × 卡宽），同源列数推导
    if (failedBodyEl) failedBodyEl.style.minHeight = coverH + 'px';
  }

  onMount(() => {
    if (!shellEl) return;
    syncGeometry();
    ro = new ResizeObserver(() => syncGeometry());
    ro.observe(shellEl);
  });
  onDestroy(() => {
    ro?.disconnect();
    ro = null;
  });
</script>

{#if variant === 'failed'}
  <div class="sk-section sk-section--hscroll sk-section--failed" bind:this={shellEl} aria-hidden="true">
    {#if title}
      <div class="detail-section-header sk-section-header">
        <span class="detail-section-title">{title}</span>
      </div>
    {:else}
      <div class="sk-header"><div class="sk-line sk-line--title skeleton-block"></div></div>
    {/if}
    <div class="sk-failed-body" bind:this={failedBodyEl}>
      <div class="sk-failed-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 16.5A4.5 4.5 0 0 1 7.4 8.2 6 6 0 0 1 19 9.5 3.5 3.5 0 0 1 18.5 16.4"/>
          <path d="M3 21 21 3"/>
        </svg>
      </div>
      {#if label}<div class="sk-failed-label">{label}</div>{/if}
    </div>
  </div>
{:else if variant === 'characters'}
  <div class="sk-section" aria-hidden="true">
    <div class="sk-header"><div class="sk-line sk-line--title skeleton-block"></div></div>
    <div class="sk-char-grid">
      {#each Array(3) as _}
        <div class="sk-char-card">
          <div class="sk-char-avatar skeleton-block"></div>
          <div class="sk-char-info">
            <div class="sk-line skeleton-block"></div>
            <div class="sk-line sk-line--short skeleton-block"></div>
          </div>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="sk-section sk-section--hscroll" bind:this={shellEl} aria-hidden="true">
    {#if title}
      <div class="detail-section-header sk-section-header">
        <span class="detail-section-title">{title}</span>
      </div>
    {:else}
      <div class="sk-header"><div class="sk-line sk-line--title skeleton-block"></div></div>
    {/if}
    <div class="sk-hscroll">
      {#each Array(5) as _}
        <div class="sk-cover-card">
          <div class="sk-cover skeleton-block"></div>
        </div>
      {/each}
    </div>
  </div>
{/if}
