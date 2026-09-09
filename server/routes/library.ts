// server/routes/library.ts — 资料库、详情、批量元数据同步
// 列表读取已由 /api/mylist（lib/list-item.ts 的 buildListItems）统一承担。
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { jsonResp } from '../lib/utils';
import { saveScannedTree, DATA_DIR } from '../lib/config';
import { enrichAnime } from '../lib/enrich';
import { computePinyinTitle } from '../lib/pinyin';
import type { ServerState } from '../types';

// Shared helper: resolve folder parsed for structural folders
function resolveFolderParsed(anime: any) {
  const { parseFolderName } = require('../scanner') as typeof import('../scanner');
  let fp = parseFolderName(anime.folderName);
  const isStructural = !fp.cjkTitle && (!fp.title || /^(?:Season\s*\d+|S\d+|第\d+季)$/i.test(fp.title.trim()));
  const logger = require('../logger').child('[ROUTE]');
  logger.debug(`resolveFolderParsed: id="${anime.id}" folderName="${anime.folderName}" isStructural=${isStructural} season=${fp.season} cleanTitle="${fp.cleanTitle}"`);
  if (isStructural) {
    const leafSeason = fp.season;
    if (anime.folderPath) {
      const parentDir = path.basename(path.dirname(anime.folderPath));
      if (parentDir && parentDir !== '.') {
        const parentParsed = parseFolderName(parentDir);
        logger.debug(`resolveFolderParsed: parentDir="${parentDir}" parentSeason=${parentParsed.season} parentCleanTitle="${parentParsed.cleanTitle}"`);
        if (parentParsed.cjkTitle || parentParsed.cleanTitle) {
          fp = { ...parentParsed, season: leafSeason || parentParsed.season };
          logger.debug(`resolveFolderParsed: 使用父目录信息 → season=${fp.season} cleanTitle="${fp.cleanTitle}"`);
        }
      }
    }
    if (!fp.cjkTitle && !fp.cleanTitle) {
      const titleParsed = parseFolderName(anime.title);
      logger.debug(`resolveFolderParsed: 回退到 anime.title="${anime.title}" → season=${titleParsed.season} cleanTitle="${titleParsed.cleanTitle}"`);
      if (titleParsed.cjkTitle || titleParsed.cleanTitle) {
        fp = { ...titleParsed, season: leafSeason || titleParsed.season };
      }
    }
  }
  logger.debug(`resolveFolderParsed: 最终 → season=${fp.season} cleanTitle="${fp.cleanTitle}" cjkTitle="${fp.cjkTitle || ''}"`);
  return fp;
}

// 磁盘对账纯函数：对比磁盘视频与 DB episodes，标记缺失（读时计算、不持久化）、追加新集、更新 fileSize。
// 返回是否有需要落盘的变更（新增 / fileSize 变化）。missing 每次全量重算，防止内存对象旧值残留。
export function reconcileEpisodes(
  anime: any,
  diskVideos: { path: string; name: string; size: number }[]
): boolean {
  const { isExtraVideo } = require('../scanner') as typeof import('../scanner');
  const videos = diskVideos.filter((v) => !isExtraVideo(v.name));
  const episodes: any[] = anime.episodes || [];

  const diskByPath = new Map(videos.map((v) => [v.path, v]));
  let changed = false;

  // 全量重算 missing，并对比 fileSize（size 变化需要落盘）
  for (const e of episodes) {
    const disk = diskByPath.get(e.filePath);
    if (!disk) {
      e.missing = true;
    } else {
      e.missing = false;
      if (disk.size !== e.fileSize) {
        e.fileSize = disk.size;
        changed = true;
      }
    }
  }

  const existingPaths = new Set(episodes.map((e) => e.filePath));
  const newFiles = videos.filter((v) => !existingPaths.has(v.path));

  if (newFiles.length > 0) {
    // 以现有所有记录的 max number 为基准（防清理中间记录后撞唯一索引）
    const startNum = Math.max(0, ...episodes.map((e) => e.number)) + 1;
    for (let i = 0; i < newFiles.length; i++) {
      episodes.push({
        number: startNum + i,
        filePath: newFiles[i].path,
        fileName: newFiles[i].name,
        fileSize: newFiles[i].size,
        duration: null,
        watched: false,
        progress: 0,
      });
    }
    changed = true;
  }

  return changed;
}

// 编号空洞压缩：按当前 number 排序后重排为连续 1..N（watched/progress 跟随文件对象）。
// 用于删除残留空洞后的自动修正（删除时 + 进详情页读取时），返回 old→new 映射供 playSessions 同步。
export function renumberEpisodes(anime: any): { oldToNew: Map<number, number>; changed: boolean } {
  const oldToNew = new Map<number, number>();
  const episodes: any[] = anime.episodes || [];
  const sorted = episodes.slice().sort((a: any, b: any) => a.number - b.number);
  let changed = false;
  sorted.forEach((e: any, i: number) => {
    const next = i + 1;
    if (e.number !== next) changed = true;
    oldToNew.set(e.number, next);
    e.number = next;
  });
  return { oldToNew, changed };
}

// 重排后同步该番 playSessions 的集号引用（指向已删/空缺号的会话保留原值，continue-watching 自然回退）。
export function shiftPlaySessionsForRenumber(
  data: any,
  animeId: string,
  oldToNew: Map<number, number>
): boolean {
  let changed = false;
  for (const s of (data.playSessions || [])) {
    if (s.animeId !== animeId) continue;
    const next = oldToNew.get(s.episodeNumber);
    if (next !== undefined && next !== s.episodeNumber) {
      s.episodeNumber = next;
      changed = true;
    }
  }
  return changed;
}

export async function handleGetAnimeDetail(req: any, res: any, state: ServerState) {
  const { data, db, logger, config } = state;
  const t0 = Date.now();
  const debug = !!config.debugDetailFlow;
  const id = decodeURIComponent(req.url.slice('/api/anime/'.length));
  const anime = data.library.find((a: any) => a.id === id);
  if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }

  if (debug) {
    console.log(`[detail-open] ${JSON.stringify({ phase: 'enter', t0, id, hasLocalFiles: !!anime.folderPath && fs.existsSync(anime.folderPath) })}`);
  }

  // 检测文件存在性，不一致时写 DB（懒维护 downloaded 字段）
  const fileExists = !!anime.folderPath && fs.existsSync(anime.folderPath);
  if (anime.downloaded !== fileExists) {
    anime.downloaded = fileExists;
    db.saveLibrary(data, new Set([anime.id])).catch((e: any) => {
      logger.warn(`Failed to update downloaded for ${anime.title}: ${e.message}`);
    });
  }

  enrichAnime(anime, data);

  // 磁盘对账：缺失标记（读时计算）、追加新集、更新 fileSize
  if (anime.folderPath && fs.existsSync(anime.folderPath)) {
    const tScan = Date.now();
    try {
      const { findVideos, isExtraVideo } = require('../scanner') as typeof import('../scanner');
      const videos = await findVideos(anime.folderPath);
      const episodeFiles = videos.filter((v: any) => !isExtraVideo(v.name));
      if (reconcileEpisodes(anime, episodeFiles)) {
        db.saveLibrary(data, new Set([anime.id])).catch((e: any) => {
          logger.error('Failed to save episodes after local scan:', e.message);
        });
      }
    } catch (e: any) {
      logger.warn(`Local file scan failed for ${anime.title}: ${e.message}`);
    }
    if (debug) {
      console.log(`[detail-open] ${JSON.stringify({ phase: 'findVideos', id, ms: Date.now() - tScan })}`);
    }
  } else if ((anime.episodes || []).length > 0) {
    // 本地文件夹不存在（未下载/已删）：所有集一律标记缺失（读时计算，不落盘）
    for (const e of (anime.episodes as any[])) {
      if (!e.missing) e.missing = true;
    }
    // missing 是响应时派生字段，不需要 saveLibrary（无需落盘）
  }

  // 编号空洞自动修正：读详情页即自愈（历史删除/迁移残留的空洞 → 重排为连续 1..N 并落盘）。
  // 仅在有旧空洞时触发一次，之后编号连续不再重复落盘。
  const renum = renumberEpisodes(anime);
  if (renum.changed) {
    const sessionsChanged = shiftPlaySessionsForRenumber(data, anime.id, renum.oldToNew);
    db.saveLibrary(data, new Set([anime.id])).catch((e: any) => {
      logger.warn(`Failed to persist episode renumber for ${anime.title}: ${e.message}`);
    });
    if (sessionsChanged) {
      db.savePlaySessions(data).catch((e: any) => {
        logger.warn(`Failed to persist renumbered playSessions for ${anime.title}: ${e.message}`);
      });
    }
  }

  if (debug) {
    console.log(`[detail-open] ${JSON.stringify({ phase: 'send', id, totalMs: Date.now() - t0 })}`);
  }

  jsonResp(res, 200, anime);

  // 后台预生成缩略图（详情页查看时插队到队列最前）
  state.thumbnailQueue?.enqueue(anime, true);
}

export function handleDeleteAnime(req: any, res: any, state: ServerState) {
  const { data, db, logger } = state;
  const id = decodeURIComponent(req.url.slice('/api/anime/'.length));
  const idx = data.library.findIndex((a: any) => a.id === id);
  if (idx === -1) { jsonResp(res, 404, { error: 'Anime not found' }); return; }
  const removed = data.library.splice(idx, 1)[0];
  if (data.myList) {
    const myIdx = data.myList.findIndex((m: any) => m.animeId === id);
    if (myIdx !== -1) data.myList.splice(myIdx, 1);
  }
  const scannedNode = data.scannedTree && data.scannedTree.find(n => n.path === removed.folderPath);
  if (scannedNode) {
    scannedNode.alreadyImported = false;
    scannedNode.bangumiMatched = false;
    scannedNode.bangumiId = null;
    scannedNode.bangumiTitle = null;
    scannedNode.bangumiTitleJp = null;
    scannedNode.bangumiTitleEn = null;
    scannedNode.summary = null;
    scannedNode.localCover = null;
    scannedNode.rating = null;
    scannedNode.metadataSource = null;
  }
  Promise.all([db.saveLibrary(data, new Set()), db.saveMyList(data), saveScannedTree(data.scannedTree)])
    .then(() => jsonResp(res, 200, { ok: true }))
    .catch(e => { logger.error('Delete save error:', e); jsonResp(res, 500, { error: 'Failed to persist' }); });
}

// GET /api/anime/:id/sessions is in stats.js

// DELETE /api/anime/:id/episode/:number — 手动清理缺失/残留集
export async function handleDeleteEpisode(req: any, res: any, state: ServerState) {
  const { data, db } = state;
  const m = req.url.match(/\/api\/anime\/(.+?)\/episode\/(\d+)/);
  if (!m) { jsonResp(res, 400, { error: 'Invalid URL' }); return; }
  const id = decodeURIComponent(m[1]);
  const episodeNumber = parseInt(m[2], 10);
  const anime = data.library.find((a: any) => a.id === id);
  if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }
  if (!(anime.episodes || []).some((e: any) => e.number === episodeNumber)) {
    jsonResp(res, 404, { error: 'Episode not found' }); return;
  }
  try {
    const removedNumber = episodeNumber;
    anime.episodes = (anime.episodes || []).filter((e: any) => e.number !== removedNumber);
    // 重排：删除后按现有顺序重新编号，保持 1..N 连续（填补空洞，集号跟随文件而非旧编号）
    const renum = renumberEpisodes(anime);
    // 同步该番播放会话的集号，避免 continue-watching 指向不存在的集号
    const sessionsChanged = shiftPlaySessionsForRenumber(data, anime.id, renum.oldToNew);
    await db.saveLibrary(data, new Set([anime.id]));
    if (sessionsChanged) await db.savePlaySessions(data);
    jsonResp(res, 200, anime);
  } catch (e: any) {
    jsonResp(res, 500, { error: e.message });
  }
}

export function handleLibrarySyncStream(req: any, res: any, state: ServerState) {
  const { data, config, db, logger, cancelledSyncSessions } = state;
  // OPTIONS for mmCanStream probe
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }
  if (req.method !== 'GET') { jsonResp(res, 405, { error: 'Method not allowed' }); return; }
  const params = new URL(req.url, 'http://localhost').searchParams;
  let animeIds;
  try { animeIds = JSON.parse(params.get('ids') || '[]'); } catch { jsonResp(res, 400, { error: 'Invalid ids parameter' }); return; }
  if (!Array.isArray(animeIds) || animeIds.length === 0) { jsonResp(res, 400, { error: 'animeIds array is required' }); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (event: string, obj: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
  const sessionId = crypto.randomUUID();
  cancelledSyncSessions.set(sessionId, false);
  res.on('close', () => { cancelledSyncSessions.set(sessionId, true); });

  (async () => {
    const { registry, matchSeason, parallelMap, pickBestBySimilarity, isPrimarilyRomaji, sorensenDice } = require('../scrapers') as any;
    const coverDir = path.join(DATA_DIR, 'covers');
    const bannerDir = path.join(DATA_DIR, 'banners');
    const toSync = [];
    for (const animeId of animeIds) {
      if (cancelledSyncSessions.get(sessionId) || res.writableEnded) { send('cancelled', { ok: true }); break; }
      const anime = data.library.find((a: any) => a.id === animeId);
      if (!anime) { send('progress', { animeId, success: false, error: 'Anime not found' }); continue; }
      toSync.push({ animeId, anime });
    }
    let processed = 0;
    const syncedIds = new Set();
    await parallelMap(toSync, async ({ animeId, anime }: any) => {
      if (cancelledSyncSessions.get(sessionId) || res.writableEnded) return;
      try {
        const folderParsed = resolveFolderParsed(anime);
        const videoCount = anime.episodes?.length || 0;
        let timedOut = false;
        const itemPromise = (async () => {
          const baseName = folderParsed.cleanTitle || folderParsed.cjkTitle || anime.folderName || anime.title || '未知';
          let meta: any, matchedSeason: any, match: any;
          // 已知 bangumiId 跳过搜索，直接取元数据
          if (anime.bangumiId) {
            send('matching', { animeId, searchTerm: baseName });
            meta = await registry.fetchMetadata('bangumi', folderParsed.cleanTitle, coverDir, anime.bangumiId, config);
            if (timedOut) return;
            if (!meta) { send('progress', { animeId, success: false, error: '获取元数据失败' }); return; }
          } else {
            const searchTerm = folderParsed.season ? `${baseName} (S${folderParsed.season})` : baseName;
            send('matching', { animeId, searchTerm });
            match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
            if (timedOut) return;
            if (!match) { send('progress', { animeId, success: false, error: '未找到匹配结果' }); return; }
            send('fetching', { animeId, matchSource: match.source || 'unknown', matchTitle: match.title || match.name || '' });
            meta = await registry.fetchMetadata(match.source, folderParsed.cleanTitle, coverDir, match.id, config, match._detail);
            if (timedOut) return;
            if (!meta) { send('progress', { animeId, success: false, error: '获取元数据失败' }); return; }
            matchedSeason = match.matchedSeason;
          }
          if (timedOut) return;
          Object.assign(anime, meta);
          // 改名后重算 pinyinTitle（bangumiTitle 可能变化，旧值过期）
          anime.pinyinTitle = computePinyinTitle(anime.bangumiTitle || anime.title || '');
        // Cover resize removed — browser handles display scaling
          if (matchedSeason != null) anime.matchedSeason = matchedSeason;
          // 从 matchSeason 直存 anilistId（罗马音走 AniList 桥）
          // banner 不在此阶段设置——统一由收尾阶段 batchGetDetails 批量查询下载
          if (match && match.anilistId) {
            anime.anilistId = match.anilistId;
            if (match.anilistTitleEn) anime.anilistTitleEn = match.anilistTitleEn;
          }
          // 仍无 anilistId → 用 Bangumi 日文原名搜 AniList 拿 anilistId（banner 由收尾阶段统一批量下载）
          if (!anime.anilistId || anime.anilistId === -1) {
            try {
              const anilist = registry.get('anilist');
              if (anilist && anilist.enabled(config)) {
                const source = config.apiSources?.find((s: any) => s.type === 'anilist');
                const searchTerm = anime.bangumiTitleJp || anime.folderName || folderParsed.cleanTitle;
                if (searchTerm) {
                  send('fetching', { animeId, searchTerm, matchSource: 'anilist', matchTitle: '' });
                  const results = await anilist.search(searchTerm, source);
                  if (results && results.length > 0) {
                    const bestMatch = pickBestBySimilarity(searchTerm, results);
                    if (bestMatch.item && bestMatch.score >= 0.5) {
                      const bestItem = bestMatch.item;
                      anime.anilistId = bestItem.id;
                      // banner 不在此阶段设置——统一由收尾阶段 batchGetDetails 批量查询下载
                      if (bestItem.title_english) anime.anilistTitleEn = bestItem.title_english;
                    }
                  }
                }
              }
            } catch (e: any) {
              logger.error(`AniList search failed for ${animeId}: ${e.message}`);
            }
          }
          // 匹配后仍无 matchedSeason → 尝试用新解析的 anilistId 推算季度
          if (matchedSeason == null && anime.anilistId && anime.anilistId !== -1) {
            try {
              send('fetching', { animeId, searchTerm: '', matchSource: 'season', matchTitle: '' });
              const { findSeasonByAnilistId } = require('../scrapers') as any;
              const resolved = await findSeasonByAnilistId(registry, folderParsed.cleanTitle || folderParsed.title, anime.anilistId, config);
              if (resolved) {
                matchedSeason = resolved;
                anime.matchedSeason = resolved;
              }
            } catch (e: any) {
              logger.warn(`AniList season resolution failed for ${animeId}: ${e.message}`);
            }
          }
          if (timedOut) return;
          send('progress', { animeId, success: true, meta, matchedSeason });
          if (anime.anilistId === -1) anime.anilistId = null;
        })();
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('处理超时')), 60000));
        await Promise.race([itemPromise, timeout]);
        timedOut = true;
      } catch (e: any) {
        send('progress', { animeId, success: false, error: e.message });
      }
      processed++;
      syncedIds.add(animeId);
      if (processed % 5 === 0) await Promise.all([db.saveLibrary(data, syncedIds), saveScannedTree(data.scannedTree)]);
    }, 5);

    // 通知前端进入收尾阶段（banner 获取等）
    send('finalizing', { message: '正在获取封面横幅…' });

    // 批量补全缺 banner/tags 的条目（统一入口 ensureMetadataBatch，一次 `id_in` 查询最多 50 条）
    const { ensureMetadataBatch } = require('../scrapers') as any;
    // 只补本次同步的条目（syncedIds），避免修改全库却只落盘本次导致非本次修改丢失
    const needDetail = data.library.filter((a: any) => syncedIds.has(a.id) && a.anilistId && a.anilistId !== -1 && ((!a.anilistBanner && a.anilistBanner !== '__none__') || !a.anilistTags));
    if (needDetail.length > 0) {
      await ensureMetadataBatch(needDetail, config, { coverDir, bannerDir });
    }

    await Promise.all([db.saveLibrary(data, syncedIds), saveScannedTree(data.scannedTree)]);
    const { registry: reg } = require('../scrapers') as any;
    reg.clearSearchCache();
    cancelledSyncSessions.delete(sessionId);
    send('done', { ok: true });
    res.end();
    // 后台生成缩略图
    for (const { anime } of toSync) {
      state.thumbnailQueue?.enqueue(anime);
    }
  })();
}
