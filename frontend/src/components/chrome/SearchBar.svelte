<script module>
  // ─── 全局搜索聚焦入口 ───
  // keyboard.js 的 `/` 快捷键与 Ctrl+F 均调用此函数（聚焦 + 全选输入框）。
  export function focusSearch() {
    const input = document.getElementById('globalSearchInput');
    if (input) {
      input.focus();
      input.select();
    }
  }
</script>

<script>
  // ─── Titlebar 全局搜索（动漫 + 设置）───
  // 由 vanilla search.js 迁移而来，复用现有 titlebar.css 类名，视觉零变化。
  // 下拉用 Svelte {#each} 渲染（自动转义），不再手动拼 HTML 字符串。
  import { onMount, onDestroy } from 'svelte';

  // i18n 辅助：现有全局 t() 可用则用之，否则回退文案
  function tr(key, fallback) {
    return typeof globalThis.t === 'function' ? globalThis.t(key) : fallback;
  }

  // ─── 设置搜索映射 ───
  const SETTINGS_MAP = [
    { label: tr('search.mediaDirPath', '媒体目录'), tab: 'basic', keywords: '媒体目录 媒体文件夹 目录路径 存储 根目录' },
    { label: tr('search.mpvPlayerPath', 'mpv 播放器'), tab: 'playback', keywords: 'mpv 播放器 可执行文件 路径' },
    { label: tr('search.autoMarkWatched', '自动标记已观看'), tab: 'playback', keywords: '自动标记 已观看 播放 进度 前序' },
    { label: tr('search.bangumiApiUrl', 'Bangumi API 地址'), tab: 'scraper', keywords: 'bangumi api 刮削 元数据 地址 镜像' },
    { label: tr('search.anilistIntegration', 'AniList 集成'), tab: 'scraper', keywords: 'anilist 罗马音 标题搜索 可选' },
    { label: tr('search.libraryModuleLayout', '库页模块布局'), tab: 'dashboard', keywords: '模块 统计 继续观看 本地动漫 布局 排序' },
  ];

  const TAB_NAMES = {
    basic: tr('search.tab.basic', '基础'),
    playback: tr('search.tab.playback', '播放'),
    scraper: tr('search.tab.scraper', '刮削'),
    dashboard: tr('search.tab.dashboard', '仪表盘'),
  };

  // ─── 状态 ───
  let query = $state('');
  let filtered = $state({ anime: [], settings: [] });
  let open = $state(false);
  let highlighted = $state(-1);
  let searchTimer = null;
  let containerEl = $state(null);
  let inputEl = $state(null);

  // 键盘导航用的扁平列表（渲染顺序：动漫在前、设置在后）
  let flatItems = $derived([...filtered.anime, ...filtered.settings]);

  // ─── 过滤逻辑 ───
  function filterByQuery(q) {
    const queryStr = q.toLowerCase().trim();
    if (!queryStr) return { anime: [], settings: [] };

    // 动漫搜索 — libraryData 是 library.js 的全局 let
    const animeResults = [];
    if (typeof window.libraryData !== 'undefined' && window.libraryData.length) {
      for (const a of window.libraryData) {
        const matchFields = [a.bangumiTitle, a.title, a.pinyinTitle]
          .filter(Boolean)
          .map((s) => s.toLowerCase());
        if (matchFields.some((f) => f.indexOf(queryStr) !== -1)) {
          animeResults.push({
            type: 'anime',
            id: a.id,
            label: a.bangumiTitle || a.title,
            sublabel: a.pinyinTitle || '',
          });
        }
      }
    }

    // 设置搜索 — 标签页名
    const settingsResults = [];
    for (const tabKey in TAB_NAMES) {
      if (TAB_NAMES[tabKey].toLowerCase().indexOf(queryStr) !== -1) {
        settingsResults.push({ type: 'settings', tab: tabKey, label: TAB_NAMES[tabKey], sublabel: tr('search.settingsPage', '设置') });
        break;
      }
    }
    // 设置搜索 — 单个设置项
    for (const s of SETTINGS_MAP) {
      const searchable = (s.label + ' ' + s.keywords).toLowerCase();
      if (searchable.indexOf(queryStr) !== -1) {
        settingsResults.push({ type: 'settings', tab: s.tab, label: s.label, sublabel: TAB_NAMES[s.tab] });
      }
    }

    return { anime: animeResults, settings: settingsResults };
  }

  // ─── 导航 ───
  function navigateTo(item) {
    closeDropdown();

    if (item.type === 'anime' && item.id) {
      if (typeof window.showDetail === 'function') {
        window.showDetail(item.id, null, null, 'library');
      }
    } else if (item.type === 'settings' && item.tab) {
      if (typeof window.openSettings === 'function') {
        window.openSettings()
          .then(() => {
            const btn = document.querySelector('.settings-tab[data-tab="' + item.tab + '"]');
            if (btn && typeof window.switchSettingsTab === 'function') {
              window.switchSettingsTab(btn, item.tab);
            }
          })
          .catch(() => {
            // 静默忽略 openSettings 失败
          });
      }
    }
  }

  function closeDropdown() {
    open = false;
    highlighted = -1;
  }

  // ─── 输入处理（防抖 300ms）───
  function onInput() {
    clearTimeout(searchTimer);
    const q = query.trim();
    if (!q) {
      closeDropdown();
      return;
    }
    searchTimer = setTimeout(() => {
      filtered = filterByQuery(q);
      open = true;
      highlighted = -1;
    }, 300);
  }

  // ─── 键盘导航 ───
  function onKeydown(e) {
    if (e.key === 'Escape') {
      closeDropdown();
      inputEl.blur();
      return;
    }

    const items = flatItems;
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = highlighted < items.length - 1 ? highlighted + 1 : 0;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (highlighted <= 0) {
        highlighted = items.length - 1; // 回绕到末尾
      } else {
        highlighted = highlighted - 1;
      }
    } else if (e.key === 'Enter') {
      const target = highlighted >= 0 ? items[highlighted] : items[0];
      if (target) navigateTo(target);
    }
  }

  // ─── 外部点击关闭 ───
  function onDocClick(e) {
    if (containerEl && !containerEl.contains(e.target)) closeDropdown();
  }

  // ─── 滚动关闭 ───
  function onScroll() {
    closeDropdown();
  }

  // ─── Ctrl+F / Cmd+F → 聚焦搜索 ───
  function onDocKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      focusSearch();
    }
  }

  onMount(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onDocKeydown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onDocKeydown);
      clearTimeout(searchTimer);
    };
  });

  onDestroy(() => {
    clearTimeout(searchTimer);
  });
</script>

<div class="titlebar__search" id="titlebarSearch" bind:this={containerEl}>
  <div class="titlebar__search-wrap">
    <svg class="titlebar__search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="m11 11 3 3"/></svg>
    <input
      type="text"
      id="globalSearchInput"
      bind:this={inputEl}
      bind:value={query}
      oninput={onInput}
      onkeydown={onKeydown}
      placeholder={tr('nav.searchPlaceholder', '搜索…')}
      autocomplete="off"
      spellcheck="false"
    />
  </div>
  <div class="titlebar__search-results" id="globalSearchResults" class:hidden={!open}>
    {#if filtered.anime.length === 0 && filtered.settings.length === 0}
      <div class="titlebar__search-empty">{tr('search.noResults', '无结果')}</div>
    {:else}
      {#if filtered.anime.length}
        <div class="titlebar__search-group">{tr('search.group.anime', '动漫')}</div>
        {#each filtered.anime as r, i}
          <div class="titlebar__search-item" class:highlighted={highlighted === i} onclick={() => navigateTo(r)}>
            <svg class="titlebar__search-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
            <div class="titlebar__search-item-text">
              <span class="titlebar__search-item-label">{r.label}</span>
              {#if r.sublabel}<span class="titlebar__search-item-sublabel">{r.sublabel}</span>{/if}
            </div>
          </div>
        {/each}
      {/if}
      {#if filtered.settings.length}
        <div class="titlebar__search-group">{tr('common.settings', '设置')}</div>
        {#each filtered.settings as s, i}
          <div class="titlebar__search-item" class:highlighted={highlighted === filtered.anime.length + i} onclick={() => navigateTo(s)}>
            <svg class="titlebar__search-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            <div class="titlebar__search-item-text">
              <span class="titlebar__search-item-label">{s.label}</span>
              <span class="titlebar__search-item-sublabel">{s.sublabel}</span>
            </div>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</div>