<script module>
  // ─── Svelte 版 Toast（复用现有 toast.css 类名）───
  import { writable } from 'svelte/store';
  import { tr } from '../lib/anime-utils.js';

  // 共享 toast 列表（跨组件通信）
  export const toasts = writable([]);
  let idCounter = 0;

  // SVG 图标
  const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    silent:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  };
  const TOAST_DURATION = { success: 4000, error: 6000, warning: 5000, info: 3500, silent: 2500 };
  const TOAST_MAX = 5;

  // 每个 toast 的计时器簿记（非响应式）
  const timers = new Map();

  // ─── showToast(msg, type, opts) ───
  //   msg  – string，或 { title, desc? }
  //   type – 'success' | 'error' | 'warning' | 'info' (默认) | 'silent'
  //   opts – { duration? } 覆盖自动消失时长
  export function showToast(msg, type = 'info', opts = {}) {
    const title = typeof msg === 'string' ? msg : (msg?.title || '');
    const desc = typeof msg === 'object' && msg.desc ? msg.desc : '';
    const duration = opts.duration || TOAST_DURATION[type] || 3500;
    const id = ++idCounter;
    const toast = { id, type, title, desc, duration, dismissing: false };
    toasts.update(list => [toast, ...list].slice(0, TOAST_MAX));
    startTimer(toast);
  }

  // ─── dismissToast(id) ───
  export function dismissToast(id) {
    clearTimer(id);
    toasts.update(list => list.map(t => t.id === id ? { ...t, dismissing: true } : t));
    setTimeout(() => {
      toasts.update(list => list.filter(t => t.id !== id));
    }, 300);
  }

  // ─── 自动消失 + 悬停暂停 ───
  function startTimer(toast) {
    clearTimer(toast.id);
    const remaining = toast.remaining ?? toast.duration;
    const timer = setTimeout(() => dismissToast(toast.id), remaining);
    timers.set(toast.id, { timer, start: Date.now(), remaining });
  }
  function pauseTimer(toast) {
    const rec = timers.get(toast.id);
    if (!rec) return;
    clearTimeout(rec.timer);
    rec.remaining -= Date.now() - rec.start;
    if (rec.remaining < 0) rec.remaining = 0;
    toast.remaining = rec.remaining;
    timers.delete(toast.id);
  }
  function clearTimer(id) {
    const rec = timers.get(id);
    if (rec) { clearTimeout(rec.timer); timers.delete(id); }
  }

  // 右键复制消息
  function copyToast(toast) {
    const text = toast.title + (toast.desc ? '\n' + toast.desc : '');
    navigator.clipboard.writeText(text)
      .then(() => showToast(tr('app.copied'), 'success', { duration: 1500 }))
      .catch(() => showToast(tr('app.copyFailed'), 'error'));
  }
</script>

<div class="toast-container" id="svelteToastContainer" role="alert" aria-live="polite">
  {#each $toasts as toast (toast.id)}
    <div
      class="toast"
      class:dismissing={toast.dismissing}
      data-type={toast.type}
      role="button"
      tabindex="0"
      onmouseenter={() => pauseTimer(toast)}
      onmouseleave={() => startTimer(toast)}
      onclick={() => dismissToast(toast.id)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') dismissToast(toast.id); }}
      oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); copyToast(toast); }}
    >
      <div class="toast-icon">{@html TOAST_ICONS[toast.type] || TOAST_ICONS.info}</div>
      <div class="toast-text">
        <div class="toast-title">{toast.title}</div>
        {#if toast.desc}<div class="toast-desc">{toast.desc}</div>{/if}
      </div>
      <div class="toast-progress" style="animation-duration:{toast.duration}ms"></div>
    </div>
  {/each}
</div>