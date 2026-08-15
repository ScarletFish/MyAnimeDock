<script module>
  // ─── MetaMatch 视图（Svelte 迁移版）───
  // 把 vanilla 的批量元数据匹配工作台 frontend/src/js/metamatch.js 迁移为 Svelte 组件树。
  // 复用现有 CSS 类名（视觉不变），与 vanilla 版共存（后续清理阶段再删 vanilla）。
  import { writable } from 'svelte/store';

  // 跨组件打开开关：main.js 桥接 window.mmOpenModal → metaMatchOpen.set(true)
  export const metaMatchOpen = writable(false);
</script>

<script>
  import { onMount } from 'svelte';
  import { showToast } from '../components/Toast.svelte';
  import { tr } from '../lib/anime-utils.js';
  import { createSyncStream } from '../lib/sync-stream.js';
  import MetaMatchToolbar from '../components/metamatch/MetaMatchToolbar.svelte';
  import MetaMatchList from '../components/metamatch/MetaMatchList.svelte';
  import MetaMatchPanel from '../components/metamatch/MetaMatchPanel.svelte';

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

  // ─── 确认弹窗（桥接全局 showConfirm，回退 true）───
  function showConfirm(message) {
    if (typeof window.showConfirm === 'function') return window.showConfirm(message);
    return Promise.resolve(true);
  }

  // ─── 共享状态（$state runes）───
  let items = $state([]);
  let filter = $state('all');
  let search = $state('');
  let selectedId = $state(null);
  let selectedIds = $state([]); // 用数组保序（Svelte 5 的 $state 不代理 Set）
  let syncInProgress = $state(false);
  let syncLog = $state([]);
  let panelVisible = $state(false);
  let syncLogVisible = $state(false);
  let needsRefresh = $state(false);
  let emptyMsg = $state('');

  // 非响应式内部状态（SSE 流 / 取消标记）
  let syncStream = null;
  let syncCancelled = false;

  // ─── 派生值 ───

  // 筛选 + 排序（替代 mmApplyFilters）
  let filteredItems = $derived.by(() => {
    const searchVal = search.toLowerCase().trim();
    let result = items.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false;
      if (searchVal) {
        const searchable = [
          item.title,
          item.folderName,
          item.bangumiTitle,
          item.pinyinTitle,
          item.meta?.bangumiTitle,
          item.meta?.bangumiTitleJp,
        ].filter(Boolean).map((s) => s.toLowerCase()).join(' ');
        if (!searchable.includes(searchVal)) return false;
      }
      return true;
    });
    const statusOrder = { pending: 0, failed: 1, matching: 2, matched: 3 };
    result.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 4;
      const sb = statusOrder[b.status] ?? 4;
      if (sa !== sb) return sa - sb;
      return items.indexOf(a) - items.indexOf(b);
    });
    return result;
  });

  // 统计徽章（替代 mmUpdateStats）
  let stats = $derived.by(() => {
    const total = items.length;
    const matched = items.filter((i) => i.status === 'matched').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const matching = items.filter((i) => i.status === 'matching').length;
    const pending = items.filter((i) => i.status === 'pending').length;
    return { total, matched, failed, matching, pending, selectedCount: selectedIds.length };
  });

  // 进度条（替代 mmUpdateProgress）
  let progress = $derived.by(() => {
    const total = items.length;
    const done = items.filter((i) => i.status === 'matched' || i.status === 'failed').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { pct, done, total };
  });

  // 主按钮优先级（替代 mmUpdateMainAction / mmMainAction 的文案部分）
  let mainAction = $derived.by(() => {
    const hasSelection = selectedIds.length > 0;
    const hasPending = items.some((i) => i.status === 'pending');
    const hasFailed = items.some((i) => i.status === 'failed');
    if (!hasPending && !hasFailed) {
      return { text: tr('metamatch.allMatched', '全部已匹配'), disabled: true, className: 'btn' };
    }
    if (hasSelection) {
      return { text: tr('metamatch.syncSelected', '同步选中 ({{n}})', { n: selectedIds.length }), disabled: false, className: 'btn btn-outline' };
    }
    if (hasFailed && !hasPending) {
      const cnt = items.filter((i) => i.status === 'failed').length;
      return { text: tr('metamatch.retryFailed', '重试失败 ({{n}})', { n: cnt }), disabled: false, className: 'btn btn-outline' };
    }
    return { text: tr('metamatch.autoMatchAll', '自动匹配全部'), disabled: false, className: 'btn btn-outline' };
  });

  // 当前选中条目
  let selectedItem = $derived(items.find((i) => i.animeId === selectedId) || null);

  // 同步日志汇总（替代 mmRenderSyncSummary 的统计部分）
  let syncSummary = $derived.by(() => {
    const matched = syncLog.filter((e) => e.status === 'matched').length;
    const failed = syncLog.filter((e) => e.status === 'failed').length;
    return { matched, failed, total: syncLog.length };
  });

  // ─── 数据加载（替代 mmLoadModalData）───
  async function loadModalData() {
    try {
      items = [];
      filter = 'all';
      search = '';
      selectedId = null;
      syncInProgress = false;
      selectedIds = [];
      syncLog = [];
      panelVisible = false;
      syncLogVisible = false;
      emptyMsg = '';

      const libData = await api.get('/api/library');
      if (!libData || libData.length === 0) {
        emptyMsg = tr('metamatch.emptyLibraryImport', '动漫库为空，请先导入动漫');
        return;
      }

      items = libData.map((a) => ({
        animeId: a.id,
        title: a.title || a.folderName || a.bangumiTitle || tr('metamatch.unknown', '未知'),
        folderName: a.folderName || a.title || '',
        specialSuffix: a.specialSuffix || null,
        parsedSeason: a.matchedSeason || a.season || (a.specialSuffix ? null : 1),
        episodeCount: a.episodes ? a.episodes.length : 0,
        status: a.bangumiId && a.bangumiTitle ? 'matched' : 'pending',
        error: null,
        pinyinTitle: a.pinyinTitle || '',
        matchedSeason: a.matchedSeason || null,
        meta: a.bangumiId
          ? {
              bangumiId: a.bangumiId,
              bangumiTitle: a.bangumiTitle,
              bangumiTitleJp: a.bangumiTitleJp,
              summary: a.summary,
              coverUrl: a.localCover,
              localCover: a.localCover,
              rating: a.rating,
              metadataSource: a.metadataSource,
            }
          : null,
        coverUrl: a.localCover || null,
        localCover: a.localCover || null,
        bangumiTitle: a.bangumiTitle,
        season: a.matchedSeason || a.season,
        anilistId: a.anilistId,
        anilistBanner: a.anilistBanner || null,
        anilistTitleEn: a.anilistTitleEn || null,
        anilistTags: a.anilistTags || null,
        anilistCover: a.anilistCover || null,
      }));
    } catch (e) {
      if (!window.location.origin.startsWith('http')) return;
      showToast(tr('metamatch.loadLibraryFailed', '加载动漫库失败: {{error}}', { error: e.message }), 'error');
      emptyMsg = tr('metamatch.loadLibraryFailedHint', '加载动漫库失败: {{error}} · 请检查服务器是否运行', { error: e.message });
    }
  }

  // ─── 选择模型（5 个交互，逐条保留）───

  // 面板跟随最后点击条目
  function selectForPanel(animeId) {
    selectedId = animeId;
    syncLogVisible = false;
    panelVisible = true;
  }

  // 关闭面板
  function deselectPanel() {
    selectedId = null;
    syncLogVisible = false;
    panelVisible = false;
  }

  // Shift=切换多选（vanilla 547-550）
  function toggleSelect(animeId) {
    if (selectedIds.includes(animeId)) {
      selectedIds = selectedIds.filter((id) => id !== animeId);
      // deselect 面板条目时切到最近选中或关闭（vanilla 377-383）
      if (panelVisible && animeId === selectedId) {
        if (selectedIds.length > 0) {
          selectForPanel(selectedIds[selectedIds.length - 1]);
        } else {
          deselectPanel();
        }
      }
    } else {
      selectedIds = [...selectedIds, animeId];
      // 新增选中时让详情面板跟随最后点击的条目（vanilla 388）
      selectForPanel(animeId);
    }
  }

  function clearSelection() {
    selectedIds = [];
    if (panelVisible) deselectPanel();
  }

  // 行点击（vanilla mmRowClick）
  function rowClick(animeId, shiftKey) {
    if (syncInProgress) return; // 同步中行不可点（vanilla 545）

    if (shiftKey) {
      toggleSelect(animeId);
      return;
    }

    // 单击已选中的单项=取消选中（vanilla 553-556）
    if (selectedIds.includes(animeId) && selectedIds.length === 1) {
      selectedIds = [];
      if (panelVisible && selectedId === animeId) deselectPanel();
    } else {
      selectedIds = [animeId];
      selectForPanel(animeId);
    }
  }

  // ─── 主按钮（vanilla mmMainAction）───
  function handleMainAction() {
    if (syncInProgress) return;

    // Priority 1: 同步选中
    if (selectedIds.length > 0) {
      const ids = [...selectedIds];
      selectedIds = [];
      ids.forEach((id) => {
        const item = items.find((i) => i.animeId === id);
        if (item) { item.status = 'pending'; item.error = null; item.meta = null; }
      });
      matchItems(ids);
      return;
    }

    // Priority 2: 重试失败
    const failedItems = items.filter((i) => i.status === 'failed');
    if (failedItems.length > 0) {
      const ids = failedItems.map((i) => i.animeId);
      failedItems.forEach((i) => { i.status = 'pending'; i.error = null; });
      matchItems(ids);
      return;
    }

    // Priority 3: 匹配全部 pending
    matchItems();
  }

  // ─── 同步日志 ───
  function addSyncLogEntry(animeId, searchTerm, status, detail) {
    const existing = syncLog.find((e) => e.animeId === animeId);
    if (existing) {
      existing.status = status;
      existing.detail = detail;
    } else {
      syncLog.push({ animeId, searchTerm, status, detail });
    }
  }

  // ─── 统一匹配入口（替代 mmMatchItems + mmSyncViaSSE）───
  async function matchItems(animeIds, options = {}) {
    if (syncInProgress) return;

    const ids = animeIds ? (Array.isArray(animeIds) ? animeIds : [animeIds]) : [];
    let itemsToSync;
    if (ids.length > 0) {
      itemsToSync = items.filter((i) => ids.includes(i.animeId) && ['pending', 'failed'].includes(i.status));
    } else {
      itemsToSync = items.filter((i) => i.status === 'pending' || i.status === 'failed');
    }

    if (itemsToSync.length === 0) {
      showToast(tr('metamatch.noPendingItems', '没有需要匹配的条目'), 'info');
      return;
    }

    syncInProgress = true;
    syncCancelled = false;
    syncLog = [];
    syncLogVisible = true;
    panelVisible = true;

    itemsToSync.forEach((i) => { i.status = 'matching'; });

    const syncIds = itemsToSync.map((i) => i.animeId);
    const simplified = options.simplified || false;

    const stream = createSyncStream(syncIds);
    syncStream = stream;

    stream.on('matching', (e) => {
      if (syncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        if (!simplified) addSyncLogEntry(data.animeId, data.searchTerm, 'searching', tr('metamatch.searchingMatch', '正在搜索匹配…'));
      } catch (_) {}
    });

    stream.on('progress', (e) => {
      if (syncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        const item = items.find((i) => i.animeId === data.animeId);
        if (!item) return;

        if (data.success) {
          item.status = 'matched';
          item.meta = data.meta || null;
          item.coverUrl = data.meta?.localCover || null;
          item.error = null;
          if (data.matchedSeason != null) item.matchedSeason = data.matchedSeason;
          // 服务端若在 progress 事件携带 anilist 字段则同步更新，保证状态卡实时一致
          if (data.anilistId != null) item.anilistId = data.anilistId;
          if (data.anilistBanner != null) item.anilistBanner = data.anilistBanner;
          if (data.anilistTitleEn != null) item.anilistTitleEn = data.anilistTitleEn;
          if (data.anilistTags != null) item.anilistTags = data.anilistTags;
          if (data.anilistCover != null) item.anilistCover = data.anilistCover;
          addSyncLogEntry(data.animeId, null, 'matched', data.meta?.bangumiTitle || data.meta?.title || tr('metamatch.matched', '匹配成功'));
        } else {
          item.status = 'failed';
          item.error = data.error || tr('metamatch.unknownError', '未知错误');
          addSyncLogEntry(data.animeId, null, 'failed', data.error || tr('metamatch.unknownError', '未知错误'));
        }
      } catch (_) {}
    });

    stream.on('fetching', (e) => {
      if (syncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        const sourceLabels = {
          anilist: tr('metamatch.sourceAnilist', '正在通过 AniList 补充信息…'),
          season: tr('metamatch.sourceSeason', '正在推算作品季度…'),
        };
        const detail = sourceLabels[data.matchSource] || tr('metamatch.fetchingMetadataSource', '正在获取元数据（{{source}}）', { source: data.matchSource || '?' });
        if (simplified) {
          addSyncLogEntry(data.animeId, data.searchTerm || tr('metamatch.matchedLabel', '匹配'), 'fetching', detail);
        } else {
          const existing = syncLog.find((entry) => entry.animeId === data.animeId);
          if (existing) { existing.status = 'fetching'; existing.detail = detail; }
        }
      } catch (_) {}
    });

    stream.on('finalizing', (e) => {
      if (syncCancelled) return;
      try {
        const data = JSON.parse(e.data);
        const msg = data.message || tr('metamatch.finalizing', '正在完成收尾工作…');
        const existing = syncLog.find((entry) => entry.animeId === '__finalizing__');
        if (existing) {
          existing.detail = msg;
        } else {
          syncLog.push({ animeId: '__finalizing__', searchTerm: tr('metamatch.finalizingShort', '收尾'), status: 'fetching', detail: msg });
        }
      } catch (_) {}
    });

    try {
      const { cancelled } = await stream.done;
      // 移除收尾伪条目
      const fi = syncLog.findIndex((e) => e.animeId === '__finalizing__');
      if (fi !== -1) syncLog.splice(fi, 1);

      if (cancelled) {
        // 取消：matching → pending，searching/fetching → failed(cancelled)
        items.forEach((i) => { if (i.status === 'matching') i.status = 'pending'; });
        syncLog.forEach((e) => {
          if (e.status === 'searching' || e.status === 'fetching') { e.status = 'failed'; e.detail = tr('metamatch.cancelled', '已取消'); }
        });
      } else {
        // 连接丢失：matching → failed
        items.forEach((i) => {
          if (i.status === 'matching') { i.status = 'failed'; i.error = i.error || tr('metamatch.connectionLost', '连接断开，匹配中断'); }
        });
        syncLog.forEach((e) => {
          if (e.status === 'searching' || e.status === 'fetching') { e.status = 'failed'; e.detail = tr('metamatch.connectionLost', '连接断开，匹配中断'); }
        });
      }
    } catch (e) {
      if (!syncCancelled) showToast(tr('metamatch.syncFailed', '同步失败: {{error}}', { error: e.message }), 'error');
      items.forEach((i) => { if (i.status === 'matching') i.status = 'pending'; });
    }

    syncInProgress = false;
    syncStream = null;

    if (!syncCancelled) {
      const matched = syncLog.filter((e) => e.status === 'matched').length;
      if (matched > 0 && typeof window.loadLibrary === 'function') {
        needsRefresh = true;
        window.loadLibrary();
        // 刷新 MetaMatch 弹窗数据，确保 anilistId/banner 等字段更新
        const prevSelectedId = selectedId;
        await loadModalData();
        if (prevSelectedId) {
          const item = items.find((i) => i.animeId === prevSelectedId);
          if (item) selectForPanel(prevSelectedId);
        }
      }
    }
  }

  // ─── 取消同步（替代 mmCancelSync）───
  function cancelSync() {
    syncCancelled = true;
    if (syncStream) {
      syncStream.cancel();
      syncStream = null;
    }
  }

  // ─── 重新匹配单项（替代 mmStartResearch）───
  function startResearch(animeId) {
    const item = items.find((i) => i.animeId === animeId);
    if (!item) return;
    item.status = 'pending';
    item.error = null;
    item.meta = null;
    matchItems([animeId]);
  }

  // ─── 应用修正匹配（替代 mmApplyFix，单条目直接 fetch）───
  async function applyFix(item, result) {
    if (!result || !item) return;

    syncInProgress = true;
    syncCancelled = false;
    syncLog = [];
    syncLogVisible = true;
    panelVisible = true;

    const title = result.name_cn || result.name || result.title || tr('metamatch.unknown', '未知');
    addSyncLogEntry(item.animeId, title, 'fetching', tr('metamatch.fetchingMetadata', '正在获取元数据…'));
    item.status = 'matching';

    try {
      const fetchResult = await api.post('/api/bangumi/fetch', {
        animeId: item.animeId,
        subjectId: result.id,
        source: result.source,
      });

      if (fetchResult?.anime) {
        const a = fetchResult.anime;
        item.status = 'matched';
        item.meta = {
          bangumiId: a.bangumiId,
          bangumiTitle: a.bangumiTitle,
          bangumiTitleJp: a.bangumiTitleJp,
          summary: a.summary,
          coverUrl: a.localCover,
          localCover: a.localCover,
          rating: a.rating,
          metadataSource: a.metadataSource,
        };
        item.coverUrl = a.localCover || item.coverUrl;
        item.error = null;
        if (a.matchedSeason != null) item.matchedSeason = a.matchedSeason;
        item.anilistId = a.anilistId;
        item.anilistBanner = a.anilistBanner || null;
        item.anilistTitleEn = a.anilistTitleEn || null;
        item.anilistTags = a.anilistTags || null;
        item.anilistCover = a.anilistCover || null;
        needsRefresh = true;
        addSyncLogEntry(item.animeId, null, 'matched', a.bangumiTitle || title);
      } else {
        item.status = 'failed';
        item.error = tr('metamatch.emptyFetchResult', '获取元数据返回空');
        addSyncLogEntry(item.animeId, null, 'failed', tr('metamatch.emptyFetchResult', '获取元数据返回空'));
      }
    } catch (e) {
      item.status = 'failed';
      item.error = e.message;
      addSyncLogEntry(item.animeId, null, 'failed', e.message);
      showToast(tr('metamatch.applyMatchFailed', '应用匹配失败: {{error}}', { error: e.message }), 'error');
    }

    syncInProgress = false;

    const matched = syncLog.filter((e) => e.status === 'matched').length;
    if (matched > 0 && typeof window.loadLibrary === 'function') {
      window.loadLibrary();
      // 刷新 MetaMatch 弹窗数据，确保 anilistId/banner 等字段更新
      const prevSelectedId = selectedId;
      await loadModalData();
      if (prevSelectedId) {
        const item = items.find((i) => i.animeId === prevSelectedId);
        if (item) selectForPanel(prevSelectedId);
      }
    }
  }

  // ─── Modal 生命周期 ───
  function closeModal() {
    // 同步中关闭弹窗 → 确认对话框（vanilla 28-52）
    if (syncInProgress) {
      showConfirm(tr('metamatch.confirmAbort', '匹配尚未完成，退出将中断正在进行的匹配。\n已匹配的条目数据不会丢失，未完成的条目可重新匹配。\n\n确定退出？')).then((ok) => {
        if (!ok) return; // 用户取消关闭
        doClose();
      });
      return;
    }
    doClose();
  }

  function doClose() {
    deselectPanel(); // 关面板
    selectedIds = []; // 清选择
    const wasSyncing = syncInProgress;
    syncInProgress = false;
    syncCancelled = true;
    syncLog = [];
    if (syncStream) { syncStream.cancel(); syncStream = null; } // 关 SSE
    if (wasSyncing) {
      showToast(tr('metamatch.matchInterrupted', '匹配已中断，未完成的条目可重新匹配'), 'warning');
    }
    if (needsRefresh && typeof window.loadLibrary === 'function') {
      needsRefresh = false;
      window.loadLibrary();
    }
    metaMatchOpen.set(false);
  }

  // ─── 打开/关闭 + body 滚动锁定 ───
  $effect(() => {
    if ($metaMatchOpen) {
      document.body.style.overflow = 'hidden';
      loadModalData();
    } else {
      document.body.style.overflow = '';
    }
  });

  // ─── 点击外部取消选择 + Escape 关闭 ───
  onMount(() => {
    function onDocClick(e) {
      if (!$metaMatchOpen) return;
      if (e.target.closest('.mm-panel')) return;
      if (e.target.closest('.mm-row')) return;
      if (e.target.closest('.modal-m-filterbar')) return;
      if (e.target.closest('.modal-m-topbar')) return;
      if (syncInProgress) return;
      if (panelVisible) deselectPanel();
      if (selectedIds.length > 0) clearSelection();
    }
    function onKey(e) {
      if (e.key === 'Escape' && $metaMatchOpen) closeModal();
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if $metaMatchOpen}
  <div
    class="modal-overlay modal-overlay--metamatch show"
    id="metaMatchModal"
    onclick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
  >
    <div class="modal modal--metamatch">
      <MetaMatchToolbar
        stats={stats}
        progress={progress}
        mainAction={mainAction}
        filter={filter}
        search={search}
        syncInProgress={syncInProgress}
        onSetFilter={(f) => (filter = f)}
        onSearch={(v) => (search = v)}
        onMainAction={handleMainAction}
        onCancel={cancelSync}
        onClose={closeModal}
      />
      <div class="modal-m-body">
        <div class="mm-left">
          <MetaMatchList
            filteredItems={filteredItems}
            selectedId={selectedId}
            selectedIds={selectedIds}
            syncInProgress={syncInProgress}
            totalCount={items.length}
            filter={filter}
            emptyMsg={emptyMsg}
            onRowClick={rowClick}
          />
        </div>
        <MetaMatchPanel
          panelVisible={panelVisible}
          syncLogVisible={syncLogVisible}
          item={selectedItem}
          syncInProgress={syncInProgress}
          syncLog={syncLog}
          syncSummary={syncSummary}
          onApplyFix={(result) => applyFix(selectedItem, result)}
          onResearch={startResearch}
        />
      </div>
    </div>
  </div>
{/if}