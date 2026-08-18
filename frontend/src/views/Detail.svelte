<script module>
  // ─── Detail 视图
  // 挂载由 orchestrator 统一处理（本文件不修改 App.svelte）。
  import { writable } from 'svelte/store';

  // 跨组件打开开关：orchestrator 可 bind 此 store 或调用 openDetail()。
  export const detailOpen = writable(false);

  // 打开参数（id / 来源卡片 rect / 来源封面 / 来源视图）
  let pendingOpen = null;

  /**
   * 打开详情视图（与 vanilla showDetail 签名兼容）。
   * 供 orchestrator / 内联 onclick 桥接调用。
   */
  export function openDetail(id, fromRect, fromSrc, sourceView = 'library') {
    pendingOpen = { id, fromRect, fromSrc, sourceView };
    detailOpen.set(true);
  }

  // 播放结束回调：实例脚本挂载时注册，mpv-status.js import 调用。
  let _playbackEndedHandler = null;
  export function setHandleDetailPlaybackEnded(fn) { _playbackEndedHandler = fn; }
  export function handleDetailPlaybackEnded(endedAnimeId) {
    return _playbackEndedHandler ? _playbackEndedHandler(endedAnimeId) : false;
  }
</script>

<script>
  import { onMount, tick } from 'svelte';
  import { showToast } from '../components/Toast.svelte';
  import { showConfirm } from '../components/ConfirmDialog.svelte';
  import EpisodeHeatmap from '../components/detail/EpisodeHeatmap.svelte';
  import Characters from '../components/detail/Characters.svelte';
  import WatchStats from '../components/detail/WatchStats.svelte';
  import RelationList from '../components/detail/RelationList.svelte';
  import LazySection from '../components/detail/LazySection.svelte';
  import SyncModal from '../components/detail/SyncModal.svelte';
  import FinishConfirmModal from '../components/detail/FinishConfirmModal.svelte';
  import { ANILIST_TAG_DATA } from '../lib/tag-data.js';
  import { tr } from '../lib/anime-utils.js';
  import { libraryData, mylistData, pendingAutoPlay, pendingFinishAnimeId } from '../lib/ui-state.js';
  import { loadLibrary } from './Library.svelte';
  import { refreshDiscovery } from './Discovery.svelte';
  import { loadMyList } from './Mylist.svelte';
  import { showView } from '../lib/router.js';
  import { titlebarContext } from '../components/chrome/Titlebar.svelte';
  import { API as api } from '../lib/api.js';

  const path = { basename(p) { return p ? p.split(/[\\/]/).pop() : ''; } };

  // ─── 状态 ───
  let anime = $state(null);
  let isWishlistMode = $state(false);
  let detailSourceView = $state('library');
  let enterActive = $state(false);
  let showContent = $state(false);
  let detailReady = $state(false); // 数据+DOM就绪后才 true，控制视图可见性
  let bannerFailed = $state(false);
  let coverFailed = $state(false);
  let tagsExpanded = $state(false);
  let syncOpen = $state(false);
  let finishConfirm = $state(null); // { ep, resolve } | null

  // 非响应式内部状态
  let _dismissedFinishConfirm = new Set();
  let isSliding = false;
  let episodeHeatmapRef = $state(null); // 组件实例引用（bind:this）

  // ─── 派生状态（声明式渲染，替代 renderDetail 字符串拼接）───

  // Banner
  let bannerUrl = $derived(anime?.anilistBanner && anime.anilistBanner !== '__none__'
    ? '/banners/' + path.basename(anime.anilistBanner) : '');
  let noBanner = $derived(!bannerUrl || bannerFailed);

  // Cover
  let localCover = $derived(anime?.localCover ? '/covers/' + path.basename(anime.localCover) + '?w=540&q=80' : '');
  let coverInitial = $derived((anime?.bangumiTitle || anime?.title || '?')[0].toUpperCase());

  // Alias
  let alias = $derived([anime?.bangumiTitleJp, anime?.romajiTitle].filter(Boolean).join(' / '));
  let aliasVisible = $derived(!!alias);

  // Info line
  let hasInfoLeft = $derived(!!(anime?.rating || anime?.ratingRank || anime?.ratingTotal));
  let seasonValue = $derived(anime ? (anime.matchedSeason || anime.season) : null);
  let seasonMismatch = $derived(!!(anime && anime.season && anime.matchedSeason && anime.season !== anime.matchedSeason));
  let hasInfoRight = $derived(!!((seasonValue && seasonValue > 1) || anime?.date || anime?.platform));
  let infoLineVisible = $derived(hasInfoLeft || hasInfoRight);

  // Tags
  let tags = $derived.by(() => {
    return (anime?.anilistTags || [])
      .filter((t) => !t.isGeneralSpoiler)
      .map((t) => {
        const d = ANILIST_TAG_DATA[t.name];
        return { name: d?.zh || t.name, desc: d?.descZh || d?.descEn || '', rank: t.rank };
      })
      .sort((x, y) => y.rank - x.rank);
  });
  let studio = $derived(anime?.anilistStudios?.[0] || '');
  let tagsVisible = $derived(!!(studio || tags.length));
  let shownTags = $derived(tagsExpanded ? tags : tags.slice(0, 4));
  let tagsRemaining = $derived(tags.length - 4);

  // Summary
  let summary = $derived.by(() => renderSummaryText(anime));

  // Episode count
  let episodeCount = $derived.by(() => {
    if (!anime || !anime.episodes || anime.episodes.length === 0) return '';
    const localCount = anime.episodes.length;
    const totalCount = anime.totalEpisodes || anime.eps;
    return totalCount
      ? tr('detail.episodeCountTotal', { localCount, totalCount })
      : tr('detail.episodeCountLocal', { localCount });
  });

  // 模块可见性
  let episodeHeatmapVisible = $derived(!isWishlistMode);
  let watchStatsVisible = $derived(!isWishlistMode && (anime?.episodes || []).some((e) => e.watched));
  let fetchBtnVisible = $derived(!isWishlistMode);
  let deleteBtnVisible = $derived(!isWishlistMode);
  let archiveVisible = $derived(isWishlistMode);

  // 播放按钮
  let playBtn = $derived.by(() => {
    if (isWishlistMode || !anime || !anime.episodes || anime.episodes.length === 0) return null;
    const result = findTargetEpisode(anime);
    const targetEp = result.episode;
    const allWatched = result.allWatched;
    const hasViewHistory = anime.episodes.some((e) => e.watched || e.progress > 0);
    let text;
    if (allWatched) text = tr('detail.replay');
    else if (targetEp.progress > 0 || hasViewHistory) text = tr('detail.continue');
    else text = tr('detail.startPlay');
    return { text, path: targetEp.filePath, pos: targetEp.progress || 0, epIdx: anime.episodes.indexOf(targetEp) };
  });

  // 心愿单外部链接
  let bgmUrl = $derived('https://bgm.tv');

  // ─── Titlebar 上下文 ───
  $effect(() => {
    if (anime) {
      titlebarContext.set({ mode: 'detail', title: anime.bangumiTitle || anime.title || '' });
    }
  });

  // ─── 打开时加载 ───
  $effect(() => {
    if ($detailOpen && pendingOpen) {
      const { id, fromRect, fromSrc, sourceView } = pendingOpen;
      detailSourceView = sourceView || 'library';
      isWishlistMode = false;
      loadAndShow(id, fromRect, fromSrc);
    }
  });

  async function loadAndShow(id, fromRect, fromSrc) {
    resetDetailEnter();
    try {
      anime = await api.get('/api/anime/' + encodeURIComponent(id));
      bannerFailed = false;
      coverFailed = false;
      tagsExpanded = false;
      enterActive = true;
      await tick(); // Svelte 渲染 DOM，img 进 DOM 开始加载
      detailReady = true; // DOM 就绪，显示视图（与旧版 showView 时序一致）
      await tick(); // 等 detailReady 的 DOM 更新 flush，动画起点/终点 rect 才能拿到正确布局
      if (fromRect) {
        // 从卡片点击进入：hero 封面展开动画接管 cover 可见性
        animateHeroCoverFlip(fromRect, fromSrc);
      } else {
        // 直接进入（仪表盘/搜索等）：cover 立即可见（内联样式覆盖 CSS class 的 opacity:0），
        const wrap = document.getElementById('svelte-detailCover');
        if (wrap) { wrap.style.opacity = '1'; wrap.style.transform = 'scale(1)'; }
        setEntranceDelays(0.04, 0);
        showContent = true;
      }
      if ($pendingFinishAnimeId === id) {
        pendingFinishAnimeId.set(null);
        checkAndShowFinishConfirm(anime);
      }
      if ($pendingAutoPlay === id) {
        pendingAutoPlay.set(null);
        const ep = findWatchEpisode(anime);
        if (ep) setTimeout(() => playEpisode(ep.filePath, ep.progress), 400);
      }
    } catch (e) {
      showToast(tr('detail.loadFailed', { error: e.message }), 'error');
    }
  }

  // ─── 摘要处理 ───
  function renderSummaryText(a) {
    if (!a) return tr('detail.noSummary');
    let text = a.summary || '';
    if (text && /[\u4e00-\u9fff]/.test(text)) {
      const parts = text.split(/\[?简介原文\]?/);
      if (parts.length > 1) {
        text = parts[0].trim();
      } else {
        const dashed = text.split(/\n---+\n/);
        if (dashed.length > 1) {
          text = dashed[0].trim();
        } else {
          const paragraphs = text.split(/\n+/).filter((p) => p.trim());
          const cn = [];
          for (let p of paragraphs) {
            const hiragana = (p.match(/[\u3040-\u309f]/g) || []).length;
            const katakana = (p.match(/[\u30a0-\u30ff]/g) || []).length;
            const hanCount = (p.match(/[\u4e00-\u9fff]/g) || []).length;
            const meaningful = p.replace(/\s/g, '').length;
            if (hanCount === 0 && hiragana === 0 && katakana === 0) continue;
            if (katakana >= 8 && hanCount < 3) continue;
            if (hiragana >= 3 && hiragana / meaningful > 0.4) continue;
            cn.push(p.trim());
          }
          if (cn.length > 0) text = cn.join('\n');
        }
      }
    }
    return text || tr('detail.noSummary');
  }

  // ─── 播放按钮 ───
  function findTargetEpisode(a) {
    if (!a.episodes || a.episodes.length === 0) return null;
    if (a.lastPlayedEp) {
      const ep = a.episodes.find((e) => e.number === a.lastPlayedEp);
      if (ep && !ep.watched) return { episode: ep, allWatched: false };
    }
    for (let i = 0; i < a.episodes.length; i++) {
      if (!a.episodes[i].watched) return { episode: a.episodes[i], allWatched: false };
    }
    return { episode: a.episodes[0], allWatched: true };
  }
  function findWatchEpisode(a) {
    const r = findTargetEpisode(a);
    return r ? r.episode : null;
  }

  async function playEpisode(filePath, position = 0) {
    try {
      await api.post('/api/play', { filePath, position });
      showToast(tr('detail.playing'), 'info');
    } catch (e) {
      showToast(tr('detail.playFailed', { error: e.message }), 'error');
    }
  }

  async function playEpisodeFromCover() {
    if (!playBtn) return;
    await playEpisode(playBtn.path, playBtn.pos);
    if (playBtn.epIdx >= 0) episodeHeatmapRef?.scrollToIndex(playBtn.epIdx);
  }

  // ─── 标记看完 / 进度 ───
  function findPendingFinishConfirm(a) {
    if (!a.lastPlayedEp || !a.episodes) return null;
    const ep = a.episodes.find((e) => e.number === a.lastPlayedEp);
    if (!ep || ep.watched) return null;
    if (ep.progress > 0 && ep.duration > 0 && ep.progress / ep.duration > 0.9) return ep;
    return null;
  }

  // Promise 模式确认弹窗
  function showFinishConfirm(a, ep) {
    return new Promise((resolve) => {
      finishConfirm = { ep, resolve };
    });
  }
  function resolveFinishConfirm(result) {
    const c = finishConfirm;
    finishConfirm = null;
    c?.resolve(result);
  }

  async function checkAndShowFinishConfirm(a) {
    if (!a) return;
    let mode = localStorage.getItem('myAnimDock_finishConfirm') || 'prompt';
    if (mode === 'on') mode = 'prompt';
    if (mode === 'off') return;
    const ep = findPendingFinishConfirm(a);
    if (!ep) return;
    const key = a.id + ':' + ep.number;
    if (mode === 'prompt') {
      if (_dismissedFinishConfirm.has(key)) return;
      const finished = await showFinishConfirm(a, ep);
      if (!finished) { _dismissedFinishConfirm.add(key); return; }
    }
    try {
      await api.post('/api/progress', { animeId: a.id, episodeNumber: ep.number, watched: true, progress: 0 });
      anime = await api.get('/api/anime/' + encodeURIComponent(a.id));
      scrollToNextUnwatched(anime, ep.number);
      showToast(tr('detail.markedWatched', { number: ep.number }), 'success');
    } catch (e) {
      showToast(tr('detail.markFailed', { error: e.message }), 'error');
    }
  }

  function scrollToNextUnwatched(a, afterEpNumber) {
    episodeHeatmapRef?.scrollToNextUnwatched(a, afterEpNumber);
  }

  async function toggleWatched(epNumber, watched) {
    if (!anime) return;
    try {
      const result = await api.post('/api/progress', { animeId: anime.id, episodeNumber: epNumber, watched });
      const ep = anime.episodes.find((e) => e.number === epNumber);
      if (ep) { ep.watched = result.episode.watched; ep.progress = result.episode.progress; }
      // 手动标记已看：与完工确认一致的"引导到下一未看"（仅标记方向滚动，取消不滚动）
      if (watched) scrollToNextUnwatched(anime, epNumber);
    } catch (e) {
      showToast(tr('detail.actionFailed', { error: e.message }), 'error');
    }
  }

  // ─── 同步元数据（打开由父控制，搜索/附加在 SyncModal 内部）───
  function syncBangumiMetadata() {
    if (!anime) return;
    syncOpen = true;
  }
  function handleAttached(newAnime) {
    anime = newAnime;
    syncOpen = false;
  }

  // ─── 删除 ───
  async function deleteAnime() {
    if (!anime) return;
    const ok = await showConfirm(tr('detail.deleteConfirm', { title: anime.title }));
    if (!ok) return;
    try {
      await api.del('/api/anime/' + encodeURIComponent(anime.id));
      showToast(tr('detail.deleted'), 'success');
      goBack();
      loadLibrary();
      refreshDiscovery();
      loadMyList();
    } catch (e) {
      showToast(tr('detail.deleteFailed', { error: e.message }), 'error');
    }
  }

  // ─── 导航 ───
  function goBack() {
    const target = detailSourceView || 'library';
    showView(target);
  }

  function findCurrentLibraryIndex() {
    if (!anime) return -1;
    const ld = $libraryData;
    if (!ld || !ld.length) return -1;
    return ld.findIndex((a) => a.id === anime.id);
  }

  function goPrev() {
    if (isSliding) return;
    if (detailSourceView === 'mylist' && $mylistData && $mylistData.length > 0) {
      const idx = $mylistData.findIndex((i) => i.id === anime.id);
      if (idx === -1) return;
      const prevIdx = idx === 0 ? $mylistData.length - 1 : idx - 1;
      const prev = $mylistData[prevIdx];
      if (prev) slideToAnime(prev.id, 'prev');
      return;
    }
    const idx = findCurrentLibraryIndex();
    if (idx === -1) return;
    const prevIdx = idx === 0 ? $libraryData.length - 1 : idx - 1;
    const prev = $libraryData[prevIdx];
    if (prev) slideToAnime(prev.id, 'prev');
  }

  function goNext() {
    if (isSliding) return;
    if (detailSourceView === 'mylist' && $mylistData && $mylistData.length > 0) {
      const idx = $mylistData.findIndex((i) => i.id === anime.id);
      if (idx === -1) return;
      const nextIdx = idx === $mylistData.length - 1 ? 0 : idx + 1;
      const next = $mylistData[nextIdx];
      if (next) slideToAnime(next.id, 'next');
      return;
    }
    const idx = findCurrentLibraryIndex();
    if (idx === -1) return;
    const nextIdx = idx === $libraryData.length - 1 ? 0 : idx + 1;
    const next = $libraryData[nextIdx];
    if (next) slideToAnime(next.id, 'next');
  }

  // fetch 阶段：只取数据不赋值。赋值推迟到退出动画完成后（见 slideToAnime），
  // 否则 anime=... 会触发 #key 重建，把退出动画挂载的旧节点提前销毁。
  async function loadAnimeData(id) {
    try {
      if (detailSourceView === 'mylist' && $mylistData) {
        const item = $mylistData.find((i) => i.id === id);
        if (!item) throw new Error('条目不存在');
        if (item.source === 'wishlist') {
          return {
            wishlist: true,
            data: {
              id: item.id,
              title: item.title,
              bangumiTitle: item.bangumiTitle || item.title,
              localCover: null,
              coverUrl: item.coverUrl || '',
              rating: item.rating || null,
              summary: item.summary || '',
              bangumiId: item.bangumiId,
              season: null,
              episodes: [],
              downloaded: false,
            },
          };
        }
        return { wishlist: false, data: await api.get('/api/anime/' + encodeURIComponent(id)) };
      }
      return { wishlist: false, data: await api.get('/api/anime/' + encodeURIComponent(id)) };
    } catch (e) {
      console.error('[Detail] loadAnimeData failed for id=' + id + ':', e);
      showToast(tr('detail.loadFailed', { error: e.message }), 'error');
      isSliding = false;
      const navOverlay = document.getElementById('svelte-detailNavOverlay');
      if (navOverlay) navOverlay.style.pointerEvents = '';
      return null;
    }
  }

  async function slideToAnime(id, direction) {
    if (isSliding) return;
    isSliding = true;
    const navOverlay = document.getElementById('svelte-detailNavOverlay');
    if (navOverlay) navOverlay.style.pointerEvents = 'none';
    resetDetailNav();

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reduceMotion === 'true';
    const gsap = globalThis.gsap;

    // 退出：旧内容沿 direction 方向滑出 + 淡出（banner 底图按 0.6 系数微平移，制造视差）。
    // 与数据 fetch 并行——两者都完成后再应用新数据，避免 #key 重建把动画节点中途销毁。
    const exitTargets = Array.from(document.querySelectorAll('.detail-content, .detail-banner-bg'));
    const exitX = direction === 'prev' ? 60 : -60;
    const exitPromise = gsap && !reduceMotion && exitTargets.length
      ? new Promise((resolve) => {
          gsap.to(exitTargets, {
            x: (i, el) => el.classList.contains('detail-banner-bg') ? exitX * 0.6 : exitX,
            opacity: 0,
            duration: 0.16,
            ease: 'power2.in',
            onComplete: resolve,
          });
        })
      : Promise.resolve();

    const [result] = await Promise.all([loadAnimeData(id), exitPromise]);
    if (!result) {
      // fetch 失败：把被推离的旧内容恢复原位（isSliding/navOverlay 已在 loadAnimeData 内复位）
      console.error('[Detail] slideToAnime loadAnimeData returned null (fetch failed)');
      if (gsap && exitTargets.length) {
        gsap.killTweensOf(exitTargets);
        gsap.set(exitTargets, { clearProps: 'transform,opacity' });
      }
      // 恢复视图可见：resetDetailEnter 已把 detailReady 置 false → section display:none，
      // 若不恢复会卡白屏（旧内容已复位但 section 仍隐藏）
      const detailSection = document.getElementById('svelte-detailView');
      if (detailSection) detailSection.style.visibility = '';
      detailReady = true;
      showContent = true;
      enterActive = false;
      return;
    }

    // 应用阶段：旧内容已滑出完毕（退出动画已把旧内容推至 opacity:0）。
    // 先给 section 预置 visibility:hidden 再赋值触发 #key 重建：
    // 新内容首帧即隐藏态（连未纳入 enter-active 隐藏规则的元素也被盖住），
    // 杜绝「重建后先以可见态绘制一帧」导致的整页闪。
    const detailSection = document.getElementById('svelte-detailView');
    if (detailSection) detailSection.style.visibility = 'hidden';
    isWishlistMode = result.wishlist;
    anime = result.data;
    bannerFailed = false;
    coverFailed = false;
    tagsExpanded = false;

    // 入场：新内容从反方向滑入，与原有分波淡入叠加
    try {
      enterActive = true;
      await tick(); // Svelte 渲染 DOM，img 进 DOM 开始加载
      detailReady = true; // DOM 就绪，显示视图（slideToAnime 是切番，页面本来就是可见的）
      // cover 立即可见（内联样式覆盖 CSS class 的 opacity:0），与旧版行为一致
      const wrap = document.getElementById('svelte-detailCover');
      if (wrap) { wrap.style.opacity = '1'; wrap.style.transform = 'scale(1)'; }
      const incoming = Array.from(document.querySelectorAll('.detail-content, .detail-banner-bg'));
      const fromX = direction === 'prev' ? -40 : 40;
      if (gsap && !reduceMotion && incoming.length) {
        gsap.set(incoming, {
          x: (i, el) => el.classList.contains('detail-banner-bg') ? fromX * 0.6 : fromX,
        });
      }
      // 恢复 section 可见性
      if (detailSection) detailSection.style.visibility = '';
      if (gsap && !reduceMotion && incoming.length) {
        gsap.to(incoming, { x: 0, duration: 0.28, ease: 'power2.out' });
      }
      setEntranceDelays(0.04, 0);
      showContent = true;
    } catch (err) {
      // 调试：定位左右切换白屏根因（#key 重建期间子组件抛错会中断本流程）
      console.error('[Detail] slideToAnime apply phase error:', err);
      // 安全网：确保视图不卡在白屏（detailReady/showContent 未置位 → section 保持 display:none）
      detailReady = true;
      showContent = true;
      enterActive = false;
      if (detailSection) detailSection.style.visibility = '';
    }
    isSliding = false;
    if (navOverlay) navOverlay.style.pointerEvents = '';
  }

  function onNavLeft(e) { createRipple(e, e.currentTarget); goPrev(); }
  function onNavRight(e) { createRipple(e, e.currentTarget); goNext(); }

  // ─── Ripple ───
  function createRipple(e, zone) {
    const rect = zone.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.8;
    const x = (e.clientX || rect.left + rect.width / 2) - rect.left;
    const y = (e.clientY || rect.top + rect.height / 2) - rect.top;
    spawnRipple(zone, x, y, size);
  }
  function createRippleAt(cx, cy, container) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const size = 120;
    const x = cx - rect.left - size / 2;
    const y = cy - rect.top - size / 2;
    spawnRipple(container, x + size / 2, y + size / 2, size * 2);
  }
  function spawnRipple(parent, x, y, size) {
    const el = document.createElement('div');
    el.className = 'detail-ripple';
    el.style.cssText = `width:${size}px;height:${size}px;left:${x - size / 2}px;top:${y - size / 2}px;`;
    parent.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  // ─── 入场动画 ───
  // tick() 只保证 Svelte DOM 更新完成，不保证浏览器已绘制。
  // 双 rAF 确保隐藏态（opacity:0）真实绘制后再 reveal，CSS transition 才有 before-change 可插值。
  // 否则首次挂载的新节点 transition 启动即取消（csswg #10187），详情页首次进入空白。
  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function resetDetailEnter() {
    document.querySelectorAll('.detail-banner-right > *, .detail-char-card, #svelte-episodeHeatmap, #svelte-watchStats')
      .forEach((el) => { el.style.transition = 'none'; el.style.transitionDelay = ''; });
    enterActive = false;
    showContent = false;
    detailReady = false;
    const hero = document.getElementById('svelte-heroCover');
    if (hero) hero.remove();
    const wrap = document.getElementById('svelte-detailCover');
    if (wrap) { wrap.style.opacity = ''; wrap.style.transform = ''; wrap.style.visibility = ''; }
    document.querySelectorAll('.detail-ripple').forEach((el) => el.remove());
  }

  // 左右切换专用重置：只重置入场状态（enterActive/showContent/过渡延迟）并清理残留波纹，
  // 不触碰 detailReady —— 保持 section 可见，避免切换期间视图被 display:none 隐藏导致白屏。
  function resetDetailNav() {
    document.querySelectorAll('.detail-banner-right > *, .detail-char-card, #svelte-episodeHeatmap, #svelte-watchStats')
      .forEach((el) => { el.style.transition = 'none'; el.style.transitionDelay = ''; });
    enterActive = false;
    showContent = false;
    const hero = document.getElementById('svelte-heroCover');
    if (hero) hero.remove();
    const wrap = document.getElementById('svelte-detailCover');
    if (wrap) { wrap.style.opacity = ''; wrap.style.transform = ''; wrap.style.visibility = ''; }
    document.querySelectorAll('.detail-ripple').forEach((el) => el.remove());
  }

  function setEntranceDelays(bannerStep, baseOffset) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.documentElement.dataset.reduceMotion === 'true') return;
    document.querySelectorAll('.detail-banner-right > *, .detail-char-card, #svelte-episodeHeatmap, #svelte-watchStats')
      .forEach((el) => { el.style.transition = ''; });
    const b = baseOffset || 0;
    document.querySelectorAll('.detail-banner-right > *').forEach((el, i) => {
      el.style.transitionDelay = `${b + i * bannerStep}s`;
    });
    const heatEl = document.getElementById('svelte-episodeHeatmap');
    if (heatEl) heatEl.style.transitionDelay = `${b + 0.06}s`;
    const cards = document.querySelectorAll('.detail-char-card');
    const center = (cards.length - 1) / 2;
    cards.forEach((card, i) => { card.style.transitionDelay = `${b + 0.12 + Math.abs(i - center) * 0.02}s`; });
    const stEl = document.getElementById('svelte-watchStats');
    if (stEl) stEl.style.transitionDelay = `${b + 0.18}s`;
  }

  async function animateHeroCoverFlip(fromRect, fromSrc) {
    const wrap = document.getElementById('svelte-detailCover');
    const img = wrap ? wrap.querySelector('img') : null;
    const toRect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    if (wrap) { wrap.style.visibility = 'hidden'; wrap.style.opacity = '0'; }
    const hero = document.createElement('div');
    hero.id = 'svelte-heroCover';
    hero.style.cssText = `
      position:fixed;z-index:100;pointer-events:none;overflow:hidden;
      left:${fromRect.left}px;top:${fromRect.top}px;
      width:${fromRect.width}px;height:${fromRect.height}px;
      border-radius:16px;background:var(--bg-card);
    `;
    if (fromSrc) {
      const clone = document.createElement('img');
      clone.src = fromSrc; clone.alt = '';
      clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      hero.appendChild(clone);
    } else if (img) {
      const clone = document.createElement('img');
      clone.src = img.src; clone.alt = img.alt || '';
      clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      hero.appendChild(clone);
    } else {
      hero.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-card);font-size:2rem;font-weight:700;color:var(--fg-muted)">' + (wrap?.textContent?.trim()?.[0] || '?') + '</div>';
    }
    document.body.appendChild(hero);
    const gsap = globalThis.gsap;
    if (gsap) {
      // 一次测量 + transform 动画（替代原 Flip.from）。
      // 原 Flip 每帧 getGlobalMatrix→getBoundingClientRect 强制同步布局，与首屏渲染抢帧；
      // 本场景起点 fromRect / 终点 toRect 布局稳定、均已知，一次测量即可。
      // transformOrigin 0 0 让 scale 以左上角为原点，translate 不受 scale 影响，终点精确对齐 toRect。
      gsap.set(hero, { transformOrigin: '0 0' });
      setEntranceDelays(0.05, 0.04);
      // 刚读取了计算样式，reveal 必须隔一帧（csswg #10187：同帧读样式后切 class → transition 取消）
      await nextFrame();
      showContent = true;
      gsap.to(hero, {
        x: toRect.left - fromRect.left,
        y: toRect.top - fromRect.top,
        scaleX: toRect.width / fromRect.width,
        scaleY: toRect.height / fromRect.height,
        duration: 0.35, ease: 'power2.out',
        onComplete: () => {
          if (wrap) { wrap.style.visibility = ''; wrap.style.opacity = '1'; wrap.style.transform = ''; }
          hero.remove();
        },
      });
    } else {
      hero.remove();
      if (wrap) { wrap.style.visibility = ''; wrap.style.opacity = '1'; }
      await nextFrame();
      showContent = true;
      setEntranceDelays(0.04, 0);
    }
  }

  // Banner / cover 事件
  function onBannerLoad(e) {
    const img = e.currentTarget;
    if (img.naturalWidth / img.naturalHeight > 2.5) img.style.objectPosition = 'center 25%';
  }
  function onBannerError() { bannerFailed = true; }
  function onCoverError() { coverFailed = true; }

  // ─── 全局播放结束回调（mpv-status.js import 调用）───
  setHandleDetailPlaybackEnded(function (endedAnimeId) {
    if (!anime) return false;
    if (endedAnimeId && anime.id !== endedAnimeId) return false;
    api.get('/api/anime/' + encodeURIComponent(anime.id)).then((updated) => {
      anime = updated;
      // 剧集列表重定位到最新进度（vanilla renderEpisodeHeatmap 的对应行为：
      // lastPlayedEp 有进度→滚到它；已看完→滚到下一未观看）
      episodeHeatmapRef?.scrollToLastPosition();
      checkAndShowFinishConfirm(anime);
      const allDone = anime.episodes && anime.episodes.length > 0 && anime.episodes.every((e) => e.watched);
      if (allDone && anime.myListStatus === 'completed') {
        showToast(tr('detail.playEndedAllWatched'), 'success');
        return;
      }
      showToast(tr('detail.playEndedUpdated'), 'success');
    });
    return true;
  });

  // ─── 键盘 / 鼠标监听（角色 resize 已在 Characters 组件内处理）───
  onMount(() => {
    function onMouseUp(e) {
      if (!$detailOpen) return;
      if (e.button === 3) {
        e.preventDefault();
        createRippleAt(e.clientX, e.clientY, document.getElementById('svelte-detailNavOverlay'));
        goBack();
      }
    }
    function onKey(e) {
      if (!$detailOpen) return;
      // I5: Escape 优先关闭同步弹窗，其次才返回
      if (e.key === 'Escape') {
        if (syncOpen) { syncOpen = false; return; }
        goBack();
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    }
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<section
  class="view"
  id="svelte-detailView"
  class:hidden={!$detailOpen || !detailReady}
  class:detail-enter-active={enterActive}
  class:show-content={showContent}
  class:detail-no-banner={noBanner}
>
  <div class="detail-nav-overlay" id="svelte-detailNavOverlay">
    <div class="detail-nav-zone detail-nav-left" id="navLeft" onclick={onNavLeft}>
      <svg class="detail-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </div>
    <div class="detail-nav-zone detail-nav-right" id="navRight" onclick={onNavRight}>
      <svg class="detail-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  </div>
  {#if anime}
    {#key anime.id}
      {#if bannerUrl && !bannerFailed}
        <div class="detail-banner-bg">
          <img class="detail-banner-bg-img" src={bannerUrl} alt="" onload={onBannerLoad} onerror={onBannerError}>
        </div>
      {/if}
      <div class="detail-content">
        <div class="detail-banner">
          <div class="detail-banner-left">
            <div class="detail-cover-wrap" id="svelte-detailCover">
              {#if localCover && !coverFailed}
                <img src={localCover} alt={anime.title} onerror={onCoverError}>
              {:else}
                <div class="gray-cover"><span class="gray-cover-text">{coverInitial}</span></div>
              {/if}
            </div>
            <div class="detail-actions">
              <button class="btn btn-outline" id="btnPlayAnime" style:display={playBtn ? 'inline-flex' : 'none'} onclick={playEpisodeFromCover}><span id="btnPlayText">{playBtn?.text}</span></button>
              <button class="btn btn-ghost" id="btnFetchBangumi" style:display={fetchBtnVisible ? 'inline-flex' : 'none'} onclick={syncBangumiMetadata}>{tr('common.sync')}</button>
              <button class="btn btn-danger" id="btnDeleteAnime" style:display={deleteBtnVisible ? 'inline-flex' : 'none'} onclick={deleteAnime}>{tr('common.remove')}</button>
            </div>
          </div>
          <div class="detail-banner-right">
            <h1 id="detailTitle">{anime.bangumiTitle || anime.title}</h1>
            <div id="detailAlias" class="detail-alias" style:display={aliasVisible ? '' : 'none'}>{alias}</div>
            <div class="detail-info-line" id="detailInfoLine" style:display={infoLineVisible ? '' : 'none'}>
              {#if hasInfoLeft}
                <span class="info-left">
                  {#if anime.rating}<span class="info-rating-num">★ {anime.rating}</span>{/if}
                  {#if anime.ratingRank}<span class="info-rating-sub">#{anime.ratingRank}</span>{/if}
                  {#if anime.ratingTotal}<span class="info-rating-sub">{tr('detail.ratingPeople', { count: anime.ratingTotal })}</span>{/if}
                </span>
              {/if}
              {#if hasInfoRight}
                <span class="info-tags">
                  {#if seasonValue && seasonValue > 1}
                    <span class="tag-pill tag-pill--secondary{seasonMismatch ? ' tag-pill--warn' : ''}">S{seasonValue}{seasonMismatch ? ' ⚠' : ''}</span>
                  {/if}
                  {#if anime.date}<span class="tag-pill tag-pill--secondary">{anime.date}</span>{/if}
                  {#if anime.platform}<span class="tag-pill tag-pill--secondary">{anime.platform}</span>{/if}
                </span>
              {/if}
            </div>
            <div class="detail-tags" id="svelte-detailTags" style:display={tagsVisible ? '' : 'none'}>
              <div class="detail-tags-list">
                {#if studio}<span class="tag-pill tag-pill--studio">{tr('detail.studioLabel')} {studio}</span>{/if}
                {#each shownTags as tag}
                  {#if tag.desc}
                    <span class="tag-pill" data-tooltip={tag.desc} data-tooltip-rich>{tag.name}</span>
                  {:else}
                    <span class="tag-pill">{tag.name}</span>
                  {/if}
                {/each}
                {#if !tagsExpanded && tagsRemaining > 0}
                  <span class="tag-pill tag-pill--more" onclick={() => (tagsExpanded = true)}>+{tagsRemaining}</span>
                {/if}
              </div>
            </div>
            <p id="detailSummary" class="detail-summary">{summary}</p>
          </div>
        </div>
        <div class="episode-list-section hscroll-section" id="svelte-episodeHeatmap" style:display={episodeHeatmapVisible ? '' : 'none'}>
          <div class="episode-list-header">
            <div class="episode-header-left">
              <h3>{tr('detail.episodeList')}</h3>
              <span class="episode-count" id="episodeCount">{episodeCount}</span>
            </div>
          </div>
          <EpisodeHeatmap bind:this={episodeHeatmapRef} anime={anime} episodes={anime.episodes} lastPlayedEp={anime.lastPlayedEp} onPlay={playEpisode} onToggleWatched={toggleWatched} />
        </div>
        <LazySection delay={350}>
          {#if !isWishlistMode}
            <Characters chars={anime.characters} />
          {/if}
        </LazySection>
        <LazySection delay={450}>
          {#if watchStatsVisible}
            <div class="watch-stats" id="svelte-watchStats">
              <div class="ws-header"><h3>{tr('detail.watchStats')}</h3></div>
              <WatchStats anime={anime} />
            </div>
          {/if}
        </LazySection>
        <LazySection delay={450}>
          <RelationList animeId={anime.id} kind="relations" />
        </LazySection>
        <LazySection delay={450}>
          <RelationList animeId={anime.id} kind="recommendations" />
        </LazySection>
        <div class="archive-magazine" id="archiveDetail" style:display={archiveVisible ? '' : 'none'}>
          <div class="archive-magazine-essay">
            <div class="archive-magazine-thoughts text-sm text-content leading-[1.7]">{tr('detail.wishlistNoLocal')}</div>
          </div>
          <div class="archive-magazine-meta">
            {#if anime.rating}
              <div class="archive-magazine-stat"><span class="archive-magazine-stat-value">★ {anime.rating}</span><span class="archive-magazine-stat-label">{tr('detail.ratingLabel')}</span></div>
            {/if}
            <div class="archive-magazine-stat"><span class="archive-magazine-stat-value">{tr('detail.wishlistLabel')}</span><span class="archive-magazine-stat-label">{tr('detail.sourceLabel')}</span></div>
          </div>
          <div class="wishlist-detail-actions mt-4">
            <a class="btn btn-primary" href={bgmUrl + '/subject/' + anime.bangumiId} target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              {tr('detail.openInBangumi')}
            </a>
          </div>
        </div>
      </div>
    {/key}
  {/if}
</section>

<SyncModal open={syncOpen} anime={anime} onAttached={handleAttached} onClose={() => (syncOpen = false)} />
<FinishConfirmModal confirm={finishConfirm} anime={anime} onResolve={resolveFinishConfirm} />