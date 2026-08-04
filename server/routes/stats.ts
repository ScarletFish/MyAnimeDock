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
  const isNoise = (tag: any, platform: any): boolean => {
    if (!tag) return true;
    if (/^\d+$/.test(tag)) return true;
    if (/^\d{4}年/.test(tag)) return true;
    if (/^\d{1,2}月$/.test(tag)) return true;
    if (/^第\d+[期季部]$/.test(tag)) return true;
    if (/^(TVA|OVA|OAD|OAV|WEB|BD|DVD|TV|SP|ONA)$/i.test(tag)) return true;
    if (/^(劇場版|映画|映畫|短片|番組|PV|特典|CM|预告|預告|予告)$/.test(tag)) return true;
    if (/^(原作|漫画改|小说改|游戏改|轻小说改|Web系)$/.test(tag)) return true;
    if (/^(日本|日本动画|动画|アニメ)$/.test(tag)) return true;
    if (/^(评分|推薦|推荐)$/.test(tag)) return true;
    if (platform && tag === platform) return true;
    return false;
  };
  const lib = data.library || [];
  const tagCount: Record<string, number> = {};
  for (const a of lib) {
    if (!a.tags || !Array.isArray(a.tags)) continue;
    for (const t of a.tags) {
      const tag = t.trim();
      if (isNoise(tag, a.platform)) continue;
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    }
  }
  jsonResp(res, 200, { tags: tagCount });
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
