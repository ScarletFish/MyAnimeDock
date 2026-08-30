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

  // ─── 详情页标签点击入口：填充 `#标签` 到搜索栏并触发搜索 ───
  // 通过自定义事件通知组件实例填充 query 并展开下拉。
  export function searchTag(tagName) {
    const input = document.getElementById('globalSearchInput');
    if (!input) return;
    input.focus();
    input.dispatchEvent(new CustomEvent('searchtag', { detail: tagName }));
  }
</script>

<script>
  // ─── Titlebar 全局搜索（动漫 + 设置）───
  // 由 vanilla search.js 迁移而来，复用现有 titlebar.css 类名，视觉零变化。
  // 下拉用 Svelte {#each} 渲染（自动转义），不再手动拼 HTML 字符串。
  import { onMount, onDestroy } from 'svelte';
  import { tr } from '../../lib/anime-utils.js';
  import { filterTags, tagZh, tagSearchFields } from '../../lib/tag-utils.js';
  import { libraryData } from '../../lib/ui-state.js';
  import { showDetail } from '../../lib/router.js';
  import { settingsOpen, settingsTab } from '../../views/Settings.svelte';

  // ─── 设置搜索映射 ───
  const SETTINGS_MAP = [
    { label: tr('search.mediaDirPath'), tab: 'basic', keywords: '媒体目录 媒体文件夹 目录路径 存储 根目录' },
    { label: tr('search.mpvPlayerPath'), tab: 'playback', keywords: 'mpv 播放器 可执行文件 路径' },
    { label: tr('search.autoMarkWatched'), tab: 'playback', keywords: '自动标记 已观看 播放 进度 前序' },
    { label: tr('search.bangumiApiUrl'), tab: 'scraper', keywords: 'bangumi api 刮削 元数据 地址 镜像' },
    { label: tr('search.anilistIntegration'), tab: 'scraper', keywords: 'anilist 罗马音 标题搜索 可选' },
    { label: tr('search.libraryModuleLayout'), tab: 'dashboard', keywords: '模块 统计 继续观看 本地动漫 布局 排序' },
  ];

  const TAB_NAMES = {
    basic: tr('search.tab.basic'),
    playback: tr('search.tab.playback'),
    scraper: tr('search.tab.scraper'),
    dashboard: tr('search.tab.dashboard'),
  };

  // ─── 状态 ───
  let query = $state('');
  let filtered = $state({ anime: [], tags: [], settings: [], animeTotal: 0 });
  let open = $state(false);
  let highlighted = $state(-1);
  let searchTimer = null;
  let containerEl = $state(null);
  let inputEl = $state(null);
  // 详情页 tag 点击派发事件后，跳过紧随其后的 document click（避免立即关闭下拉）
  let suppressNextDocClick = false;

  // 键盘导航用的扁平列表（渲染顺序：标签在前、动漫、设置在后）
  let flatItems = $derived([...filtered.tags, ...filtered.anime, ...filtered.settings]);

  // 把文本按命中关键词切成片段，供高亮渲染（Svelte 自动转义，安全）
  function highlightParts(text, query) {
    if (!text || !query) return [{ text: text || '', match: false }];
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const parts = [];
    let idx = 0;
    while (idx < text.length) {
      const found = lower.indexOf(q, idx);
      if (found === -1) {
        parts.push({ text: text.slice(idx), match: false });
        break;
      }
      if (found > idx) parts.push({ text: text.slice(idx, found), match: false });
      parts.push({ text: text.slice(found, found + q.length), match: true });
      idx = found + q.length;
    }
    return parts;
  }

  // ─── 过滤逻辑 ───
  function filterByQuery(q) {
    const raw = q.trim();
    if (!raw) return { anime: [], tags: [], settings: [], animeTotal: 0 };

    // `#` 前缀 → 标签搜索；否则标题搜索
    const isTagSearch = raw.startsWith('#');
    const queryStr = (isTagSearch ? raw.slice(1) : raw).toLowerCase();

    // 仅 `#`（无关键词）→ 列出库内实际用到的标签（映射中文名，排除剧透）
    if (isTagSearch && !queryStr) {
      const tagSet = new Set();
      if ($libraryData && $libraryData.length) {
        for (const a of $libraryData) {
          for (const t of filterTags(a.anilistTags)) {
            tagSet.add(tagZh(t.name));
          }
        }
      }
      const tags = [...tagSet]
        .map((name) => ({ type: 'tag', name }))
        .sort((x, y) => x.name.localeCompare(y.name, 'zh'));
      return { anime: [], tags, settings: [], animeTotal: 0 };
    }

    // 动漫搜索 — libraryData 是 ui-state 的共享 store
    const animeResults = [];
    if ($libraryData && $libraryData.length) {
      for (const a of $libraryData) {
        let matched = false;
        let matchField = '';
        if (isTagSearch) {
          // 标签搜索：anilistTags（英文原始名 + 中文名，排除剧透）
          const tagFields = tagSearchFields(a.anilistTags);
          const hit = tagFields.find((t) => t.toLowerCase().indexOf(queryStr) !== -1);
          if (hit) { matched = true; matchField = hit; }
        } else {
          const matchFields = [a.bangumiTitle, a.title, a.pinyinTitle]
            .filter(Boolean)
            .map((s) => s.toLowerCase());
          if (matchFields.some((f) => f.indexOf(queryStr) !== -1)) matched = true;
        }
        if (matched) {
          animeResults.push({
            type: 'anime',
            id: a.id,
            label: a.bangumiTitle || a.title,
            sublabel: isTagSearch ? matchField : (a.pinyinTitle || ''),
            highlight: queryStr,
          });
        }
      }
    }
    const animeTotal = animeResults.length;
    const anime = animeResults;

    // 设置搜索 — 标签页名
    const settingsResults = [];
    for (const tabKey in TAB_NAMES) {
      if (TAB_NAMES[tabKey].toLowerCase().indexOf(queryStr) !== -1) {
        settingsResults.push({ type: 'settings', tab: tabKey, label: TAB_NAMES[tabKey], sublabel: tr('search.settingsPage') });
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

    return { anime, tags: [], animeTotal, settings: settingsResults };
  }

  // ─── 选中标签：填入 `#中文名` 继续筛选（搜索双源匹配中英文）───
  function selectTag(tag) {
    clearTimeout(searchTimer);
    query = '#' + tag.name;
    filtered = filterByQuery(query);
    open = true;
    highlighted = -1;
    suppressNextDocClick = true;
    inputEl.focus();
  }

  // ─── 导航 ───
  function navigateTo(item) {
    if (item.type === 'tag') {
      selectTag(item);
      return;
    }
    closeDropdown();

    if (item.type === 'anime' && item.id) {
      showDetail(item.id, null, null, 'library');
    } else if (item.type === 'settings' && item.tab) {
      settingsOpen.set(true);
      settingsTab.set(item.tab);
    }
  }

  function closeDropdown() {
    open = false;
    highlighted = -1;
  }

  // ─── 重新聚焦：若已有查询则立即重开下拉（点击外部关闭后再点回输入框）───
  function onFocus() {
    const q = query.trim();
    if (!q) return;
    filtered = filterByQuery(q);
    open = true;
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

  // 高亮项变化时自动滚入视野（下拉可滚动，避免键盘导航滚出屏幕外）
  $effect(() => {
    if (highlighted < 0 || !open) return;
    const el = containerEl?.querySelectorAll('.titlebar__search-item')[highlighted];
    el?.scrollIntoView({ block: 'nearest' });
  });

  // ─── 外部点击关闭 ───
  function onDocClick(e) {
    if (suppressNextDocClick) { suppressNextDocClick = false; return; }
    if (containerEl && !containerEl.contains(e.target)) closeDropdown();
  }

  // ─── 滚动关闭（排除下拉容器自身的滚动）───
  function onScroll(e) {
    if (containerEl && e.target && containerEl.contains(e.target)) return;
    closeDropdown();
  }

  // ─── Ctrl+F / Cmd+F → 聚焦搜索 ───
  function onDocKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      focusSearch();
    }
  }

  // ─── 详情页标签点击：填充 `#标签` 并触发搜索 ───
  function onSearchTag(e) {
    const tagName = e.detail;
    if (!tagName) return;
    query = '#' + tagName;
    filtered = filterByQuery(query);
    open = true;
    highlighted = -1;
    suppressNextDocClick = true;
  }

  onMount(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onDocKeydown);
    inputEl?.addEventListener('searchtag', onSearchTag);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onDocKeydown);
      inputEl?.removeEventListener('searchtag', onSearchTag);
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
      onfocus={onFocus}
      onkeydown={onKeydown}
      placeholder={tr('nav.searchPlaceholder')}
      autocomplete="off"
      spellcheck="false"
    />
  </div>
  <div class="titlebar__search-results" id="globalSearchResults" class:hidden={!open}>
    <div class="titlebar__search-results-inner">
    {#if filtered.anime.length === 0 && filtered.tags.length === 0 && filtered.settings.length === 0}
      <div class="titlebar__search-empty">{tr('search.noResults')}</div>
    {:else}
      {#if filtered.tags.length}
        <div class="titlebar__search-group">{tr('search.group.tags')}</div>
        {#each filtered.tags as t, i}
          <div class="titlebar__search-item" class:highlighted={highlighted === i} onclick={() => selectTag(t)}>
            <span class="titlebar__search-item-avatar">#</span>
            <div class="titlebar__search-item-text">
              <span class="titlebar__search-item-label">{t.name}</span>
            </div>
          </div>
        {/each}
      {/if}
      {#if filtered.anime.length}
        <div class="titlebar__search-group">
          {tr('search.group.anime')}
          {#if filtered.animeTotal > 0}
            <span class="titlebar__search-count">{tr('search.resultCount', { count: filtered.animeTotal })}</span>
          {/if}
        </div>
        {#each filtered.anime as r, i}
          <div class="titlebar__search-item" class:highlighted={highlighted === filtered.tags.length + i} onclick={() => navigateTo(r)}>
            <span class="titlebar__search-item-avatar">{(r.label || '?')[0].toUpperCase()}</span>
            <div class="titlebar__search-item-text">
              <span class="titlebar__search-item-label">
                {#each highlightParts(r.label, r.highlight) as part}
                  <span class:titlebar__search-item-mark={part.match}>{part.text}</span>
                {/each}
              </span>
              {#if r.sublabel}
                <span class="titlebar__search-item-sublabel">
                  {#each highlightParts(r.sublabel, r.highlight) as part}
                    <span class:titlebar__search-item-mark={part.match}>{part.text}</span>
                  {/each}
                </span>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
      {#if filtered.settings.length}
        <div class="titlebar__search-group">{tr('common.settings')}</div>
        {#each filtered.settings as s, i}
          <div class="titlebar__search-item" class:highlighted={highlighted === filtered.tags.length + filtered.anime.length + i} onclick={() => navigateTo(s)}>
            <span class="titlebar__search-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></span>
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
</div>