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

  // ─── 共享常量（与 ui.js 一致）───
  const STATUS_LABELS = {
    watching: tr('common.watching', '进行中'),
    wish: tr('common.wish', '计划中'),
    completed: tr('common.completed', '已完成'),
    on_hold: tr('common.on_hold', '搁置'),
    dropped: tr('common.dropped', '抛弃'),
  };
  const MYLIST_STATUS_ORDER = ['watching', 'wish', 'completed', 'on_hold', 'dropped'];

  const ANIME_SORT_OPTIONS = [
    { key: 'name', label: tr('mylist.sortName', '名称') },
    { key: 'recent', label: tr('mylist.sortRecent', '最近观看') },
    { key: 'updated', label: tr('mylist.sortUpdated', '最近更新') },
    { key: 'rating', label: tr('common.rating', '评分') },
    { key: 'imported', label: tr('mylist.sortImported', '导入时间') },
  ];

  // ─── 状态 ───
  let mylistData = $state([]);
  let mylistFilter = $state('all');
  let sortMode = $state(localStorage.getItem('mylistSort') || 'name');
  let sortOpen = $state(false);
  let loading = $state(false);

  // 状态弹窗
  let statusModalOpen = $state(false);
  let statusModalId = $state(null);
  let statusModalTitle = $state('');
  let statusModalBg = $state('');
  let statusValue = $state('wish');
  let statusDdOpen = $state(false);
  let ratingVal = $state('—');
  let progressVal = $state('—');
  let startSeg = $state({ y: '', m: '', d: '' });
  let endSeg = $state({ y: '', m: '', d: '' });
  let notes = $state('');

  // 右键菜单
  let ctxVisible = $state(false);
  let ctxX = $state(0);
  let ctxY = $state(0);
  let ctxItem = $state(null);

  // 愿望单详情弹窗
  let wishItem = $state(null);

  // Grid 列（响应 --scale）
  let gridCols = $state('');
  $effect(() => {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
    gridCols = `repeat(auto-fit, minmax(${Math.round(200 * scale)}px, ${Math.round(277 * scale)}px))`;
  });

  // ─── 打开时加载 ───
  $effect(() => {
    if ($mylistOpen) {
      loadMyList();
    }
  });

  onMount(() => {
    function onDocClick(e) {
      if (sortOpen && !e.target.closest('.mylist-sort-bar')) sortOpen = false;
      if (statusDdOpen && !e.target.closest('.status-dd')) statusDdOpen = false;
      if (ctxVisible && !e.target.closest('.context-menu')) closeCtx();
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  });

  // ─── 数据加载 ───
  async function loadMyList() {
    loading = true;
    try {
      mylistData = await api.get('/api/mylist');
    } catch (e) {
      if (!window.location.origin.startsWith('http')) return;
      showToast(tr('mylist.loadFailed', '加载失败：{message}', { message: e.message }), 'error');
    } finally {
      loading = false;
    }
  }

  // ─── 排序 ───
  function sortAnimeItems(items, sortMode) {
    var FORMAT_RANK = { TV: 0, OVA: 1, SP: 2, MOVIE: 3 };

    function getBaseKey(a) {
      var t = (a.bangumiTitle || a.title || '').toLowerCase();
      t = t.replace(/[♪♫☆★！!？?~～\s]+/g, ' ').trim();
      t = t.replace(/\d+季/g, '').trim();
      t = t.replace(/\s*(OVA|SP|OAD|剧场版|Movie|Special|夏日时光|Dear My Sister|Sing For You|BLOOM|Nachuyachumi).*$/i, '').trim();
      t = t.replace(/\s+\d+[\s\S]*$/, '').trim();
      t = t.replace(/\d+$/, '').trim();
      return t || (a.title || a.id || '').toLowerCase();
    }
    function getSeasonRank(a) {
      var p = (a.platform || '').toUpperCase();
      var formatRank = FORMAT_RANK[p] != null ? FORMAT_RANK[p] : 0;
      var season = a.matchedSeason || a.season || 1;
      return formatRank * 100 + season;
    }
    function getJpName(a) {
      return (a.bangumiTitleJp || a.bangumiTitle || a.title || '').toLowerCase();
    }
    function getLastWatched(a) {
      if (!a.episodes || a.episodes.length === 0) return '';
      var latest = '';
      a.episodes.forEach(function (e) {
        if (e.updatedAt && e.updatedAt > latest) latest = e.updatedAt;
      });
      return latest;
    }
    function getBlockScore(block, key) {
      if (key === 'rating') return Math.max.apply(null, block.map(function (a) { return a.rating || 0; }));
      if (key === 'recent') return block.reduce(function (m, a) { var lw = getLastWatched(a); return lw > m ? lw : m; }, '');
      if (key === 'updated') return block.reduce(function (m, a) { return (a.importedAt || '') > m ? a.importedAt || '' : m; }, '');
      if (key === 'imported') return block.reduce(function (m, a) { var i = a.importedAt || 'z'; return i < m ? i : m; }, 'z');
      return getJpName(block[0]);
    }

    var groups = {};
    items.forEach(function (a) {
      var key = getBaseKey(a);
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });
    var blocks = Object.values(groups);
    blocks.forEach(function (block) { block.sort(function (a, b) { return getSeasonRank(a) - getSeasonRank(b); }); });

    blocks.sort(function (a, b) {
      var sa = getBlockScore(a, sortMode);
      var sb = getBlockScore(b, sortMode);
      if (typeof sa === 'number') return sb - sa;
      if (sortMode === 'imported') return sa.localeCompare(sb);
      return sb.localeCompare(sa) || sa.localeCompare(sb);
    });

    var result = [];
    blocks.forEach(function (block) { block.forEach(function (a) { result.push(a); }); });
    return result;
  }

  function switchSort(mode) {
    sortMode = mode;
    sortOpen = false;
    localStorage.setItem('mylistSort', mode);
  }

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
  function showMyListContextMenu(e, item) {
    e.preventDefault();
    e.stopPropagation();
    ctxItem = item;
    ctxVisible = true;
    let x = e.clientX;
    let y = e.clientY;
    ctxX = x;
    ctxY = y;
    // 位置微调（渲染后测量）
    tick().then(() => {
      const menu = document.getElementById('svelteCtxMenu');
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
      ctxX = x;
      ctxY = y;
    });
  }

  function closeCtx() {
    ctxVisible = false;
    ctxItem = null;
  }

  async function copyTitle() {
    const item = ctxItem;
    const title = item ? item.bangumiTitle || item.title || '' : '';
    closeCtx();
    try {
      await navigator.clipboard.writeText(title);
      showToast(tr('mylist.copied', '已复制'), 'success');
    } catch (e) {
      showToast(tr('mylist.copyFailed', '复制失败'), 'error');
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
    const confirmed = await showConfirm(tr('mylist.confirmRemove', '确认从我的列表移除「{name}」？', { name }));
    if (!confirmed) return;
    try {
      await api.del('/api/mylist/' + encodeURIComponent(item.id));
      showToast(tr('mylist.removed', '已移除'), 'info');
      loadMyList();
    } catch (e) {
      showToast(tr('mylist.removeFailed', '移除失败：{message}', { message: e.message }), 'error');
    }
  }

  async function deleteWishlistItem() {
    const item = ctxItem;
    closeCtx();
    if (!item) return;
    const confirmed = await showConfirm(tr('mylist.confirmRemoveFromWishlist', '确认从愿望单移除？'));
    if (!confirmed) return;
    try {
      await api.del('/api/wishlist/' + encodeURIComponent(item.id));
      showToast(tr('mylist.removed', '已移除'), 'info');
      loadMyList();
    } catch (e) {
      showToast(tr('mylist.removeFailed', '移除失败：{message}', { message: e.message }), 'error');
    }
  }

  async function showConfirm(message) {
    if (typeof window.showConfirm === 'function') return await window.showConfirm(message);
    return window.confirm(message);
  }

  // ─── 状态弹窗 ───
  function openStatusModal(item) {
    statusModalId = item.id;
    const libItem = typeof window.libraryData !== 'undefined' && Array.isArray(window.libraryData)
      ? window.libraryData.find((a) => a.id === item.id)
      : null;
    const anime = libItem || item;

    statusModalTitle = anime ? anime.bangumiTitle || anime.title || tr('mylist.markStatus', '标记状态') : tr('mylist.markStatus', '标记状态');

    const cover = anime && anime.localCover ? '/covers/' + basename(anime.localCover) + '?w=600&q=80' : '';
    statusModalBg = cover;

    statusValue = (item && item.status) || 'wish';
    statusDdOpen = false;

    const rating = item && item.userRating != null ? item.userRating : '';
    ratingVal = rating !== '' ? String(rating) : '—';

    const storedProgress = item && item.progress != null ? item.progress : null;
    const watchedCount = anime && anime.episodes ? anime.episodes.filter((e) => e.watched).length : 0;
    const progVal = storedProgress != null ? storedProgress : watchedCount || '';
    progressVal = progVal !== '' ? String(progVal) : '—';

    const storedStart = item && item.startedAt ? item.startedAt : null;
    const firstPlayed = item && item.firstPlayedAt ? localDateStr(item.firstPlayedAt) : null;
    setDateToSegments(startSeg, storedStart ? storedStart.substring(0, 10) : firstPlayed || _todayStr());

    const storedEnd = item && item.completedAt ? item.completedAt : null;
    setDateToSegments(endSeg, storedEnd ? storedEnd.substring(0, 10) : _todayStr());

    notes = (item && item.notes) || '';

    statusModalOpen = true;
  }

  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function localDateStr(isoStr) {
    var d = new Date(isoStr);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function setDateToSegments(seg, dateStr) {
    if (dateStr) {
      var parts = dateStr.substring(0, 10).split('-');
      seg.y = parts[0] || '';
      seg.m = parts[1] || '';
      seg.d = parts[2] || '';
    }
  }

  function readDateSegments(seg) {
    var y = seg.y.trim();
    var m = seg.m.trim();
    var d = seg.d.trim();
    if (!y && !m && !d) return '';
    y = y.padStart(4, '0');
    m = m.padStart(2, '0') || '01';
    d = d.padStart(2, '0') || '01';
    return y + '-' + m + '-' + d;
  }

  function segAutoTab(e, seg, field) {
    const input = e.currentTarget;
    let val = input.value.replace(/\D/g, '');
    seg[field] = val;
    if (val.length >= input.maxLength) {
      const segs = input.closest('.date-segments');
      if (segs) {
        const inputs = segs.querySelectorAll('.date-seg');
        for (let i = 0; i < inputs.length; i++) {
          if (inputs[i] === input && i < inputs.length - 1) {
            inputs[i + 1].focus();
            break;
          }
        }
      }
    }
  }

  function stepperChange(field, delta, min, max, step) {
    const current = field === '—' ? 0 : parseFloat(field) || 0;
    let newVal = Math.round((current + delta) / step) * step;
    newVal = Math.max(min, Math.min(max, newVal));
    if (field === 'ratingVal') {
      ratingVal = newVal === 0 && delta < 0 ? '—' : String(newVal);
    } else {
      progressVal = newVal === 0 && delta < 0 ? '—' : String(newVal);
    }
  }

  async function saveStatusModal() {
    const id = statusModalId;
    if (!id) return;

    const status = statusValue;
    const rating = ratingVal !== '—' ? parseFloat(ratingVal) : null;
    const progress = progressVal !== '—' ? parseInt(progressVal, 10) : null;
    const startedAt = readDateSegments(startSeg);
    const completedAt = readDateSegments(endSeg);

    const data = {
      status,
      rating,
      progress,
      startedAt: startedAt ? startedAt + 'T00:00:00.000Z' : null,
      completedAt: completedAt ? completedAt + 'T00:00:00.000Z' : null,
      notes,
    };

    try {
      await api.put('/api/mylist/' + encodeURIComponent(id), data);
      showToast(tr('mylist.saved', '已保存'), 'success');
      statusModalOpen = false;
      closeCtx();
      loadMyList();
      if (typeof window.loadLibrary === 'function') window.loadLibrary();
    } catch (e) {
      showToast(tr('mylist.saveFailed', '保存失败：{message}', { message: e.message }), 'error');
    }
  }

  async function setMyListItemStatus(id, status) {
    try {
      await api.put('/api/mylist/' + encodeURIComponent(id) + '/status', { status });
      showToast(tr('mylist.statusUpdated', '状态已更新'), 'success');
      closeCtx();
      loadMyList();
      if (typeof window.loadLibrary === 'function') window.loadLibrary();
    } catch (e) {
      showToast(tr('mylist.updateFailed', '更新失败：{message}', { message: e.message }), 'error');
    }
  }

  // 卡片渲染后应用 reveal 动画
  $effect(() => {
    if (!filtered.length) return;
    tick().then(() => {
      document.querySelectorAll('#svelteMylistGrid .anime-card').forEach((card) => {
        card.style.animation = 'cardReveal 300ms var(--ease-out) forwards';
      });
    });
  });
</script>

{#if $mylistOpen}
  <section class="view" id="svelte-mylistView">
    <div class="mylist-status-bar" id="svelte-mylistStatusBar">
      <div
        class="mylist-status-item" class:active={mylistFilter === 'all'}
        data-status="all" onclick={() => setFilter('all')}
      ><b>{statusCounts.all}</b>{tr('common.all', '全部')}</div>
      {#each MYLIST_STATUS_ORDER as s}
        <div
          class="mylist-status-item" class:active={mylistFilter === s}
          data-status={s} onclick={() => setFilter(s)}
        ><b>{statusCounts[s] || 0}</b>{STATUS_LABELS[s] || s}</div>
      {/each}
    </div>

    <div class="view-header">
      <h1>{tr('mylist.title', '我的列表')}</h1>
      <div class="mylist-sort-bar" id="svelte-mylistSortDropdown">
        <button class="library-sort-trigger" class:open={sortOpen} onclick={() => (sortOpen = !sortOpen)} aria-label={tr('mylist.sort', '排序')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M6 12h12M9 18h6"/></svg>
        </button>
        <div class="library-sort-menu" class:open={sortOpen}>
          {#each ANIME_SORT_OPTIONS as o}
            <div class="library-sort-option" class:active={o.key === sortMode} onclick={() => switchSort(o.key)}>{o.label}</div>
          {/each}
        </div>
      </div>
    </div>

    <div id="svelte-mylistGrid" class="mylist-grid">
      {#if loading}
        <p class="form-hint">{tr('common.loading', '加载中...')}</p>
      {:else if filtered.length === 0}
        <div class="empty-state" id="svelte-mylistEmpty" style="display:flex">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
          </svg>
          <p>{mylistFilter === 'all' ? tr('common.empty', '暂无内容') : tr('mylist.emptyFiltered', '暂无{label}', { label: STATUS_LABELS[mylistFilter] || '' })}</p>
        </div>
      {:else if mylistFilter === 'all'}
        {#each MYLIST_STATUS_ORDER as status}
          {@const group = grouped[status]}
          {#if group && group.length > 0}
            <div class="mylist-section">
              <div class="mylist-section-header">
                <span class="mylist-section-title">{STATUS_LABELS[status]}</span>
                <span class="mylist-section-count">{group.length}</span>
              </div>
              <div class="grid-container" style="grid-template-columns:{gridCols}">
                {#each group as item (item.id)}
                  {@render card(item)}
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      {:else}
        <div class="grid-container" style="grid-template-columns:{gridCols}">
          {#each filtered as item (item.id)}
            {@render card(item)}
          {/each}
        </div>
      {/if}
    </div>
  </section>

  {#snippet card(item)}
    {@const isWish = item.source === 'wishlist'}
    {@const title = item.bangumiTitle || item.title || ''}
    {@const alwaysShowTitle = getCardTitleVisible('mylist')}
    {@const cover = coverSrc(item, 400)}
    <div
      class="anime-card" class:anime-card--wish={isWish}
      data-id={item.id} data-source={item.source}
      onclick={(e) => onCardClick(item, e)}
      oncontextmenu={(e) => showMyListContextMenu(e, item)}
    >
      {#if cover}
        <img src={cover} loading="lazy" decoding="async" alt={title}
          style={isWish ? 'opacity:0.45;filter:grayscale(0.6)' : ''}>
      {:else}
        <div class="gray-cover"><span class="gray-cover-text">{(title || '?')[0].toUpperCase()}</span></div>
      {/if}
      {#if !isWish}
        <div class="card-more-btn" data-tooltip={tr('ui.setStatusTooltip', '设置状态')}
          onclick={(e) => { e.stopPropagation(); openStatusModal(item); }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
          </svg>
        </div>
      {/if}
      {#if item.userRating}
        <span class="user-rating">☆ {item.userRating}</span>
      {/if}
      {#if alwaysShowTitle}
        <div class="title-strip"><div class="card-title">{title}</div></div>
      {/if}
      <div class="overlay">
        <h3>{title}</h3>
        <div class="meta">
          {#if item.rating}<span class="rating-badge">★ {item.rating}</span>{/if}
          {#if item.season && !isWish}<span class="season-badge">S{item.season}</span>{/if}
          {#if isWish}<span class="wishlist-badge">{tr('ui.wishlistBadge', '愿望单')}</span>{/if}
        </div>
      </div>
    </div>
  {/snippet}

  <!-- 右键菜单 -->
  {#if ctxVisible && ctxItem}
    <div class="context-menu show" id="svelteCtxMenu" style="left:{ctxX}px;top:{ctxY}px">
      {#if ctxItem.source === 'wishlist'}
        <div class="context-menu-item context-menu-danger" onclick={deleteWishlistItem}>{tr('mylist.removeFromWishlist', '从愿望单移除')}</div>
      {:else}
        <div class="context-menu-item" onclick={copyTitle}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>{tr('mylist.copyTitle', '复制标题')}</span>
        </div>
        <div class="context-menu-item" onclick={openInBgm}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          <span>{tr('mylist.openInBgm', '在 Bangumi 打开')}</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" onclick={() => { const it = ctxItem; closeCtx(); openStatusModal(it); }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{tr('mylist.markStatus', '标记状态')}</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item context-menu-danger" onclick={removeMyListItem}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          <span>{tr('common.remove', '移除')}</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- 状态弹窗 -->
  {#if statusModalOpen}
    <div class="modal-overlay show" id="svelte-statusModal" onclick={(e) => { if (e.target === e.currentTarget) statusModalOpen = false; }}>
      <div class="modal status-modal">
        <div class="status-modal-bg-wrap">
          <div class="status-modal-bg" id="svelte-statusModalBg" style={statusModalBg ? `background-image:url(${statusModalBg})` : ''}></div>
          <div class="status-modal-overlay"></div>
          <div class="status-modal-glass"></div>
        </div>
        <button class="status-modal-close" onclick={() => (statusModalOpen = false)} aria-label={tr('common.close', '关闭')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="status-modal-inner">
          <h2 class="status-modal-heading" id="svelte-statusModalTitle">{statusModalTitle}</h2>
          <div class="status-modal-body">
            <div class="field-row">
              <div class="field-cell">
                <label class="field-label">{tr('common.status', '状态')}</label>
                <div class="status-dd" id="svelte-statusDd" class:is-open={statusDdOpen}>
                  <button type="button" class="status-dd-trigger" id="svelte-statusDdTrigger" onclick={(e) => { e.stopPropagation(); statusDdOpen = !statusDdOpen; }}>
                    <span class="status-dd-text" id="svelte-statusDdText">{STATUS_LABELS[statusValue] || tr('common.wish', '计划中')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="status-dd-chevron"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  <div class="status-dd-menu" id="svelte-statusDdMenu">
                    <button type="button" class="status-dd-opt" class:is-selected={statusValue === 'watching'} onclick={() => { statusValue = 'watching'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/></svg><span>{tr('common.watching', '进行中')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                    <button type="button" class="status-dd-opt" class:is-selected={statusValue === 'wish'} onclick={() => { statusValue = 'wish'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg><span>{tr('common.wish', '计划中')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                    <button type="button" class="status-dd-opt" class:is-selected={statusValue === 'completed'} onclick={() => { statusValue = 'completed'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>{tr('common.completed', '已完成')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                    <button type="button" class="status-dd-opt" class:is-selected={statusValue === 'on_hold'} onclick={() => { statusValue = 'on_hold'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>{tr('common.on_hold', '搁置')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                    <button type="button" class="status-dd-opt" class:is-selected={statusValue === 'dropped'} onclick={() => { statusValue = 'dropped'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>{tr('common.dropped', '抛弃')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                  </div>
                </div>
              </div>
              <div class="field-cell">
                <label class="field-label">{tr('common.rating', '评分')}</label>
                <div class="num-stepper" id="svelte-ratingStepper" data-min="0" data-max="10" data-step="0.5">
                  <button type="button" class="num-stepper-btn" onclick={() => stepperChange('ratingVal', -0.5, 0, 10, 0.5)}>−</button>
                  <span class="num-stepper-val" id="svelte-ratingDisplay">{ratingVal}</span>
                  <button type="button" class="num-stepper-btn" onclick={() => stepperChange('ratingVal', 0.5, 0, 10, 0.5)}>+</button>
                </div>
              </div>
              <div class="field-cell">
                <label class="field-label">{tr('mylist.progressEpisodes', '进度 (集)')}</label>
                <div class="num-stepper" id="svelte-progressStepper" data-min="0" data-max="999" data-step="1">
                  <button type="button" class="num-stepper-btn" onclick={() => stepperChange('progressVal', -1, 0, 999, 1)}>−</button>
                  <span class="num-stepper-val" id="svelte-progressDisplay">{progressVal}</span>
                  <button type="button" class="num-stepper-btn" onclick={() => stepperChange('progressVal', 1, 0, 999, 1)}>+</button>
                </div>
              </div>
            </div>
            <div class="field-row">
              <div class="field-cell">
                <label class="field-label">{tr('common.startDate', '开始日期')}</label>
                <div class="date-segments" data-date="startedAt">
                  <input type="text" class="date-seg date-seg--y" maxlength="4" placeholder="YYYY" inputmode="numeric" value={startSeg.y} oninput={(e) => segAutoTab(e, startSeg, 'y')}>
                  <span class="date-sep">/</span>
                  <input type="text" class="date-seg date-seg--m" maxlength="2" placeholder="MM" inputmode="numeric" value={startSeg.m} oninput={(e) => segAutoTab(e, startSeg, 'm')}>
                  <span class="date-sep">/</span>
                  <input type="text" class="date-seg date-seg--d" maxlength="2" placeholder="DD" inputmode="numeric" value={startSeg.d} oninput={(e) => segAutoTab(e, startSeg, 'd')}>
                </div>
              </div>
              <div class="field-cell">
                <label class="field-label">{tr('common.endDate', '结束日期')}</label>
                <div class="date-segments" data-date="completedAt">
                  <input type="text" class="date-seg date-seg--y" maxlength="4" placeholder="YYYY" inputmode="numeric" value={endSeg.y} oninput={(e) => segAutoTab(e, endSeg, 'y')}>
                  <span class="date-sep">/</span>
                  <input type="text" class="date-seg date-seg--m" maxlength="2" placeholder="MM" inputmode="numeric" value={endSeg.m} oninput={(e) => segAutoTab(e, endSeg, 'm')}>
                  <span class="date-sep">/</span>
                  <input type="text" class="date-seg date-seg--d" maxlength="2" placeholder="DD" inputmode="numeric" value={endSeg.d} oninput={(e) => segAutoTab(e, endSeg, 'd')}>
                </div>
              </div>
              <div class="field-cell">
                <label class="field-label">{tr('common.notes', '笔记')}</label>
                <input type="text" id="svelte-notesInput" class="notes-input" placeholder={tr('mylist.notesPlaceholder', '简短记录...')} maxlength="200" bind:value={notes}>
              </div>
            </div>
          </div>
          <div class="status-modal-footer">
            <button class="btn btn-primary" onclick={saveStatusModal}>{tr('common.save', '保存')}</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

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
            {tr('mylist.openInBgmFull', '在 Bangumi 打开')}
          </a>
          <button class="btn btn-ghost" onclick={() => (wishItem = null)}>{tr('common.close', '关闭')}</button>
        </div>
        <button class="modal-close-btn" onclick={() => (wishItem = null)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  {/if}
{/if}