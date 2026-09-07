// server/lib/anime-meta.ts — 动漫元数据派生判定（预期集数 / 追番状态）
import type { Anime } from '../types';

/** 预计总集数（Bangumi 元数据；eps 可能是数组或数字，未知返回 null） */
export function expectedEpCount(a: Anime | undefined | null): number | null {
  if (!a) return null;
  const v = a.totalEpisodes ?? (Array.isArray(a.eps) ? a.eps.length : a.eps);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 追番中：预计总集数已知且本地集数不足（看完本地最后一集是等更新，不是完结） */
export function isChasing(a: Anime | undefined | null): boolean {
  const total = expectedEpCount(a);
  return total != null && !!a?.episodes && a.episodes.length < total;
}