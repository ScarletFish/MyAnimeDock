<script>
  // ─── MetaMatch 左侧列表（纯展示，props in / events out）───
  // 对应 vanilla metamatch.js 的 mmRenderList / mmShowEmpty。
  import { tr } from '../../lib/anime-utils.js';

  let { filteredItems, selectedId, selectedIds, syncInProgress, totalCount, filter, emptyMsg, onRowClick } = $props();

  const badgeLabels = {
    matched: tr('metamatch.statusMatched'),
    failed: tr('metamatch.statusFailed'),
    matching: tr('metamatch.statusMatching'),
    pending: tr('metamatch.statusPending'),
  };

  // 空状态文案（对应 vanilla mmRenderList 195-208）
  let emptyText = $derived.by(() => {
    if (emptyMsg) return emptyMsg;
    if (totalCount === 0) return tr('metamatch.libraryEmpty');
    if (filter === 'all') return tr('metamatch.noItems');
    const label = { matched: tr('metamatch.statusMatched'), failed: tr('metamatch.statusFailed'), pending: tr('metamatch.statusPending') }[filter] || '';
    return tr('metamatch.noItemsForFilter', { filter: label });
  });
</script>

{#if filteredItems.length === 0}
  <div class="mm-list-empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <p>{emptyText}</p>
    <p class="empty-hint">{tr('metamatch.noMatchHint')}</p>
  </div>
{:else}
  <div class="mm-list">
    {#each filteredItems as item, i (item.animeId)}
      <div
        class="mm-row"
        class:mm-row--selected={item.animeId === selectedId}
        class:mm-row--matching={item.status === 'matching'}
        class:mm-row--batch={selectedIds.includes(item.animeId)}
        style="animation-delay:{Math.min(i, 30) * 18}ms"
        onclick={(e) => onRowClick(item.animeId, e.shiftKey)}
      >
        <div class="mm-row-dot mm-row-dot--{item.status}"></div>
        <div class="mm-row-info">
          <div class="mm-row-title">{item.title}</div>
          <div class="mm-row-sub">
            {#if item.parsedSeason || item.episodeCount}
              {#if item.parsedSeason}S{item.parsedSeason}{/if}
              {#if item.parsedSeason && item.episodeCount} · {/if}
              {#if item.episodeCount}{tr('metamatch.episodeCount', { n: item.episodeCount })}{/if}
            {:else}—{/if}
            {#if item.matchedSeason != null && item.matchedSeason > 1}
              {@const seasonMismatch = item.parsedSeason && item.matchedSeason !== item.parsedSeason}
              <span class="mm-row-season" class:mm-row-season--mismatch={seasonMismatch}>S{item.matchedSeason}{seasonMismatch ? ' ⚠' : ''}</span>
            {/if}
          </div>
        </div>
        {#if item.status === 'matched' && item.meta}
          <div class="mm-row-match">
            <span class="mm-row-match-title">{item.meta.bangumiTitle || ''}</span>
            {#if item.meta.bangumiTitleJp || item.meta.rating}
              <div class="mm-row-match-meta">
                {#if item.meta.bangumiTitleJp}<span class="mm-row-match-jp">{item.meta.bangumiTitleJp}</span>{/if}
                {#if item.meta.bangumiTitleJp && item.meta.rating}<span class="mm-row-match-sep">&middot;</span>{/if}
                {#if item.meta.rating}<span class="mm-row-rating">★ {item.meta.rating}</span>{/if}
              </div>
            {/if}
          </div>
        {:else if item.status === 'failed'}
          <div class="mm-row-match mm-row-match--error">{item.error || tr('metamatch.matchFailed')}</div>
        {:else if item.status === 'matching'}
          <div class="mm-row-match mm-row-match--pending">{tr('metamatch.matchingDots')}</div>
        {:else}
          <div class="mm-row-match mm-row-match--pending">{tr('metamatch.pendingMatch')}</div>
        {/if}
        <span class="mm-row-badge mm-row-badge--{item.status}">{badgeLabels[item.status]}</span>
      </div>
    {/each}
  </div>
{/if}