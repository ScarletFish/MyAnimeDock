// 水平滚动分页圆点指示器（原 detail-pagination.js，Svelte 共享版）
// 被 Detail.svelte（剧集/关联/推荐）与 Library.svelte（继续观看）复用。
//
// 布局模型（与 patterns.css .hscroll-card 契约）：
//   --card-w = 基准卡宽常量（各分区 CSS 指定，档位门槛，不是实际渲染宽）
//   --cols   = 整数列数，本模块按 基准 + 容器宽 纯函数计算并写回容器 style，
//              卡片 calc 弹性均分（每屏恰好整数张完整卡、铺满无空隙）。
// 无量测任何渲染尺寸、无时序耦合：隐藏/显示/最大化的先后顺序不影响结果，
// 窗口尺寸一变（ResizeObserver）即重算。

/**
 * 为水平滚动容器初始化分页圆点
 * @param {object} opts
 * @param {HTMLElement} opts.scroll - flex 水平滚动容器
 * @param {string} opts.cardSelector - 卡片 CSS 选择器（保留以兼容调用方签名；宽度改走 calc 均分，不再量测）
 * @param {number} opts.total - 卡片总数
 * @param {HTMLElement} opts.dotsParent - 放置圆点容器的父元素（section header）
 * @param {number} [opts.initialIndex] - 初始滚动到的索引（可选）
 */
export function initScrollDots(opts) {
  const { scroll, total, dotsParent, initialIndex } = opts;
  if (!scroll || !dotsParent || total === 0) return;

  // 基准卡宽常量：读容器（或其父级）上定义的 --card-w token
  function getBaselineW() {
    return parseFloat(getComputedStyle(scroll).getPropertyValue('--card-w')) || 320;
  }
  function getGap() {
    const cs = getComputedStyle(scroll);
    return parseFloat(cs.gap) || parseFloat(cs.columnGap) || 12;
  }
  // 内容盒宽度（与 CSS calc 的 100% 对齐：content box = clientWidth − padding）
  function getContentW() {
    const cs = getComputedStyle(scroll);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return Math.max(0, scroll.clientWidth - padX);
  }
  // 整数列数 = f(基准, 容器宽)：写回 --cols 供 calc 弹性均分
  function computeCols() {
    const gap = getGap();
    const cols = Math.max(1, Math.floor((getContentW() + gap) / (getBaselineW() + gap)));
    const prev = scroll.style.getPropertyValue('--cols');
    if (String(cols) !== prev) scroll.style.setProperty('--cols', String(cols));
    return cols;
  }
  // 每张卡的实际渲染宽 = (容器宽 − gap*(cols−1)) / cols；滚动步长 = 卡宽 + gap
  function getCardStep() {
    const gap = getGap();
    const cols = VISIBLE_COUNT;
    const cardW = (getContentW() - gap * (cols - 1)) / cols;
    return cardW + gap;
  }
  let VISIBLE_COUNT = computeCols();

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

  let ticking = false;
  function updateActiveDot() {
    // 容器尺寸变化（窗口/缩放）时列数随之重算；无变化时守卫吞掉开销
    const newCount = computeCols();
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

  // 容器宽度变化（窗口尺寸/缩放）时重算列数与圆点；自身不依赖任何外部合成事件
  const ro = new ResizeObserver(() => requestAnimationFrame(updateActiveDot));
  ro.observe(scroll);

  // Init
  if (initialIndex != null) {
    const step = getCardStep();
    scroll.scrollLeft = Math.max(0, initialIndex * step);
  }
  requestAnimationFrame(updateActiveDot);
}