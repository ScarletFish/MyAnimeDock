<script module>
  import { writable } from 'svelte/store';
  export const mikanModalOpen = writable(false);
</script>

<script>
  import { onMount } from 'svelte';
  import { portal } from '../lib/portal.js';
  import { showToast } from '../components/Toast.svelte';
  import { tr } from '../lib/anime-utils.js';
  import { API as api } from '../lib/api.js';
  import { initScrollDots } from '../lib/scroll-dots.js';

  let open = $state(false);
  let weeklyAnime = $state([]);
  let loading = $state(true);
  let expandedAnime = $state(null);
  let bangumiDetail = $state(null);
  let loadingDetail = $state(false);
  let copyingRss = $state(null);
  let scrollEls = $state({});
  let imageCache = $state(new Map());

  const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const MIKAN_BASE = 'https://mikanime.tv';

  // 订阅 store
  $effect(() => {
    const unsub = mikanModalOpen.subscribe(v => open = v);
    return unsub;
  });

  // open/close body scroll lock
  $effect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      loadWeeklyAnime();
    } else {
      document.body.style.overflow = '';
      expandedAnime = null;
      bangumiDetail = null;
    }
  });

  // Escape close
  $effect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function close() {
    mikanModalOpen.set(false);
  }

  async function loadWeeklyAnime() {
    loading = true;
    try {
      const resp = await api.get('/api/mikan/weekly');
      weeklyAnime = Array.isArray(resp) ? resp : [];
      // 数据加载后初始化圆点
      requestAnimationFrame(() => {
        for (let i = 0; i < 7; i++) {
          initDotsForDay(i);
        }
      });
    } catch (e) {
      showToast(tr('mikan.loadFailed', { error: e.message }), 'error');
    } finally {
      loading = false;
    }
  }

  async function toggleAnime(anime, dayIdx) {
    // 点击已展开的则收起
    if (expandedAnime?.detailUrl === anime.detailUrl) {
      expandedAnime = null;
      bangumiDetail = null;
      return;
    }

    expandedAnime = anime;
    bangumiDetail = null;
    loadingDetail = true;

    try {
      const resp = await api.get(`/api/mikan/bangumi?url=${encodeURIComponent(anime.detailUrl)}`);
      bangumiDetail = resp;
    } catch (e) {
      showToast(tr('mikan.loadResourcesFailed', { error: e.message }), 'error');
    } finally {
      loadingDetail = false;
    }
  }

  async function copyRss(rssUrl) {
    const fullUrl = `https://mikanime.tv${rssUrl}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      copyingRss = rssUrl;
      showToast(tr('mikan.rssCopied'), 'success');
      setTimeout(() => { copyingRss = null; }, 1500);
    } catch (e) {
      showToast(tr('mikan.copyFailed'), 'error');
    }
  }

  function getDayGroups() {
    const map = new Map();
    for (const g of weeklyAnime) {
      map.set(g.dayOfWeek, g.bangumi);
    }
    // 按周一~周日排序
    return [1, 2, 3, 4, 5, 6, 0].map(d => ({
      dayOfWeek: d,
      name: DAY_NAMES[d - 1] || '周日',
      bangumi: map.get(d) || [],
    }));
  }

  // 初始化分页圆点
  function initDotsForDay(dayIdx) {
    const scrollEl = scrollEls[dayIdx];
    if (!scrollEl) return;
    const group = getDayGroups()[dayIdx];
    if (!group || group.bangumi.length === 0) return;

    const headerEl = document.querySelector(`#mikan-day-${dayIdx} .mikan-day-header`);
    if (!headerEl) return;

    requestAnimationFrame(() => {
      initScrollDots({
        scroll: scrollEl,
        cardSelector: '.mikan-anime-card',
        total: group.bangumi.length,
        dotsParent: headerEl,
      });
    });
  }
</script>

{#if open}
  <div
    class="modal-overlay"
    use:portal
    class:show={open}
    role="button"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) close(); }}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') close(); }}
  >
    <div class="modal mikan-modal">
      <button class="modal-close-btn" onclick={close} aria-label="关闭">✕</button>
      <div class="modal-header">
        <h2>{tr('mikan.title')}</h2>
      </div>

      {#if loading}
        <div class="mikan-loading">
          <svg class="spinning" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <span>{tr('common.loading')}</span>
        </div>
      {:else}
        <div class="mikan-days">
          {#each getDayGroups() as group, dayIdx}
            {#if group.bangumi.length > 0}
              <div class="mikan-day-section" id="mikan-day-{dayIdx}">
                <div class="mikan-day-header">
                  <div class="mikan-day-title">
                    <span>{group.name}</span>
                    <span class="mikan-day-count">{group.bangumi.length}部</span>
                  </div>
                </div>

                <div
                  class="mikan-day-scroll"
                  bind:this={scrollEls[dayIdx]}
                >
                  {#each group.bangumi as anime, animeIdx}
                    <div
                      class="mikan-anime-card"
                      class:expanded={expandedAnime?.detailUrl === anime.detailUrl}
                      onclick={() => toggleAnime(anime, dayIdx)}
                      role="button"
                      tabindex="0"
                      onkeydown={(e) => { if (e.key === 'Enter') toggleAnime(anime, dayIdx); }}
                    >
                      <div class="mikan-anime-cover">
                        {#if anime.cover}
                          <img
                            src={MIKAN_BASE + anime.cover}
                            alt={anime.name}
                            loading="lazy"
                            onerror={(e) => e.target.style.display = 'none'}
                          />
                        {/if}
                      </div>
                      <div class="mikan-anime-name">{anime.name}</div>
                    </div>
                  {/each}
                </div>

                {#if expandedAnime && group.bangumi.some(a => a.detailUrl === expandedAnime.detailUrl)}
                  <div class="mikan-detail-panel">
                    {#if loadingDetail}
                      <div class="mikan-detail-loading">
                        <svg class="spinning" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M12 6v6l4 2"/>
                        </svg>
                        <span>{tr('common.loading')}</span>
                      </div>
                    {:else if bangumiDetail}
                      <div class="mikan-detail-content">
                        <div class="mikan-detail-title">{bangumiDetail.name}</div>
                        <div class="mikan-subgroups">
                          {#each bangumiDetail.subgroups as sg}
                            <div class="mikan-subgroup-row">
                              <span class="mikan-subgroup-name">{sg.name}</span>
                              <button
                                class="btn btn-sm btn-outline"
                                onclick={(e) => { e.stopPropagation(); copyRss(sg.rssUrl); }}
                              >
                                {#if copyingRss === sg.rssUrl}
                                  ✓
                                {:else}
                                  {tr('mikan.copyRss')}
                                {/if}
                              </button>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
