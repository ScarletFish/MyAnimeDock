<script module>
  // ─── My List 视图 ───
  import { writable } from 'svelte/store';

  // 跨组件打开开关：router.js 的 showView 同步 mylistOpen store。
  export const mylistOpen = writable(false);

  // 刷新入口：实例脚本挂载时注册，main.js / Detail / MetaMatch 等 import 调用。
  let _loadMyList = null;
  export function setLoadMyList(fn) { _loadMyList = fn; }
  export function loadMyList(fromViewSwitch = false) {
    if (_loadMyList) _loadMyList(fromViewSwitch);
  }
</script>

<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';
  import AnimeCard from '../components/AnimeCard.svelte';
  import StatusSection from '../components/StatusSection.svelte';
  import StatusModal from '../components/StatusModal.svelte';
  import ContextMenu from '../components/ContextMenu.svelte';
  import { getStatusLabels, MYLIST_STATUS_ORDER, getAnimeSortOptions, sortAnimeItems } from '../lib/sort.js';
  import { calcGridCols, readScale } from '../lib/grid.js';
  import { tr, escapeHtml } from '../lib/anime-utils.js';
  import { mylistData, cardTitleMylist, mylistSortMode, patchLibraryItem, removeLibraryItemFromStore } from '../lib/ui-state.js';
  import { showDetail, getMyListScrollTop, restoreViewScroll, __skipViewEnter } from '../lib/router.js';
  import { refreshStats } from './Library.svelte';
  import { createScrollAnim } from '../lib/scroll-anim.js';
  import { Select } from 'bits-ui';
  import { API as api } from '../lib/api.js';

  // ─── 状态 ───
  let mylistFilter = $state('all');
  // ─── 排序（绑定全局 store，Detail 左右导航依赖此值）───
  let sortMode = $state(get(mylistSortMode));
  const unsubSort = mylistSortMode.subscribe((v) => { sortMode = v; });
  onDestroy(unsubSort);
  // bits-ui Select 内部管理 open/键盘导航/焦点；变更写回 store。
  $effect(() => {
    mylistSortMode.set(sortMode);
  });
  let loading = $state(false);

  // 状态弹窗
  let statusModalItem = $state(null);
  let statusModalOpen = $state(false);

  // 右键菜单
  let ctxOpen = $state(false);
  let ctxX = $state(0);
  let ctxY = $state(0);
  let ctxItem = $state(null);

  // Grid 列（响应 --scale）
  let gridCols = $state('');
  $effect(() => {
    gridCols = calcGridCols(readScale());
  });

  // ─── 打开时加载 ───
  // store 已有数据时跳过 fetch，直接用缓存渲染（返回列表页不再 loading）；
  // 首次打开（数据为空）或 mutation 回调强制刷新时才发请求。
  $effect(() => {
    if ($mylistOpen && $mylistData.length === 0) {
      loadMyListImpl(true);
    }
  });
  //命中缓存的滚动条刷新
   let scrollRestored = false;
  $effect(() => {
    if (!$mylistOpen) {
      scrollRestored = false;
      return;
    }
    if (loading) return;                // 加载中由 loadMyListImpl 负责
    if ($mylistData.length === 0) return;
    if (scrollRestored) return;

    const mc = document.querySelector('.main-content');
    if (!mc) return;

    const saved = getMyListScrollTop(); // 从 router.js 读取保存值
    restoreViewScroll(mc, saved); // 无保存值→显式回到顶部，不复用其他视图的滚动
    scrollRestored = true;
  });

  // ─── 视图切换入场：容器淡入───
  // 视图打开时整块淡入。Mylist 已有模块级 fade+rise + 卡片 ScrollTrigger，容器只做淡入（y:0），
  // 避免双层位移叠加过重。{#if} 渲染视图：tick() 等 section 进入 DOM 后再动画。
  $effect(() => {
    if (!$mylistOpen) return;
    // 从详情页返回：跳过容器淡入（showView 已置 __skipViewEnter 标记，此标记每次 showView 重算）
    if (__skipViewEnter) return;
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
    // 外部流程（saveStatusModal/detail.js 等）调裸 loadMyList() 时，
    // 路由到这里刷新我的列表页（in-place，保留当前滚动）。
    setLoadMyList((fromViewSwitch) => loadMyListImpl(fromViewSwitch));
  });

  // ─── 数据加载 ───
  // fromViewSwitch=true：视图切换进入（从详情/其他视图返回），恢复 router 保存的滚动位置；
  // fromViewSwitch=false：就地刷新（状态变更等），保留当前滚动。
  async function loadMyListImpl(fromViewSwitch = false) {
    const mc = document.querySelector('.main-content');
    const restore = $mylistOpen && mc
      ? (fromViewSwitch ? (getMyListScrollTop() ?? 0) : mc.scrollTop)
      : 0;
    loading = true;
    try {
      mylistData.set(await api.get('/api/mylist'));
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

  // ─── 过滤 ───
  function setFilter(filter) {
    mylistFilter = filter;
  }

  // ─── 派生：过滤 + 排序后的数据 ───
  let filtered = $derived.by(() => {
    let list = $mylistData;
    if (mylistFilter !== 'all') {
      list = $mylistData.filter((item) => item.status === mylistFilter);
    }
    return sortAnimeItems(list, sortMode);
  });

  // 状态栏计数
  let statusCounts = $derived.by(() => {
    const counts = { all: $mylistData.length };
    MYLIST_STATUS_ORDER.forEach((s) => (counts[s] = 0));
    $mylistData.forEach((item) => {
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

  // ─── 卡片标题常显（响应 Settings 变更）───
  let alwaysShowTitleMylist = $state(false);
  const unsubCardTitle = cardTitleMylist.subscribe((v) => { alwaysShowTitleMylist = v; });
  onDestroy(unsubCardTitle);

  // ─── 卡片渲染辅助 ───
  function basename(p) {
    if (!p) return '';
    return p.split(/[\\/]/).pop();
  }

  function coverSrc(item, size) {
    return item.localCover ? '/covers/' + basename(item.localCover) + '?w=' + size + '&q=75' : '';
  }

  function getBangumiFrontendUrl() {
    return 'https://bgm.tv';
  }

  // ─── 卡片点击 ───
  function onCardClick(item, e) {
    const cardEl = e.currentTarget;
    const img = cardEl.querySelector('img');
    let rect = null;
    let imgSrc = null;
    if (img && img.naturalWidth > 0) {
      rect = img.getBoundingClientRect();
      if (rect.width && rect.height) imgSrc = img.currentSrc || img.src;
    }
    if (!rect) rect = cardEl.getBoundingClientRect();
    showDetail(item.id, rect, imgSrc, 'mylist');
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
    const confirmed = await showConfirm({
      title: tr('library.confirmRemoveTitle', { title: escapeHtml(name) }),
      hint: tr('library.confirmRemoveHint'),
    });
    if (!confirmed) return;
    try {
      await api.del('/api/anime/' + encodeURIComponent(item.animeId || item.id));
      showToast(tr('library.deleted'), 'success');
      // 单 store：remove 已从 mylistData 移除，libraryData derived 自动消失
      removeLibraryItemFromStore(item.animeId || item.id);
      refreshStats();
    } catch (e) {
      showToast(tr('library.deleteFailed', { message: e.message }), 'error');
    }
  }

  // ─── 状态弹窗 ───
  function openStatusModal(item) {
    statusModalItem = item;
    statusModalOpen = true;
  }

  function afterSave(updatedItem) {
    // 单 store：patch 命中即两视图一致；未命中（条目不在 store）才全量兜底
    if (updatedItem && updatedItem.id && patchLibraryItem(updatedItem)) return;
    loadMyListImpl();
  }

  async function setMyListItemStatus(id, status) {
    try {
      const result = await api.put('/api/mylist/' + encodeURIComponent(id) + '/status', { status });
      showToast(tr('mylist.statusUpdated'), 'success');
      closeCtx();
      if (result && result.item) {
        if (!patchLibraryItem(result.item)) loadMyListImpl();
        refreshStats();
      } else {
        loadMyListImpl();
      }
    } catch (e) {
      showToast(tr('mylist.updateFailed', { message: e.message }), 'error');
    }
  }

  // ─── 滚动驱动入场：区块级（每 section 一个 ScrollTrigger）+ 卡片级（batch 波状）───
  // 无时间 stagger，滚动到哪、哪批内容进场。数据签名（过滤后 id 列表，含过滤/排序/数据变化）
  // 未变时不重建——切走再切回、下拉再回滚都不重播；数据变化后 kill 旧 trigger 再重建。
  const mylistAnim = createScrollAnim();
  let mylistSig = '';
  $effect(() => {
    if (!$mylistOpen) return;        // {#if} 卸载期间无 DOM，不建 trigger
    if (loading) return;             // 加载中 DOM 不完整（kill 由下方 effect 负责）
    // 签名按分组（状态桶）取 id 列表：状态迁移会带着 keyed 卡片元素换组，flat 列表会漏判
    const sig = mylistFilter === 'all'
      ? Object.entries(grouped).map(([s, arr]) => `${s}:${arr.map((a) => a.id).join(',')}`).sort().join('|')
      : filtered.map((a) => a.id).join(',');
    if (sig === mylistSig) return;   // 数据未变：不重建、不重播
    mylistSig = sig;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gsap = globalThis.gsap;
    if (!gsap || !gsap.ScrollTrigger) return;
    tick().then(() => {
      const root = document.getElementById('svelte-mylistView');
      if (!root) return;
      mylistAnim.build({
        sections: root.querySelectorAll('#svelte-mylistView .mylist-section'),
        cards: root.querySelectorAll('#svelte-mylistView .anime-card'),
      });
    });
  });
  // 视图关闭/加载中：kill 全部 trigger 并清除隐藏态内联样式（切走再切回内容直接可见）
  $effect(() => {
    if ($mylistOpen && !loading) return;
    mylistAnim.kill();
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
        ><b>{statusCounts[s] || 0}</b>{getStatusLabels()[s] || s}</div>
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
            {#each getAnimeSortOptions() as o (o.key)}
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
          <p>{mylistFilter === 'all' ? tr('common.empty') : tr('mylist.emptyFiltered', { label: getStatusLabels()[mylistFilter] || '' })}</p>
        </div>
      {:else if mylistFilter === 'all'}
        {#each MYLIST_STATUS_ORDER as status}
          {@const group = grouped[status]}
          {#if group && group.length > 0}
            <StatusSection
              variant="mylist"
              label={getStatusLabels()[status]}
              items={group}
              gridCols={gridCols}
            >
              {#snippet children(item)}
                <AnimeCard
                  {item}
                  alwaysShowTitle={alwaysShowTitleMylist}
                  showMoreBtn
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
          label={getStatusLabels()[mylistFilter] || mylistFilter}
          items={filtered}
          gridCols={gridCols}
        >
          {#snippet children(item)}
            <AnimeCard
              {item}
              alwaysShowTitle={alwaysShowTitleMylist}
              showMoreBtn
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
    {#if ctxItem}
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
{/if}