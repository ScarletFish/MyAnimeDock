// server/routes/mikan.ts — 蜜柑计划 API 路由
import { jsonResp } from '../lib/utils';
import { getWeeklyBangumi, getSeasonBangumi, getBangumiResources } from '../scrapers/mikan';
import type { ServerState, MikanBangumi, MikanSubtitleGroup, MikanSubtitleGroupInfo } from '../types';

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
    
    const seasonBangumi = await getSeasonBangumi(year, season, config.mikanMirror);
    
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
  const { logger, config } = state;
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const name = url.searchParams.get('name');
    const detailUrl = url.searchParams.get('url');
    
    if (!name && !detailUrl) {
      jsonResp(res, 400, { error: 'Either name or url parameter is required' });
      return;
    }
    
    if (detailUrl) {
      const detail = await getBangumiResources(detailUrl, config.mikanMirror);
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

module.exports = {
  handleMikanWeekly,
  handleMikanSeason,
  handleMikanBangumi,
};
