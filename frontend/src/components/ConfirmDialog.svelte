<script module>
  // ─── 独立确认弹窗 ───
  import { writable, get } from 'svelte/store';
  import { tr } from '../lib/anime-utils.js';

  const confirmStore = writable(null);

  /**
   * 显示确认弹窗，返回 Promise<boolean>
   * @param {string} message 提示文案
   * @returns {Promise<boolean>}
   */
  export function showConfirm(message) {
    return new Promise(resolve => {
      confirmStore.set({ message, resolve });
    });
  }

  /**
   * 用户选择后 resolve 并清空
   * @param {boolean} ok
   */
  function resolveConfirm(ok) {
    const entry = get(confirmStore);
    confirmStore.set(null);
    entry?.resolve(ok);
  }
</script>

{#if $confirmStore}
  <div
    class="modal-overlay"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    onclick={(e) => { if (e.target === e.currentTarget) resolveConfirm(false); }}
    onkeydown={(e) => { if (e.key === 'Escape') resolveConfirm(false); }}
  >
    <div class="modal" style="max-width:380px;padding:var(--space-6) var(--space-8) var(--space-5)">
      <p style="margin:0 0 18px;line-height:1.7;font-size:15px;text-align:left" class="text-content">
        {$confirmStore.message}
      </p>
      <div class="modal-actions flex items-center justify-between">
        <button class="btn btn-ghost confirm-cancel min-w-[80px]" onclick={() => resolveConfirm(false)}>
          {tr('common.cancel')}
        </button>
        <button class="btn btn-danger confirm-ok min-w-[80px]" onclick={() => resolveConfirm(true)}>
          {tr('common.confirm')}
        </button>
      </div>
    </div>
  </div>
{/if}
