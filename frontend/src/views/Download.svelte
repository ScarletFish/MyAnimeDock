<script module>
  import { writable } from 'svelte/store';
  export const downloadOpen = writable(false);
</script>

<script>
  import { onMount, onDestroy, tick } from 'svelte';
import { slide } from 'svelte/transition';
  import { get } from 'svelte/store';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';
  import { tr, localDateStr } from '../lib/anime-utils.js';
  import { API as api } from '../lib/api.js';
  import { settingsOpen } from './Settings.svelte';
  import MikanModal, { mikanModalOpen } from './MikanModal.svelte';

  let configured = $state(false);
  let loading = $state(true);
  let torrents = $state([]);
  let magnetInput = $state('');
  let adding = $state(false);
  let es = $state(null);
  let prevOpen = $state(false);

  let sourceFilter = $state('all');
  let statusFilter = $state('all');

  let expandedHash = $state(null);
  let torrentFiles = $state([]);
  let filesLoading = $state(false);
  let filesOpen = $state(false);
  let detailEl = $state(null);
  const filteredTorrents = $derived(
    torrents.filter((t) => {
      const srcOk = sourceFilter === 'all'
        || (sourceFilter === 'anime-mikan' ? t.category === 'anime-mikan' : t.category !== 'anime-mikan');
      const stOk = statusFilter === 'all' || getStatusInfo(t.state).label === statusFilter;
      return srcOk && stOk;
    })
  );

  const footerStats = $derived.by(() => {
    let dlSpeed = 0, upSpeed = 0, downloaded = 0, uploaded = 0;
    for (const t of filteredTorrents) {
      dlSpeed += t.dlspeed || 0;
      upSpeed += t.upspeed || 0;
      downloaded += t.downloaded || 0;
      uploaded += t.uploaded || 0;
    }
    return { dlSpeed, upSpeed, downloaded, uploaded };
  });

  const STATUS_MAP = {
    downloading: { label: '下载中', cls: 'qb-status--downloading' },
    metaDL: { label: '下载中', cls: 'qb-status--downloading' },
    allocating: { label: '下载中', cls: 'qb-status--downloading' },
    forcedDL: { label: '下载中', cls: 'qb-status--downloading' },
    uploading: { label: '做种', cls: 'qb-status--uploading' },
    stalledUP: { label: '做种', cls: 'qb-status--uploading' },
    forcedUP: { label: '做种', cls: 'qb-status--uploading' },
    stoppedUP: { label: '已完成', cls: 'qb-status--completed' },
    pausedUP: { label: '已完成', cls: 'qb-status--completed' },
    queuedUP: { label: '已完成', cls: 'qb-status--completed' },
    stalledDL: { label: '等待', cls: 'qb-status--waiting' },
    queuedDL: { label: '等待', cls: 'qb-status--waiting' },
    pausedDL: { label: '已暂停', cls: 'qb-status--paused' },
    stoppedDL: { label: '已暂停', cls: 'qb-status--paused' },
    error: { label: '出错', cls: 'qb-status--error' },
    missingFiles: { label: '出错', cls: 'qb-status--error' },
    checkingUP: { label: '校验中', cls: 'qb-status--checking' },
    checkingDL: { label: '校验中', cls: 'qb-status--checking' },
    checkingResumeData: { label: '校验中', cls: 'qb-status--checking' },
    unknown: { label: '未知', cls: 'qb-status--unknown' },
    moving: { label: '移动中', cls: 'qb-status--waiting' },
  };

  function getStatusInfo(state) {
    return STATUS_MAP[state] || STATUS_MAP.unknown;
  }

  // qBittorrent v5 把 pausedDL/pausedUP 改名为 stoppedDL/stoppedUP；
  // 队列中(queued*)也属非活动态，应显示"恢复"
  function isTorrentPaused(state) {
    return ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP', 'queuedDL', 'queuedUP'].includes(state);
  }

  // 乐观更新：预判动作后的状态，先给即时反馈（验证阶段会被真实状态覆盖）
  function optimisticState(t, willPause) {
    const upStates = ['uploading', 'stalledUP', 'forcedUP', 'stoppedUP', 'pausedUP', 'queuedUP'];
    if (willPause) return upStates.includes(t.state) ? 'stoppedUP' : 'stoppedDL';
    return upStates.includes(t.state) ? 'uploading' : 'downloading';
  }

  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let i = 0;
    let speed = bytesPerSec;
    while (speed >= 1024 && i < units.length - 1) { speed /= 1024; i++; }
    return speed.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function formatProgress(progress) {
    return (progress * 100).toFixed(1) + '%';
  }

  function formatEta(sec) {
    if (!sec || sec < 0 || sec >= 8640000) return '∞';
    const d = Math.floor(sec / 86400);
    sec %= 86400;
    const h = Math.floor(sec / 3600);
    sec %= 3600;
    const m = Math.floor(sec / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function formatDuration(sec) {
    if (!sec || sec < 0) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  async function toggleRow(t) {
    if (expandedHash === t.hash) {
      expandedHash = null;
      torrentFiles = [];
      filesOpen = false;
      return;
    }
    expandedHash = t.hash;
    torrentFiles = [];
    filesOpen = false;
    filesLoading = true;
    try {
      const resp = await api.get('/api/qb/files?hash=' + encodeURIComponent(t.hash));
      torrentFiles = resp || [];
    } catch (e) {
      torrentFiles = [];
    } finally {
      filesLoading = false;
    }
    await tick();
    detailEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function loadData() {
    if (!configured) return;
    try {
      const tList = await api.get('/api/qb/torrents');
      torrents = tList || [];
    } catch (e) {
      // qB 可能未运行
    }
  }

  async function addMagnet() {
    const url = magnetInput.trim();
    if (!url) return;
    adding = true;
    try {
      await api.post('/api/qb/add', { urls: url });
      magnetInput = '';
      showToast(tr('download.magnetAdded'), 'success');
    } catch (e) {
      showToast(tr('download.magnetFailed', { error: e.message }), 'error');
    } finally {
      adding = false;
    }
  }

  async function togglePause(torrent) {
    const isPaused = isTorrentPaused(torrent.state);
    try {
      await api.post('/api/qb/action', {
        action: isPaused ? 'resume' : 'pause',
        hashes: torrent.hash,
      });
      // 预判：立即把本地状态翻成期望值，先给即时反馈；真实状态由 2s SSE 纠正
      const willPause = !isPaused;
      torrents = torrents.map((x) =>
        x.hash === torrent.hash ? { ...x, state: optimisticState(x, willPause) } : x,
      );
    } catch (e) {
      showToast(tr('download.actionFailed', { error: e.message }), 'error');
    }
  }

  async function deleteTorrent(torrent) {
    const confirmed = await showConfirm(tr('download.confirmDelete', { name: torrent.name }));
    if (!confirmed) return;
    try {
      await api.post('/api/qb/action', {
        action: 'delete',
        hashes: torrent.hash,
        deleteFiles: false,
      });
      await loadData();
      showToast(tr('download.torrentDeleted'), 'success');
    } catch (e) {
      showToast(tr('download.actionFailed', { error: e.message }), 'error');
    }
  }

  let reconnectTimer = null;

  function connectSSE() {
    disconnectSSE();
    const source = new EventSource('/api/events/qb-status');
    es = source;
    source.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        configured = payload.configured;
        torrents = payload.torrents || [];
      } catch {}
    };
    source.onerror = () => {
      source.close();
      es = null;
      // 页面可见时自动重连
      if (!document.hidden && get(downloadOpen)) {
        reconnectTimer = setTimeout(connectSSE, 3000);
      }
    };
  }

  function disconnectSSE() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (es) { es.close(); es = null; }
  }

  function handleVisibility() {
    if (document.hidden) {
      disconnectSSE();
    } else if (get(downloadOpen)) {
      connectSSE();
    }
  }

  onMount(async () => {
    document.addEventListener('visibilitychange', handleVisibility);
    loading = false;
    try {
      const cfg = await api.get('/api/config');
      configured = !!(cfg.qbPort && cfg.qbUsername);
    } catch {}
  });

  onDestroy(() => {
    document.removeEventListener('visibilitychange', handleVisibility);
    disconnectSSE();
  });

  // 视图显隐时连接/断开 SSE
  $effect(() => {
    const open = $downloadOpen;
    if (open && !prevOpen) {
      connectSSE();
    } else if (!open && prevOpen) {
      disconnectSSE();
    }
    prevOpen = open;
  });
</script>

<section class="view download-view" class:hidden={!$downloadOpen}>
  <div class="view-header">
    <h1>{tr('nav.download')}</h1>
    <div class="download-push">
      <button class="btn-icon mikan-trigger" onclick={() => mikanModalOpen.set(true)} data-tooltip="蜜柑计划">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
      <input
        type="text"
        class="download-magnet-input"
        placeholder={tr('download.magnetPlaceholder')}
        bind:value={magnetInput}
        onkeydown={(e) => { if (e.key === 'Enter') addMagnet(); }}
      />
      <button class="btn btn-primary btn-sm" onclick={addMagnet} disabled={adding || !magnetInput.trim()}>
        {#if adding}
          <svg class="spinning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        {:else}
          {tr('download.add')}
        {/if}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="download-loading">
      <svg class="spinning" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      <span>{tr('common.loading')}</span>
    </div>
  {:else if !configured}
    <div class="download-not-configured">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <p>{tr('download.notConfigured')}</p>
      <button class="btn btn-primary" onclick={() => settingsOpen.set(true)}>
        {tr('download.goSettings')}
      </button>
    </div>
  {:else}
    {#if torrents.length > 0}
      <div class="download-filters">
        <div class="filter-group" role="group" aria-label="来源">
          <button class="filter-btn {sourceFilter === 'all' ? 'filter-btn--active' : ''}" onclick={() => sourceFilter = 'all'}>{tr('download.filterAll')}</button>
          <button class="filter-btn {sourceFilter === 'anime-mikan' ? 'filter-btn--active' : ''}" onclick={() => sourceFilter = 'anime-mikan'}>{tr('download.filterSubscribed')}</button>
          <button class="filter-btn {sourceFilter === 'manual' ? 'filter-btn--active' : ''}" onclick={() => sourceFilter = 'manual'}>{tr('download.filterManual')}</button>
        </div>
        <div class="filter-group" role="group" aria-label="状态">
          <button class="filter-btn {statusFilter === 'all' ? 'filter-btn--active' : ''}" onclick={() => statusFilter = 'all'}>{tr('download.filterAll')}</button>
          <button class="filter-btn {statusFilter === '下载中' ? 'filter-btn--active' : ''}" onclick={() => statusFilter = '下载中'}>{tr('download.filterDownloading')}</button>
          <button class="filter-btn {statusFilter === '做种' ? 'filter-btn--active' : ''}" onclick={() => statusFilter = '做种'}>{tr('download.filterSeeding')}</button>
          <button class="filter-btn {statusFilter === '已完成' ? 'filter-btn--active' : ''}" onclick={() => statusFilter = '已完成'}>{tr('download.filterCompleted')}</button>
          <button class="filter-btn {statusFilter === '已暂停' ? 'filter-btn--active' : ''}" onclick={() => statusFilter = '已暂停'}>{tr('download.filterPaused')}</button>
          <button class="filter-btn {statusFilter === '出错' ? 'filter-btn--active' : ''}" onclick={() => statusFilter = '出错'}>{tr('download.filterError')}</button>
        </div>
      </div>
    {/if}
    <div class="download-list">
      {#if torrents.length === 0}
        <div class="download-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <p>{tr('download.empty')}</p>
        </div>
      {:else if filteredTorrents.length === 0}
        <div class="download-filtered-empty">
          <p>{tr('download.filterEmpty')}</p>
        </div>
      {:else}
        {#each filteredTorrents as t (t.hash)}
          {@const statusInfo = getStatusInfo(t.state)}
          <div
            class="download-item"
            class:expanded={expandedHash === t.hash}
            role="button"
            tabindex="0"
            onclick={() => toggleRow(t)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(t); } }}
          >
            <div class="download-item-main">
              <div class="download-item-info">
                <span class="download-item-name" data-tooltip={t.name}>{t.name}</span>
                <span class="download-item-meta">
                  <span class="download-item-size">{formatSize(t.size)}</span>
                  {#if t.num_seeds > 0}
                    <span class="download-item-seeds">P:{t.num_seeds}</span>
                  {/if}
                </span>
              </div>
              <div class="download-item-progress">
                <div class="download-progress-bar">
                  <div class="download-progress-fill" style="width: {Math.min(t.progress * 100, 100)}%"></div>
                </div>
                <span class="download-progress-text">{formatProgress(t.progress)}</span>
              </div>
              <span class="download-status {statusInfo.cls}">{statusInfo.label}</span>
              <div class="download-item-speed">
                {#if t.dlspeed > 0}
                  <span class="download-speed-down">↓{formatSpeed(t.dlspeed)}</span>
                {/if}
                {#if t.upspeed > 0}
                  <span class="download-speed-up">↑{formatSpeed(t.upspeed)}</span>
                {/if}
              </div>
              <div class="download-item-actions">
                <button class="btn-icon" onclick={(e) => { e.stopPropagation(); togglePause(t); }} data-tooltip={isTorrentPaused(t.state) ? tr('download.resume') : tr('download.pause')}>
                  {#if isTorrentPaused(t.state)}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {:else}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  {/if}
                </button>
                <button class="btn-icon btn-danger" onclick={(e) => { e.stopPropagation(); deleteTorrent(t); }} data-tooltip={tr('download.delete')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          </div>
          {#if expandedHash === t.hash}
            <div class="download-detail" bind:this={detailEl} transition:slide={{ duration: 120 }}>
              <div class="download-detail-grid">
                <div class="download-detail-field download-detail-field--path">
                  <span class="download-detail-label">{tr('download.detailPath')}</span>
                  <span class="download-detail-value">{t.save_path || '—'}</span>
                </div>
                <div class="download-detail-short">
                  <div class="download-detail-field"><span class="download-detail-label">{tr('download.detailRatio')}</span><span class="download-detail-value">{t.ratio != null ? String(Math.round(t.ratio)) : '—'}</span></div>
                  <div class="download-detail-field"><span class="download-detail-label">{tr('download.detailEta')}</span><span class="download-detail-value">{formatEta(t.eta)}</span></div>
                  <div class="download-detail-field download-detail-field--date"><span class="download-detail-label">{tr('download.detailAdded')}</span><span class="download-detail-value">{t.added_on ? localDateStr(new Date(t.added_on * 1000).toISOString()) : '—'}</span></div>
                  <div class="download-detail-field"><span class="download-detail-label">{tr('download.detailSeeding')}</span><span class="download-detail-value">{formatDuration(t.seeding_time)}</span></div>
                </div>
              </div>
              <button type="button" class="download-files-toggle" onclick={(e) => { e.stopPropagation(); filesOpen = !filesOpen; }}>{tr('download.detailFiles', { count: torrentFiles.length })}</button>
              {#if filesOpen && filesLoading}
                <div class="download-detail-loading"><svg class="spinning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
              {:else if filesOpen && torrentFiles.length}
                <ul class="download-file-list" transition:slide={{ duration: 120 }}>
                  {#each torrentFiles as f}
                    <li class="download-file-row">
                      <span class="download-file-name">{f.name}</span>
                      <span class="download-file-size">{formatSize(f.size)}</span>
                      <span class="download-file-progress">{formatProgress(f.progress)}</span>
                    </li>
                  {/each}
                </ul>
              {:else if filesOpen}
                <div class="download-detail-empty" transition:slide={{ duration: 120 }}>{tr('download.detailNoFiles')}</div>
              {/if}
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    {#if filteredTorrents.length > 0}
      <div class="download-footer">
        <div class="download-footer-stat">
          <span class="download-footer-label">↓</span>
          <span class="download-footer-value download-speed-down">{formatSpeed(footerStats.dlSpeed)}</span>
        </div>
        <div class="download-footer-stat">
          <span class="download-footer-label">↑</span>
          <span class="download-footer-value download-speed-up">{formatSpeed(footerStats.upSpeed)}</span>
        </div>
        <div class="download-footer-divider"></div>
        <div class="download-footer-stat">
          <span class="download-footer-label">{tr('download.totalDownloaded')}</span>
          <span class="download-footer-value">{formatSize(footerStats.downloaded)}</span>
        </div>
        <div class="download-footer-stat">
          <span class="download-footer-label">{tr('download.totalUploaded')}</span>
          <span class="download-footer-value">{formatSize(footerStats.uploaded)}</span>
        </div>
      </div>
    {/if}
  {/if}
</section>

<MikanModal />
