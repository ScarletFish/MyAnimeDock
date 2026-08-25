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
  import MikanSubscribeModal from '../components/MikanSubscribeModal.svelte';

  let open = $state(false);
  let weeklyAnime = $state([]);
  let loading = $state(true);
  let expandedAnime = $state(null);
  let bangumiDetail = $state(null);
  let loadingDetail = $state(false);
  let selectedSubgroupIdx = $state(0);
  let subscribing = $state(null);
  let scrollEls = $state({});
  let loadingFullSubgroup = $state(null);
  let fullResourcesLoaded = $state(new Set());

  // Subscribe modal state
  let subscribeModalOpen = $state(false);
  let subscribeTarget = $state(null);

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
      selectedSubgroupIdx = 0;
      fullResourcesLoaded = new Set();
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
    selectedSubgroupIdx = 0;
    fullResourcesLoaded = new Set();

    try {
      const resp = await api.get(`/api/mikan/bangumi?url=${encodeURIComponent(anime.detailUrl)}`);
      bangumiDetail = resp;
    } catch (e) {
      showToast(tr('mikan.loadResourcesFailed', { error: e.message }), 'error');
    } finally {
      loadingDetail = false;
    }
  }

  function openSubscribeModal(subgroup) {
    if (!bangumiDetail || !expandedAnime) return;
    subscribeTarget = subgroup;
    subscribeModalOpen = true;
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

  async function loadFullResources(sgIdx) {
    if (!bangumiDetail || !expandedAnime) return;
    const sg = bangumiDetail.subgroups[sgIdx];
    if (!sg || fullResourcesLoaded.has(sgIdx)) return;

    loadingFullSubgroup = sgIdx;
    try {
      const resources = await api.get(`/api/mikan/bangumi/full?url=${encodeURIComponent(expandedAnime.detailUrl)}&subgroupId=${sg.id}`);
      if (Array.isArray(resources) && resources.length > 0) {
        bangumiDetail.subgroups[sgIdx].resources = resources;
        fullResourcesLoaded = new Set([...fullResourcesLoaded, sgIdx]);
      }
    } catch (e) {
      showToast(tr('mikan.loadFullFailed', { error: e.message }), 'error');
    } finally {
      loadingFullSubgroup = null;
    }
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
                      <div class="mikan-split">
                        <!-- 左栏：字幕组列表 -->
                        <div class="mikan-split-left">
                          <div class="mikan-split-left-title">{bangumiDetail.name}</div>
                          <div class="mikan-subgroup-list">
                            {#each bangumiDetail.subgroups as sg, idx}
                              <div
                                class="mikan-subgroup-item"
                                class:selected={selectedSubgroupIdx === idx}
                                onclick={() => selectedSubgroupIdx = idx}
                                role="button"
                                tabindex="0"
                                onkeydown={(e) => { if (e.key === 'Enter') selectedSubgroupIdx = idx; }}
                              >
                                <span class="mikan-subgroup-name">{sg.name}</span>
                                <button
                                  class="btn btn-sm btn-outline"
                                  disabled={subscribing === sg.id}
                                  onclick={(e) => { e.stopPropagation(); openSubscribeModal(sg); }}
                                >
                                  {#if subscribing === sg.id}
                                    ...
                                  {:else}
                                    {tr('mikan.subscribe')}
                                  {/if}
                                </button>
                              </div>
                            {/each}
                          </div>
                        </div>

                        <!-- 右栏：资源列表 -->
                        <div class="mikan-split-right">
                          {#if bangumiDetail.subgroups[selectedSubgroupIdx]}
                            {@const sg = bangumiDetail.subgroups[selectedSubgroupIdx]}
                            <div class="mikan-resource-list">
                              {#each sg.resources as r}
                                <div class="mikan-resource-item">
                                  <span class="mikan-resource-name">{r.name}</span>
                                  <span class="mikan-resource-meta">{r.size} · {r.date}</span>
                                </div>
                              {/each}
                              {#if sg.resources.length === 0}
                                <div class="mikan-resource-empty">
                                  {tr('mikan.noResources')}
                                </div>
                              {/if}
                              {#if sg.resources.length > 0 && !fullResourcesLoaded.has(selectedSubgroupIdx)}
                                <button
                                  class="mikan-load-full-btn"
                                  disabled={loadingFullSubgroup === selectedSubgroupIdx}
                                  onclick={() => loadFullResources(selectedSubgroupIdx)}
                                >
                                  {#if loadingFullSubgroup === selectedSubgroupIdx}
                                    <svg class="spinning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                                    </svg>
                                    {tr('common.loading')}
                                  {:else}
                                    {tr('mikan.loadFull')}
                                  {/if}
                                </button>
                              {/if}
                            </div>
                          {/if}
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

<MikanSubscribeModal
  bind:open={subscribeModalOpen}
  anime={expandedAnime}
  subgroup={subscribeTarget}
  {bangumiDetail}
  onSubscribed={() => { /* 可选：刷新状态 */ }}
/>
