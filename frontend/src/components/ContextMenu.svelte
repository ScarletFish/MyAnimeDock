<script>
  // ─── ContextMenu（Svelte 迁移 Chunk B）───
  // 外壳照搬 Mylist.svelte 右键菜单（定位 + 模板），菜单项由调用方注入。
  // 只认 props，不处理 oncontextmenu 事件本身。
  import { tick, onMount, onDestroy } from 'svelte';

  let {
    open = $bindable(false),
    x = 0,
    y = 0,
    children,
  } = $props();

  let menuEl = $state(null);

  // open 变 true：渲染后钳制坐标防溢出
  $effect(() => {
    if (!open) return;
    tick().then(() => {
      if (!menuEl) return;
      const rect = menuEl.getBoundingClientRect();
      let nx = x;
      let ny = y;
      if (nx + rect.width > window.innerWidth) nx = window.innerWidth - rect.width - 8;
      if (ny + rect.height > window.innerHeight) ny = window.innerHeight - rect.height - 8;
      x = nx;
      y = ny;
    });
  });

  function onDocClick(e) {
    if (open && !e.target.closest('.context-menu')) open = false;
  }
  function onDocKeydown(e) {
    if (e.key === 'Escape') open = false;
  }
  function onDocScroll() {
    open = false;
  }

  onMount(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKeydown);
    document.addEventListener('scroll', onDocScroll, true);
  });
  onDestroy(() => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKeydown);
    document.removeEventListener('scroll', onDocScroll, true);
  });
</script>

{#if open}
  <div class="context-menu show" bind:this={menuEl} style="left:{x}px;top:{y}px">
    {@render children()}
  </div>
{/if}