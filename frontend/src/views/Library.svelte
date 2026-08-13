<script module>
  // ─── Library 视图（Svelte 迁移版）───
  // 跨组件打开开关：main.js 桥接 window.openLibrary → libraryOpen.set(true)
  import { writable } from 'svelte/store';

  export const libraryOpen = writable(false);
</script>

<script>
  // ─── Library 视图（Svelte 迁移版）───
  // 把 index.html 的 #libraryView + src/js/library.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  // 核心逻辑（网格渲染/排序/空状态/继续观看）用 runes 重写；
  // 跨视图副作用（showDetail/openStatusModal/showView/mmOpenModal 等）通过 window 桥接现有全局。
  import { onMount, tick } from 'svelte';
  import { showToast } from '../components/Toast.svelte';

  // ─── Grid 列公式（原 library.js GRID_CARD_MIN/MAX）───
  const GRID_CARD_MIN = 200;
  const GRID_CARD_MAX = 277;

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
  };

  // ─── 全局桥接（迁移期间共存）───
  function g(name) {
    return typeof window[name] === 'function' ? window[name] : null;
  }

  // ─── 状态 ───
  let libraryData = $state([]);
  let stats = $state(null);
  let layout = $state([]);
  let sortMode = $state('name');
  let sortOpen = $state(false);
  let loading = $state(true);
  let gridCols = $state('');

  // ─── 排序选项（镜像 mylist.js ANIME_SORT_OPTIONS）───
  const SORT_OPTIONS = [
    { key: 'name', label: tr('mylist.sortName', '名称') },
    { key: 'recent', label: tr('mylist.sortRecent', '最近观看') },
    { key: 'updated', label: tr('mylist.sortUpdated', '最近更新') },
    { key: 'rating', label: tr('common.rating', '评分') },
    { key: 'imported', label: tr('mylist.sortImported', '导入时间') },
  ];

  // ─── 状态分区（watching/wish/completed）───
  const STATUS_SECTIONS = [
    { status: 'watching', label: tr('common.watching', '在看') },
    { status: 'wish', label: tr('common.wish', '想看') },
    { status: 'completed', label: tr('common.completed', '看过') },
  ];

  // ─── 默认布局（镜像 dashboard-layout.js）───
  function defaultLayout() {
    return [
      { id: 'stats', enabled: true },
      { id: 'continueWatch', enabled: true },
      { id: 'localLibrary', enabled: true },
    ];
  }

  // ─── 挂载：点击外部关闭排序菜单 + 暴露 Svelte 刷新入口 ───
  onMount(() => {
    document.addEventListener('click', onDocClick);
    // 桥接：vanilla 流程（saveStatusModal/detail.js 等）调裸 loadLibrary() 时，
    // main.js 的 window.loadLibrary 路由到这里刷新 Svelte 库页（in-place，保留当前滚动）。
    window.loadLibrarySvelte = () => loadLibrary(false);
    return () => {
      document.removeEventListener('click', onDocClick);
      delete window.loadLibrarySvelte;
    };
  });

  // ─── 打开时加载数据（避免启动时全量 fetch）───
  // fromViewSwitch=true：视图切换进入（从详情/其他视图返回），恢复 vanilla 保存的滚动位置；
  // fromViewSwitch=false：库页已显示时的就地刷新（状态变更等），保留当前滚动。
  $effect(() => {
    if ($libraryOpen) loadLibrary(true);
  });

  function onDocClick(e) {
    if (sortOpen && !e.target.closest('.library-sort-bar')) sortOpen = false;
  }

  // ─── 加载 ───
  async function loadLibrary(fromViewSwitch = false) {
    const mc = document.querySelector('.main-content');
    // 进入时先确定恢复目标：视图切换用 vanilla 保存值；就地刷新用当前滚动。
    const restore = $libraryOpen && mc
      ? (fromViewSwitch ? (window.__getLibraryScrollTop?.() ?? 0) : mc.scrollTop)
      : 0;
    loading = true;
    try {
      const newData = await api.get('/api/library');
      libraryData = newData;
      const getLayout = g('getDashboardLayout');
      layout = getLayout ? getLayout() : defaultLayout();
      sortMode = localStorage.getItem('librarySort') || 'name';
      await loadStats();
      loading = false;
      // 等 DOM 渲染完成后恢复滚动（重渲染会重置 scrollTop）
      await tick();
      if ($libraryOpen && mc) mc.scrollTop = restore;
    } catch (e) {
      loading = false;
      if (!window.location.origin.startsWith('http')) return;
      showToast(tr('library.loadFailed', '加载失败：{message}', { message: e.message }), 'error');
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
    void libraryData;
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
    const min = Math.round(GRID_CARD_MIN * scale);
    const max = Math.round(GRID_CARD_MAX * scale);
    gridCols = `repeat(auto-fit, minmax(${min}px, ${max}px))`;
  });

  // ─── 继续观看（镜像 renderContinueSection）───
  const continueItems = $derived(
    libraryData
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
      if (ep && (!ep.watched || ep.progress > 0)) return ep;
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
    return tr('library.episodeProgress', '第 {current}/{total} 集', { current: ep ? ep.number : '?', total });
  }

  // ─── 状态网格（镜像 renderStatusGrids + sortAnimeItems）───
  const statusGrids = $derived(
    STATUS_SECTIONS.map((cfg) => {
      const items = sortAnimeItems(
        libraryData.filter((a) => (a.myListStatus || 'wish') === cfg.status),
        sortMode
      );
      return { ...cfg, items };
    })
  );

  function sortAnimeItems(items, mode) {
    const fn = g('sortAnimeItems');
    if (fn) return fn(items, mode);
    return items;
  }

  // ─── 继续观看：GSAP 交错入场（对齐 vanilla library.js renderContinueSectionFull animate=true）
  // 注意：vanilla 此动画没有 prefers-reduced-motion 守卫（library.js:345-356），这里同样不加，
  // 否则系统开启减少动态效果时 vanilla 有动画、Svelte 无动画，行为不一致。
  // 依赖 loading：libraryData 在 loadLibrary 中先于 loading=false 赋值，若 effect 只依赖
  // continueItems，会在 loading 占位渲染（卡片未入 DOM）时触发并空返回，永不再跑。
  $effect(() => {
    const items = continueItems;
    if (loading) return;
    if (items.length === 0) return;
    const gsap = globalThis.gsap;
    if (!gsap) return;
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
      const init = window.initScrollDots;
      if (typeof init !== 'function') return;
      init({
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
      return;
    }
    if (loading) return;
    if (modulesAnimated) return;
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
      gsap.fromTo(
        modules,
        { autoAlpha: 0, y: 16 },
        { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.1, clearProps: 'transform,opacity' }
      );
    });
  });

  // ─── 卡片级：状态网格卡片 ScrollTrigger 视口渐显（替换原 cardReveal）───
  // 适配动态网格（auto-fit 列数/卡片数不定）：每个网格建一个 ScrollTrigger，
  // 网格进入视口时卡片交错渐显（once:true）。数据重载/排序后先 kill 旧触发器再重建。
  let cardTriggers = [];
  $effect(() => {
    void statusGrids;
    if (loading) return;
    const gsap = globalThis.gsap;
    if (!gsap || !gsap.ScrollTrigger) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    tick().then(() => {
      // 清理旧触发器，避免重复触发/泄漏
      cardTriggers.forEach((t) => t.kill());
      cardTriggers = [];
      if (reduce) return; // 减少动态效果：跳过动画，卡片直接显示
      const scroller = document.querySelector('.main-content');
      if (!scroller) return;
      for (const cfg of statusGrids) {
        const grid = document.querySelector(`#svelte-libraryGrid-${cfg.status}`);
        if (!grid) continue;
        const cards = grid.querySelectorAll('.anime-card');
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
    if ($libraryOpen) return;
    if (!cardTriggers.length) return;
    cardTriggers.forEach((t) => t.kill());
    cardTriggers = [];
  });

  // ─── 卡片 HTML（复用全局 renderAnimeCard，视觉一致）───
  function cardHtml(a) {
    const getTitle = g('getCardTitleVisible');
    const alwaysShowTitle = getTitle ? getTitle('library') : false;
    const fn = g('renderAnimeCard');
    if (fn) return fn(a, { alwaysShowTitle });
    return '';
  }

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
  function toggleSort() {
    sortOpen = !sortOpen;
  }

  function selectSort(key) {
    sortMode = key;
    localStorage.setItem('librarySort', key);
    sortOpen = false;
  }

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
    const fn = g('showDetail');
    if (fn) fn(id, rect, imgSrc, 'library');
  }

  function navigateToDetailWithPlay(id, el) {
    window.pendingAutoPlay = id;
    navigateToDetail(id, el);
  }

  function openContextMenu(e, id) {
    const fn = g('showContextMenu');
    if (fn) fn(e, id);
  }

  function openStatus(e, id) {
    const fn = g('openStatusModal');
    if (fn) fn(e, id);
  }

  function goDiscovery() {
    const fn = g('showView');
    if (fn) fn('discovery');
  }

  function openSettings() {
    const fn = g('openSettings');
    if (fn) fn();
  }

  function openBatchMatch() {
    const fn = g('mmOpenModal');
    if (fn) fn();
  }
</script>

<section class="view" id="svelte-libraryView" class:hidden={!$libraryOpen}>
  <div class="view-header">
    <h1>{tr('library.title', '动漫库')}</h1>
    <div class="view-header-right">
      <button class="btn btn-outline" onclick={openBatchMatch}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span>{tr('library.batchMatch', '批量匹配')}</span>
      </button>
    </div>
  </div>

  <div class="dashboard" id="svelte-libraryDashboard">
    {#if loading}
      <div class="dashboard-stats-loading">{tr('common.loading', '加载中…')}</div>
    {:else if libraryData.length === 0}
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
        <h2 class="library-empty-title">{tr('library.emptyTitle', '动漫库是空的')}</h2>
        <p class="library-empty-desc">{tr('library.emptyDesc1', '还没有导入任何动漫。')}<br>{tr('library.emptyDesc2', '去发现页扫描媒体目录，或先设置媒体目录路径。')}</p>
        <div class="library-empty-actions">
          <button class="btn btn-primary" onclick={goDiscovery}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            {tr('library.goDiscovery', '去发现')}
          </button>
          <button class="btn" onclick={openSettings}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            {tr('library.setMediaDir', '设置媒体目录')}
          </button>
        </div>
      </div>
    {:else}
      {#each layout as s (s.id)}
        {#if s.enabled && s.id === 'stats'}
          <div class="dashboard-section" data-section="stats">
            <div class="dashboard-section-header"><span class="dashboard-section-title">{tr('library.statsOverview', '统计概览')}</span></div>
            <div class="dashboard-section-body">
              {#if stats}
                <div class="dashboard-stats">
                  <div class="dashboard-stats-item"><b>{fmtSize(stats.totalFileSize || 0)}</b>{tr('library.statSize', '总大小')}</div>
                  <div class="dashboard-stats-item"><b>{stats.totalFileCount}</b>{tr('library.statFiles', '文件数')}</div>
                  <div class="dashboard-stats-item"><b>{stats.watching}</b>{tr('library.statWatching', '在看')}</div>
                  <div class="dashboard-stats-item"><b>{stats.completed}</b>{tr('library.statCompleted', '看过')}</div>
                  <div class="dashboard-stats-item"><b>{stats.total}</b>{tr('library.statLocal', '本地')}</div>
                  <div class="dashboard-stats-item"><b>{stats.totalEpWatched}</b>{tr('library.statEpisodeCount', '已看集数')}</div>
                  <div class="dashboard-stats-item"><b>{fmtTime(stats.totalWatchSeconds || 0)}</b>{tr('library.statDuration', '观看时长')}</div>
                </div>
              {/if}
            </div>
          </div>
        {:else if s.enabled && s.id === 'continueWatch'}
          <div class="dashboard-section hscroll-section" data-section="continueWatch">
            <div class="dashboard-section-header"><span class="dashboard-section-title">{tr('library.continueWatching', '继续观看')}</span></div>
            <div class="dashboard-section-body">
              {#if continueItems.length > 0}
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
                            <div class="dashboard-continue-label">{tr('library.continuePlay', '继续播放')}</div>
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
              {/if}
            </div>
          </div>
        {:else if s.enabled && s.id === 'localLibrary'}
          <div class="dashboard-section" data-section="localLibrary">
            <div class="dashboard-section-header">
              <span class="dashboard-section-title">{tr('library.localAnime', '本地动漫')}</span>
              <div class="library-sort-bar">
                <button class="library-sort-trigger" class:open={sortOpen} onclick={toggleSort} aria-label={tr('mylist.sort', '排序')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M6 12h12M9 18h6"/></svg>
                </button>
                {#if sortOpen}
                  <div class="library-sort-menu open">
                    {#each SORT_OPTIONS as o (o.key)}
                      <div class="library-sort-option" class:active={o.key === sortMode} onclick={() => selectSort(o.key)}>{o.label}</div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
            <div class="dashboard-section-body">
              {#each statusGrids as cfg (cfg.status)}
                {#if cfg.items.length > 0}
                  <div class="status-section" id="svelte-statusSection-{cfg.status}">
                    <div class="status-section-header">
                      <span class="status-section-title">{cfg.label}</span>
                      <span class="status-section-count">{cfg.items.length}</span>
                    </div>
                    <div class="grid-container" id="svelte-libraryGrid-{cfg.status}" style="grid-template-columns:{gridCols}">
                      {#each cfg.items as a (a.id)}
                        <div
                          class="anime-card"
                          data-id={a.id}
                          onclick={(e) => navigateToDetail(a.id, e.currentTarget)}
                          oncontextmenu={(e) => openContextMenu(e, a.id)}
                        >
                          {@html cardHtml(a)}
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</section>