<script>
  // Theme Dock — self-contained visual settings panel.
  // Mounted in App.svelte, opened from Settings.svelte via window.openVisualDock().
  import { onMount } from 'svelte';
  import { applyTheme, setThemeAttributes, applyZoom } from '../lib/theme.js';
  import { api } from '../lib/anime-utils.js';

  let open = $state(false);

  // ─── Dock state ───
  let dockThemeMode = $state(false); // false=dark, true=light
  let dockZoom = $state(100);
  let dockReduceMotion = $state(false);
  let activeTheme = $state('default');

  // ─── Label refs ───
  let dockLabelDark;
  let dockLabelLight;

  function updateDockThemeToggleLabels() {
    if (dockLabelDark) {
      dockLabelDark.className = 'theme-toggle-label' + (dockThemeMode ? ' theme-toggle-label--inactive' : ' theme-toggle-label--active');
    }
    if (dockLabelLight) {
      dockLabelLight.className = 'theme-toggle-label' + (dockThemeMode ? ' theme-toggle-label--active' : ' theme-toggle-label--inactive');
    }
  }

  function syncFromDocument() {
    const mode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
    dockThemeMode = mode === 'light';

    const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    activeTheme = (rawTheme === 'dark' || rawTheme === 'light') ? 'default' : rawTheme;

    const currentZoom = Math.round((parseFloat(document.documentElement.style.getPropertyValue('--scale')) || 1) * 100);
    dockZoom = currentZoom;

    dockReduceMotion = document.documentElement.getAttribute('data-reduce-motion') === 'true';

    updateDockThemeToggleLabels();
  }

  function animateThemeTransition(theme, mode) {
    document.documentElement.classList.add('theme-transitioning');
    applyTheme(theme, mode);
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 500);
  }

  function selectTheme(theme) {
    if (theme === activeTheme) return;
    const mode = dockThemeMode ? 'light' : 'dark';
    animateThemeTransition(theme, mode);
    activeTheme = theme;
  }

  function handleDockThemeModeToggle() {
    const newMode = dockThemeMode ? 'light' : 'dark';
    const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const oldMode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
    const oldTheme = (rawTheme === 'dark' || rawTheme === 'light') ? 'default' : rawTheme;
    if (activeTheme === oldTheme && newMode === oldMode) return;
    updateDockThemeToggleLabels();
    animateThemeTransition(activeTheme, newMode);
  }

  let _dockZoomTimer = null;
  function handleDockZoom() {
    const scale = dockZoom / 100;
    applyZoom(scale);
    clearTimeout(_dockZoomTimer);
    _dockZoomTimer = setTimeout(async () => {
      try { await api.put('/api/config', { uiScale: scale }); } catch (_) {}
    }, 300);
  }

  function handleReduceMotionToggle() {
    const reduced = dockReduceMotion;
    localStorage.setItem('reduceMotion', reduced ? '1' : '');
    document.documentElement.setAttribute('data-reduce-motion', reduced ? 'true' : 'false');
  }

  function handleEsc(e) {
    if (e.key === 'Escape' && open) {
      open = false;
    }
  }

  function openDock() {
    syncFromDocument();
    open = true;
  }

  function closeDock() {
    open = false;
  }

  onMount(() => {
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  });

  // ─── Bridge for Settings.svelte ───
  window.openVisualDock = () => {
    // Close settings modal first, then open dock
    if (typeof window.closeSettings === 'function') window.closeSettings();
    openDock();
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="theme-dock-overlay" class:open onclick={closeDock}></div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="theme-dock" class:open>
  <div class="theme-dock-inner">
    <div class="theme-dock-section">
      <span class="theme-dock-label" data-i18n="nav.themeColors">主题色系</span>
      <div class="theme-picker">
        <button class="theme-option theme-option--default" class:theme-option--active={activeTheme === 'default'} data-theme="default" onclick={() => selectTheme('default')} data-tooltip="默认" data-i18n-attr="common.default:data-tooltip"></button>
        <button class="theme-option theme-option--amber" class:theme-option--active={activeTheme === 'amber'} data-theme="amber" onclick={() => selectTheme('amber')} data-tooltip="琥珀" data-i18n-attr="nav.amber:data-tooltip"></button>
        <button class="theme-option theme-option--ocean" class:theme-option--active={activeTheme === 'ocean'} data-theme="ocean" onclick={() => selectTheme('ocean')} data-tooltip="海洋" data-i18n-attr="nav.ocean:data-tooltip"></button>
        <button class="theme-option theme-option--sakura" class:theme-option--active={activeTheme === 'sakura'} data-theme="sakura" onclick={() => selectTheme('sakura')} data-tooltip="樱花" data-i18n-attr="nav.sakura:data-tooltip"></button>
        <button class="theme-option theme-option--emerald" class:theme-option--active={activeTheme === 'emerald'} data-theme="emerald" onclick={() => selectTheme('emerald')} data-tooltip="翡翠" data-i18n-attr="nav.emerald:data-tooltip"></button>
        <button class="theme-option theme-option--violet" class:theme-option--active={activeTheme === 'violet'} data-theme="violet" onclick={() => selectTheme('violet')} data-tooltip="紫罗兰" data-i18n-attr="nav.violet:data-tooltip"></button>
      </div>
    </div>
    <div class="theme-dock-separator"></div>
    <div class="theme-dock-section">
      <div class="theme-mode-toggle mt-0">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <span class="theme-toggle-label" class:theme-toggle-label--active={!dockThemeMode} class:theme-toggle-label--inactive={dockThemeMode} bind:this={dockLabelDark} data-i18n="common.dark">深色</span>
        <label class="toggle-switch">
          <input type="checkbox" bind:checked={dockThemeMode} onchange={handleDockThemeModeToggle}>
          <span class="toggle-slider"></span>
        </label>
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <span class="theme-toggle-label" class:theme-toggle-label--active={dockThemeMode} class:theme-toggle-label--inactive={!dockThemeMode} bind:this={dockLabelLight} data-i18n="common.light">浅色</span>
      </div>
    </div>
    <div class="theme-dock-separator"></div>
    <div class="theme-dock-section theme-dock-section--zoom">
      <span class="theme-dock-label" data-i18n="nav.zoom">缩放</span>
      <input type="range" min="75" max="125" step="5" bind:value={dockZoom} oninput={handleDockZoom}>
      <span class="theme-dock-zoom-value">{dockZoom}%</span>
    </div>
    <div class="theme-dock-separator"></div>
    <div class="theme-dock-section">
      <span class="theme-dock-label" data-i18n="nav.reduceMotion">减少动画</span>
      <label class="toggle-switch">
        <input type="checkbox" bind:checked={dockReduceMotion} onchange={handleReduceMotionToggle}>
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>
  <button class="theme-dock-close" onclick={closeDock} data-tooltip="关闭" data-i18n-attr="common.close:data-tooltip">✕</button>
</div>
