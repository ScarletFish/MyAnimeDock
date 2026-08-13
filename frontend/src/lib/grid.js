// ─── 共享 Grid 列公式（Svelte 迁移 Chunk A）───
// 原 library.js GRID_CARD_MIN/MAX + 响应 --scale 计算。

export const GRID_CARD_MIN = 200;
export const GRID_CARD_MAX = 277;

export function readScale() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
}

export function calcGridCols(scale) {
  return `repeat(auto-fit, minmax(${Math.round(200 * scale)}px, ${Math.round(277 * scale)}px))`;
}