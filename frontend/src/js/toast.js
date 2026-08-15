// Toast + confirm (搬移自 app.js —— 零逻辑改动)

// ─── Toast: SVG Icons ───
const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  silent:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
};
const TOAST_DURATION = { success: 4000, error: 6000, warning: 5000, info: 3500, silent: 2500 };
const TOAST_MAX = 5;

// Toast: dismiss helper
function dismissToast(el) {
  if (el.classList.contains('dismissing')) return;
  el.classList.add('dismissing');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => { if (el.parentNode) el.remove(); }, 600);
}

// Toast: show
//   msg  – string, or { title, desc? }
//   type – 'success' | 'error' | 'warning' | 'info' (default) | 'silent'
//   opts – { duration? } override auto-dismiss ms
function showToast(msg, type, opts) {
  type = type || 'info';
  opts = opts || {};
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Normalize msg
  const title = typeof msg === 'string' ? msg : (msg.title || '');
  const desc  = typeof msg === 'object' && msg.desc ? msg.desc : '';

  // Create element
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('data-type', type);
  const duration = opts.duration || TOAST_DURATION[type] || 3500;
  el.innerHTML = `
    <div class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</div>
    <div class="toast-text">
      <div class="toast-title">${escHtml(title)}</div>
      ${desc ? '<div class="toast-desc">' + escHtml(desc) + '</div>' : ''}
    </div>
    <div class="toast-progress" style="animation-duration:${duration}ms"></div>
  `;
  container.prepend(el);

  // Cap max visible
  while (container.children.length > TOAST_MAX) {
    dismissToast(container.lastChild);
  }

  // ─── Auto-dismiss with hover pause ───
  let remaining = duration;
  let timerStart = Date.now();
  let timerId;

  function startTimer() {
    timerId = setTimeout(() => dismissToast(el), remaining);
    timerStart = Date.now();
  }
  function pauseTimer() {
    clearTimeout(timerId);
    remaining -= Date.now() - timerStart;
    if (remaining < 0) remaining = 0;
  }

  el.addEventListener('mouseenter', pauseTimer);
  el.addEventListener('mouseleave', startTimer);

  // Left-click dismiss
  el.addEventListener('click', function onClick() {
    clearTimeout(timerId);
    dismissToast(el);
  });

  // Right-click copy message
  el.addEventListener('contextmenu', function onContext(e) {
    e.preventDefault();
    e.stopPropagation();
    const text = title + (desc ? '\n' + desc : '');
    navigator.clipboard.writeText(text)
      .then(() => showToast(t('app.copied'), 'success', { duration: 1500 }))
      .catch(() => showToast(t('app.copyFailed'), 'error'));
  });

  startTimer();
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ─── ESM exports for cross-module utilities ───
window.showToast = showToast;
window.dismissToast = dismissToast;
