<script>
  // ─── 标记看完确认弹窗（Promise 模式，声明式）───
  // confirm = { ep, resolve } | null；onResolve(result) 由父组件 resolve 并清空。
  import { tick } from 'svelte';

  let { confirm = null, anime = null, onResolve } = $props();

  function tr(key, fallback, options) {
    return typeof globalThis.t === 'function' ? globalThis.t(key, options) : fallback;
  }

  // 打开时聚焦确认按钮
  $effect(() => {
    if (confirm) {
      tick().then(() => {
        document.querySelector('#svelte-finishConfirmModal .confirm-ok')?.focus();
      });
    }
  });
</script>

{#if confirm}
  <div class="modal-overlay show" id="svelte-finishConfirmModal" style="z-index:9999" onclick={(e) => { if (e.target === e.currentTarget) onResolve?.(false); }}>
    <div class="modal" style="max-width:340px;padding:var(--space-6) var(--space-8) var(--space-5);text-align:center">
      <p class="text-content" style="margin:0 0 var(--space-1);font-weight:600;font-size:17px">{tr('detail.episodeXofY', '第 {number}/{total} 集', { number: confirm.ep.number, total: anime?.episodes?.length || '?' })}</p>
      <p class="text-content" style="margin:0 0 var(--space-5);font-size:14px;color:var(--fg-muted)">{tr('detail.markWatchedConfirm', '标记该集为已看完？')}</p>
      <div class="modal-actions flex items-center justify-center" style="gap:var(--space-3);padding:0">
        <button class="btn btn-ghost confirm-cancel" style="flex:1;justify-content:center" onclick={() => onResolve?.(false)}>{tr('detail.cancel', '取消')}</button>
        <button class="btn btn-primary confirm-ok" style="flex:1;justify-content:center" onclick={() => onResolve?.(true)}>{tr('detail.mark', '标记')}</button>
      </div>
    </div>
  </div>
{/if}