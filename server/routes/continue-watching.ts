// server/routes/continue-watching.ts — 继续播放列表
// 候选/排序/继续集解析严格镜像 frontend/src/views/Library.svelte 的 continueItems 逻辑。
import { jsonResp } from '../lib/utils';
import { enrichAnime } from '../lib/enrich';
import type { AnimeEpisode, ContinueWatchingItem, ServerState } from '../types';

export function handleGetContinueWatching(req: any, res: any, state: ServerState): void {
  const { data, logger } = state;
  try {
    const candidates = data.library.filter((a) => {
      // 语义同 lib/list-item.ts 的 hasLocalFiles：仅 downloaded === true 视为本地存在
      if (!a.downloaded) return false;
      if (!a.episodes || a.episodes.length === 0) return false;
      const watchedCount = a.episodes.filter((e) => e.watched).length;
      const inProgress = a.episodes.some((e) => e.progress != null && e.progress > 0 && !e.watched);
      return inProgress || (watchedCount > 0 && watchedCount < a.episodes.length);
    });
    candidates.forEach((a) => enrichAnime(a, data));
    const items: ContinueWatchingItem[] = candidates
      .sort((a, b) => {
        const aTime = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
        const bTime = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 10)
      .map((anime) => {
        let ep: AnimeEpisode | null = null;
        if (anime.lastPlayedEp) {
          const match = anime.episodes.find((e) => e.number === anime.lastPlayedEp);
          if (match && !match.watched) ep = match;
        }
        if (!ep) {
          ep = anime.episodes.find((e) => !e.watched) ?? null;
        }
        return {
          id: anime.id,
          title: anime.title ?? null,
          bangumiTitle: anime.bangumiTitle ?? null,
          localCover: anime.localCover ?? null,
          episodeCount: anime.episodes.length,
          continueEpisode: ep
            ? { number: ep.number, filePath: ep.filePath, progress: ep.progress ?? 0, duration: ep.duration ?? null }
            : null,
        };
      });
    jsonResp(res, 200, items);
  } catch (err) {
    logger.error('[continue-watching]', err);
    jsonResp(res, 500, { error: (err as Error).message });
  }
}