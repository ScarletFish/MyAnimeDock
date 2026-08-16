<script>
  // ─── Sidebar（Svelte 迁移）───
  // 忠实迁移 index.html 的 vanilla <aside class="sidebar">，视觉零改动。
  // 保留全部 class / id / data-tip / data-i18n-attr，供 router.js（按 id 切 .active）继续工作。
  // 侧栏悬浮 tooltip 逻辑原在 tooltip.js 的第二个 IIFE（load 时 querySelectorAll 绑定），
  // 因 Sidebar 由 Svelte 挂载（晚于 tooltip.js）而失效，故移入本组件 onMount 后绑定。
  import { onMount } from 'svelte';
  import { showView } from '../lib/router.js';

  let tipEl = null;
  let tipTextEl = null;
  let showTimer = null;
  let hideTimer = null;

  function showTip(btn) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const label = btn.getAttribute('data-tip');
    if (!label) return;
    tipTextEl.textContent = label;
    const br = btn.getBoundingClientRect();
    tipEl.style.top = (br.top + br.height / 2) + 'px';
    tipEl.classList.add('is-visible');
  }

  function scheduleShow(btn) {
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => showTip(btn), 400);
  }

  function cancelShow() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  }

  function hideTip() {
    cancelShow();
    hideTimer = setTimeout(() => tipEl.classList.remove('is-visible'), 120);
  }

  onMount(() => {
    tipEl = document.getElementById('sidebarTooltip');
    tipTextEl = document.getElementById('sidebarTooltipText');
    if (!tipEl || !tipTextEl) return;

    const onTipEnter = () => {
      cancelShow();
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    };
    const onTipLeave = () => hideTip();

    tipEl.addEventListener('mouseenter', onTipEnter);
    tipEl.addEventListener('mouseleave', onTipLeave);

    return () => {
      tipEl.removeEventListener('mouseenter', onTipEnter);
      tipEl.removeEventListener('mouseleave', onTipLeave);
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  });
</script>

<aside class="sidebar">
  <div class="sidebar-brand" onclick={() => window.openVisualDock?.()} onmouseenter={(e) => scheduleShow(e.currentTarget)} onmouseleave={hideTip} data-tip="主题与视觉设置" data-i18n-attr="nav.themeVisual:data-tip" role="button" tabindex="0">
    <div class="sidebar-brand-icon theme-indicator">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="MyAnimeDock">
        <rect x="0" y="0" width="16" height="16" rx="3" fill="var(--accent)" stroke="var(--border)" stroke-width="0.5"/>
        <text x="8" y="13" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="12" fill="var(--bg-elevated)" text-anchor="middle">D</text>
      </svg>
    </div>
  </div>
  <nav class="sidebar-nav">
    <button class="nav-btn" id="btnDiscovery" data-tip="发现" data-i18n-attr="nav.discovery:data-tip" onclick={() => showView('discovery')} onmouseenter={(e) => scheduleShow(e.currentTarget)} onmouseleave={hideTip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21-4.35-4.35"></path>
      </svg>
    </button>
    <button class="nav-btn active" id="btnLibrary" data-tip="动漫库" data-i18n-attr="nav.library:data-tip" onclick={() => showView('library')} onmouseenter={(e) => scheduleShow(e.currentTarget)} onmouseleave={hideTip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path>
      </svg>
    </button>
    <button class="nav-btn" id="btnMyList" data-tip="我的列表" data-i18n-attr="nav.mylist:data-tip" onclick={() => showView('mylist')} onmouseenter={(e) => scheduleShow(e.currentTarget)} onmouseleave={hideTip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <line x1="3" y1="6" x2="3.01" y2="6"></line>
        <line x1="3" y1="12" x2="3.01" y2="12"></line>
        <line x1="3" y1="18" x2="3.01" y2="18"></line>
      </svg>
    </button>
    <button class="nav-btn" id="btnStats" data-tip="统计" data-i18n-attr="nav.stats:data-tip" onclick={() => showView('stats')} onmouseenter={(e) => scheduleShow(e.currentTarget)} onmouseleave={hideTip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
      </svg>
    </button>
  </nav>
  <div class="sidebar-bottom">
    <button class="nav-btn" id="btnSettings" data-tip="设置" data-i18n-attr="common.settings:data-tip" onclick={() => window.openSettings?.()} onmouseenter={(e) => scheduleShow(e.currentTarget)} onmouseleave={hideTip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    </button>
  </div>
</aside>