<script module>
  // 模块级 30min TTL 缓存（跨重挂载不清，同原 detail.js _relationCache/_recCache）
  const _CACHE_TTL = 30 * 60 * 1000;
  const _cache = new Map();
  function cacheGet(key) {
    const e = _cache.get(key);
    if (!e || Date.now() - e.ts >= _CACHE_TTL) return null;
    return e.data;
  }
  function cacheSet(key, data) { _cache.set(key, { data, ts: Date.now() }); }
</script>

<script>
  // ─── 关联 / 推荐 横向滚动列表（声明式）───
  // kind: 'relations' | 'recommendations'。根为 .hscroll（保留 id 契约）。
  import { onMount } from 'svelte';
  import { initScrollDots } from '../../lib/scroll-dots.js';
  import { tr } from '../../lib/anime-utils.js';
  import { openDetail } from '../../views/Detail.svelte';
  import { API as api } from '../../lib/api.js';

  let { animeId = null, kind = 'relations' } = $props();

  let items = $state([]);
  let loading = $state(true);
  let failed = $state(false);
  let scrollEl = $state(null);

  const isRecs = $derived(kind === 'recommendations');
  const sectionId = $derived(isRecs ? 'svelte-detailRecommendations' : 'svelte-detailRelations');
  const scrollId = $derived(isRecs ? 'svelte-recommendationScroll' : 'svelte-relationScroll');
  const endpoint = $derived(isRecs ? 'recommendations' : 'relations');
  const badgeColors = { SEQUEL: '#22c55e', PREQUEL: '#f59e0b', SIDE_STORY: '#6366f1', SPIN_OFF: '#ec4899' };

  function openDetailFromCard(id) {
    openDetail(id, null, null, 'library');
  }
  // AniList URL 按类型分段：漫画/小说（MANGA/NOVEL/ONE_SHOT）走 /manga/，其余走 /anime/。
  // 若硬拼 /anime/{id}，漫画类关联条目会 404。
  const MANGA_FORMATS = new Set(['MANGA', 'NOVEL', 'ONE_SHOT']);
  function openExternalUrl(r) {
    const path = MANGA_FORMATS.has(r.format) ? 'manga' : 'anime';
    const url = 'https://anilist.co/' + path + '/' + r.id;
    if (window.__TAURI__?.shell?.open) {
      window.__TAURI__.shell.open(url).catch(() => {});
    } else {
      window.open(url, '_blank');
    }
  }

  function initDots() {
    requestAnimationFrame(() => {
      if (scrollEl) initScrollDots({ scroll: scrollEl, cardSelector: '.relation-card', total: items.length, dotsParent: document.querySelector('#' + sectionId + ' .detail-section-header') });
    });
  }

  onMount(async () => {
    const cacheKey = kind + ':' + animeId;
    const cached = cacheGet(cacheKey);
    if (cached) {
      items = cached;
      loading = false;
      initDots();
      return;
    }
    try {
      const res = await api.get('/api/anime/' + encodeURIComponent(animeId) + '/' + endpoint);
      const list = res[endpoint] || [];
      items = list;
      cacheSet(cacheKey, list);
    } catch (e) {
      failed = true;
    } finally {
      loading = false;
      initDots();
    }
  });
</script>

{#if !loading && !failed && items.length > 0}
  <div id={sectionId} class="detail-section hscroll-section">
    <div class="detail-section-header">
      <span class="detail-section-title">{tr(isRecs ? 'detail.recommendations' : 'detail.related', isRecs ? '推荐' : '关联作品')}</span>
    </div>
    <div class="hscroll" id={scrollId} bind:this={scrollEl} style="gap: calc(0.75rem * var(--scale)); padding: calc(0.25rem * var(--scale)) 0 calc(0.5rem * var(--scale)) 0">
      {#each items as r}
        {@const rTitle = r.title?.native || r.title?.romaji || r.title?.english || 'Unknown'}
        {@const cover = r.coverImage?.large || ''}
        <div class="relation-card" onclick={r.inLibrary && r.localId ? () => openDetailFromCard(r.localId) : () => openExternalUrl(r)}>
          <div class="relation-card-cover">
            <div class="relation-card-img" style={cover ? 'background-image:url("' + cover.replace(/"/g, '%22') + '")' : ''}></div>
            {#if isRecs}
              {#if r.averageScore}<span class="relation-badge relation-badge--rating">★ {r.averageScore}</span>{/if}
            {:else}
              {@const label = r.relationType || ''}
              <span class="relation-badge" style="background:{badgeColors[label] || '#6b7280'}">{label}</span>
            {/if}
          </div>
          <div class="relation-card-title">{rTitle}</div>
        </div>
      {/each}
    </div>
  </div>
{/if}