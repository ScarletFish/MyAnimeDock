// server/routes/meta-match.ts — MetaMatch 批量匹配工作台瘦列表
// data.library 内存态已是 animeToLegacy + metadata spread 的 legacy 形状
// （列表读取 buildListItems 同一对象），此处直接抽 17 个瘦字段，不改顺序、不做 IO。
import { jsonResp } from '../lib/utils';
import type { MetaMatchItem, ServerState } from '../types';

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
    }));
    jsonResp(res, 200, items);
  } catch (err) {
    logger.error('[meta-match]', err);
    jsonResp(res, 500, { error: (err as Error).message });
  }
}