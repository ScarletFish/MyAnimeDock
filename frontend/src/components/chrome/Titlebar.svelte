<script module>
  // ─── Titlebar 上下文 store（跨组件通信）───
  // mode: 'default' | 'detail'；title 预留（当前模板未展示，保留字段）。
  // main.js 桥接 window.setTitlebarContext → titlebarContext.set(...)。
  import { writable } from 'svelte/store';

  export const titlebarContext = writable({ mode: 'default', title: '' });
</script>

<script>
  // ─── Titlebar（窗口控制 + 拖拽 + 双击最大化 + 返回按钮 + 品牌/详情上下文切换）───
  // 由 vanilla titlebar.js 迁移而来，复用现有 titlebar.css 类名，视觉零变化。
  import { onMount, onDestroy } from 'svelte';
  import SearchBar from './SearchBar.svelte';

  // i18n 辅助：现有全局 t() 可用则用之，否则回退文案
  function tr(key, fallback) {
    return typeof globalThis.t === 'function' ? globalThis.t(key) : fallback;
  }

  // ── Tauri 窗口 API（浏览器环境无 __TAURI__ 时降级为 no-op）──
  let tauriWin = null;
  if (window.__TAURI__ && window.__TAURI__.window) {
    try {
      tauriWin = window.__TAURI__.window.getCurrentWindow();
    } catch (_) {}
  }

  let maximized = $state(false);
  let unlistenResize = null;

  function setMaxIcon(maxed) {
    maximized = !!maxed;
  }

  function updateMaximizeIcon() {
    if (tauriWin && tauriWin.isMaximized) {
      tauriWin.isMaximized().then(setMaxIcon).catch(() => {});
    }
  }

  // ── 窗口控制 ──
  function onMinimize() {
    if (tauriWin) tauriWin.minimize();
  }
  function onClose() {
    if (tauriWin) tauriWin.close();
  }
  async function onToggleMaximize() {
    if (!tauriWin) return;
    await tauriWin.toggleMaximize();
    updateMaximizeIcon();
  }

  // ── 拖拽移动（mousedown 在 titlebar 上，跳过交互元素）──
  function onTitlebarMouseDown(e) {
    if (!tauriWin) return;
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select, textarea, a, #globalSearchResults')) return;
    tauriWin.startDragging();
  }

  // ── 双击最大化 / 还原 ──
  function onTitlebarDblClick(e) {
    if (!tauriWin) return;
    if (e.target.closest('.titlebar__btn')) return;
    tauriWin.toggleMaximize().then(updateMaximizeIcon);
  }

  // ── 返回按钮（详情视图）──
  function onBack() {
    if (typeof window.goBack === 'function') window.goBack();
  }

  onMount(async () => {
    // 监听窗口 resize（外部最大化、快捷键等）
    if (tauriWin && tauriWin.onResize) {
      try {
        unlistenResize = await tauriWin.onResize(updateMaximizeIcon);
      } catch (_) {}
    }
    updateMaximizeIcon();
  });

  onDestroy(() => {
    if (typeof unlistenResize === 'function') unlistenResize();
  });
</script>

<div id="titlebar" onmousedown={onTitlebarMouseDown} ondblclick={onTitlebarDblClick}>
  <div class="titlebar__left">
    <span class="titlebar__brand" id="titlebarBrand" class:hidden={$titlebarContext.mode === 'detail'}>MyAnimeDock</span>
    <div class="titlebar__detail-context" id="titlebarDetailContext" class:hidden={$titlebarContext.mode !== 'detail'}>
      <button class="titlebar__back" id="titlebarBack" onclick={onBack}>
        <svg viewBox="0 0 16 16"><polyline points="10 4 6 8 10 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>{tr('common.back')}</span>
      </button>
    </div>
  </div>

  <SearchBar />

  <div class="titlebar__controls">
    <button class="titlebar__btn" id="titlebarMinimize" onclick={onMinimize} data-tooltip={tr('nav.minimize')}>
      <svg viewBox="0 0 14 14"><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>
    <button class="titlebar__btn" id="titlebarMaximize" onclick={onToggleMaximize} data-tooltip={maximized ? tr('nav.restore') : tr('nav.maximize')}>
      {#if maximized}
        <svg viewBox="0 0 14 14"><rect x="4.5" y="5.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 2.5h7.5v1H3v6.5H2V2.5z" fill="currentColor"/></svg>
      {:else}
        <svg viewBox="0 0 14 14"><rect x="3" y="3" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
      {/if}
    </button>
    <button class="titlebar__btn titlebar__btn--close" id="titlebarClose" onclick={onClose} data-tooltip={tr('common.close')}>
      <svg viewBox="0 0 14 14"><line x1="4" y1="4" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="4" x2="4" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>
  </div>
</div>