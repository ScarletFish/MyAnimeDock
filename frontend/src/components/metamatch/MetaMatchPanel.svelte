<script>
  // ─── MetaMatch 右侧面板容器（滑动动画 + 互斥切换）───
  // 替代 vanilla mmOpenPanel / mmClosePanel + 350ms timeout。
  // 用 Svelte transition:slide + {#if} 实现滑动动画。
  // axis:'x' 保持 vanilla 的水平滑动（从右侧滑出），slide 默认是垂直方向。
  import { slide } from 'svelte/transition';
  import { tr } from '../../lib/anime-utils.js';
  import MetaMatchDetail from './MetaMatchDetail.svelte';
  import MetaMatchSyncLog from './MetaMatchSyncLog.svelte';

  let { panelVisible, syncLogVisible, item, syncInProgress, syncLog, syncSummary, onApplyFix, onResearch } = $props();
</script>

{#if panelVisible}
  <div class="mm-panel open" transition:slide={{ axis: 'x', duration: 180 }}>
    {#if syncLogVisible}
      <div class="mm-panel-synclog">
        <div class="mm-panel-synclog-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span>{tr('metamatch.syncLog')}</span>
        </div>
        <MetaMatchSyncLog entries={syncLog} summary={syncSummary} />
      </div>
    {:else if item}
      <div class="mm-panel-content">
        <MetaMatchDetail item={item} syncInProgress={syncInProgress} onApplyFix={onApplyFix} onResearch={onResearch} />
      </div>
    {/if}
  </div>
{/if}