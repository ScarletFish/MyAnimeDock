// ─── 共享 Grid 列公式 ───
// GRID_CARD_MIN/MAX + 响应 --scale 计算。

export const GRID_CARD_MIN = 200;
export const GRID_CARD_MAX = 277;

export function readScale() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
}

export function calcGridCols(scale) {
  return `repeat(auto-fit, minmax(${Math.round(GRID_CARD_MIN * scale)}px, ${Math.round(GRID_CARD_MAX * scale)}px))`;
}

// 反算 auto-fit minmax 的实际列数与卡宽（供窗口化用）：
// 列数按 min 决定（放尽可能多列），卡宽 = 均分剩余空间、clamp 到 max。
export function calcGridColCount(width, gap, scale) {
  const min = GRID_CARD_MIN * scale;
  const max = GRID_CARD_MAX * scale;
  const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
  const cardW = Math.min((width - (cols - 1) * gap) / cols, max);
  return { cols, cardW };
}