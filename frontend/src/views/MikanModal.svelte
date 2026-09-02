<script module>
  import { writable } from 'svelte/store';
  export const mikanModalOpen = writable(false);
</script>

<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { portal } from '../lib/portal.js';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';
  import { tr } from '../lib/anime-utils.js';
  import { API as api } from '../lib/api.js';
  import { initScrollDots } from '../lib/scroll-dots.js';
  import { initHscrollAutoCols } from '../lib/hscroll-auto-cols.js';
  import { Select, Popover } from 'bits-ui';
  import MikanSubscribePanel from '../components/MikanSubscribePanel.svelte';

  let open = $state(false);
  let weeklyAnime = $state([]);
  let loading = $state(true);
  let expandedAnime = $state(null);
  let bangumiDetail = $state(null);
  let loadingDetail = $state(false);
  let selectedSubgroupIdx = $state(0);
  let subscribing = $state(null);
  let scrollEls = $state({});
  let stopAutoColsFns = [];
  let loadingFullSubgroup = $state(null);
  let fullResourcesLoaded = $state(new Set());
  let detailPanelEl = $state(null);
  let refreshingDetail = $state(false);
  let forceFullFresh = $state(false);

  // Subscribe panel state
  let subscribeMode = $state(false);
  let subscribeTarget = $state(null);
  let preview = $state({ matched: [], excluded: [], unmatched: [], total: 0 });

  const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const MIKAN_BASE = 'https://mikanime.tv';
  const SEASONS = ['春', '夏', '秋', '冬'];

  // 当前季度
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentSeason = currentMonth >= 4 && currentMonth <= 6 ? '春' : currentMonth >= 7 && currentMonth <= 9 ? '夏' : currentMonth >= 10 && currentMonth <= 12 ? '秋' : '冬';

  let selectedYear = $state(currentYear);
  let selectedSeason = $state(currentSeason);

  // 周番组固定按周一至周日 7 天分组
  const WEEKDAY_SECTIONS = 7;

  const yearOptions = Array.from({ length: currentYear - 2012 + 1 }, (_, i) => currentYear - i);

  // bits-ui Popover: 年份+季度网格
  let seasonLabel = $derived(`${selectedYear} ${selectedSeason}季番组`);

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
      subscribeMode = false;
      subscribeTarget = null;
      preview = { matched: [], excluded: [], unmatched: [], total: 0 };
    }
  });

  // Escape close
  $effect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (subscribeMode) exitSubscribeMode();
        else close();
      }
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
      const resp = await api.get(`/api/mikan/season?year=${selectedYear}&season=${encodeURIComponent(selectedSeason)}`);
      weeklyAnime = Array.isArray(resp) ? resp : [];
      expandedAnime = null;
      bangumiDetail = null;
      selectedSubgroupIdx = 0;
      fullResourcesLoaded = new Set();
      subscribeMode = false;
      subscribeTarget = null;
      preview = { matched: [], excluded: [], unmatched: [], total: 0 };
    } catch (e) {
      showToast(tr('mikan.loadFailed', { error: e.message }), 'error');
    } finally {
      loading = false;
    }
    // loading=false 后才刷新 DOM；tick 后（paint 前）同步首算，一帧到位
    await tick();
    for (let i = 0; i < WEEKDAY_SECTIONS; i++) {
      initDotsForDay(i);
      initAutoColsForDay(i);
    }
  }

  function selectSeason(y, s) {
    selectedYear = y;
    selectedSeason = s;
    loadWeeklyAnime();
  }

  async function toggleAnime(anime, dayIdx) {
    // 退出订阅模式
    if (subscribeMode) exitSubscribeMode();

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
      await tick();
      detailPanelEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      showToast(tr('mikan.loadResourcesFailed', { error: e.message }), 'error');
    } finally {
      loadingDetail = false;
    }
  }

  async function refreshDetail() {
    if (!expandedAnime?.detailUrl || refreshingDetail) return;
    refreshingDetail = true;
    forceFullFresh = true;
    const url = expandedAnime.detailUrl;
    try {
      const resp = await api.get(`/api/mikan/bangumi?url=${encodeURIComponent(url)}&refresh=1`);
      bangumiDetail = resp;
      fullResourcesLoaded = new Set();
      await tick();
      detailPanelEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      showToast(tr('mikan.loadResourcesFailed', { error: e.message }), 'error');
    } finally {
      refreshingDetail = false;
    }
  }

  function openSubscribeModal(subgroup) {
    if (!bangumiDetail || !expandedAnime) return;
    subscribeTarget = subgroup;
    subscribeMode = true;
  }

  function exitSubscribeMode() {
    subscribeMode = false;
    subscribeTarget = null;
    preview = { matched: [], excluded: [], unmatched: [], total: 0 };
  }

  async function unsubscribe(subgroup) {
    if (!subgroup.subscription) return;
    const confirmed = await showConfirm(tr('mikan.unsubscribeConfirm'));
    if (!confirmed) return;
    try {
      await api.post('/api/mikan/unsubscribe', { subscriptionId: subgroup.subscription.id });
      // 更新本地状态
      const sg = bangumiDetail.subgroups.find(s => s.id === subgroup.id);
      if (sg) sg.subscription = null;
      showToast(tr('mikan.unsubscribed'), 'success');
    } catch (e) {
      showToast(tr('mikan.unsubscribeFailed', { error: e.message }), 'error');
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

  async function loadFullResources(sgIdx) {
    if (!bangumiDetail || !expandedAnime) return;
    const sg = bangumiDetail.subgroups[sgIdx];
    if (!sg || fullResourcesLoaded.has(sgIdx)) return;

    loadingFullSubgroup = sgIdx;
    try {
      const refreshParam = forceFullFresh ? '&refresh=1' : '';
      const resources = await api.get(`/api/mikan/bangumi/full?url=${encodeURIComponent(expandedAnime.detailUrl)}&subgroupId=${sg.id}${refreshParam}`);
      if (Array.isArray(resources) && resources.length > 0) {
        bangumiDetail.subgroups[sgIdx].resources = resources;
        fullResourcesLoaded = new Set([...fullResourcesLoaded, sgIdx]);
        forceFullFresh = false;
      }
    } catch (e) {
      showToast(tr('mikan.loadMoreFailed', { error: e.message }), 'error');
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

  // 初始化自动列数（.mikan-day-scroll 是自带 --cols 的 plain flex 容器）
  function initAutoColsForDay(dayIdx) {
    const scrollEl = scrollEls[dayIdx];
    if (!scrollEl) return;
    // 弹窗 #if open 会销毁/重建 DOM：重建前须断开旧 observer，
    // 否则新元素永远接不上（守卫拦住重建）。
    if (typeof stopAutoColsFns[dayIdx] === 'function') { stopAutoColsFns[dayIdx](); stopAutoColsFns[dayIdx] = null; }
    stopAutoColsFns[dayIdx] = initHscrollAutoCols(scrollEl, {
      cardSelector: '.mikan-anime-card',
      onColsChange: () => scrollEl.dispatchEvent(new Event('scroll')),
    });
  }

  onDestroy(() => {
    for (const stop of stopAutoColsFns) {
      if (typeof stop === 'function') stop();
    }
    stopAutoColsFns = [];
  });
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
        <Popover.Root>
          <Popover.Trigger class="mikan-season-btn">
            {seasonLabel}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </Popover.Trigger>
          <Popover.Portal to="#modal-root">
            <Popover.Content class="mikan-season-dd" side="bottom" sideOffset={4}>
              <div class="mikan-season-dd-inner">
                {#each yearOptions as year}
                  <div class="mikan-season-dd-year">{year}</div>
                  <div class="mikan-season-dd-row">
                    {#each SEASONS as s}
                      <button
                        class="mikan-season-dd-item"
                        class:active={year === selectedYear && s === selectedSeason}
                        onclick={() => selectSeason(year, s)}
                      >
                        {s}
                      </button>
                    {/each}
                  </div>
                {/each}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
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
          {#if getDayGroups().every(g => g.bangumi.length === 0)}
            <div class="mikan-empty">{tr('mikan.noSeasonData')}</div>
          {/if}
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
                  <div class="mikan-detail-panel" bind:this={detailPanelEl}>
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
                        <!-- 左栏：字幕组列表 / 订阅面板 -->
                        <div class="mikan-split-left">
                          {#if subscribeMode}
                            <MikanSubscribePanel
                              resources={bangumiDetail.subgroups[selectedSubgroupIdx]?.resources || []}
                              subgroup={subscribeTarget}
                              anime={expandedAnime}
                              {bangumiDetail}
                              onPreview={(p) => { preview = p; }}
                              onConfirm={exitSubscribeMode}
                              onCancel={exitSubscribeMode}
                            />
                           {:else}
                             <div class="mikan-split-left-head">
                               <div class="mikan-split-left-title">{bangumiDetail.name}</div>
                               <button
                                 class="mikan-refresh-btn"
                                 onclick={refreshDetail}
                                 disabled={refreshingDetail}
                                 aria-label={tr('mikan.refresh')}
                                 title={tr('mikan.refresh')}
                               >
                                 {#if refreshingDetail}
                                   <svg class="spinning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                     <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                                   </svg>
                                 {:else}
                                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                     <path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>
                                   </svg>
                                 {/if}
                               </button>
                             </div>
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
                                  {#if sg.subscription}
                                    <button
                                      class="btn btn-sm btn-outline btn-subscribed"
                                      onclick={(e) => { e.stopPropagation(); unsubscribe(sg); }}
                                    >
                                      {tr('mikan.subscribed')}
                                    </button>
                                  {:else}
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
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>

                        <!-- 右栏：资源列表 -->
                        <div class="mikan-split-right">
                          {#if bangumiDetail.subgroups[selectedSubgroupIdx]}
                            {@const sg = bangumiDetail.subgroups[selectedSubgroupIdx]}
                            <div class="mikan-resource-list">
                              {#each (fullResourcesLoaded.has(selectedSubgroupIdx) ? sg.resources : sg.resources.slice(0, 9)) as r}
                                {@const segs = preview.segments?.get(r) || [{ text: r.name, type: 'normal' }]}
                                {@const isHit = preview.hasFilter && preview.matched.includes(r)}
                                {@const isExcluded = preview.hasFilter && preview.excluded.includes(r)}
                                <div class="mikan-resource-item" class:mikan-resource--hit={isHit} class:mikan-resource--excluded={isExcluded}>
                                  <span class="mikan-resource-name">{#if isExcluded}{r.name}{:else}{#each segs as s}{#if s.type === 'normal'}{s.text}{:else}<mark class={"mikan-hl-" + s.type}>{s.text}</mark>{/if}{/each}{/if}</span>
                                  <span class="mikan-resource-meta">{r.size} · {r.date}</span>
                                </div>
                              {/each}
                              {#if sg.resources.length === 0}
                                <div class="mikan-resource-empty">
                                  {tr('mikan.noResources')}
                                </div>
                              {/if}
                              {#if !fullResourcesLoaded.has(selectedSubgroupIdx) && sg.resources.length > 9}
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
                                    {tr('mikan.loadMore')}
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


