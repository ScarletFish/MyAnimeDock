<script>
  // ─── MetaMatch 同步日志（纯展示，props in）───
  // 对应 vanilla metamatch.js 的 mmRenderSyncLog / mmRenderSyncSummary。
  import { tr } from '../../lib/anime-utils.js';

  let { entries, summary } = $props();

  // 各状态图标（与 vanilla 一致）
  const ICONS = {
    searching: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    fetching: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    matched: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };
</script>

<div class="mm-panel-synclog-entries">
  {#each entries as e (e.animeId)}
    <div class="mm-panel-synclog-entry">
      <div class="mm-panel-synclog-icon mm-panel-synclog-icon--{e.status}">
        {@html ICONS[e.status] || ''}
      </div>
      <div class="mm-panel-synclog-body">
        <div class="mm-panel-synclog-title mm-panel-synclog-title--{e.status}">{e.searchTerm}</div>
        {#if e.detail}
          <div class="mm-panel-synclog-detail mm-panel-synclog-detail--{e.status}">{e.detail}</div>
        {/if}
      </div>
    </div>
  {/each}
</div>

{#if summary.total > 0}
  <div class="mm-panel-synclog-summary">
    <div class="mm-panel-synclog-summary-stats">
      {#if summary.matched > 0}
        <div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--matched">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {tr('metamatch.matchedLabel')} <span class="num">{summary.matched}</span>
        </div>
      {/if}
      {#if summary.failed > 0}
        <div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--failed">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          {tr('metamatch.statusFailed')} <span class="num">{summary.failed}</span>
        </div>
      {/if}
      <div class="mm-panel-synclog-summary-stat mm-panel-synclog-summary-stat--total">
        {tr('metamatch.totalLabel')} <span class="num">{summary.total}</span>
      </div>
    </div>
    <div class="mm-panel-synclog-summary-msg">
      {summary.failed === 0 ? tr('metamatch.allMatchedMsg') : tr('metamatch.retryFailedHint')}
    </div>
  </div>
{/if}