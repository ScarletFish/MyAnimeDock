// ─── 水平滚动分区自动列数（一帧到位）───
// 原布局按整数 --cols + 断点写死（以 1080p 校准）。本模块让列数随容器宽度
// 连续变化，同时保持卡片尺寸恒等于"原 CSS 首次渲染出的卡宽"。
//
// 原理（兼容原观感、零猜测，无双渲染）：
//   1. 调用方保证在 DOM 就绪后同步调用（tick().then / onMount），浏览器尚未 paint。
//   2. 量取实际渲染出的第一张卡宽（offsetWidth）作为目标卡宽。
//   3. 在此基础上连续算列数：cols = round((width+gap)/(cardW+gap))，
//      之后 ResizeObserver 随宽度增减列数，卡宽锁死在首次量得的值。
//
// 首算的测量 + 写回发生在浏览器首次 paint 之前的同一帧内，因此 CSS 基线态
// 永远不会被画出来，没有"先按 --cols 渲染再接管"的两阶段观感。
// 可选覆盖：
//   .hscroll-section { --min-cols: 2; --max-cols: 8; }   // 钳制列数
function getGap(el) {
  const cs = getComputedStyle(el);
  // 兜底 16px 对应 CSS 默认 --gap: var(--space-4)（1rem）；flex 容器上
  // getComputedStyle 总能读到计算 gap，此兜底仅防御 getComputedStyle 异常
  return parseFloat(cs.columnGap) || parseFloat(cs.gap) || 16;
}

/**
 * 让一个水平滚动容器自动计算 --cols，卡宽锁定在首次渲染值。
 * 列数变化后如提供 onColsChange，用于联动 scroll-dots 重算页数。
 * @param {HTMLElement} el - 容器（含 hscroll-card 子级的 flex 容器）
 * @param {object} [opts]
 * @param {string} [opts.cardSelector] - 卡片选择器，用于量卡宽（默认 '.hscroll-card'）
 * @param {(cols:number, el:HTMLElement)=>void} [opts.onColsChange]
 * @returns {()=>void} 清理函数（断开 observer + 恢复 CSS 基线）
 */
export function initHscrollAutoCols(el, opts = {}) {
  if (!el) return () => {};
  const { cardSelector = '.hscroll-card', onColsChange } = opts;

  let lastCols = NaN;
  let cardW = NaN; // 目标卡宽（px），锁定首次量得的值

  function measureCardWidth() {
    const card = el.querySelector(cardSelector);
    if (!card || card.offsetWidth <= 0) return NaN;
    return card.offsetWidth;
  }

  function compute(force = false) {
    // 隐藏或未布局时跳过
    if (!el.isConnected || el.clientWidth <= 0) return;

    // 首次：锁定目标卡宽（= 原 CSS 渲染出的实际卡宽）
    if (Number.isNaN(cardW)) {
      const measured = measureCardWidth();
      if (Number.isNaN(measured)) return; // 已挂载但卡还没渲染，等下一次
      cardW = measured;
    }

    const cs = getComputedStyle(el);
    const gap = getGap(el);
    const minCols = parseInt(cs.getPropertyValue('--min-cols'), 10) || 1;
    const maxCols = parseInt(cs.getPropertyValue('--max-cols'), 10) || Infinity;

    const step = cardW + gap;
    // 用 Math.round 而非 floor：offsetWidth 取整后 (W+g)/step 会略小于整列数
    // （如 3.995），floor 会少算一列（1080p 下 4→3）。round 与 scroll-dots 的
    // getVisibleCount（同样 round）口径一致，保证页数与圆点同步。
    let cols = Math.round((el.clientWidth + gap) / step);
    if (cols < minCols) cols = minCols;
    if (cols > maxCols) cols = maxCols;
    if (cols < 1) cols = 1;

    if (force || cols !== lastCols) {
      lastCols = cols;
      el.style.setProperty('--cols', String(cols));
      if (typeof onColsChange === 'function') onColsChange(cols, el);
    }
  }

  // 同步首算：调用方必须在 DOM 就绪后调用（tick().then() 或 onMount），
  // 此时浏览器尚未 paint，测量 + 写回在同一帧内完成，首次绘制即最终列数，
  // CSS 基线态不会被画出来。后续宽度变化由 ResizeObserver 覆盖。
  compute(true);

  const ro = new ResizeObserver(() => compute());
  ro.observe(el);

  return () => {
    ro.disconnect();
    // 移除 inline --cols，恢复 CSS 断点基线（避免重测时量到上次的残余值）
    el.style.removeProperty('--cols');
  };
}