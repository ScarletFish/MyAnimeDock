// server/routes/library.js — 资料库、详情、批量元数据同步
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { jsonResp, readBody, serveImage } = require('../lib/utils');
const { saveScannedTree, DATA_DIR } = require('../lib/config');

// Shared helper: resolve folder parsed for structural folders
function resolveFolderParsed(anime) {
  const { parseFolderName } = require('../scanner');
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

/**
 * POST /api/library/sync-anilist-backfill
 * 为所有缺 anilistId 的已有库条目回填 AniList 元数据。
 * 每处理 5 部落盘一次，返回处理结果统计。
 */
async function runAnilistBackfill(state) {
  const { data, config, db, logger } = state;
  const { syncAnilist, parallelMap } = require('../scrapers');
  const bannerDir = path.join(DATA_DIR, 'banners');
  const coverDir = path.join(DATA_DIR, 'covers');

  const candidates = data.library.filter(a => a.anilistId == null && a.anilistId !== -1);

  logger.info(`AniList backfill: ${candidates.length} candidates`);

  const results = await parallelMap(candidates, async (anime) => {
    try {
      const result = await syncAnilist(anime, config, bannerDir, coverDir);
      if (result) {
        logger.info(`Backfill: ${anime.title} → anilistId=${result.anilistId}`);
        return 'succeeded';
      } else {
        return 'skipped';
      }
    } catch (e) {
      logger.error(`Backfill: ${anime.title} → ${e.message}`);
      return 'failed';
    }
  }, 2);

  const backfillIds = new Set(candidates.map(a => a.id));
  await db.saveLibrary(data, backfillIds);

  const succeeded = results.filter(r => r === 'succeeded').length;
  const skipped = results.filter(r => r === 'skipped').length;
  const failed = results.filter(r => r === 'failed').length;
  return { total: candidates.length, succeeded, failed, skipped };
}

module.exports = {
  handleGetLibrary(req, res, state) {
    const { data, config, logger } = state;
    // Compute pinyin for each anime
    const pinyinModule = require('pinyin');
    const pinyinFn = pinyinModule.pinyin || pinyinModule.default || pinyinModule;
    data.library.forEach(a => {
      const name = a.bangumiTitle || a.title || '';
      try {
        a.pinyinTitle = pinyinFn(name).map(p => (p[0] || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')).join('');
      } catch (_) {
        a.pinyinTitle = '';
      }
      const myItem = (data.myList || []).find(m => m.animeId === a.id);
      a.myListStatus = myItem ? myItem.status : null;
      // Derive last played episode from play sessions (no DB field needed)
      const animeSessions = (data.playSessions || [])
        .filter(s => s.animeId === a.id)
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
      if (animeSessions.length > 0) {
        a.lastPlayedEp = animeSessions[0].episodeNumber;
        a.lastPlayedAt = animeSessions[0].startTime;
      }
    });
    jsonResp(res, 200, data.library.filter(a => a.downloaded !== false));
  },

  handleGetAnimeDetail(req, res, state) {
    const { data, config, logger } = state;
    const id = decodeURIComponent(req.url.slice('/api/anime/'.length));
    const anime = data.library.find(a => a.id === id);
    if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }
    anime.downloaded = fs.existsSync(anime.folderPath);
    if (anime.summary) {
      const { truncateSummary } = require('../scrapers/bangumi');
      anime.summary = truncateSummary(anime.summary);
    }
    // Derive last played episode from play sessions
    const animeSessions = (data.playSessions || [])
      .filter(s => s.animeId === id)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    if (animeSessions.length > 0) {
      anime.lastPlayedEp = animeSessions[0].episodeNumber;
      anime.lastPlayedAt = animeSessions[0].startTime;
    }
    jsonResp(res, 200, anime);

    // 后台预生成缩略图（详情页查看时插队到队列最前）
    state.thumbnailQueue?.enqueue(anime, true);

    // 懒加载 banner：已有 anilistId 但缺 banner 时异步补全（不阻塞响应）
    // 仅针对有 anilistId 的条目 —— SSE 同步和 handleBangumiFetch 已处理 AniList 解析
    // 跳过已确认无横幅的条目（anilistBanner === '__none__'）
    if (anime.anilistId && anime.anilistId !== -1 && anime.anilistBanner !== '__none__' && (!anime.anilistBanner || anime.anilistBanner.startsWith('http'))) {
      const { syncAnilistDetail } = require('../scrapers');
      const bannerDir = path.join(DATA_DIR, 'banners');
      const coverDir = path.join(DATA_DIR, 'covers');
      syncAnilistDetail(anime, config, bannerDir, coverDir).then(result => {
        if (result) {
          const { db } = state;
          db.updateAnime(anime.id, { anilistBanner: anime.anilistBanner ?? null, anilistTitleEn: anime.anilistTitleEn ?? null });
        }
      }).catch(e => logger.warn(`Detail lazy banner failed for ${id}: ${e.message}`));
    }
  },

  handleDeleteAnime(req, res, state) {
    const { data, db, logger } = state;
    const id = decodeURIComponent(req.url.slice('/api/anime/'.length));
    const idx = data.library.findIndex(a => a.id === id);
    if (idx === -1) { jsonResp(res, 404, { error: 'Anime not found' }); return; }
    const removed = data.library.splice(idx, 1)[0];
    if (data.myList) {
      const myIdx = data.myList.findIndex(m => m.animeId === id);
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
      scannedNode.coverUrl = null;
      scannedNode.localCover = null;
      scannedNode.rating = null;
      scannedNode.metadataSource = null;
    }
    Promise.all([db.saveLibrary(data, new Set()), db.saveMyList(data), saveScannedTree(data.scannedTree)])
      .then(() => jsonResp(res, 200, { ok: true }))
      .catch(e => { logger.error('Delete save error:', e); jsonResp(res, 500, { error: 'Failed to persist' }); });
  },

  // GET /api/anime/:id/sessions is in stats.js

  handleLibrarySyncStream(req, res, state) {
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
    const send = (event, obj) => res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
    const sessionId = crypto.randomUUID();
    cancelledSyncSessions.set(sessionId, false);
    res.on('close', () => { cancelledSyncSessions.set(sessionId, true); });

    (async () => {
      const { registry, matchSeason, parallelMap, pickBestBySimilarity, isPrimarilyRomaji, sorensenDice } = require('../scrapers');
      const coverDir = path.join(DATA_DIR, 'covers');
      const bannerDir = path.join(DATA_DIR, 'banners');
      const toSync = [];
      for (const animeId of animeIds) {
        if (cancelledSyncSessions.get(sessionId) || res.writableEnded) { send('cancelled', { ok: true }); break; }
        const anime = data.library.find(a => a.id === animeId);
        if (!anime) { send('progress', { animeId, success: false, error: 'Anime not found' }); continue; }
        toSync.push({ animeId, anime });
      }
      let processed = 0;
      const syncedIds = new Set();
      await parallelMap(toSync, async ({ animeId, anime }) => {
        if (cancelledSyncSessions.get(sessionId) || res.writableEnded) return;
        try {
          const folderParsed = resolveFolderParsed(anime);
          const videoCount = anime.episodes?.length || 0;
          let timedOut = false;
          const itemPromise = (async () => {
            const baseName = folderParsed.cleanTitle || folderParsed.cjkTitle || anime.folderName || anime.title || '未知';
            let meta, matchedSeason, match;
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
          // Cover resize removed — browser handles display scaling
            if (matchedSeason != null) anime.matchedSeason = matchedSeason;
            // 从 matchSeason 直存 anilistId（罗马音走 AniList 桥）
            if (match && match.anilistId) {
              anime.anilistId = match.anilistId;
              if (match.anilistBanner) anime.anilistBanner = match.anilistBanner;
              if (match.anilistTitleEn) anime.anilistTitleEn = match.anilistTitleEn;
            }
            // 仍无 anilistId → 用 Bangumi 日文原名搜 AniList 拿 banner
            if (!anime.anilistId || anime.anilistId === -1) {
              try {
                const anilist = registry.get('anilist');
                if (anilist && anilist.enabled(config)) {
                  const source = config.apiSources?.find(s => s.type === 'anilist');
                  const searchTerm = anime.bangumiTitleJp || anime.folderName || folderParsed.cleanTitle;
                  if (searchTerm) {
                    send('fetching', { animeId, searchTerm, matchSource: 'anilist', matchTitle: '' });
                    const results = await anilist.search(searchTerm, source);
                    if (results && results.length > 0) {
                      const bestMatch = pickBestBySimilarity(searchTerm, results);
                      if (bestMatch.item && bestMatch.score >= 0.5) {
                        const bestItem = bestMatch.item;
                        anime.anilistId = bestItem.id;
                        if (bestItem.bannerImage) anime.anilistBanner = bestItem.bannerImage;
                        if (bestItem.title_english) anime.anilistTitleEn = bestItem.title_english;
                      }
                    }
                  }
                }
              } catch (e) {
                logger.error(`AniList search failed for ${animeId}: ${e.message}`);
              }
            }
            // 匹配后仍无 matchedSeason → 尝试用新解析的 anilistId 推算季度
            if (matchedSeason == null && anime.anilistId && anime.anilistId !== -1) {
              try {
                send('fetching', { animeId, searchTerm: '', matchSource: 'season', matchTitle: '' });
                const { findSeasonByAnilistId } = require('../scrapers');
                const resolved = await findSeasonByAnilistId(registry, folderParsed.cleanTitle || folderParsed.title, anime.anilistId, config);
                if (resolved) {
                  matchedSeason = resolved;
                  anime.matchedSeason = resolved;
                }
              } catch (e) {
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
        } catch (e) {
          send('progress', { animeId, success: false, error: e.message });
        }
        processed++;
        syncedIds.add(animeId);
        if (processed % 5 === 0) await Promise.all([db.saveLibrary(data, syncedIds), saveScannedTree(data.scannedTree)]);
      }, 5);

      // 通知前端进入收尾阶段（banner 获取等）
      send('finalizing', { message: '正在获取封面横幅…' });

      // 批量补全缺 banner 的条目（一次 `id_in` 查询处理最多 50 条，代替 N 次独立 DETAIL_QUERY）
      const anilistScraper = registry.get('anilist');
      const needBanner = data.library.filter(a => a.anilistId && a.anilistId !== -1 && !a.anilistBanner && a.anilistBanner !== '__none__');
      if (needBanner.length > 0 && anilistScraper) {
        const ids = [...new Set(needBanner.map(a => a.anilistId))];
        logger.info(`Batch AniList detail: ${ids.length} ids (${needBanner.length} items)`);
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50);
          try {
            const results = await anilistScraper.batchGetDetails(chunk);
            for (const media of results) {
              const matches = needBanner.filter(a => a.anilistId === media.id);
              for (const anime of matches) {
                if (media.bannerImage) {
                  anime.anilistBanner = media.bannerImage;
                  try {
                    const localPath = await anilistScraper.downloadBanner(media.bannerImage, bannerDir, media.id);
                    if (localPath) anime.anilistBanner = localPath;
                  } catch (_) {}
                } else {
                  anime.anilistBanner = '__none__'; // 标记为"已确认无横幅"，避免重复查询
                }
                if (media.title?.english) anime.anilistTitleEn = media.title.english;
              }
            }
          } catch (e) {
            logger.error('Batch AniList detail failed: ' + e.message);
          }
        }
      }

      await Promise.all([db.saveLibrary(data, syncedIds), saveScannedTree(data.scannedTree)]);
      const { registry: reg } = require('../scrapers');
      reg.clearSearchCache();
      cancelledSyncSessions.delete(sessionId);
      send('done', { ok: true });
      res.end();
      // 后台生成缩略图
      for (const { anime } of toSync) {
        state.thumbnailQueue?.enqueue(anime);
      }
    })();
  },

  async handleAnilistBackfill(req, res, state) {
    try {
      const result = await runAnilistBackfill(state);
      jsonResp(res, 200, result);
    } catch (e) {
      jsonResp(res, 500, { error: e.message });
    }
  },
};
