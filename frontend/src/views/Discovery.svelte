<script module>
  // ─── Discovery 视图 ───
  // 挂载由 orchestrator 统一处理。
  import { writable } from 'svelte/store';

  // 跨组件可见性开关：router.js 的 showView 同步 discoveryOpen store。
  export const discoveryOpen = writable(false);

  // 刷新入口：实例脚本挂载时注册，main.js / 其他视图 import 调用。
  let _refreshDiscovery = null;
  export function setRefreshDiscovery(fn) { _refreshDiscovery = fn; }
  export function refreshDiscovery() {
    if (_refreshDiscovery) _refreshDiscovery();
  }
</script>

<script>
  import { onMount, tick } from 'svelte';
  import { showToast } from '../components/Toast.svelte';
  import { tr } from '../lib/anime-utils.js';
  import { createScrollAnim } from '../lib/scroll-anim.js';
  import { getViewScrollTop } from '../lib/router.js';
  import { loadLibrary } from './Library.svelte';
  import { API as api } from '../lib/api.js';
  import { isDiscoveryDirty, markDiscoveryClean } from '../lib/view-cache.js';
  import { notifyInvalidated } from '../lib/ui-state.js';

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
    if(filter === 'unimported'){
      return discoveryData.filter((n) => !n.alreadyImported && !n.excluded);
    }
    if(filter === 'excluded'){
      return discoveryData.filter((n) => n.excluded);
    }
    // 默认 fallback：all
    return discoveryData
      .filter((n) => !n.excluded)
      .sort((a, b) => (a.alreadyImported ? 1 : -1));//未导入排前
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

  // 可见时加载数据：仅在脏（isDiscoveryDirty，库变更总线/首次打开）时重拉，避免每次打开全量 fetch。
  // 缓存命中（非脏）时沿用组件内 discoveryData 直接渲染；呈现动画/滚动恢复逻辑不受影响。
  // 注意：脏标志不是响应式的 —— 库变更发生在视图打开期间不会打断当前展示，下次打开才重拉。
  $effect(() => {
    if (!$discoveryOpen) return;
    if (isDiscoveryDirty()) loadDiscovery(true);
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

  // ─── 卡片入场：ScrollTrigger.batch 视口波状渐显 ───
  // 滚动驱动、无时间 stagger；每卡一个 trigger（once:true 进视口即自毁）。
  // 数据签名（过滤/统计/行数）未变时不重建——切走再切回不重播；
  // 数据重渲染（扫描/过滤/导入/排除）后 kill 旧 trigger 再重建。
  // 视图隐藏（class:hidden / display:none）期间不建 trigger，否则位置算错。
  const discAnim = createScrollAnim();
  let discSig = '';
  $effect(() => {
    if (!$discoveryOpen) return;
    if (rows.length === 0) return;
    const sig = `${filter}|${statAnime}|${statImported}|${rows.length}`;
    if (sig === discSig) return;
    discSig = sig;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gsap = globalThis.gsap;
    if (!gsap || !gsap.ScrollTrigger) return;
    tick().then(() => {
      const root = document.getElementById('svelte-discoveryView');
      if (!root) return;
      discAnim.build({ cards: root.querySelectorAll('.discovery-card') });
    });
  });
  // 视图关闭：kill 全部 trigger 并清除残留内联样式（原 close-cleanup 逻辑并入，
  // 避免动画被中断后下次打开卡在 opacity:0）
  $effect(() => {
    if ($discoveryOpen) return;
    discAnim.kill();
  });

  onMount(() => {
    // 允许外部（orchestrator/其他视图）触发刷新
    setRefreshDiscovery(() => loadDiscovery());
    return () => {
      if (stickObserver) stickObserver.disconnect();
    };
  });

  // ─── 加载 ───
  async function loadDiscovery(fromViewSwitch = false) {
    emptyVisible = false;
    // 注意：不在入口重置 statsVisible/actionsVisible —— 保留旧状态撑住工具栏占位，
    // 数据到达后由 renderDiscovery/空分支原位更新，避免 reload 期间 display:none 闪烁。
    scanBtnVisible = true;
    scanBtnText = tr('discovery.scanDir');
    scanBtnDisabled = false;
    // 重置空状态文案，避免陈旧默认值（configureHint）泄漏
    emptyText = tr('discovery.notFound');
    emptyHint = tr('discovery.configureHint');
    // 进入恢复目标：视图切换用 router 保存值；就地刷新（扫描/过滤/导入）保持当前滚动不跳。
    const mc = document.querySelector('.main-content');
    const saved = $discoveryOpen
      ? (fromViewSwitch ? (getViewScrollTop('discovery') ?? 0) : (mc ? mc.scrollTop : 0))
      : 0;

    try {
      const config = await api.get('/api/config');
      if (!config.dirValid) {
        mediaDir = tr('discovery.noMediaDir');
        emptyVisible = true;
        emptyText = tr('discovery.notFound');
        emptyHint = tr('discovery.configureHint');
        scanBtnVisible = false;
        // 目录失效是真实状态变化 → 显式收起工具栏（原入口重置逻辑移至此处）
        statsVisible = false;
        actionsVisible = false;
        await tick();
        if ($discoveryOpen && mc) mc.scrollTop = saved;
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
        await tick();
        if ($discoveryOpen && mc) mc.scrollTop = saved;
        return;
      }

      // 取回新 tree 且非空 → 数据新鲜，清除脏标志（之后打开沿用组件内数据，不再重拉）；
      // 失败/空树保持脏，下次打开自动重试。
      markDiscoveryClean();

      renderDiscovery();
      await tick();
      if ($discoveryOpen && mc) mc.scrollTop = saved;
    } catch (e) {
      // Tauri 初始加载时静默失败
      if (!window.location.origin.startsWith('http')) return;
      showToast(tr('discovery.loadFailed', { message: e.message }), 'error');
    }
  }

  function renderDiscovery() {
    // 用原始数据判断空状态，避免过滤后为空时误判
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
    // 扫描期间保留 stats/actions 旧状态（数据未变），完成后 loadDiscovery 原位更新

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
      loadLibrary();
      // 导入走向 loadLibrary()（全量 mylistData.set），不走 patch/remove 总线；
      // 显式通知失效，让统计页缓存下次打开自动重取。
      notifyInvalidated('library');
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
      loadLibrary();
      // 解除关联同样全量写入，补失效通知（见上）。
      notifyInvalidated('library');
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
      <button class="btn btn-outline discovery-scan-btn" id="svelte-discoveryScanBtn" style:display={scanBtnVisible ? '' : 'none'} disabled={scanBtnDisabled} onclick={startScan}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path>
        </svg>
        <span id="svelte-scanBtnText">{scanBtnText}</span>
      </button>
    </div>
  </div>

  <div class="discovery-actions-sentinel" id="svelte-discoveryActionsSentinel" bind:this={sentinelEl}></div>
  <div class="discovery-actions" id="svelte-discoveryActions" style:display={statsVisible ? '' : 'none'} bind:this={actionsEl}>
    <div class="discovery-actions-left">
      {#if actionsVisible}
        <button class="btn btn-outline" id="svelte-selectAllBtn" onclick={selectAllCandidates}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/></svg>
          <span>{selectAllLabel}</span>
        </button>
        <button class="btn btn-outline" onclick={importSelected}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          <span>{tr('discovery.importSelected')}</span> (<span id="svelte-importCount">{importCount}</span>)
        </button>
      {/if}
      {#if statsVisible}
        <span class="discovery-stats" id="svelte-discoveryStats">
          <span class="discovery-stats-num">{statAnime}{tr('discovery.animeCountUnit')}</span>
          <span class="discovery-stats-sub">{statImported}{tr('discovery.importedCountUnit')}</span>
        </span>
      {/if}
    </div>
    <div class="discovery-actions-right">
      <!-- filter tabs 常驻（容器显隐由 statsVisible 统一控制），reload 期间始终可见可点 -->
      <div class="filter-group">
        <button class="filter-btn" class:filter-btn--active={filter === 'all'} data-filter="all" onclick={() => setFilter('all')}>{tr('common.all')}</button>
        <button class="filter-btn" class:filter-btn--active={filter === 'unimported'} data-filter="unimported" onclick={() => setFilter('unimported')}>{tr('discovery.unimported')}</button>
        <button class="filter-btn" class:filter-btn--active={filter === 'excluded'} data-filter="excluded" onclick={() => setFilter('excluded')}>{tr('discovery.excluded')}</button>
      </div>
      {#if actionsVisible}
        <div class="filter-group">
          <button class="filter-btn" onclick={expandAll}>{tr('discovery.expandAll')}</button>
          <button class="filter-btn" onclick={collapseAll}>{tr('discovery.collapseAll')}</button>
        </div>
      {/if}
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