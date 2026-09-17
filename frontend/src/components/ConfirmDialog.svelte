<script module>
  // ─── 独立确认弹窗 ───
  import { writable, get } from 'svelte/store';
  import { tr } from '../lib/anime-utils.js';
  import { portal } from '../lib/portal.js';

  const confirmStore = writable(null);

  /**
   * 显示确认弹窗，返回 Promise<boolean>
   * @param {{ title: string, hint?: string }} opts 结构化文案：标题（必填，大一号）+ 提示（可选，附属说明）
   * @returns {Promise<boolean>}
   */
  export function showConfirm({ title, hint } = {}) {
    return new Promise(resolve => {
      confirmStore.set({ title, hint, resolve });
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
    class="modal-overlay show modal-overlay--confirm"
    use:portal
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    onclick={(e) => { if (e.target === e.currentTarget) resolveConfirm(false); }}
    onkeydown={(e) => { if (e.key === 'Escape') resolveConfirm(false); }}
  >
    <div class="modal modal--confirm">
      <p class="confirm-title">
        {@html $confirmStore.title}
      </p>
      {#if $confirmStore.hint}
        <p class="confirm-hint">
          {@html $confirmStore.hint}
        </p>
      {/if}
      <div class="modal-actions flex items-center justify-between">
        <button class="btn btn-ghost confirm-cancel min-w-[100px]" onclick={() => resolveConfirm(false)}>
          {tr('common.cancel')}
        </button>
        <button class="btn btn-danger confirm-ok min-w-[100px]" onclick={() => resolveConfirm(true)}>
          {tr('common.confirm')}
        </button>
      </div>
    </div>
  </div>
{/if}