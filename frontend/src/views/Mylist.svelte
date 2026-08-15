<script module>
  // ─── My List 视图（Svelte 迁移版）───
  // 渐进迁移：把 index.html 的 #mylistView + src/js/mylist.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  import { writable } from 'svelte/store';

  // 跨组件打开开关：orchestrator 桥接 window.showView('mylist') → mylistOpen.set(true)
  export const mylistOpen = writable(false);
</script>

<script>
  import { onMount, tick } from 'svelte';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';
  import AnimeCard from '../components/AnimeCard.svelte';
  import StatusSection from '../components/StatusSection.svelte';
  import StatusModal from '../components/StatusModal.svelte';
  import ContextMenu from '../components/ContextMenu.svelte';
  import { STATUS_LABELS, MYLIST_STATUS_ORDER, ANIME_SORT_OPTIONS, sortAnimeItems } from '../lib/sort.js';
  import { calcGridCols, readScale } from '../lib/grid.js';
  import { Select } from 'bits-ui';

  // ─── i18n 辅助（复用全局 t()，回退文案）───
  function tr(key, fallback, options) {
    return typeof globalThis.t === 'function' ? globalThis.t(key, options) : fallback;
  }

  // ─── API 辅助（自包含，不复用全局 API）───
  const api = {
    async get(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async put(url, data) {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async del(url) {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };

  // ─── 状态 ───
  let mylistData = $state([]);
  let mylistFilter = $state('all');
  let sortMode = $state(localStorage.getItem('mylistSort') || 'name');
  let loading = $state(false);

  // 状态弹窗
  let statusModalItem = $state(null);
  let statusModalOpen = $state(false);

  // 右键菜单
  let ctxOpen = $state(false);
  let ctxX = $state(0);
  let ctxY = $state(0);
  let ctxItem = $state(null);

  // 愿望单详情弹窗
  let wishItem = $state(null);

  // Grid 列（响应 --scale）
  let gridCols = $state('');
  $effect(() => {
    gridCols = calcGridCols(readScale());
  });

  // ─── 打开时加载 ───
  $effect(() => {
    if ($mylistOpen) {
      loadMyList(true);
    }
  });

  // ─── 视图切换入场：容器淡入（方案 B）───
  // 视图打开时整块淡入。Mylist 已有模块级 fade+rise + 卡片 ScrollTrigger，容器只做淡入（y:0），
  // 避免双层位移叠加过重。{#if} 渲染视图：tick() 等 section 进入 DOM 后再动画。
  $effect(() => {
    if (!$mylistOpen) return;
    // 从详情页返回：跳过容器淡入（showView 已置 __skipViewEnter 标记，此标记每次 showView 重算）
    if (window.__skipViewEnter) return;
    tick().then(() => {
      const el = document.getElementById('svelte-mylistView');
      if (!el || typeof globalThis.gsap !== 'function') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const gsap = globalThis.gsap;
      gsap.killTweensOf(el);
      gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: 'power2.out', clearProps: 'opacity' });
    });
  });

  onMount(() => {
    // 桥接：vanilla 流程调裸 loadMyList() 时，main.js 的 window.loadMyList 路由到这里刷新。
    window.loadMyListSvelte = () => loadMyList();
    return () => {
      delete window.loadMyListSvelte;
    };
  });

  // ─── 数据加载 ───
  // fromViewSwitch=true：视图切换进入（从详情/其他视图返回），恢复 vanilla 保存的滚动位置；
  // fromViewSwitch=false：就地刷新（状态变更等），保留当前滚动。
  async function loadMyList(fromViewSwitch = false) {
    const mc = document.querySelector('.main-content');
    const restore = $mylistOpen && mc
      ? (fromViewSwitch ? (window.__getMyListScrollTop?.() ?? 0) : mc.scrollTop)
      : 0;
    loading = true;
    try {
      mylistData = await api.get('/api/mylist');
      // 桥接：同步到 window，供 Detail.svelte 的 goPrev/goNext/findCurrentLibraryIndex 读取
      window.mylistData = mylistData;
      loading = false;
      // 等 DOM 渲染完成后恢复滚动（重渲染会重置 scrollTop）
      await tick();
      if ($mylistOpen && mc) mc.scrollTop = restore;
    } catch (e) {
      loading = false;
      if (!window.location.origin.startsWith('http')) return;
      showToast(tr('mylist.loadFailed', { message: e.message }), 'error');
    }
  }

  // ─── 排序 ───
  // bits-ui Select 内部管理 open/键盘导航/焦点；这里仅持久化选择。
  $effect(() => {
    localStorage.setItem('mylistSort', sortMode);
  });

  // ─── 过滤 ───
  function setFilter(filter) {
    mylistFilter = filter;
  }

  // ─── 派生：过滤 + 排序后的数据 ───
  let filtered = $derived.by(() => {
    let list = mylistData;
    if (mylistFilter !== 'all') {
      list = mylistData.filter((item) => item.status === mylistFilter);
    }
    return sortAnimeItems(list, sortMode);
  });

  // 状态栏计数
  let statusCounts = $derived.by(() => {
    const counts = { all: mylistData.length };
    MYLIST_STATUS_ORDER.forEach((s) => (counts[s] = 0));
    mylistData.forEach((item) => {
      const s = item.status || 'wish';
      if (counts[s] != null) counts[s]++;
    });
    return counts;
  });

  // 分组（all 标签页）
  let grouped = $derived.by(() => {
    const groups = {};
    for (const item of filtered) {
      const s = item.status || 'wish';
      if (!groups[s]) groups[s] = [];
      groups[s].push(item);
    }
    return groups;
  });

  // ─── 卡片渲染辅助 ───
  function getCardTitleVisible(view) {
    const val = localStorage.getItem('myAnimDock_cardTitle_' + view);
    if (val === null) return false;
    return val === 'true';
  }

  function basename(p) {
    if (!p) return '';
    return p.split(/[\\/]/).pop();
  }

  function coverSrc(item, size) {
    return item.localCover ? '/covers/' + basename(item.localCover) + '?w=' + size + '&q=75' : '';
  }

  function getBangumiFrontendUrl() {
    if (typeof window.getBangumiFrontendUrl === 'function') return window.getBangumiFrontendUrl();
    return 'https://bgm.tv';
  }

  // ─── 卡片点击 ───
  function onCardClick(item, e) {
    if (item.source === 'wishlist') {
      showWishlistDetail(item);
      return;
    }
    const cardEl = e.currentTarget;
    const img = cardEl.querySelector('img');
    let rect = null;
    let imgSrc = null;
    if (img && img.naturalWidth > 0) {
      rect = img.getBoundingClientRect();
      if (rect.width && rect.height) imgSrc = img.currentSrc || img.src;
    }
    if (!rect) rect = cardEl.getBoundingClientRect();
    if (typeof window.showDetail === 'function') {
      window.showDetail(item.id, rect, imgSrc, 'mylist');
    }
  }

  // ─── 愿望单详情弹窗 ───
  function showWishlistDetail(item) {
    wishItem = item;
  }

  // ─── 右键菜单 ───
  function showMyListContextMenu(item, e) {
    e.preventDefault();
    e.stopPropagation();
    ctxItem = item;
    ctxX = e.clientX;
    ctxY = e.clientY;
    ctxOpen = true;
  }

  function closeCtx() {
    ctxOpen = false;
    ctxItem = null;
  }

  async function copyTitle() {
    const item = ctxItem;
    const title = item ? item.bangumiTitle || item.title || '' : '';
    closeCtx();
    try {
      await navigator.clipboard.writeText(title);
      showToast(tr('mylist.copied'), 'success');
    } catch (e) {
      showToast(tr('mylist.copyFailed'), 'error');
    }
  }

  function openInBgm() {
    const item = ctxItem;
    closeCtx();
    if (!item) return;
    const url = getBangumiFrontendUrl() + '/subject/' + item.id;
    if (window.__TAURI__?.shell?.open) {
      window.__TAURI__.shell.open(url).catch(() => {});
    } else {
      window.open(url, '_blank');
    }
  }

  async function removeMyListItem() {
    const item = ctxItem;
    closeCtx();
    if (!item) return;
    const name = item.bangumiTitle || item.title || item.id;
    const confirmed = await showConfirm(tr('mylist.confirmRemove', { name }));
    if (!confirmed) return;
    try {
      await api.del('/api/mylist/' + encodeURIComponent(item.id));
      showToast(tr('mylist.removed'), 'info');
      loadMyList();
    } catch (e) {
      showToast(tr('mylist.removeFailed', { message: e.message }), 'error');
    }
  }

  async function deleteWishlistItem() {
    const item = ctxItem;
    closeCtx();
    if (!item) return;
    const confirmed = await showConfirm(tr('mylist.confirmRemoveFromWishlist'));
    if (!confirmed) return;
    try {
      await api.del('/api/wishlist/' + encodeURIComponent(item.id));
      showToast(tr('mylist.removed'), 'info');
      loadMyList();
    } catch (e) {
      showToast(tr('mylist.removeFailed', { message: e.message }), 'error');
    }
  }

  // ─── 状态弹窗 ───
  function openStatusModal(item) {
    statusModalItem = item;
    statusModalOpen = true;
  }

  function afterSave() {
    loadMyList();
    if (typeof window.loadLibrary === 'function') window.loadLibrary();
  }

  async function setMyListItemStatus(id, status) {
    try {
      await api.put('/api/mylist/' + encodeURIComponent(id) + '/status', { status });
      showToast(tr('mylist.statusUpdated'), 'success');
      closeCtx();
      loadMyList();
      if (typeof window.loadLibrary === 'function') window.loadLibrary();
    } catch (e) {
      showToast(tr('mylist.updateFailed', { message: e.message }), 'error');
    }
  }

  // ─── 模块级 fade 入场：视图打开时分区容器整块淡入（交错，与 Library 一致）───
  // 触发时机是视图打开（$mylistOpen false→true），不是数据变化——用 modulesAnimated 标记
  // 每次打开只播一次，过滤/排序/刷新不重播；依赖 loading，避免占位渲染期空跑。
  let modulesAnimated = false;
  $effect(() => {
    const open = $mylistOpen;
    if (!open) {
      modulesAnimated = false;
      return;
    }
    if (loading) return;
    if (modulesAnimated) return;
    // 从详情页返回：跳过本次打开的模块级 fade（标记每次 showView 重算；置 modulesAnimated
    // 避免后续 effect 重跑时重播，与 reduce-motion 分支行为一致）
    if (window.__skipViewEnter) {
      modulesAnimated = true;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      modulesAnimated = true;
      return;
    }
    const gsap = globalThis.gsap;
    if (!gsap) {
      modulesAnimated = true;
      return;
    }
    tick().then(() => {
      modulesAnimated = true;
      const modules = document.querySelectorAll('#svelte-mylistView .mylist-section');
      if (!modules.length) return;
      gsap.killTweensOf(modules);
      gsap.fromTo(
        modules,
        { autoAlpha: 0, y: 16 },
        { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.1, clearProps: 'transform,opacity' }
      );
    });
  });

  // ─── 卡片级：网格卡片 ScrollTrigger 视口渐显（替换原 cardReveal）───
  // 每个分区（.mylist-section）建一个 ScrollTrigger，网格进入视口时卡片交错渐显（once:true）。
  // 数据重载/过滤/排序后先 kill 旧触发器再重建，避免重复触发/泄漏。
  let cardTriggers = [];
  $effect(() => {
    void filtered;
    if (loading) return;
    const gsap = globalThis.gsap;
    if (!gsap || !gsap.ScrollTrigger) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    tick().then(() => {
      cardTriggers.forEach((t) => t.kill());
      cardTriggers = [];
      if (reduce) return; // 减少动态效果：跳过动画，卡片直接显示
      const scroller = document.querySelector('.main-content');
      if (!scroller) return;
      const sections = document.querySelectorAll('#svelte-mylistView .mylist-section');
      for (const section of sections) {
        const grid = section.querySelector('.grid-container');
        if (!grid) continue;
        const cards = section.querySelectorAll('.anime-card');
        if (!cards.length) continue;
        const tween = gsap.fromTo(
          cards,
          { autoAlpha: 0, y: 24 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.5,
            ease: 'power2.out',
            stagger: 0.05,
            scrollTrigger: { trigger: grid, start: 'top 92%', once: true, scroller },
          }
        );
        if (tween.scrollTrigger) cardTriggers.push(tween.scrollTrigger);
      }
    });
  });

  // ─── 视图关闭时清理卡片 ScrollTrigger ───
  $effect(() => {
    if ($mylistOpen) return;
    if (!cardTriggers.length) return;
    cardTriggers.forEach((t) => t.kill());
    cardTriggers = [];
  });
</script>

{#if $mylistOpen}
  <section class="view" id="svelte-mylistView">
    <div class="mylist-status-bar" id="svelte-mylistStatusBar">
      <div
        class="mylist-status-item" class:active={mylistFilter === 'all'}
        data-status="all" onclick={() => setFilter('all')}
      ><b>{statusCounts.all}</b>{tr('common.all')}</div>
      {#each MYLIST_STATUS_ORDER as s}
        <div
          class="mylist-status-item" class:active={mylistFilter === s}
          data-status={s} onclick={() => setFilter(s)}
        ><b>{statusCounts[s] || 0}</b>{STATUS_LABELS[s] || s}</div>
      {/each}
    </div>

    <div class="view-header">
      <h1>{tr('mylist.title')}</h1>
      <div class="mylist-sort-bar" id="svelte-mylistSortDropdown">
        <Select.Root type="single" bind:value={sortMode}>
          <Select.Trigger class="library-sort-trigger" aria-label={tr('mylist.sort')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M6 12h12M9 18h6"/></svg>
          </Select.Trigger>
          <Select.Content class="library-sort-menu" align="end">
            {#each ANIME_SORT_OPTIONS as o (o.key)}
              <Select.Item value={o.key}>
                {#snippet child(p)}
                  <div {...p.props} class="library-sort-option" class:active={p.selected}>{o.label}</div>
                {/snippet}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>

    <div id="svelte-mylistGrid" class="mylist-grid">
      {#if loading}
        <p class="form-hint">{tr('common.loading')}</p>
      {:else if filtered.length === 0}
        <div class="empty-state" id="svelte-mylistEmpty" style="display:flex">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
          </svg>
          <p>{mylistFilter === 'all' ? tr('common.empty') : tr('mylist.emptyFiltered', { label: STATUS_LABELS[mylistFilter] || '' })}</p>
        </div>
      {:else if mylistFilter === 'all'}
        {#each MYLIST_STATUS_ORDER as status}
          {@const group = grouped[status]}
          {#if group && group.length > 0}
            <StatusSection
              variant="mylist"
              label={STATUS_LABELS[status]}
              items={group}
              gridCols={gridCols}
            >
              {#snippet children(item)}
                <AnimeCard
                  {item}
                  alwaysShowTitle={getCardTitleVisible('mylist')}
                  showMoreBtn={item.source !== 'wishlist'}
                  onClick={onCardClick}
                  onContextMenu={showMyListContextMenu}
                  onMore={openStatusModal}
                />
              {/snippet}
            </StatusSection>
          {/if}
        {/each}
      {:else}
        <StatusSection
          variant="mylist"
          label={STATUS_LABELS[mylistFilter] || mylistFilter}
          items={filtered}
          gridCols={gridCols}
        >
          {#snippet children(item)}
            <AnimeCard
              {item}
              alwaysShowTitle={getCardTitleVisible('mylist')}
              showMoreBtn={item.source !== 'wishlist'}
              onClick={onCardClick}
              onContextMenu={showMyListContextMenu}
              onMore={openStatusModal}
            />
          {/snippet}
        </StatusSection>
      {/if}
    </div>
  </section>

  <!-- 右键菜单 -->
  <ContextMenu bind:open={ctxOpen} bind:x={ctxX} bind:y={ctxY}>
    {#if ctxItem?.source === 'wishlist'}
      <div class="context-menu-item context-menu-danger" onclick={deleteWishlistItem}>{tr('mylist.removeFromWishlist')}</div>
    {:else if ctxItem}
      <div class="context-menu-item" onclick={copyTitle}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>{tr('mylist.copyTitle')}</span>
      </div>
      <div class="context-menu-item" onclick={openInBgm}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        <span>{tr('mylist.openInBgm')}</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" onclick={() => { const it = ctxItem; closeCtx(); openStatusModal(it); }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>{tr('mylist.markStatus')}</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-danger" onclick={removeMyListItem}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        <span>{tr('common.remove')}</span>
      </div>
    {/if}
  </ContextMenu>

  <!-- 状态弹窗 -->
  <StatusModal bind:open={statusModalOpen} item={statusModalItem} onSaved={afterSave} />

  <!-- 愿望单详情弹窗 -->
  {#if wishItem}
    <div class="modal-overlay show" onclick={(e) => { if (e.target === e.currentTarget) wishItem = null; }}>
      <div class="modal wishlist-detail-modal">
        {#if wishItem.coverUrl}
          <div class="wishlist-detail-cover"><img src={wishItem.coverUrl} alt={wishItem.bangumiTitle || wishItem.title} loading="lazy" decoding="async"></div>
        {/if}
        <h2>{wishItem.bangumiTitle || wishItem.title}</h2>
        {#if wishItem.rating}
          <div class="wishlist-detail-rating">★ {wishItem.rating}</div>
        {/if}
        {#if wishItem.summary}
          <p class="wishlist-detail-summary">{wishItem.summary}</p>
        {/if}
        <div class="wishlist-detail-actions">
          <a class="btn btn-primary" href={`${getBangumiFrontendUrl()}/subject/${wishItem.bangumiId}`} target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            {tr('mylist.openInBgmFull')}
          </a>
          <button class="btn btn-ghost" onclick={() => (wishItem = null)}>{tr('common.close')}</button>
        </div>
        <button class="modal-close-btn" onclick={() => (wishItem = null)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  {/if}
{/if}