<script>
  // ─── MetaMatch 顶栏（纯展示，props in / events out）───
  // 对应 vanilla metamatch.js 的 mmUpdateStats / mmUpdateProgress / mmUpdateMainAction 渲染部分。
  import { tr } from '../../lib/anime-utils.js';

  let { stats, progress, mainAction, filter, search, syncInProgress, onSetFilter, onSearch, onMainAction, onCancel, onClose } = $props();

  const FILTERS = ['all', 'pending', 'failed', 'matched'];
</script>

<div class="modal-m-topbar">
  <h2>{tr('metamatch.title', '批量元数据匹配')}</h2>
  <div class="modal-m-badges">
    <span class="stat-badge"><span class="num">{stats.total}</span><span>{tr('common.all', '全部')}</span></span>
    <span class="stat-badge pending"><span class="num">{stats.pending}</span><span>{tr('metamatch.statusPending', '待处理')}</span></span>
    <span class="stat-badge failed"><span class="num">{stats.failed}</span><span>{tr('common.failed', '失败')}</span></span>
    <span class="stat-badge matched"><span class="num">{stats.matched}</span><span>{tr('metamatch.statusMatched', '已匹配')}</span></span>
    <span class="stat-badge matching"><span class="num">{stats.matching}</span><span>{tr('metamatch.statusMatching', '匹配中')}</span></span>
  </div>
  <button class="modal-close-btn" onclick={onClose} aria-label={tr('common.close', '关闭')}>✕</button>
</div>

<div class="modal-m-progress">
  <div class="fill" style="width:{progress.pct}%"></div>
</div>

<div class="modal-m-filterbar">
  {#if syncInProgress}
    <button class="btn btn-sm btn-ghost" onclick={onCancel}>{tr('common.stop', '停止')}</button>
  {:else}
    <button class={mainAction.className} class:disabled={mainAction.disabled} onclick={onMainAction}>{mainAction.text}</button>
  {/if}
  <span class="mm-shift-tip" style:display={stats.selectedCount === 1 ? '' : 'none'}>{tr('metamatch.shiftMultiSelect', 'Shift+点击 多选')}</span>
  <div class="spacer"></div>
  {#each FILTERS as f}
    <button
      class="mm-filter-dot"
      class:mm-filter-dot--active={filter === f}
      onclick={() => onSetFilter(f)}
      aria-label={f}
    >
      <span class="dot dot-{f}"></span>
    </button>
  {/each}
  <div class="mm-list-search">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input
      type="text"
      placeholder={tr('metamatch.searchEntry', '搜索条目...')}
      value={search}
      oninput={(e) => onSearch(e.currentTarget.value)}
    />
  </div>
</div>