<script module>
  // ─── Discovery 视图（Svelte 迁移版）───
  // 渐进迁移：把 index.html 的 #discoveryView + src/js/discovery.js 迁移为 Svelte 组件。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  // 挂载由 orchestrator 统一处理（不修改 App.svelte / main.js / index.html）。
  import { writable } from 'svelte/store';

  // 跨组件可见性开关：orchestrator 桥接 window.openDiscovery → discoveryOpen.set(true)
  export const discoveryOpen = writable(false);
</script>

<script>
  import { onMount, tick } from 'svelte';
  import { showToast } from '../components/Toast.svelte';

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
    async post(url, data) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };

  // ─── 状态 ───
  let discoveryData = $state([]);
  let checkedPaths = $state(new Set());
  let expandedPaths = $state(new Set());
  let isScanning = $state(false);
  let filter = $state('all');

  // 视图可见性/文案
  let mediaDir = $state(tr('discovery.notConfigured'));
  let emptyVisible = $state(false);
  let emptyText = $state(tr('discovery.notFound'));
  let emptyHint = $state(tr('discovery.configureHint'));
  let statsVisible = $state(false);
  let actionsVisible = $state(false);
  let scanBtnVisible = $state(true);
  let scanBtnText = $state(tr('discovery.scanDir'));
  let scanBtnDisabled = $state(false);

  // 统计（派生）
  let statAnime = $derived(discoveryData.length);
  let statImported = $derived(discoveryData.filter((n) => n.alreadyImported).length);
  let importCount = $derived(checkedPaths.size);

  // 过滤后的展示数据（派生）
  let displayData = $derived.by(() => {
    let data = discoveryData;
    if (filter === 'unimported') {
      data = discoveryData.filter((n) => !n.alreadyImported && !n.excluded);
    } else if (filter === 'excluded') {
      data = discoveryData.filter((n) => n.excluded);
    } else if (filter === 'all') {
      data = discoveryData.filter((n) => !n.excluded);
      // 未导入排前
      data = [...data].sort((a, b) => (a.alreadyImported ? 1 : -1));
    }
    return data;
  });

  // 分组行（父目录下多个子项 → sibling group；单个子项 → 展平父目录）
  let rows = $derived.by(() => {
    const parentCounts = {};
    for (const n of displayData) {
      const key = (n.parentChain || []).join('\0');
      if (key) parentCounts[key] = (parentCounts[key] || 0) + 1;
    }
    const out = [];
    let i = 0;
    while (i < displayData.length) {
      const key = (displayData[i].parentChain || []).join('\0');
      const isSibling = key && parentCounts[key] > 1;
      if (isSibling) {
        const group = [];
        while (i < displayData.length && (displayData[i].parentChain || []).join('\0') === key) {
          group.push(displayData[i]);
          i++;
        }
        out.push({ type: 'group', items: group });
      } else {
        const singleChild = key && parentCounts[key] === 1;
        const node = singleChild ? { ...displayData[i], parentChain: [] } : displayData[i];
        out.push({ type: 'card', node });
        i++;
      }
    }
    return out;
  });

  // 全选按钮文案（派生）
  let selectAllLabel = $derived.by(() => {
    const candidates = displayData.filter((n) => !n.alreadyImported && !n.excluded);
    const allChecked = candidates.length > 0 && candidates.every((n) => checkedPaths.has(n.path));
    return allChecked ? tr('discovery.unselectAll') : tr('discovery.selectAll');
  });

  // 清理失效的勾选路径
  $effect(() => {
    const validPaths = new Set(displayData.filter((n) => !n.alreadyImported && !n.excluded).map((n) => n.path));
    let changed = false;
    const s = new Set(checkedPaths);
    for (const p of s) {
      if (!validPaths.has(p)) {
        s.delete(p);
        changed = true;
      }
    }
    if (changed) checkedPaths = s;
  });

  // Sticky action bar：观察 sentinel，滚动时给 actions 加 stuck 类
  let actionsEl = $state(null);
  let sentinelEl = $state(null);
  let stickObserver = null;
  $effect(() => {
    if (actionsVisible && sentinelEl && actionsEl) {
      if (stickObserver) stickObserver.disconnect();
      stickObserver = new IntersectionObserver(
        ([e]) => {
          actionsEl.classList.toggle('discovery-actions--stuck', !e.isIntersecting);
        },
        { threshold: [0] }
      );
      stickObserver.observe(sentinelEl);
    } else if (stickObserver) {
      // actions 隐藏时清理观察者，避免残留 observer 继续 toggle 隐藏元素
      stickObserver.disconnect();
      stickObserver = null;
    }
  });

  // 可见时加载数据，避免启动时全量 fetch
  $effect(() => {
    if ($discoveryOpen) loadDiscovery();
  });

  // ─── 视图切换入场：fade + rise（方案 B）───
  // 视图打开（store false→true）时整块淡入上浮。用 tick() 等 DOM 更新后再动画，
  // 避免在 class:hidden 未移除时对隐藏元素空跑。
  $effect(() => {
    if (!$discoveryOpen) return;
    tick().then(() => {
      const el = document.getElementById('svelte-discoveryView');
      if (!el || typeof globalThis.gsap !== 'function') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const gsap = globalThis.gsap;
      gsap.killTweensOf(el);
      gsap.fromTo(
        el,
        { autoAlpha: 0, y: 16 },
        { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out', clearProps: 'transform,opacity' }
      );
    });
  });

  // 卡片入场动画（对齐 vanilla discovery.js:202-204）
  // 只依赖数据变化（rows），不依赖视图开关——切走再切回不重新动画，与 vanilla 一致
  $effect(() => {
    if (rows.length === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gsap = globalThis.gsap;
    if (!gsap) return;
    tick().then(() => {
      const cards = document.querySelectorAll('#svelte-discoveryView .discovery-card');
      if (!cards.length) return;
      gsap.killTweensOf(cards);
      // 目标透明度按卡片状态 class 推导（已导入 0.5/排除 0.6/普通 1），与 CSS 规则一致。
      // 从 0 淡入到各自真实值，避免统一淡到 1 后 clearProps 瞬间回落到 CSS 值造成「白→浅白」跳变。
      // 不用 getComputedStyle：切换筛选时上一轮动画可能被 kill 中断，卡片残留 inline opacity
      // （中间值甚至 0），读取计算样式会得到残留值导致目标透明度错误（0→0 卡死不可见）。
      const targetOpacities = Array.from(cards).map((c) =>
        c.classList.contains('discovery-card--imported') ? 0.5
        : c.classList.contains('discovery-card--excluded') ? 0.6
        : 1
      );
      gsap.fromTo(cards,
        { opacity: 0, y: 12 },
        {
          opacity: (i) => targetOpacities[i],
          y: 0,
          stagger: 0.03,
          duration: 0.3,
          ease: 'power2.out',
          clearProps: 'transform',
        }
      );
    });
  });

  // 视图关闭时清除残留内联样式，避免动画被中断后下次打开卡在 opacity:0
  $effect(() => {
    if ($discoveryOpen) return;
    document.querySelectorAll('#svelte-discoveryView .discovery-card').forEach((c) => {
      c.style.opacity = '';
      c.style.transform = '';
    });
  });

  onMount(() => {
    // 桥接：允许外部（orchestrator/其他视图）触发刷新
    window.refreshDiscoverySvelte = () => loadDiscovery();
    return () => {
      if (stickObserver) stickObserver.disconnect();
      delete window.refreshDiscoverySvelte;
    };
  });

  // ─── 加载 ───
  async function loadDiscovery() {
    emptyVisible = false;
    statsVisible = false;
    actionsVisible = false;
    scanBtnVisible = true;
    scanBtnText = tr('discovery.scanDir');
    scanBtnDisabled = false;
    // 重置空状态文案，避免陈旧默认值（configureHint）泄漏
    emptyText = tr('discovery.notFound');
    emptyHint = tr('discovery.configureHint');

    try {
      const config = await api.get('/api/config');
      if (!config.dirValid) {
        mediaDir = tr('discovery.noMediaDir');
        emptyVisible = true;
        emptyText = tr('discovery.notFound');
        emptyHint = tr('discovery.configureHint');
        scanBtnVisible = false;
        return;
      }
      mediaDir = config.mediaDir;

      const showExcluded = filter === 'excluded';
      const resp = await api.get(`/api/browse${showExcluded ? '?showExcluded=true' : ''}`);
      discoveryData = resp.tree || [];

      if (discoveryData.length === 0) {
        emptyVisible = true;
        emptyText = tr('discovery.notScanned');
        emptyHint = tr('discovery.clickScanToStart');
        statsVisible = false;
        actionsVisible = false;
        return;
      }

      renderDiscovery();
    } catch (e) {
      // Tauri 初始加载时静默失败
      if (!window.location.origin.startsWith('http')) return;
      showToast(tr('discovery.loadFailed', { message: e.message }), 'error');
    }
  }

  function renderDiscovery() {
    // 用原始数据判断空状态（对齐 vanilla discovery.js:123），避免过滤后为空时误判
    if (discoveryData.length === 0) {
      emptyVisible = true;
      emptyText = tr('discovery.noAnimeFound');
      statsVisible = false;
      actionsVisible = false;
      return;
    }
    emptyVisible = false;
    statsVisible = true;
    const hasNew = discoveryData.some((n) => !n.alreadyImported && !n.excluded);
    actionsVisible = hasNew;
  }

  // ─── 扫描 ───
  async function startScan() {
    if (isScanning) return;
    isScanning = true;
    scanBtnDisabled = true;
    scanBtnText = tr('discovery.scanning');
    emptyVisible = false;
    statsVisible = false;
    actionsVisible = false;

    try {
      const resp = await fetch('/api/scan');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const msg = JSON.parse(line.slice(6));
          if (msg.type === 'progress') {
            scanBtnText = tr('discovery.scanProgress', { current: msg.current, total: msg.total });
          } else if (msg.type === 'done') {
            loadDiscovery();
          } else if (msg.type === 'error') {
            showToast(tr('discovery.scanFailed', { message: msg.message }), 'error');
          }
        }
      }
    } catch (e) {
      showToast(tr('discovery.scanFailed', { message: e.message }), 'error');
    }

    scanBtnDisabled = false;
    scanBtnText = tr('discovery.rescan');
    isScanning = false;
  }

  // ─── 过滤 ───
function setFilter(f) {
    filter = f;
    loadDiscovery(); // 重新拉取（excluded 需 showExcluded=true），匹配 vanilla onChange 行为
  }

  // ─── 勾选 ───
  function onCardCheck(node, e) {
    const s = new Set(checkedPaths);
    if (e.currentTarget.checked) s.add(node.path);
    else s.delete(node.path);
    checkedPaths = s;
  }

  function selectAllCandidates() {
    const candidates = displayData.filter((n) => !n.alreadyImported && !n.excluded);
    if (candidates.length === 0) return;
    const allChecked = candidates.every((n) => checkedPaths.has(n.path));
    const s = new Set(checkedPaths);
    if (!allChecked) candidates.forEach((n) => s.add(n.path));
    else candidates.forEach((n) => s.delete(n.path));
    checkedPaths = s;
  }

  // ─── 展开/折叠 ───
  function toggleCardFiles(node) {
    const s = new Set(expandedPaths);
    if (s.has(node.path)) s.delete(node.path);
    else s.add(node.path);
    expandedPaths = s;
  }

  function expandAll() {
    const s = new Set();
    displayData.forEach((n) => {
      if (n.videos && n.videos.length) s.add(n.path);
    });
    expandedPaths = s;
  }

  function collapseAll() {
    expandedPaths = new Set();
  }

  // ─── 导入 ───
  async function importSelected() {
    const paths = Array.from(checkedPaths);
    const items = discoveryData
      .filter((n) => paths.includes(n.path) && !n.alreadyImported)
      .map((n) => ({
        folderPath: n.path,
        folderName: n.name,
        parsedTitle: n.parsedTitle,
        parsedSeason: n.parsedSeason,
        specialSuffix: n.specialSuffix,
      }));
    if (items.length === 0) {
      showToast(tr('discovery.selectFirst'), 'warning');
      return;
    }
    try {
      const result = await api.post('/api/import', { items });
      showToast(tr('discovery.importedCount', { count: result.imported.length }), 'success');
      showToast(tr('discovery.autoAddedToMylist'), 'silent');
      loadDiscovery();
      if (typeof window.loadLibrary === 'function') window.loadLibrary();
    } catch (e) {
      showToast(tr('discovery.importFailed', { message: e.message }), 'error');
    }
  }

  // ─── 单卡内联操作 ───
  async function unlinkSingle(path) {
    try {
      await api.post('/api/discovery/unlink', { path });
      showToast(tr('discovery.unlinked'), 'info');
      const s = new Set(checkedPaths);
      s.delete(path);
      checkedPaths = s;
      loadDiscovery();
      if (typeof window.loadLibrary === 'function') window.loadLibrary();
    } catch (e) {
      showToast(tr('discovery.unlinkFailed', { message: e.message }), 'error');
    }
  }

  async function excludeSingle(path) {
    try {
      await api.post('/api/discovery/exclude', { path });
      showToast(tr('discovery.excludedScan'), 'info');
      loadDiscovery();
    } catch (e) {
      showToast(tr('discovery.excludeFailed', { message: e.message }), 'error');
    }
  }

  async function includeSingle(path) {
    try {
      await api.post('/api/discovery/include', { path });
      showToast(tr('discovery.unexcluded'), 'info');
      loadDiscovery();
    } catch (e) {
      showToast(tr('discovery.unexcludeFailed', { message: e.message }), 'error');
    }
  }
</script>

{#snippet card(node, showLine)}
  {@const hasVideos = node.videos && node.videos.length > 0}
  {@const chain = node.parentChain || []}
  {@const hasChain = chain.length > 0}
  {@const showParentChain = hasChain && chain[chain.length - 1] !== node.parsedTitle}
  {@const sizeMB = (node.totalSize / (1024 * 1024)).toFixed(0)}
  {@const seasonText = node.parsedSeason ? ` S${node.parsedSeason}` : ''}
  {@const fileId = 'svelte-dc-' + node.path.replace(/[^a-zA-Z0-9]/g, '-')}
  {@const excluded = node.excluded || false}
  {@const isExpanded = expandedPaths.has(node.path)}
  <div
    class="discovery-card"
    class:discovery-card--imported={node.alreadyImported}
    class:discovery-card--sibling={showLine}
    class:discovery-card--excluded={excluded}
    data-path={node.path}
  >
    <div class="discovery-card-main">
      {#if hasVideos}
        <span class="discovery-card-toggle" class:open={isExpanded} onclick={(e) => { e.stopPropagation(); toggleCardFiles(node); }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>
        </span>
      {:else}
        <span class="discovery-card-toggle discovery-card-toggle--hidden"></span>
      {/if}
      <label class="discovery-card-row" for={fileId}>
        {#if !node.alreadyImported && !excluded}
          <input type="checkbox" class="discovery-cb" id={fileId} checked={checkedPaths.has(node.path)} onchange={(e) => onCardCheck(node, e)}>
          <span class="discovery-cb-visual">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        {/if}
        <span class="discovery-card-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M2 9h20"/></svg>
        </span>
        <div class="discovery-card-info">
          <div class="discovery-card-title-row">
            <span class="discovery-card-title" class:discovery-card-title--imported={node.alreadyImported} class:discovery-card-title--excluded={excluded}>{node.parsedTitle}{seasonText}</span>
            <div class="discovery-card-row-actions">
              {#if node.alreadyImported}
                <button class="discovery-card-action discovery-card-unlink" onclick={(e) => { e.preventDefault(); e.stopPropagation(); unlinkSingle(node.path); }} data-tooltip={tr('discovery.unlink')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
                  {tr('discovery.unlink')}
                </button>
              {/if}
              {#if !node.alreadyImported && !excluded}
                <button class="discovery-card-action discovery-card-exclude" onclick={(e) => { e.preventDefault(); e.stopPropagation(); excludeSingle(node.path); }} data-tooltip={tr('discovery.excludeScan')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                  {tr('discovery.exclude')}
                </button>
              {/if}
              {#if excluded}
                <button class="discovery-card-action discovery-card-unexclude" onclick={(e) => { e.preventDefault(); e.stopPropagation(); includeSingle(node.path); }} data-tooltip={tr('discovery.unexclude')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
                  {tr('discovery.unexclude')}
                </button>
              {/if}
            </div>
          </div>
          <span class="discovery-card-meta">{tr('discovery.meta', { count: node.videoCount, size: sizeMB })}</span>
        </div>
        {#if excluded}
          <span class="discovery-badge discovery-badge--excluded">{tr('discovery.excluded')}</span>
        {:else if node.alreadyImported}
          <span class="discovery-badge discovery-badge--imported">{tr('discovery.imported')}</span>
        {:else}
          <span class="discovery-badge discovery-badge--new">{tr('discovery.new')}</span>
        {/if}
      </label>
    </div>
    {#if showParentChain || hasVideos}
      <div class="discovery-annotation" class:discovery-annotation--nested={showParentChain}>
        {#if showParentChain}
          <div class="discovery-parent">
            {#each chain as p, i}{p}{#if i < chain.length - 1}<br>{/if}{/each}
          </div>
        {/if}
        {#if hasVideos}
          <ul class="discovery-card-files" class:collapsed={!isExpanded}>
            {#each node.videos as v}
              <li class="discovery-card-file" data-tooltip={v.name}>
                <span class="discovery-card-file-icon">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </span>
                <span class="discovery-card-file-name">{v.name}</span>
                <span class="discovery-card-file-size">{(v.size / 1024 / 1024).toFixed(0)} MB</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<!-- Discovery View -->
<section class="view" class:hidden={!$discoveryOpen} id="svelte-discoveryView">
  <div class="view-header" id="svelte-discoveryHero">
    <div>
      <h1>{tr('discovery.mediaDir')}</h1>
      <p class="discovery-hero-path" id="svelte-discoveryPath">{mediaDir}</p>
    </div>
    <div class="view-header-right">
      <div class="discovery-stats-pills" id="svelte-discoveryStats" style:display={statsVisible ? '' : 'none'}>
        <span class="stat-pill"><span id="svelte-statAnime">{statAnime}</span><span>{tr('discovery.animeCountUnit')}</span></span>
        <span class="stat-pill"><span id="svelte-statImported">{statImported}</span><span>{tr('discovery.importedCountUnit')}</span></span>
      </div>
      <button class="btn btn-outline discovery-scan-btn" id="svelte-discoveryScanBtn" style:display={scanBtnVisible ? '' : 'none'} disabled={scanBtnDisabled} onclick={startScan}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path>
        </svg>
        <span id="svelte-scanBtnText">{scanBtnText}</span>
      </button>
    </div>
  </div>

  <div class="discovery-actions-sentinel" id="svelte-discoveryActionsSentinel" bind:this={sentinelEl}></div>
  <div class="discovery-actions" id="svelte-discoveryActions" style:display={actionsVisible ? '' : 'none'} bind:this={actionsEl}>
    <div class="discovery-actions-left">
      <button class="btn btn-outline" id="svelte-selectAllBtn" onclick={selectAllCandidates}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/></svg>
        <span>{selectAllLabel}</span>
      </button>
      <button class="btn btn-outline" onclick={importSelected}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        <span>{tr('discovery.importSelected')}</span> (<span id="svelte-importCount">{importCount}</span>)
      </button>
    </div>
    <div class="discovery-actions-right">
      <div class="filter-group">
        <button class="filter-btn" class:filter-btn--active={filter === 'all'} data-filter="all" onclick={() => setFilter('all')}>{tr('common.all')}</button>
        <button class="filter-btn" class:filter-btn--active={filter === 'unimported'} data-filter="unimported" onclick={() => setFilter('unimported')}>{tr('discovery.unimported')}</button>
        <button class="filter-btn" class:filter-btn--active={filter === 'excluded'} data-filter="excluded" onclick={() => setFilter('excluded')}>{tr('discovery.excluded')}</button>
      </div>
      <div class="filter-group">
        <button class="filter-btn" onclick={expandAll}>{tr('discovery.expandAll')}</button>
        <button class="filter-btn" onclick={collapseAll}>{tr('discovery.collapseAll')}</button>
      </div>
    </div>
  </div>

  <div class="discovery-grid" id="svelte-discoveryGrid">
    {#each rows as row}
      {#if row.type === 'group'}
        <div class="discovery-sibling-group">
          {#each row.items as node}
            {@render card(node, true)}
          {/each}
        </div>
      {:else}
        {@render card(row.node, false)}
      {/if}
    {/each}
  </div>

  <div class="empty-state" id="svelte-discoveryEmpty" style:display={emptyVisible ? 'flex' : 'none'}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
    <p id="svelte-discoveryEmptyText">{emptyText}</p>
    <p class="empty-hint">{emptyHint}</p>
  </div>
</section>