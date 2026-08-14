<script>
  // ─── 角色·声优（声明式）───
  // 根为 .detail-characters 区块（含 header + grid + toggle），grid 保留 id="svelte-detailCharGrid"，
  // 卡片 class="detail-char-card"（setEntranceDelays stagger 契约）。
  // 展开状态用 $state（随 {#key} 重挂载自然重置，替代 dataset.userToggled）。
  import { onMount } from 'svelte';

  let { chars = [] } = $props();

  let visible = $state(true);
  let expanded = $state(false);
  let userToggled = $state(false);
  let gridEl = $state(null);
  let wrapEl = $state(null);
  let resizeTimer = null;
  const MAX_GRID_HEIGHT = 10000;

  function tr(key, fallback, options) {
    return typeof globalThis.t === 'function' ? globalThis.t(key, options) : fallback;
  }

  function charAvatarFallback() {
    visible = false;
  }

  function getCharGridRowHeight() {
    if (!gridEl || !gridEl.children[0]) return 104;
    return gridEl.children[0].offsetHeight + 8;
  }

  function measureAndBalance() {
    if (!gridEl || !wrapEl) return;
    const rowH = getCharGridRowHeight();
    const totalItems = gridEl.children.length;
    const maxRows = Math.ceil(totalItems / 3);
    const targetRows = Math.min(3, maxRows);
    if (targetRows >= maxRows) {
      expanded = true;
      gridEl.style.overflow = '';
      gridEl.style.maxHeight = MAX_GRID_HEIGHT + 'px';
    } else {
      expanded = false;
      gridEl.style.overflow = 'hidden';
      gridEl.style.maxHeight = (rowH * targetRows) + 'px';
    }
  }

  function updateToggleVisibility() {
    if (!gridEl || !wrapEl) return;
    const toggle = wrapEl.querySelector('.detail-char-toggle');
    if (!toggle) return;
    const hasOverflow = gridEl.scrollHeight > gridEl.clientHeight;
    toggle.style.display = (hasOverflow || userToggled) ? 'inline-flex' : 'none';
  }

  function autoExpandCharacters() {
    if (userToggled) return;
    measureAndBalance();
    updateToggleVisibility();
  }

  function toggleExpand() {
    userToggled = true;
    expanded = !expanded;
    if (gridEl) {
      if (expanded) {
        gridEl.style.overflow = '';
        gridEl.style.maxHeight = MAX_GRID_HEIGHT + 'px';
      } else {
        measureAndBalance();
      }
    }
    setTimeout(updateToggleVisibility, 50);
  }

  function waitForCharImages() {
    if (!gridEl) return Promise.resolve();
    const imgs = gridEl.querySelectorAll('.detail-char-avatar');
    if (!imgs.length) return Promise.resolve();
    const timeout = new Promise((r) => setTimeout(r, 3000));
    const loadAll = Promise.all(Array.from(imgs).map((img) =>
      img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
    ));
    return Promise.race([loadAll, timeout]);
  }

  onMount(() => {
    // 窗口 resize → 重新 auto-expand（未手动切换时）
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!visible || userToggled) return;
        autoExpandCharacters();
      }, 300);
    };
    window.addEventListener('resize', onResize);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) { visible = false; return; }
    if (!chars.length) { visible = false; return; }
    visible = true;
    if (!gridEl) return;
    // M2: 先设 maxHeight=scrollHeight 防跳动，等图加载后再 measureAndBalance
    const needsClipping = gridEl.children.length > 6;
    if (needsClipping) {
      gridEl.style.maxHeight = gridEl.scrollHeight + 'px';
    }
    waitForCharImages().then(() => {
      if (!visible) return;
      if (userToggled) return;
      if (needsClipping) {
        autoExpandCharacters();
      } else {
        gridEl.style.maxHeight = '';
        gridEl.style.overflow = '';
      }
      updateToggleVisibility();
    });

    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
    };
  });
</script>

{#if visible}
  <div class="detail-characters" id="detailCharacters">
    <div class="detail-section-header">
      <h3>{tr('detail.characters', '角色·声优')}</h3>
    </div>
    <div class="detail-char-wrap" id="svelte-detailCharWrap" class:expanded={expanded} bind:this={wrapEl}>
      <div class="detail-char-grid" id="svelte-detailCharGrid" bind:this={gridEl}>
        {#each chars.slice(0, 24) as c}
          {@const name = c.nameCn || c.name}
          {@const cv = c.actors && c.actors[0] ? (c.actors[0].nameCn || c.actors[0].name) : null}
          <div class="detail-char-card">
            {#if c.image}
              <img class="detail-char-avatar" src={c.image} alt="" loading="lazy" decoding="async" onerror={charAvatarFallback}>
            {:else}
              <div class="detail-char-avatar-placeholder">{name.charAt(0)}</div>
            {/if}
            <div class="detail-char-info">
              <div class="detail-char-name">{name}</div>
              {#if cv}<div class="detail-char-cv">{cv}</div>{/if}
            </div>
          </div>
        {/each}
      </div>
      <button class="detail-char-toggle" onclick={toggleExpand}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
    </div>
  </div>
{/if}