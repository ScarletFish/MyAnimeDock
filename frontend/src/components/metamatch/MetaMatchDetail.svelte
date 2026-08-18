<script>
  // ─── MetaMatch 详情视图（纯展示 + 局部 fix search 状态）───
  // 对应 vanilla metamatch.js 的 mmRenderPanel / mmSearchForFix / mmFilterSummary。
  // fixResults / fixKeyword 为局部状态；onApplyFix(result) 上抛给父容器编排。
  import { tr, basename } from '../../lib/anime-utils.js';
  import { showToast } from '../../components/Toast.svelte';
  import { API as api } from '../../lib/api.js';

  let { item, syncInProgress, onApplyFix, onResearch } = $props();

  // ─── 局部状态 ───
  let fixResults = $state([]);
  let fixKeyword = $state('');
  let searching = $state(false);
  let searchError = $state('');
  let searched = $state(false);
  let coverFailed = $state(false);

  const statusLabels = {
    matched: tr('metamatch.statusMatched'),
    failed: tr('metamatch.statusFailed'),
    matching: tr('metamatch.statusMatching'),
    pending: tr('metamatch.statusPending'),
  };

  // ─── 封面（vanilla 582：localCover 绝对路径 → /covers/ 前缀；远程 URL 原样）───
  let coverSrc = $derived.by(() => {
    const coverPath = item?.meta?.localCover || item?.localCover || item?.coverUrl;
    if (!coverPath) return '';
    return coverPath.startsWith('http') ? coverPath : '/covers/' + basename(coverPath) + '?w=400&q=75';
  });
  let coverAlt = $derived(item?.meta?.bangumiTitle || item?.title || tr('metamatch.coverAlt'));
  let coverInitial = $derived((item?.title || '?')[0].toUpperCase());

  // ─── 季信息 ───
  let seasonInfo = $derived.by(() => {
    if (!item) return '';
    if (!item.parsedSeason && !item.episodeCount) return '';
    const parts = [];
    if (item.parsedSeason) parts.push(tr('metamatch.seasonN', { n: item.parsedSeason }));
    if (item.episodeCount) parts.push(tr('metamatch.episodeCount', { n: item.episodeCount }));
    return parts.join(' · ');
  });

  // ─── 简介过滤（vanilla mmFilterSummary）───
  let summaryText = $derived.by(() => {
    if (!item?.meta?.summary) return '';
    return mmFilterSummary(item.meta.summary);
  });

  function mmFilterSummary(text) {
    if (!text) return '';
    if (/[\u4e00-\u9fff]/.test(text)) {
      const parts = text.split(/\[?简介原文\]?/);
      if (parts.length > 1) {
        text = parts[0].trim();
      } else {
        const paragraphs = text.split(/\n+/).filter((p) => p.trim());
        const cn = paragraphs.filter((p) => /[\u4e00-\u9fff]/.test(p));
        if (cn.length > 0) text = cn.join('\n');
      }
    }
    return text;
  }

  // ─── 双源数据完整性（vanilla 614-668）───
  let bgmOk = $derived(!!(item?.meta?.bangumiId && item?.meta?.bangumiTitle && item?.meta?.localCover));
  let alId = $derived(item?.anilistId);
  let banner = $derived(item?.anilistBanner);
  let bannerDownloaded = $derived(!!banner && banner !== '__none__');
  let bannerOk = $derived(bannerDownloaded || banner === '__none__');
  let alOk = $derived((alId != null && alId !== -1) && bannerOk && !!item?.anilistTags);
  let bannerState = $derived.by(() => {
    if (banner === '__none__') return { cls: 'none', text: tr('metamatch.noBanner') };
    if (bannerDownloaded) return { cls: 'ok', text: tr('metamatch.bannerFetched') };
    return { cls: 'none', text: tr('metamatch.noBanner') };
  });

  // ─── 关键词（pending）───
  let keywords = $derived([item?.title, item?.folderName].filter(Boolean));

  // ─── Fix 默认关键词（vanilla 696）───
  let defaultKeyword = $derived((item?.specialSuffix || item?.title || item?.folderName || '').replace(/[~～]/g, '').trim());

  // 条目切换时重置局部 fix 状态
  let prevItemId = $state(null);
  $effect(() => {
    if (item?.animeId !== prevItemId) {
      prevItemId = item?.animeId;
      fixResults = [];
      fixKeyword = defaultKeyword;
      searching = false;
      searchError = '';
      searched = false;
      coverFailed = false;
    }
  });

  // ─── Fix 搜索（vanilla mmSearchForFix）───
  async function searchForFix() {
    const keyword = fixKeyword.trim();
    if (!keyword) {
      showToast(tr('metamatch.enterKeyword'), 'warning');
      return;
    }
    searching = true;
    searchError = '';
    searched = false;
    fixResults = [];
    try {
      const result = await api.post('/api/bangumi/search', { keyword, sources: undefined });
      fixResults = result?.results || [];
      searched = true;
    } catch (e) {
      searchError = e.message;
      searched = true;
    } finally {
      searching = false;
    }
  }

  // ─── Fix 结果渲染辅助（vanilla 764-784）───
  const typeMap = {
    1: tr('metamatch.typeBook'),
    2: 'TV',
    3: tr('metamatch.typeAnime'),
    4: 'OVA',
    5: 'Web',
    6: tr('metamatch.typeLiveAction'),
  };

  function resultTitle(r) {
    return r.name_cn || r.name || r.title || '—';
  }
  function resultCover(r) {
    return r.images?.small || r.images?.grid || r.coverUrl || r.image?.large || r.image?.medium || '';
  }
  function resultRating(r) {
    return r.rating?.score ? r.rating.score.toFixed(1) : (r.score || '');
  }
  function resultType(r) {
    return r.type ? (typeMap[r.type] || r.type) : '';
  }
</script>

<div class="mm-panel-header-area">
  <div class="mm-panel-cover-sm">
    {#if coverSrc && !coverFailed}
      <img src={coverSrc} alt={coverAlt} loading="lazy" decoding="async" onerror={() => (coverFailed = true)}>
    {:else}
      <div class="mm-panel-cover-sm-fallback">{coverInitial}</div>
    {/if}
    <div class="mm-panel-cover-status mm-panel-cover-status--{item.status}">
      <div class="mm-panel-status-dot"></div>{statusLabels[item.status]}
    </div>
  </div>
  {#if seasonInfo}
    <div class="mm-panel-key-info">
      <span class="mm-panel-key-text">{seasonInfo}</span>
    </div>
  {/if}
</div>

<div class="mm-panel-scroll">
  {#if item.status === 'matched' && summaryText}
    <div>
      <div class="mm-panel-label">{tr('metamatch.summaryLabel')}</div>
      <div class="mm-panel-summary">
        <div class="mm-panel-summary-text">{summaryText}</div>
      </div>
    </div>
  {/if}

  {#if item.status === 'matched'}
    <div class="mm-panel-section">
      <div class="mm-panel-label">{tr('metamatch.dataIntegrity')}</div>
      <div class="mm-panel-ids">
        <div class="mm-source-row">
          <div class="mm-source-head">
            <span class="mm-source-name">Bangumi</span>
            <span class="mm-status-badge" class:mm-status-badge--ok={bgmOk} class:mm-status-badge--missing={!bgmOk}>{bgmOk ? tr('metamatch.complete') : tr('metamatch.missing')}</span>
          </div>
          <div class="mm-source-meta">
            {#if item.meta?.bangumiId}
              <code class="mm-panel-id-value">{item.meta.bangumiId}</code>
              <a class="mm-panel-id-link" href="https://bgm.tv/subject/{item.meta.bangumiId}" target="_blank" rel="noopener">{tr('metamatch.open')}</a>
            {:else}
              <span class="mm-panel-id-value">—</span>
            {/if}
          </div>
        </div>
        <div class="mm-source-row">
          <div class="mm-source-head">
            <span class="mm-source-name">AniList</span>
            <span class="mm-status-badge" class:mm-status-badge--ok={alOk} class:mm-status-badge--missing={!alOk}>{alOk ? tr('metamatch.complete') : tr('metamatch.missing')}</span>
          </div>
          <div class="mm-source-meta">
            {#if alId != null && alId !== -1}
              <code class="mm-panel-id-value">{alId}</code>
              <a class="mm-panel-id-link" href="https://anilist.co/anime/{alId}" target="_blank" rel="noopener">{tr('metamatch.open')}</a>
            {:else}
              <span class="mm-panel-id-value">—</span>
            {/if}
          </div>
        </div>
        <div class="mm-banner-row">
          <span class="mm-panel-id-label">{tr('metamatch.bannerLabel')}</span>
          <span class="mm-banner-status mm-banner-status--{bannerState.cls}">{bannerState.text}</span>
        </div>
      </div>
    </div>
  {/if}

  {#if item.status === 'failed' && item.error}
    <div class="mm-panel-error">
      <div class="mm-panel-error-title">{tr('metamatch.errorTitle')}</div>
      <div class="mm-panel-error-msg">{item.error}</div>
    </div>
  {/if}

  {#if item.status === 'pending'}
    <div>
      <div class="mm-panel-label">{tr('metamatch.parseKeywords')}</div>
      <div class="mm-panel-keywords">
        {#each keywords as kw}
          <span class="mm-panel-keyword">{kw}</span>
        {/each}
      </div>
    </div>
  {/if}

  {#if !syncInProgress}
    <div class="mm-fix-section">
      <div class="mm-panel-label">{tr('metamatch.fixMatch')}</div>
      {#if item.status === 'matched'}
        <div class="mm-fix-research">
          <button class="btn mm-fix-research-btn" onclick={() => onResearch(item.animeId)} title={tr('metamatch.researchTitle')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            {tr('metamatch.researchAgain')}
          </button>
        </div>
      {/if}
      <div class="mm-fix-search">
        <input
          type="text"
          placeholder={tr('metamatch.searchPlaceholder')}
          bind:value={fixKeyword}
          onkeydown={(e) => { if (e.key === 'Enter') searchForFix(); }}
        >
        <button class="btn btn-primary mm-fix-search-btn" onclick={searchForFix}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
      </div>
      <div class="mm-fix-results">
        {#if searching}
          <div class="p-3 text-center text-content-muted text-[0.8125rem]">
            <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span class="ml-1.5">{tr('metamatch.searching')}</span>
          </div>
        {:else if searchError}
          <div class="p-3 text-center text-error text-[0.8125rem]">{tr('metamatch.searchFailed', { error: searchError })}</div>
        {:else if searched && fixResults.length === 0}
          <div class="p-3 text-center text-content-muted text-[0.8125rem]">{tr('metamatch.noResults')}</div>
        {:else if fixResults.length > 0}
          <div class="mm-fix-result-count">{tr('metamatch.resultsCount', { n: fixResults.length })}</div>
          {#each fixResults as r, i (i)}
            <div class="search-result-item" onclick={() => onApplyFix(r)}>
              {#if resultCover(r)}
                <img class="search-result-cover" src={resultCover(r)} alt="" loading="lazy" decoding="async" onerror={(e) => (e.currentTarget.style.display = 'none')}>
              {/if}
              <div class="search-result-info">
                <div class="search-result-title" data-tooltip={resultTitle(r)}>{resultTitle(r)}</div>
                {#if r.name}
                  <div class="search-result-subtitle" data-tooltip={r.name}>{r.name}</div>
                {/if}
                <div class="search-result-meta">
                  {r.date || ''}{resultRating(r) ? ' · ★' + resultRating(r) : ''}{#if resultType(r)}<span class="result-type-badge">{resultType(r)}</span>{/if}
                </div>
              </div>
              <button class="btn btn-primary search-result-btn">{tr('metamatch.select')}</button>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>