<script>
  // ─── 同步元数据弹窗（声明式）───
  // open 由父组件 syncOpen 驱动；body 锁 + input focus 随组件 $effect 管理。
  import { tick } from 'svelte';
  import { showToast } from '../Toast.svelte';

  let { open = false, anime = null, onAttached, onClose } = $props();

  let keyword = $state('');
  let state = $state('idle'); // idle | searching | fetching | results | empty | failed
  let results = $state([]);

  function tr(key, fallback, options) {
    return typeof globalThis.t === 'function' ? globalThis.t(key, options) : fallback;
  }

  const api = {
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

  // 打开时初始化关键词 + 锁 body 滚动 + 聚焦输入框
  $effect(() => {
    if (open) {
      keyword = (anime?.specialSuffix || anime?.bangumiTitle || anime?.title || '').replace(/[~～]/g, '').trim();
      state = 'idle';
      results = [];
      document.body.style.overflow = 'hidden';
      tick().then(() => {
        document.querySelector('#svelte-syncModal input')?.focus();
      });
    } else {
      document.body.style.overflow = '';
    }
  });

  async function search() {
    if (!anime) return;
    const kw = keyword.trim();
    if (!kw) { showToast(tr('detail.enterKeyword', '请输入搜索关键词'), 'warning'); return; }
    state = 'searching';
    try {
      const result = await api.post('/api/bangumi/search', { keyword: kw });
      if (result.results && result.results.length > 0) {
        results = result.results;
        state = 'results';
      } else {
        state = 'empty';
      }
    } catch (e) {
      showToast(tr('detail.searchFailed', '搜索失败：{error}', { error: e.message }), 'error');
      state = 'failed';
    }
  }

  async function attach(subjectId) {
    if (!anime) return;
    state = 'fetching';
    try {
      const result = await api.post('/api/bangumi/fetch', { animeId: anime.id, subjectId });
      onAttached?.(result.anime);
      if (typeof window.loadLibrary === 'function') window.loadLibrary();
      showToast(tr('detail.metadataSuccess', '元数据同步成功'), 'success');
    } catch (e) {
      showToast(tr('detail.fetchFailed', '获取失败：{error}', { error: e.message }), 'error');
      state = 'idle';
    }
  }
</script>

{#if open}
  <div class="modal-overlay show" id="svelte-syncModal" onclick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class="modal modal--large">
      <h2>{tr('detail.syncMetadata', '同步元数据')}</h2>
      <div class="form-group">
        <label for="syncKeyword">{tr('detail.searchKeyword', '搜索关键词')}</label>
        <div class="flex gap-2">
          <input type="text" id="syncKeyword" placeholder={tr('detail.searchPlaceholder', '输入搜索词...')} class="flex-1 min-w-0" bind:value={keyword}>
          <button class="btn btn-primary" onclick={search}>{tr('common.search', '搜索')}</button>
        </div>
      </div>
      <div class="bangumi-search-results" id="syncSearchResults">
        {#if state === 'searching'}
          <p class="text-center p-4 text-content">{tr('detail.searching', '搜索中...')}</p>
        {:else if state === 'fetching'}
          <p class="text-center p-4 text-content">{tr('detail.fetchingMetadata', '正在获取元数据...')}</p>
        {:else if state === 'empty'}
          <p class="search-result-empty">{tr('detail.noSearchResults', '没有找到相关结果')}</p>
        {:else if state === 'failed'}
          <p class="search-result-empty">{tr('detail.searchFailedEmpty', '搜索失败')}</p>
        {:else if state === 'results'}
          <h4 class="m-0 mb-3 text-content">{tr('detail.selectSubject', '选择条目')}</h4>
          {#each results as r}
            <div class="search-result-item" onclick={() => attach(r.id)}>
              <img class="search-result-cover" src={r.images?.small || r.images?.grid || ''} alt="" loading="lazy" decoding="async" onerror={(e) => (e.currentTarget.style.display = 'none')}>
              <div class="search-result-info">
                <div class="search-result-title">{r.name_cn || r.name}</div>
                <div class="search-result-subtitle">{r.name}</div>
                <div class="search-result-meta">{r.date || ''}{r.rating?.score ? ' · ★' + r.rating.score.toFixed(1) : ''}</div>
              </div>
              <button class="btn btn-primary search-result-btn">{tr('detail.select', '选择')}</button>
            </div>
          {/each}
        {/if}
      </div>
      <button class="modal-close-btn" onclick={onClose}>✕</button>
    </div>
  </div>
{/if}