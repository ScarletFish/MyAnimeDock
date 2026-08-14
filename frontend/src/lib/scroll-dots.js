// 水平滚动分页圆点指示器（原 detail-pagination.js，Svelte 共享版）
// 被 Detail.svelte（剧集/关联/推荐）与 Library.svelte（继续观看）复用。

/**
 * 为水平滚动容器初始化分页圆点
 * @param {object} opts
 * @param {HTMLElement} opts.scroll - flex 水平滚动容器
 * @param {string} opts.cardSelector - 卡片 CSS 选择器（如 '.relation-card'）
 * @param {number} opts.total - 卡片总数
 * @param {HTMLElement} opts.dotsParent - 放置圆点容器的父元素（section header）
 * @param {number} [opts.initialIndex] - 初始滚动到的索引（可选）
 */
export function initScrollDots(opts) {
  const { scroll, cardSelector, total, dotsParent, initialIndex } = opts;
  if (!scroll || !dotsParent || total === 0) return;

  // Detect visible card count from rendered layout
  function getVisibleCount() {
    const card = scroll.querySelector(cardSelector);
    if (!card) return 4;
    const cs = getComputedStyle(scroll);
    const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 12;
    return Math.round(scroll.clientWidth / (card.offsetWidth + gap)) || 4;
  }
  let VISIBLE_COUNT = getVisibleCount();

  // Create dots container
  let dotsEl = dotsParent.querySelector('.scroll-dots');
  if (!dotsEl) {
    dotsEl = document.createElement('div');
    dotsEl.className = 'scroll-dots';
    dotsParent.appendChild(dotsEl);
  }

  let dotCount = 0;
  function rebuildDots() {
    const newCount = Math.max(1, total - VISIBLE_COUNT + 1);
    if (newCount === dotCount) return;
    dotCount = newCount;
    if (dotCount <= 1) {
      dotsEl.innerHTML = '';
    } else {
      dotsEl.innerHTML = Array.from({ length: dotCount }, (_, i) =>
        `<button class="scroll-dot${i === 0 ? ' active' : ''}" data-index="${i}"></button>`
      ).join('');
    }
  }
  rebuildDots();

  function getCardStep() {
    const card = scroll.querySelector(cardSelector);
    if (!card) return 300;
    const cs = getComputedStyle(scroll);
    const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 12;
    return card.offsetWidth + gap;
  }

  let ticking = false;
  function updateActiveDot() {
    const newCount = getVisibleCount();
    if (newCount !== VISIBLE_COUNT) {
      VISIBLE_COUNT = newCount;
      rebuildDots();
    }
    if (dotCount <= 1) return;
    const step = getCardStep();
    if (!step) return;
    const nearestIdx = Math.round(scroll.scrollLeft / step);
    const clampedIdx = Math.max(0, Math.min(dotCount - 1, nearestIdx));
    dotsEl.querySelectorAll('.scroll-dot').forEach((d) => d.classList.toggle('active', parseInt(d.dataset.index) === clampedIdx));
  }

  scroll.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => { updateActiveDot(); ticking = false; });
      ticking = true;
    }
  }, { passive: true });

  dotsEl.addEventListener('click', (e) => {
    const dot = e.target.closest('.scroll-dot');
    if (!dot) return;
    const idx = parseInt(dot.dataset.index);
    const step = getCardStep();
    scroll.scrollTo({ left: idx * step, behavior: 'smooth' });
    dotsEl.querySelectorAll('.scroll-dot').forEach((d) => d.classList.toggle('active', parseInt(d.dataset.index) === idx));
  });

  // Init
  if (initialIndex != null) {
    const step = getCardStep();
    scroll.scrollLeft = Math.max(0, initialIndex * step);
  }
  requestAnimationFrame(updateActiveDot);
}
