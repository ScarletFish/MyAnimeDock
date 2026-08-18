<script module>
  // ─── Library 视图（Svelte 迁移版）───
  // 跨组件打开开关：router.js 的 showView 同步 libraryOpen store。
  import { writable } from 'svelte/store';

  export const libraryOpen = writable(false);

  // 刷新入口：实例脚本挂载时注册，main.js / Detail / MetaMatch / SyncModal 等 import 调用。
  let _loadLibrary = null;
  export function setLoadLibrary(fn) { _loadLibrary = fn; }
  export function loadLibrary(fromViewSwitch = false) {
    if (_loadLibrary) _loadLibrary(fromViewSwitch);
  }
</script>

<script>
  // ─── Library 视图（Svelte 迁移版）───
  // 把 index.html 的 #libraryView + src/js/library.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  // 核心逻辑（网格渲染/排序/空状态/继续观看）用 runes 重写；
  // 跨视图副作用（showDetail/openStatusModal/showView/mmOpenModal 等）通过 window 桥接现有全局。
  import { onMount, tick } from 'svelte';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';
  import StatusModal from '../components/StatusModal.svelte';
  import ContextMenu from '../components/ContextMenu.svelte';
  import LocalAnimeSection from './LocalAnimeSection.svelte';
  import { calcGridCols, readScale } from '../lib/grid.js';
  import { initScrollDots } from '../lib/scroll-dots.js';
  import { getDashboardLayout } from '../lib/dashboard-layout.js';
  import { tr } from '../lib/anime-utils.js';
  import { libraryData, pendingAutoPlay } from '../lib/ui-state.js';
  import { showView, showDetail, getLibraryScrollTop, __skipViewEnter } from '../lib/router.js';
  import { settingsOpen } from './Settings.svelte';
  import { metaMatchOpen } from './MetaMatch.svelte';
  import { API as api } from '../lib/api.js';

  // ─── Grid 列公式（原 library.js GRID_CARD_MIN/MAX）───
  const GRID_CARD_MIN = 200;
  const GRID_CARD_MAX = 277;

  // ─── 状态 ───
  let stats = $state(null);
  let layout = $state([]);
  let loading = $state(true);
  let gridCols = $state('');

  // 本次进入恢复的滚动位置 > 0（从视图中部返回）→ 模块纯淡入，抑制位移动画。
  let returnedToPosition = $state(false);

  // 状态弹窗
  let statusTarget = $state(null);
  let statusModalOpen = $state(false);

  // 右键菜单
  let ctxOpen = $state(false);
  let ctxX = $state(0);
  let ctxY = $state(0);
  let ctxItem = $state(null);

  // ─── 默认布局（镜像 dashboard-layout.js）───
  function defaultLayout() {
    return [
      { id: 'stats', enabled: true },
      { id: 'continueWatch', enabled: true },
      { id: 'localLibrary', enabled: true },
    ];
  }

  // ─── 挂载：暴露 Svelte 刷新入口 ───
  onMount(() => {
    // 外部流程（saveStatusModal/detail.js 等）调裸 loadLibrary() 时，
    // 路由到这里刷新 Svelte 库页（in-place，保留当前滚动）。
    setLoadLibrary((fromViewSwitch) => loadLibraryImpl(fromViewSwitch));
  });

  // ─── 打开时加载数据（避免启动时全量 fetch）───
  // fromViewSwitch=true：视图切换进入（从详情/其他视图返回），恢复 vanilla 保存的滚动位置；
  // fromViewSwitch=false：库页已显示时的就地刷新（状态变更等），保留当前滚动。
  $effect(() => {
    if ($libraryOpen) loadLibraryImpl(true);
  });

  // ─── 视图切换入场：容器淡入（方案 B）───
  // 视图打开时整块淡入。Library 已有模块级 fade+rise（模块浮起），容器只做淡入（y:0），
  // 避免「容器浮起 + 内部模块浮起」双层位移叠加过重。store 触发天然 once（每次打开播一次）。
  $effect(() => {
    if (!$libraryOpen) return;
    // 从详情页返回：跳过容器淡入（showView 已置 __skipViewEnter 标记，此标记每次 showView 重算）
    if (__skipViewEnter) return;
    tick().then(() => {
      const el = document.getElementById('svelte-libraryView');
      if (!el || typeof globalThis.gsap !== 'function') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const gsap = globalThis.gsap;
      gsap.killTweensOf(el);
      gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: 'power2.out', clearProps: 'opacity' });
    });
  });

  // ─── 加载 ───
  async function loadLibraryImpl(fromViewSwitch = false) {
    const mc = document.querySelector('.main-content');
    // 进入时先确定恢复目标：视图切换用 router 保存值；就地刷新用当前滚动。
    const restore = $libraryOpen && mc
      ? (fromViewSwitch ? (getLibraryScrollTop() ?? 0) : mc.scrollTop)
      : 0;
    // 返回原位置（restore>0）→ 模块纯淡入；顶部进入 → 完整位移动画。
    // 内容不足被浏览器钳回 0 时 restore>0 为假，自然走完整动画（可接受）。
    returnedToPosition = fromViewSwitch && restore > 0;
    loading = true;
    try {
      const newData = await api.get('/api/library');
      libraryData.set(newData);
      layout = getDashboardLayout();
      await loadStats();
      loading = false;
      // 等 DOM 渲染完成后恢复滚动（重渲染会重置 scrollTop）
      await tick();
      if ($libraryOpen && mc) mc.scrollTop = restore;
    } catch (e) {
      loading = false;
      if (!window.location.origin.startsWith('http')) return;
      showToast(tr('library.loadFailed', { message: e.message }), 'error');
    }
  }

  async function loadStats() {
    try {
      stats = await api.get('/api/stats');
    } catch {
      stats = null;
    }
  }

  // ─── Grid 列公式（响应 --scale）───
  $effect(() => {
    void $libraryData;
    gridCols = calcGridCols(readScale());
  });

  // ─── 继续观看（镜像 renderContinueSection）───
  const continueItems = $derived(
    $libraryData
      .filter((a) => {
        if (!a.episodes || a.episodes.length === 0) return false;
        const watchedCount = a.episodes.filter((e) => e.watched).length;
        const inProgress = a.episodes.some((e) => e.progress > 0 && !e.watched);
        return inProgress || (watchedCount > 0 && watchedCount < a.episodes.length);
      })
      .sort((a, b) => {
        const aTime = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
        const bTime = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 10)
  );

  function findContinueEpisode(anime) {
    if (!anime.episodes || anime.episodes.length === 0) return null;
    if (anime.lastPlayedEp) {
      const ep = anime.episodes.find((e) => e.number === anime.lastPlayedEp);
      if (ep && !ep.watched) return ep;
    }
    for (let i = 0; i < anime.episodes.length; i++) {
      if (!anime.episodes[i].watched) return anime.episodes[i];
    }
    return null;
  }

  function continueBg(a) {
    const ep = findContinueEpisode(a);
    let thumbUrl = '';
    if (ep) {
      if (ep.progress > 0 && ep.duration > 0) {
        let thumbTime = Math.min(Math.round(ep.progress), ep.duration - 10);
        if (thumbTime <= 0) thumbTime = 60;
        thumbUrl = '/api/thumbnail?path=' + encPath(ep.filePath) + '&time=' + thumbTime;
      } else {
        thumbUrl = '/api/thumbnail?path=' + encPath(ep.filePath) + '&time=mid';
      }
    }
    const coverSrc = a.localCover ? '/covers/' + basename(a.localCover) : '';
    return thumbUrl || coverSrc;
  }

  // encodeURIComponent 不编码单引号 '（保留 ' ( ) ! ~ * - _ .），而 continueBg 结果会放进
  // CSS url('...') 单引号字符串，路径里的 ' 会提前终止 CSS 字符串导致缩略图不显示
  // （回归 61b51d8，vanilla 用 &quot; 双引号规避，Svelte 版用单引号重新引入）。补编码 ' → %27。
  function encPath(p) {
    return encodeURIComponent(p).replace(/'/g, '%27');
  }

  function continueProgress(a) {
    const ep = findContinueEpisode(a);
    const total = a.episodes ? a.episodes.length : 0;
    return ep && total ? Math.round((ep.number / total) * 100) : 0;
  }

  function continueLabel(a) {
    const ep = findContinueEpisode(a);
    const total = a.episodes ? a.episodes.length : 0;
    return tr('library.episodeProgress', { current: ep ? ep.number : '?', total });
  }

  // ─── 继续观看：GSAP 交错入场（对齐 vanilla library.js renderContinueSectionFull animate=true）
  // 与模块级 fade 行为一致：只在视图打开时播一次；从详情页返回（__skipViewEnter）跳过；
  // 刷新/状态变更不重播（continueAnimated 标记，置位时机在视图关闭时复位）。
  // 注意：vanilla 此动画没有 prefers-reduced-motion 守卫，这里同样不加。
  let continueAnimated = false;
  $effect(() => {
    const open = $libraryOpen;
    const items = continueItems;
    if (!open) {
      continueAnimated = false;
      return;
    }
    if (loading) return;
    if (items.length === 0) return;
    if (__skipViewEnter) {
      continueAnimated = true;
      return;
    }
    if (continueAnimated) return;
    const gsap = globalThis.gsap;
    if (!gsap) return;
    continueAnimated = true;
    tick().then(() => {
      const scrollEl = document.querySelector('#svelte-libraryView .dashboard-continue-scroll');
      if (!scrollEl) return;
      const cards = scrollEl.querySelectorAll('.dashboard-continue-card');
      if (!cards.length) return;
      gsap.killTweensOf(cards);
      gsap.from(cards, {
        y: 30,
        autoAlpha: 0,
        scale: 0.92,
        duration: 0.6,
        ease: 'back.out(1.4)',
        stagger: { each: 0.08, from: 'start' },
        clearProps: 'all',
      });
    });
  });

  // ─── 继续观看横向滚动分页圆点（对齐 vanilla library.js renderContinueSectionFull）───
  $effect(() => {
    const items = continueItems;
    if (loading) return;
    if (items.length === 0) return;
    tick().then(() => {
      const scrollEl = document.querySelector('#svelte-libraryView .dashboard-continue-scroll');
      if (!scrollEl) return;
      const section = scrollEl.closest('.dashboard-section');
      const header = section ? section.querySelector('.dashboard-section-header') : null;
      initScrollDots({
        scroll: scrollEl,
        cardSelector: '.dashboard-continue-card',
        total: scrollEl.querySelectorAll('.dashboard-continue-card').length,
        dotsParent: header,
      });
    });
  });

  // ─── 模块级 fade 入场：视图打开时稳定分区容器整块淡入（交错）───
  // 只动画稳定容器（继续观看分区 + 各状态分区），不动画动态内容。
  // 触发时机是视图打开（$libraryOpen false→true），不是数据变化——用 modulesAnimated
  // 标记本次打开只播一次，刷新/状态变更不重播；同时依赖 loading，避免占位渲染期空跑。
  let modulesAnimated = false;
  $effect(() => {
    const open = $libraryOpen;
    if (!open) {
      modulesAnimated = false;
      returnedToPosition = false;
      return;
    }
    if (loading) return;
    if (modulesAnimated) return;
    // 从详情页返回：跳过本次打开的模块级 fade（标记每次 showView 重算；置 modulesAnimated
    // 避免后续 effect 重跑时重播，与 reduce-motion 分支行为一致）
    if (__skipViewEnter) {
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
      const modules = document.querySelectorAll(
        '#svelte-libraryView .dashboard-section[data-section="continueWatch"], #svelte-libraryView .status-section'
      );
      if (!modules.length) return;
      gsap.killTweensOf(modules);
      // 返回原位置（restore>0）→ 纯淡入（y 偏移 0，无位移）；顶部进入 → 现有 y:16 完整动画。
      const start = returnedToPosition ? { autoAlpha: 0 } : { autoAlpha: 0, y: 16 };
      const end = returnedToPosition
        ? { autoAlpha: 1, duration: 0.5, ease: 'power2.out', stagger: 0.1, clearProps: 'transform,opacity' }
        : { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.1, clearProps: 'transform,opacity' };
      gsap.fromTo(modules, start, end);
    });
  });

  // ─── 工具 ───
  function basename(p) {
    if (!p) return '';
    return p.split(/[\\/]/).pop();
  }

  function fmtTime(sec) {
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.round(sec / 60) + 'min';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m > 0 ? h + 'h ' + m + 'min' : h + 'h';
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  // ─── 交互 ───
  function navigateToDetail(id, el) {
    const img = el.querySelector('img');
    let rect = null;
    let imgSrc = null;
    if (img) {
      rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) rect = null;
      else imgSrc = img.currentSrc || img.src;
    }
    if (!rect) rect = el.getBoundingClientRect();
    showDetail(id, rect, imgSrc, 'library');
  }

  function navigateToDetailWithPlay(id, el) {
    pendingAutoPlay.set(id);
    navigateToDetail(id, el);
  }

  function openContextMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const item = $libraryData.find((a) => a.id === id);
    if (!item) return;
    ctxItem = item;
    ctxX = e.clientX;
    ctxY = e.clientY;
    ctxOpen = true;
  }

  function openStatus(item, e) {
    statusTarget = item;
    statusModalOpen = true;
  }

  function afterSave() {
    loadLibraryImpl(false);
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

  function getBangumiFrontendUrl() {
    return 'https://bgm.tv';
  }

  async function removeLibraryItem() {
    const item = ctxItem;
    closeCtx();
    if (!item) return;
    const name = item.bangumiTitle || item.title || item.id;
    const confirmed = await showConfirm(tr('mylist.confirmRemove', { name }));
    if (!confirmed) return;
    try {
      await api.del('/api/mylist/' + encodeURIComponent(item.id));
      showToast(tr('mylist.removed'), 'info');
      loadLibraryImpl(false);
    } catch (e) {
      showToast(tr('mylist.removeFailed', { message: e.message }), 'error');
    }
  }

  function goDiscovery() {
    showView('discovery');
  }

  function openSettings() {
    settingsOpen.set(true);
  }

  function openBatchMatch() {
    metaMatchOpen.set(true);
  }
</script>

<section class="view" id="svelte-libraryView" class:hidden={!$libraryOpen} class:view--static={returnedToPosition}>
  <div class="view-header">
    <h1>{tr('library.title')}</h1>
    <div class="view-header-right">
      <button class="btn btn-outline" onclick={openBatchMatch}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span>{tr('library.batchMatch')}</span>
      </button>
    </div>
  </div>

  <div class="dashboard" id="svelte-libraryDashboard">
    {#if loading}
      <div class="dashboard-stats-loading">{tr('common.loading')}</div>
    {:else if $libraryData.length === 0}
      <!-- 空状态 -->
      <div class="library-empty-state">
        <div class="library-empty-icon">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="8" y="14" width="48" height="40" rx="4" stroke-opacity="0.6"/>
            <path d="M8 26h48" stroke-opacity="0.3"/>
            <rect x="16" y="34" width="12" height="14" rx="1" fill="currentColor" fill-opacity="0.06" stroke-opacity="0.5"/>
            <rect x="32" y="34" width="12" height="14" rx="1" fill="currentColor" fill-opacity="0.06" stroke-opacity="0.5"/>
            <path d="M22 40l4-2v4l-4-2z" fill="currentColor" fill-opacity="0.3" stroke="none"/>
            <path d="M38 40l4-2v4l-4-2z" fill="currentColor" fill-opacity="0.3" stroke="none"/>
          </svg>
        </div>
        <h2 class="library-empty-title">{tr('library.emptyTitle')}</h2>
        <p class="library-empty-desc">{tr('library.emptyDesc1')}<br>{tr('library.emptyDesc2')}</p>
        <div class="library-empty-actions">
          <button class="btn btn-primary" onclick={goDiscovery}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            {tr('library.goDiscovery')}
          </button>
          <button class="btn" onclick={openSettings}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            {tr('library.setMediaDir')}
          </button>
        </div>
      </div>
    {:else}
      {#each layout as s (s.id)}
        {#if s.enabled && s.id === 'stats'}
          <div class="dashboard-section" data-section="stats">
            <div class="dashboard-section-header"><span class="dashboard-section-title">{tr('library.statsOverview')}</span></div>
            <div class="dashboard-section-body">
              {#if stats}
                <div class="dashboard-stats">
                  <div class="dashboard-stats-item"><b>{fmtSize(stats.totalFileSize || 0)}</b>{tr('library.statSize')}</div>
                  <div class="dashboard-stats-item"><b>{stats.totalFileCount}</b>{tr('library.statFiles')}</div>
                  <div class="dashboard-stats-item"><b>{stats.watching}</b>{tr('library.statWatching')}</div>
                  <div class="dashboard-stats-item"><b>{stats.completed}</b>{tr('library.statCompleted')}</div>
                  <div class="dashboard-stats-item"><b>{stats.total}</b>{tr('library.statLocal')}</div>
                  <div class="dashboard-stats-item"><b>{stats.totalEpWatched}</b>{tr('library.statEpisodeCount')}</div>
                  <div class="dashboard-stats-item"><b>{fmtTime(stats.totalWatchSeconds || 0)}</b>{tr('library.statDuration')}</div>
                </div>
              {/if}
            </div>
          </div>
        {:else if s.enabled && s.id === 'continueWatch'}
          {#if continueItems.length > 0}
            <div class="dashboard-section hscroll-section" data-section="continueWatch">
              <div class="dashboard-section-header"><span class="dashboard-section-title">{tr('library.continueWatching')}</span></div>
              <div class="dashboard-section-body">
                {#key continueItems}
                  <div class="dashboard-continue-scroll">
                    {#each continueItems as a (a.id)}
                      <div
                        class="dashboard-continue-card"
                        onclick={(e) => navigateToDetailWithPlay(a.id, e.currentTarget)}
                        oncontextmenu={(e) => openContextMenu(e, a.id)}
                      >
                        <div class="dashboard-continue-bg" style="background-image:url('{continueBg(a)}')"></div>
                        <div class="dashboard-continue-overlay"></div>
                        <div class="dashboard-continue-content">
                          <div class="dashboard-continue-info">
                            <div class="dashboard-continue-label">{tr('library.continuePlay')}</div>
                            <div class="dashboard-continue-title">{a.bangumiTitle || a.title}</div>
                          </div>
                        </div>
                        <div class="dashboard-continue-play" onclick={(e) => { e.stopPropagation(); navigateToDetailWithPlay(a.id, e.currentTarget); }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="8 5 19 12 8 19 8 5"/></svg>
                        </div>
                        <div class="dashboard-continue-progress-bar-wrap">
                          <div class="dashboard-continue-progress-bar"><div class="dashboard-continue-progress-fill" style="width:{continueProgress(a)}%"></div></div>
                          <span class="dashboard-continue-progress-label">{continueLabel(a)}</span>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/key}
              </div>
            </div>
          {/if}
        {:else if s.enabled && s.id === 'localLibrary'}
          <LocalAnimeSection
            items={$libraryData}
            {gridCols}
            onOpenContextMenu={(item, e) => openContextMenu(e, item.id)}
            onOpenStatus={openStatus}
          />
        {/if}
      {/each}
    {/if}
  </div>

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
      <div class="context-menu-item" onclick={() => { const it = ctxItem; closeCtx(); openStatus(it, null); }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>{tr('mylist.markStatus')}</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-danger" onclick={removeLibraryItem}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        <span>{tr('common.remove')}</span>
      </div>
    {/if}
  </ContextMenu>

  <!-- 状态弹窗 -->
  <StatusModal bind:open={statusModalOpen} item={statusTarget} onSaved={afterSave} />
</section>