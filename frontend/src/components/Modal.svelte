<script>
  // ─── Svelte 版 Modal（复用现有 modals.css 类名）───
  let {
    open = $bindable(false),   // 受控开关（父组件 bind:open）
    title = '',                // 可选标题（渲染 modal-header）
    onClose = null,            // 关闭回调
    closeOnOverlay = true,     // 点击遮罩关闭
    showCloseBtn = true,       // 显示右上角关闭按钮
    children,                  // 默认内容（snippet）
    footer,                    // 底部操作区（snippet）
  } = $props();

  let visible = $state(false);

  // 打开/关闭时同步 body 滚动锁定
  $effect(() => {
    if (open) {
      visible = true;
      document.body.style.overflow = 'hidden';
    } else {
      visible = false;
      document.body.style.overflow = '';
    }
  });

  // Escape 关闭
  $effect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function close() {
    open = false;
    if (typeof onClose === 'function') onClose();
  }
</script>

{#if visible}
  <div
    class="modal-overlay"
    class:show={open}
    role="button"
    tabindex="-1"
    onclick={(e) => { if (closeOnOverlay && e.target === e.currentTarget) close(); }}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') close(); }}
  >
    <div class="modal">
      {#if showCloseBtn}
        <button class="modal-close-btn" onclick={close} aria-label="关闭">✕</button>
      {/if}
      {#if title}
        <div class="modal-header">
          <h2>{title}</h2>
        </div>
      {/if}
      {@render children?.()}
      {#if footer}
        <div class="modal-actions">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}