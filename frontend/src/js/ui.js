// Shared UI rendering layer — 无依赖，纯函数
// 必须在 app.js 之前加载（定义全局函数供各视图使用）

// ─── XSS 防护 ───

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── 路径工具 ───

const path = {
  basename(p) {
    if (!p) return '';
    return p.split(/[\\/]/).pop();
  }
};

// ─── 共享常量 ───

const STATUS_LABELS = {
  watching: t('common.watching'),
  wish: t('common.wish'),
  completed: t('common.completed'),
  on_hold: t('common.on_hold'),
  dropped: t('common.dropped')
};

// ─── 组件渲染 ───

/**
 * 灰色封面占位图
 */
function renderGrayCover(anime) {
  const initial = (anime ? (anime.bangumiTitle || anime.title || '?') : '?')[0].toUpperCase();
  return '<div class="gray-cover"><span class="gray-cover-text">' + escHtml(initial) + '</span></div>';
}

/**
 * 统一动漫卡片渲染
 *
 * @param {Object} anime — 动漫数据对象
 * @param {Object} [options]
 * @param {string} [options.onClick='navigateToDetail'] — onclick 函数名
 * @param {string} [options.onContextMenu='showContextMenu'] — oncontextmenu 函数名
 * @param {boolean} [options.showMoreBtn=true] — 是否显示更多按钮
 * @param {string} [options.coverSize='400'] — 封面缩放宽度 px
 * @param {boolean} [options.isWish=false] — 愿望单模式（半透明封面）
 * @param {boolean} [options.alwaysShowTitle=false] — 常显标题条
 * @param {string} [options.extraAttrs=''] — 卡片额外 HTML 属性
 */
function renderAnimeCard(anime, options = {}) {
  const {
    onClick = 'navigateToDetail',
    onContextMenu = 'showContextMenu',
    showMoreBtn = true,
    coverSize = '400',
    isWish = false,
    userRating = null,
    extraAttrs = '',
    alwaysShowTitle = false
  } = options;

  const id = escAttr(anime.id);
  const title = escHtml(anime.bangumiTitle || anime.title);

  // Cover: localCover (library) → gray placeholder
  const coverSrc = anime.localCover
    ? '/covers/' + path.basename(anime.localCover) + '?w=' + coverSize + '&q=75'
    : '';

  const coverStyle = isWish ? 'opacity:0.45;filter:grayscale(0.6)' : '';
  const cardClass = isWish ? 'anime-card anime-card--wish' : 'anime-card';

  // More button
  const moreBtnHtml = showMoreBtn
    ? ('<div class="card-more-btn" onclick="event.stopPropagation();openStatusModal(event, \'' + id + '\')" data-tooltip="' + t('ui.setStatusTooltip') + '">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">' +
          '<circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>' +
        '</svg></div>')
    : '';

  return '<div class="' + cardClass + '" data-id="' + id + '" onclick="' + onClick + '(\'' + id + '\', this)" ' +
    'oncontextmenu="' + onContextMenu + '(event, \'' + id + '\')" ' +
    extraAttrs +
    '>' +
    (coverSrc
      ? '<img src="' + escAttr(coverSrc) + '" loading="lazy" decoding="async" alt="' + title + '"' +
        (coverStyle ? ' style="' + coverStyle + '"' : '') + '>'
      : renderGrayCover(anime)
    ) +
    moreBtnHtml +
    (userRating ? '<span class="user-rating">☆ ' + userRating + '</span>' : '') +
    (alwaysShowTitle ? '<div class="title-strip"><div class="card-title">' + title + '</div></div>' : '') +
    '<div class="overlay">' +
      '<h3>' + title + '</h3>' +
      '<div class="meta">' +
        (anime.rating ? '<span class="rating-badge">★ ' + anime.rating + '</span>' : '') +
        (anime.season && !isWish ? '<span class="season-badge">S' + anime.season + '</span>' : '') +
        (isWish ? '<span class="wishlist-badge">' + t('ui.wishlistBadge') + '</span>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

// ─── Modal ───

function openModal(el, { onClose } = {}) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el._onClose = typeof onClose === 'function' ? onClose : null;
  el.classList.add('show');
  document.body.style.overflow = 'hidden';
}

window.closeModal = function closeModal(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el || typeof el.classList !== 'object') return;
  el.classList.remove('show');
  document.body.style.overflow = '';
  if (el._onClose) {
    const cb = el._onClose;
    el._onClose = null;
    cb();
  }
};

// Auto-init: overlay click + Escape key delegation
(function() {
  // Overlay click: close modal when clicking overlay background
  document.addEventListener('click', function(e) {
    var overlay = e.target.closest('.modal-overlay');
    if (overlay && e.target === overlay) {
      closeModal(overlay);
    }
  });
  // Escape key: close topmost open modal
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var openModals = document.querySelectorAll('.modal-overlay.show');
      if (openModals.length > 0) {
        closeModal(openModals[openModals.length - 1]);
      }
    }
  });
})();

// ─── Global Tooltip (styled replacement for native title attribute) ───
// Use data-tooltip="text" on any element → hover shows modern tooltip.
// Delay 500ms, fades in above the element, auto-positions.
(function() {
  var el = document.createElement('div');
  el.id = 'globalTooltip';
  document.body.appendChild(el);

  var showTimer = null;
  var hideTimer = null;
  var current = null;

  // Mouse enter an element with data-tooltip
  document.addEventListener('mouseover', function(e) {
    var target = e.target.closest('[data-tooltip]');
    if (!target) { return; }
    if (target === current) { return; }

    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    current = target;

    // Store cursor position at entry (fixed, doesn't track movement)
    var entryX = e.clientX;
    var entryY = e.clientY;

    showTimer = setTimeout(function() {
      // Rich tooltip: multiline wrapped text (data-tooltip-rich), else single-line
      var rich = target.hasAttribute('data-tooltip-rich');
      el.classList.toggle('is-rich', rich);
      el.textContent = target.getAttribute('data-tooltip');
      position(entryX, entryY);
      el.classList.remove('is-exiting');
      el.classList.add('is-visible');
    }, 500);
  });

  // Mouse leave → hide
  document.addEventListener('mouseout', function(e) {
    var target = e.target.closest('[data-tooltip]');
    if (!target) { return; }
    if (target !== current && !target.contains(current)) { return; }

    clearTimeout(showTimer);
    current = null;
    hideTimer = setTimeout(function() {
      el.classList.add('is-exiting');
      el.classList.remove('is-visible');
    }, 80);
  });

  // Scroll → hide (prevents stuck tooltip)
  document.addEventListener('scroll', function() {
    if (el.classList.contains('is-visible')) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      current = null;
      el.classList.add('is-exiting');
      el.classList.remove('is-visible');
    }
  }, true);

  function position(cx, cy) {
    var tw = el.offsetWidth || 0;
    var th = el.offsetHeight || 30;
    var gap = 10;
    // Default: below-right of cursor
    var left = cx + gap;
    var top = cy + gap + 4;

    // Flip left if would overflow right edge
    if (tw && left + tw > window.innerWidth - 6) {
      left = cx - tw - gap;
    }
    // Flip above if would overflow bottom edge
    if (top + th > window.innerHeight - 6) {
      top = cy - th - gap;
    }
    // Protect left/top edges
    left = Math.max(6, left);
    top = Math.max(6, top);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
})();

// ─── Native file/directory dialogs (Tauri) ───

async function openDialog(options) {
  // Tauri v2 withGlobalTauri: plugin API 挂载在 __TAURI__.dialog
  if (window.__TAURI__?.dialog?.open) {
    return await window.__TAURI__.dialog.open(options);
  }
  // 回退：core.invoke（Tauri v2 plugin 命名规则用竖线分隔）
  if (window.__TAURI__?.core?.invoke) {
    return await window.__TAURI__.core.invoke('plugin:dialog|open', options);
  }
  if (window.__TAURI__?.invoke) {
    return await window.__TAURI__.invoke('plugin:dialog|open', options);
  }
  return null;
}

// ─── ESM exports for cross-module utilities ───
window.escHtml = escHtml;
window.escAttr = escAttr;
window.renderGrayCover = renderGrayCover;
window.renderAnimeCard = renderAnimeCard;
window.openModal = openModal;
window.openDialog = openDialog;
