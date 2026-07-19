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
  watching: '进行中',
  wish: '计划中',
  completed: '已完成',
  on_hold: '搁置',
  dropped: '抛弃'
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
 * @param {string} [options.extraAttrs=''] — 卡片额外 HTML 属性
 */
function renderAnimeCard(anime, options = {}) {
  const {
    onClick = 'navigateToDetail',
    onContextMenu = 'showContextMenu',
    showMoreBtn = true,
    coverSize = '400',
    isWish = false,
    extraAttrs = ''
  } = options;

  const id = escAttr(anime.id);
  const title = escHtml(anime.bangumiTitle || anime.title);

  // Cover: localCover (library) → coverUrl (wishlist) → gray placeholder
  const coverSrc = anime.localCover
    ? '/covers/' + path.basename(anime.localCover) + '?w=' + coverSize + '&q=75'
    : (anime.coverUrl || '');

  const coverStyle = isWish ? 'opacity:0.45;filter:grayscale(0.6)' : '';
  const cardClass = isWish ? 'anime-card anime-card--wish' : 'anime-card';

  // Status badge label
  const mylistLabel = anime.myListStatus
    ? (STATUS_LABELS[anime.myListStatus] || anime.myListStatus)
    : null;

  // More button
  const moreBtnHtml = showMoreBtn
    ? ('<div class="card-more-btn" onclick="event.stopPropagation();openStatusModal(event, \'' + id + '\')" data-tooltip="设置状态">' +
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
    '<div class="overlay">' +
      '<h3>' + title + '</h3>' +
      '<div class="meta">' +
        (anime.rating ? '<span class="rating-badge">★ ' + anime.rating + '</span>' : '') +
        (anime.season && !isWish ? '<span class="season-badge">S' + anime.season + '</span>' : '') +
        (mylistLabel && anime.myListStatus !== 'watching'
          ? '<span class="mylist-badge ' + anime.myListStatus + '">' + mylistLabel + '</span>'
          : '') +
        (isWish ? '<span class="wishlist-badge">愿望</span>' : '') +
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

function closeModal(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el.classList.remove('show');
  document.body.style.overflow = '';
  if (el._onClose) {
    const cb = el._onClose;
    el._onClose = null;
    cb();
  }
}

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

    showTimer = setTimeout(function() {
      el.textContent = target.getAttribute('data-tooltip');
      position(target);
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

  function position(target) {
    var rect = target.getBoundingClientRect();
    var tw = el.offsetWidth || 0;
    // Centered above the target element
    var left = rect.left + rect.width / 2 - (tw / 2);
    var top = rect.top - 12;

    if (tw) {
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    }
    top = Math.max(6, top);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
})();
