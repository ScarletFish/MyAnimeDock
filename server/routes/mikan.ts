// server/routes/mikan.ts — 蜜柑计划 API 路由
import { jsonResp, readBody, createTimedCache } from '../lib/utils';
import { qbAddRssFeed, qbRemoveRssFeedByUrl, qbSetRssRule, qbRemoveRssRule } from '../lib/qb-client';
import { getWeeklyBangumi, getSeasonBangumi, getBangumiResources, getSubgroupFullResources } from '../scrapers/mikan';
import type { ServerState, MikanBangumi, MikanBangumiDetail, MikanResource } from '../types';
import crypto from 'crypto';

// 进程内 TTL 缓存（复用 lib/utils 的 createTimedCache 单槽，包一层按 URL 作 key）
// 仅缓存成功响应；抓取失败不写入，按现状直接报错。命中不续期（固定 30min 窗口）。
const MIKAN_TTL = 30 * 60 * 1000;
interface CacheSlot { get(): unknown; set(v: unknown): void; clear(): void; }
const mikanCache = new Map<string, CacheSlot>();

function cacheGet<T>(key: string): T | null {
  const slot = mikanCache.get(key);
  if (!slot) return null;
  const v = slot.get();
  return v === null ? null : (v as T);
}

function cacheSet<T>(key: string, value: T): void {
  let slot = mikanCache.get(key);
  if (!slot) {
    slot = createTimedCache<unknown>(MIKAN_TTL) as unknown as CacheSlot;
    mikanCache.set(key, slot);
  }
  slot.set(value as unknown);
}

function cacheDelete(prefix: string): void {
  for (const k of mikanCache.keys()) {
    if (k.startsWith(prefix)) mikanCache.delete(k);
  }
}

interface MikanDayGroup {
  dayOfWeek: number;
  bangumi: MikanBangumi[];
}

/**
 * GET /api/mikan/weekly
 * 获取一周内更新的番剧列表
 */
async function handleMikanWeekly(_req: any, res: any, state: ServerState) {
  const { logger, config } = state;
  try {
    const weeklyBangumi = await getWeeklyBangumi(config.mikanMirror);
    
    const result: MikanDayGroup[] = [];
    weeklyBangumi.forEach((bangumiList, dayOfWeek) => {
      result.push({
        dayOfWeek,
        bangumi: bangumiList,
      });
    });
    
    jsonResp(res, 200, result);
  } catch (e: any) {
    logger.error('[MIKAN]', e);
    jsonResp(res, 500, { error: e.message });
  }
}

/**
 * GET /api/mikan/season?year=2026&season=夏
 * 获取指定季度的番剧列表
 */
async function handleMikanSeason(req: any, res: any, state: ServerState) {
  const { logger, config } = state;
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const year = parseInt(url.searchParams.get('year') || '', 10);
    const season = url.searchParams.get('season') || '夏';
    
    if (!year || year < 2000 || year > 2100) {
      jsonResp(res, 400, { error: 'Invalid year parameter' });
      return;
    }
    
    const validSeasons = ['春', '夏', '秋', '冬'];
    if (!validSeasons.includes(season)) {
      jsonResp(res, 400, { error: 'Invalid season parameter. Must be: 春/夏/秋/冬' });
      return;
    }

    const refresh = url.searchParams.get('refresh') === '1';
    const cacheKey = `mikan:season:${year}:${season}`;
    let seasonBangumi = refresh ? null : cacheGet<Map<number, MikanBangumi[]>>(cacheKey);
    if (!seasonBangumi) {
      seasonBangumi = await getSeasonBangumi(year, season, config.mikanMirror);
      cacheSet(cacheKey, seasonBangumi);
    }

    const result: MikanDayGroup[] = [];
    seasonBangumi.forEach((bangumiList, dayOfWeek) => {
      result.push({
        dayOfWeek,
        bangumi: bangumiList,
      });
    });
    
    jsonResp(res, 200, result);
  } catch (e: any) {
    logger.error('[MIKAN]', e);
    jsonResp(res, 500, { error: e.message });
  }
}

/**
 * GET /api/mikan/bangumi?name=番剧名 或 /api/mikan/bangumi?url=/Home/Bangumi/3941
 * 获取番剧详情页的字幕组资源
 */
async function handleMikanBangumi(req: any, res: any, state: ServerState) {
  const { logger, config, db } = state;
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const name = url.searchParams.get('name');
    const detailUrl = url.searchParams.get('url');
    
    if (!name && !detailUrl) {
      jsonResp(res, 400, { error: 'Either name or url parameter is required' });
      return;
    }
    
    if (detailUrl) {
      const refresh = url.searchParams.get('refresh') === '1';
      const cacheKey = `mikan:bangumi:${detailUrl}`;
      let detail = refresh ? null : cacheGet<MikanBangumiDetail>(cacheKey);
      if (!detail) {
        detail = await getBangumiResources(detailUrl, config.mikanMirror);
        cacheSet(cacheKey, detail);
      }
      // 详情刷新时同步让该番剧的全量资源缓存失效，保证「加载更多」也最新
      if (refresh) cacheDelete(`mikan:full:${detailUrl}:`);
      // 订阅状态读本地 DB，每次实时附加，不进缓存（避免订阅后 stale）
      if (detail.bgmId) {
        const subs = db.getMikanSubscriptionsByBgmId(detail.bgmId);
        const subMap = new Map(subs.map((s: any) => [s.subgroupId, s]));
        for (const sg of detail.subgroups) {
          const sub = subMap.get(sg.id);
          (sg as any).subscription = sub ? { id: sub.id, name: sub.name } : null;
        }
      }
      jsonResp(res, 200, detail);
      return;
    }
    
    // TODO: 如果只提供了名字，需要先搜索找到详情页URL
    jsonResp(res, 400, { error: 'Search by name not yet implemented. Please provide url parameter.' });
  } catch (e: any) {
    logger.error('[MIKAN]', e);
    jsonResp(res, 500, { error: e.message });
  }
}

/**
 * GET /api/mikan/bangumi/full?url=/Home/Bangumi/3941&subgroupId=615
 * 获取指定字幕组的完整资源列表（通过 AJAX，慢但全）
 */
async function handleMikanBangumiFull(req: any, res: any, state: ServerState) {
  const { logger, config } = state;
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const detailUrl = url.searchParams.get('url');
    const subgroupIdStr = url.searchParams.get('subgroupId');
    
    if (!detailUrl || !subgroupIdStr) {
      jsonResp(res, 400, { error: 'url and subgroupId parameters are required' });
      return;
    }
    
    const subgroupId = parseInt(subgroupIdStr, 10);
    if (isNaN(subgroupId)) {
      jsonResp(res, 400, { error: 'subgroupId must be a number' });
      return;
    }

    const refresh = url.searchParams.get('refresh') === '1';
    const cacheKey = `mikan:full:${detailUrl}:${subgroupId}`;
    let resources = refresh ? null : cacheGet<MikanResource[]>(cacheKey);
    if (!resources) {
      resources = await getSubgroupFullResources(detailUrl, subgroupId, config.mikanMirror);
      cacheSet(cacheKey, resources);
    }
    jsonResp(res, 200, resources);
  } catch (e: any) {
    logger.error('[MIKAN]', e);
    jsonResp(res, 500, { error: e.message });
  }
}

/**
 * POST /api/mikan/subscribe
 * 订阅字幕组 RSS
 */
async function handleMikanSubscribe(req: any, res: any, state: ServerState) {
  const { logger, config, db, data } = state;
  try {
    const body = JSON.parse(await readBody(req));
    const { animeId, bgmId, name, subgroupId, subgroupName, rssUrl, mustContain, mustNotContain } = body;

    if (!animeId || !name || !subgroupId || !rssUrl) {
      jsonResp(res, 400, { error: 'animeId, name, subgroupId, rssUrl are required' });
      return;
    }

    // 构造完整 RSS URL
    const fullRssUrl = `https://mikanime.tv${rssUrl}`;
    const savePath = `${config.mediaDir}/${name}`.replace(/\\/g, '/');
    const ruleName = `mikan_${animeId}`;
    // feed path 必须唯一（qB 同 path 只能有一个 feed），用 anime 名+subgroupId 区分
    const feedPath = `Mikan/${name}_sg${subgroupId}`;

    // 1. 添加 RSS feed 到 qBittorrent（path 为 RSS 树文件夹，必须唯一）
    // 409 容忍：可能上次取消订阅时 feed 移除失败，或并发重复订阅
    try {
      await qbAddRssFeed(config.qbPort, config.qbUsername, config.qbPassword, fullRssUrl, feedPath);
    } catch (feedErr: any) {
      if (!feedErr?.message?.includes('409')) throw feedErr;
      logger.debug(`[MIKAN] RSS feed already exists, continuing: ${fullRssUrl}`);
    }

    // 2. 设置自动下载规则
    const ruleDef: Record<string, any> = {
      enabled: true,
      mustContain: mustContain || '',
      mustNotContain: mustNotContain || '',
      useRegex: true,
      episodeFilter: '',
      smartFilter: false,
      previouslyMatchedEpisodes: [],
      affectedFeeds: [fullRssUrl],
      ignoreDays: 0,
      lastMatch: '',
      addPaused: false,
      assignedCategory: 'anime-mikan',
      savePath,
    };
    await qbSetRssRule(config.qbPort, config.qbUsername, config.qbPassword, ruleName, ruleDef);

    // 3. 保存到数据库
    const id = crypto.randomUUID();
    db.upsertMikanSubscription({
      id,
      animeId,
      bgmId: bgmId || null,
      name,
      subgroupId,
      subgroupName,
      rssUrl: fullRssUrl,
      savePath,
      mustContain: mustContain || null,
      mustNotContain: mustNotContain || null,
    });

    // 反查已有 anime，补写 bangumiId
    if (bgmId) {
      const existing = data.library.find((a: any) => a.folderName === name && !a.bangumiId);
      if (existing) {
        existing.bangumiId = Number(bgmId);
        db.saveLibrary(data, new Set([existing.id])).catch((e: any) => {
          logger.error('[MIKAN] Failed to save bangumiId to existing anime:', e.message);
        });
      }
    }

    logger.info(`[MIKAN] Subscribed: ${name} / ${subgroupName}`);
    jsonResp(res, 200, { ok: true, subscriptionId: id });
  } catch (e: any) {
    logger.error('[MIKAN] Subscribe failed:', e);
    jsonResp(res, 500, { error: e.message });
  }
}

/**
 * POST /api/mikan/unsubscribe
 * 取消订阅
 */
async function handleMikanUnsubscribe(req: any, res: any, state: ServerState) {
  const { logger, config, db } = state;
  try {
    const body = JSON.parse(await readBody(req));
    const { subscriptionId, animeId } = body;

    const targetId = subscriptionId || animeId;
    if (!targetId) {
      jsonResp(res, 400, { error: 'subscriptionId or animeId is required' });
      return;
    }

    // 查找订阅记录
    const sub = subscriptionId
      ? db.getMikanSubscriptionById(subscriptionId)
      : db.getMikanSubscription(animeId);

    if (!sub) {
      jsonResp(res, 404, { error: 'Subscription not found' });
      return;
    }

    // 从 qBittorrent 移除规则和 RSS feed
    const ruleName = `mikan_${sub.animeId}`;
    try {
      await qbRemoveRssRule(config.qbPort, config.qbUsername, config.qbPassword, ruleName);
    } catch { /* rule 可能不存在 */ }
    try {
      await qbRemoveRssFeedByUrl(config.qbPort, config.qbUsername, config.qbPassword, sub.rssUrl);
    } catch { /* feed 可能不存在 */ }

    // 从数据库删除
    db.deleteMikanSubscription(sub.animeId);

    logger.info(`[MIKAN] Unsubscribed: ${sub.name} / ${sub.subgroupName}`);
    jsonResp(res, 200, { ok: true });
  } catch (e: any) {
    logger.error('[MIKAN] Unsubscribe failed:', e);
    jsonResp(res, 500, { error: e.message });
  }
}

/**
 * GET /api/mikan/subscription?animeId=xxx
 * 查询订阅状态
 */
async function handleMikanSubscription(req: any, res: any, state: ServerState) {
  const { logger, db } = state;
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const animeId = url.searchParams.get('animeId');

    if (!animeId) {
      jsonResp(res, 400, { error: 'animeId is required' });
      return;
    }

    const sub = db.getMikanSubscription(animeId);
    jsonResp(res, 200, sub || null);
  } catch (e: any) {
    logger.error('[MIKAN] Query subscription failed:', e);
    jsonResp(res, 500, { error: e.message });
  }
}

module.exports = {
  handleMikanWeekly,
  handleMikanSeason,
  handleMikanBangumi,
  handleMikanBangumiFull,
  handleMikanSubscribe,
  handleMikanUnsubscribe,
  handleMikanSubscription,
};
