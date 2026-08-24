<script module>
  import { writable } from 'svelte/store';
  export const downloadOpen = writable(false);
</script>

<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';
  import { tr } from '../lib/anime-utils.js';
  import { API as api } from '../lib/api.js';
  import { settingsOpen } from './Settings.svelte';

  let configured = $state(false);
  let loading = $state(true);
  let transfer = $state(null);
  let torrents = $state([]);
  let magnetInput = $state('');
  let adding = $state(false);
  let es = $state(null);
  let prevOpen = $state(false);

  const STATUS_MAP = {
    downloading: { label: '下载中', cls: 'qb-status--downloading' },
    uploading: { label: '做种', cls: 'qb-status--uploading' },
    stalledUP: { label: '做种', cls: 'qb-status--uploading' },
    stalledDL: { label: '等待', cls: 'qb-status--waiting' },
    queuedDL: { label: '等待', cls: 'qb-status--waiting' },
    pausedDL: { label: '已暂停', cls: 'qb-status--paused' },
    pausedUP: { label: '已暂停', cls: 'qb-status--paused' },
    error: { label: '出错', cls: 'qb-status--error' },
    missingFiles: { label: '出错', cls: 'qb-status--error' },
    checkingUP: { label: '校验中', cls: 'qb-status--checking' },
    checkingDL: { label: '校验中', cls: 'qb-status--checking' },
    unknown: { label: '未知', cls: 'qb-status--unknown' },
  };

  function getStatusInfo(state) {
    return STATUS_MAP[state] || STATUS_MAP.unknown;
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

  async function loadData() {
    if (!configured) return;
    try {
      const [tInfo, tList] = await Promise.all([
        api.get('/api/qb/transfer'),
        api.get('/api/qb/torrents'),
      ]);
      transfer = tInfo;
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
    const isPaused = torrent.state?.includes('paused');
    try {
      await api.post('/api/qb/action', {
        action: isPaused ? 'resume' : 'pause',
        hashes: torrent.hash,
      });
      await loadData();
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
        transfer = payload.transfer;
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

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibility);
    loading = false;
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
      {:else}
        {#each torrents as t (t.hash)}
          {@const statusInfo = getStatusInfo(t.state)}
          <div class="download-item">
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
                <button class="btn-icon" onclick={() => togglePause(t)} data-tooltip={t.state?.includes('paused') ? tr('download.resume') : tr('download.pause')}>
                  {#if t.state?.includes('paused')}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {:else}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  {/if}
                </button>
                <button class="btn-icon btn-danger" onclick={() => deleteTorrent(t)} data-tooltip={tr('download.delete')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if transfer}
      <div class="download-footer">
        <div class="download-footer-stat">
          <span class="download-footer-label">↓</span>
          <span class="download-footer-value download-speed-down">{formatSpeed(transfer.dl_info_speed)}</span>
        </div>
        <div class="download-footer-stat">
          <span class="download-footer-label">↑</span>
          <span class="download-footer-value download-speed-up">{formatSpeed(transfer.up_info_speed)}</span>
        </div>
        <div class="download-footer-divider"></div>
        <div class="download-footer-stat">
          <span class="download-footer-label">{tr('download.totalDownloaded')}</span>
          <span class="download-footer-value">{formatSize(transfer.dl_info_data)}</span>
        </div>
        <div class="download-footer-stat">
          <span class="download-footer-label">{tr('download.totalUploaded')}</span>
          <span class="download-footer-value">{formatSize(transfer.up_info_data)}</span>
        </div>
      </div>
    {/if}
  {/if}
</section>
