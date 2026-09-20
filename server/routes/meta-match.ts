// server/routes/meta-match.ts — MetaMatch 批量匹配工作台瘦列表
// data.library 内存态已是 animeToLegacy + metadata spread 的 legacy 形状
// （列表读取 buildListItems 同一对象），此处直接抽 18 个瘦字段，不改顺序、不做 IO。
import { jsonResp } from '../lib/utils';
import { parseFolderName } from '../scanner';
import { buildSearchTerms } from '../scrapers';
import type { MetaMatchItem, ServerState } from '../types';

/**
 * 计算该条目自动匹配时后端将实际使用的最终检索词序列（与 matchSeason 的
 * buildSearchTerms 同源），供 MetaMatch 详情页「匹配前」展示。
 */
function computeSearchTerms(a: any): string[] {
  const fallback = [a.title || a.folderName].filter(Boolean) as string[];
  if (!a.folderName) return fallback;
  try {
    return buildSearchTerms(parseFolderName(a.folderName), a.title || a.folderName);
  } catch {
    return fallback;
  }
}

export function handleGetMetaMatchItems(req: any, res: any, state: ServerState): void {
  const { data, logger } = state;
  try {
    const items: MetaMatchItem[] = data.library.map((a) => ({
      id: a.id,
      title: a.title,
      folderName: a.folderName,
      bangumiTitle: a.bangumiTitle,
      bangumiId: a.bangumiId,
      pinyinTitle: a.pinyinTitle,
      season: a.season,
      matchedSeason: a.matchedSeason,
      specialSuffix: a.specialSuffix,
      episodeCount: (a.episodes || []).length,
      summary: a.summary,
      localCover: a.localCover,
      rating: a.rating,
      bangumiTitleJp: a.bangumiTitleJp,
      anilistId: a.anilistId,
      anilistBanner: a.anilistBanner,
      anilistTags: a.anilistTags,
      searchTerms: computeSearchTerms(a),
    }));
    jsonResp(res, 200, items);
  } catch (err) {
    logger.error('[meta-match]', err);
    jsonResp(res, 500, { error: (err as Error).message });
  }
}