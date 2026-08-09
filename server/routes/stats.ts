// server/routes/stats.ts — 统计面板、观看活动、会话数据
import { jsonResp } from '../lib/utils';
import type { ServerState } from '../types';

export function handleStats(req: any, res: any, state: ServerState): void {
  const { data } = state;
  const lib = data.library || [];
  const watching = lib.filter((a: any) => a.myListStatus === 'watching').length;
  const completed = lib.filter((a: any) => a.myListStatus === 'completed').length;
  const total = lib.filter((a: any) => a.downloaded !== false).length;
  let totalEpWatched = 0;
  let totalFileSize = 0;
  let totalFileCount = 0;
  for (const a of lib) {
    if (!a.episodes) continue;
    for (const e of a.episodes) {
      if (e.watched) totalEpWatched++;
      if (e.fileSize) { totalFileSize += e.fileSize; totalFileCount++; }
    }
  }
  const totalWatchSeconds = (data.playSessions || []).reduce((sum: number, s: any) => {
    return sum + Math.max(0, s.duration || 0, s.clockTime || 0);
  }, 0);
  jsonResp(res, 200, { watching, completed, total, totalEpWatched, totalWatchSeconds, totalFileSize, totalFileCount });
}

export function handleStatsTags(req: any, res: any, state: ServerState): void {
  const { data } = state;
  const lib = data.library || [];
  const tagCount: Record<string, number> = {};
  for (const a of lib) {
    if (!a.anilistTags || !Array.isArray(a.anilistTags)) continue;
    for (const t of a.anilistTags) {
      if (!t || !t.name || t.isGeneralSpoiler) continue;
      tagCount[t.name] = (tagCount[t.name] || 0) + 1;
    }
  }
  jsonResp(res, 200, { tags: tagCount });
}

// 和弦图排除的泛化 tag：Cast-Main Cast（主角/卡司构成）+ Demographic（受众向）。
// 这两类几乎每部番都有，会主导共现矩阵成为中心枢纽，故排除；保留 Cast-Traits 等具体特征。
const CHORD_EXCLUDED_TAGS = new Set([
  // Cast-Main Cast
  'Anti-Hero', 'Elderly Protagonist', 'Ensemble Cast', 'Estranged Family',
  'Female Protagonist', 'Male Protagonist', 'Primarily Adult Cast',
  'Primarily Animal Cast', 'Primarily Child Cast', 'Primarily Female Cast',
  'Primarily Male Cast', 'Primarily Teen Cast',
  // Demographic
  'Josei', 'Kids', 'Seinen', 'Shoujo', 'Shounen',
]);

const CHORD_MAX_TAGS = 12;

export function handleStatsTagCooccurrence(req: any, res: any, state: ServerState): void {
  const { data } = state;
  const lib = data.library || [];

  // 统计 tag 频次（过滤剧透 + 排除泛化分类）
  const tagCount: Record<string, number> = {};
  for (const a of lib) {
    if (!a.anilistTags || !Array.isArray(a.anilistTags)) continue;
    for (const t of a.anilistTags) {
      if (!t || !t.name || t.isGeneralSpoiler || CHORD_EXCLUDED_TAGS.has(t.name)) continue;
      tagCount[t.name] = (tagCount[t.name] || 0) + 1;
    }
  }

  // 取 Top N 高频 tag
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, CHORD_MAX_TAGS)
    .map(([name]) => name);

  const index = new Map(topTags.map((name, i) => [name, i]));
  const n = topTags.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  // 统计共现：同一部番内出现的 tag 两两 +1（对角保持 0，避免 d3.chord 生成 self-ribbon）
  for (const a of lib) {
    if (!a.anilistTags || !Array.isArray(a.anilistTags)) continue;
    const present = new Set<number>();
    for (const t of a.anilistTags) {
      if (!t || !t.name || t.isGeneralSpoiler || CHORD_EXCLUDED_TAGS.has(t.name)) continue;
      const idx = index.get(t.name);
      if (idx !== undefined) present.add(idx);
    }
    const arr = Array.from(present);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        matrix[arr[i]][arr[j]]++;
        matrix[arr[j]][arr[i]]++;
      }
    }
  }

  // 过滤掉没有任何交叉共现的 tag（行和为 0），避免 d3.chord 组值为空
  const keep = topTags
    .map((name, i) => ({ name, rowSum: matrix[i].reduce((s, v) => s + v, 0) }))
    .filter(t => t.rowSum > 0)
    .map(t => t.name);

  if (keep.length < 2) {
    jsonResp(res, 200, { tags: keep, matrix: [] });
    return;
  }

  const keepIndex = new Map(keep.map((name, i) => [name, i]));
  const m = keep.length;
  const filtered: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    const ki = keepIndex.get(topTags[i]);
    if (ki === undefined) continue;
    for (let j = 0; j < n; j++) {
      const kj = keepIndex.get(topTags[j]);
      if (kj === undefined) continue;
      filtered[ki][kj] = matrix[i][j];
    }
  }

  jsonResp(res, 200, { tags: keep, matrix: filtered });
}

export function handleStatsSeasons(req: any, res: any, state: ServerState): void {
  const { data } = state;
  const lib = data.library || [];
  const seasonCount: Record<string, number> = { spring: 0, summer: 0, autumn: 0, winter: 0, unknown: 0 };
  for (const a of lib) {
    let dateStr = a.date || null;
    if (!dateStr && a.importedAt) dateStr = a.importedAt.slice(0, 10);
    if (!dateStr || typeof dateStr !== 'string') { seasonCount.unknown++; continue; }
    const match = dateStr.match(/^(\d{4})[-/](\d{1,2})/);
    if (!match) { seasonCount.unknown++; continue; }
    const month = parseInt(match[2], 10);
    if (month >= 4 && month <= 6) seasonCount.spring++;
    else if (month >= 7 && month <= 9) seasonCount.summer++;
    else if (month >= 10 && month <= 12) seasonCount.autumn++;
    else seasonCount.winter++;
  }
  jsonResp(res, 200, { seasons: seasonCount });
}

export function handleStatsRatings(req: any, res: any, state: ServerState): void {
  const { data } = state;
  const lib = data.library || [];
  const bins = [0, 0, 0, 0, 0, 0, 0];
  for (const a of lib) {
    const r = a.rating;
    if (r == null || typeof r !== 'number' || isNaN(r)) continue;
    if (r < 2) bins[0]++;
    else if (r < 4) bins[1]++;
    else if (r < 6) bins[2]++;
    else if (r < 7) bins[3]++;
    else if (r < 8) bins[4]++;
    else if (r < 9) bins[5]++;
    else bins[6]++;
  }
  jsonResp(res, 200, { bins, labels: ['0-2', '2-4', '4-6', '6-7', '7-8', '8-9', '9-10'] });
}

export function handleStatsWatchActivity(req: any, res: any, state: ServerState): void {
  const { data } = state;
  const sessions = data.playSessions || [];
  const months: Array<{ ym: string; label: string; minutes: number }> = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    months.push({ ym, label, minutes: 0 });
  }
  for (const s of sessions) {
    if (!s.startTime || !s.endTime) continue;
    const sd = new Date(s.startTime);
    const ym = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}`;
    const entry = months.find(m => m.ym === ym);
    if (entry) {
      const watchSecs = Math.max(0, s.duration || 0, s.clockTime || 0);
      entry.minutes += Math.round(watchSecs / 60);
    }
  }
  jsonResp(res, 200, { months: months.map(m => ({ label: m.label, minutes: m.minutes })) });
}

export function handleAnimeSessions(req: any, res: any, state: ServerState): void {
  const { data } = state;
  const id = decodeURIComponent(req.url.slice('/api/anime/'.length, -'/sessions'.length));
  const sessions = data.playSessions.filter((s: any) => s.animeId === id && s.endTime);
  const byDate: Record<string, number> = {};
  for (const s of sessions) {
    const sd = new Date(s.startTime);
    const dateKey = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
    byDate[dateKey] = (byDate[dateKey] || 0) + Math.max(0, s.duration || 0);
  }
  const result: Record<string, number> = {};
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    result[key] = Math.round((byDate[key] || 0) / 60);
  }
  jsonResp(res, 200, result);
}
