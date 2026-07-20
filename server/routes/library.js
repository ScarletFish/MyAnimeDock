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

  await db.saveLibrary(data);

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
    jsonResp(res, 200, anime);

    // 后台预生成缩略图（详情页查看时插队到队列最前）
    state.thumbnailQueue?.enqueue(anime, true);

    // 懒加载 banner：anilistId 有但 banner 缺失时异步补全（不阻塞响应）
    if (anime.anilistId && anime.anilistId !== -1 && !anime.anilistBanner) {
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
    Promise.all([db.saveLibrary(data), db.saveMyList(data), saveScannedTree(data.scannedTree)])
      .then(() => jsonResp(res, 200, { ok: true }))
      .catch(e => { logger.error('Delete save error:', e); jsonResp(res, 500, { error: 'Failed to persist' }); });
  },

  // GET /api/anime/:id/sessions is in stats.js

  async handleLibrarySync(req, res, state) {
    const { data, config, db, logger } = state;
    try {
      const body = await readBody(req);
      const { animeIds } = JSON.parse(body);
      if (!Array.isArray(animeIds) || animeIds.length === 0) {
        jsonResp(res, 400, { error: 'animeIds array is required' });
        return;
      }
      const { registry, matchSeason, parallelMap } = require('../scrapers');
      const coverDir = path.join(DATA_DIR, 'covers');
      const toSync = [];
      const results = [];
      for (const animeId of animeIds) {
        const anime = data.library.find(a => a.id === animeId);
        if (!anime) { results.push({ animeId, success: false, error: 'Anime not found' }); continue; }
        toSync.push({ animeId, anime });
      }
      const syncResults = await parallelMap(toSync, async ({ animeId, anime }) => {
        try {
          const folderParsed = resolveFolderParsed(anime);
          const videoCount = anime.episodes?.length || 0;
          let meta, matchedSeason;
          // 已知 bangumiId 跳过搜索，直接取元数据
          if (anime.bangumiId) {
            meta = await registry.fetchMetadata('bangumi', folderParsed.cleanTitle, coverDir, anime.bangumiId, config);
            if (!meta) return { animeId, success: false, error: '获取元数据失败' };
          } else {
            const match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
            if (!match) return { animeId, success: false, error: '未找到匹配结果' };
            meta = await registry.fetchMetadata(match.source, folderParsed.cleanTitle, coverDir, match.id, config, match._detail);
            if (!meta) return { animeId, success: false, error: '获取元数据失败' };
            matchedSeason = match.matchedSeason;
          }
          Object.assign(anime, meta);
            // Cover resize removed — browser handles display scaling
          if (matchedSeason != null) anime.matchedSeason = matchedSeason;
          return { animeId, success: true, meta, matchedSeason };
        } catch (e) {
          return { animeId, success: false, error: e.message };
        }
      }, 2);
      results.push(...syncResults);
      await Promise.all([db.saveLibrary(data), saveScannedTree(data.scannedTree)]);
      const { registry: reg } = require('../scrapers');
      reg.clearSearchCache();
      jsonResp(res, 200, { ok: true, results });
      // 后台生成缩略图
      for (const r of results) {
        if (r.success) {
          const anime = data.library.find(a => a.id === r.animeId);
          if (anime) state.thumbnailQueue?.enqueue(anime);
        }
      }
    } catch (e) {
      jsonResp(res, 500, { error: e.message });
    }
  },

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
      const { registry, matchSeason, parallelMap, syncAnilist } = require('../scrapers');
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
      await parallelMap(toSync, async ({ animeId, anime }) => {
        if (cancelledSyncSessions.get(sessionId) || res.writableEnded) return;
        try {
          const folderParsed = resolveFolderParsed(anime);
          const videoCount = anime.episodes?.length || 0;
          let timedOut = false;
          const itemPromise = (async () => {
            const baseName = folderParsed.cleanTitle || folderParsed.cjkTitle || anime.folderName || anime.title || '未知';
            let meta, matchedSeason;
            // 已知 bangumiId 跳过搜索，直接取元数据
            if (anime.bangumiId) {
              send('matching', { animeId, searchTerm: baseName });
              meta = await registry.fetchMetadata('bangumi', folderParsed.cleanTitle, coverDir, anime.bangumiId, config);
              if (timedOut) return;
              if (!meta) { send('progress', { animeId, success: false, error: '获取元数据失败' }); return; }
            } else {
              const searchTerm = folderParsed.season ? `${baseName} (S${folderParsed.season})` : baseName;
              send('matching', { animeId, searchTerm });
              const match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
              if (timedOut) return;
              if (!match) { send('progress', { animeId, success: false, error: '未找到匹配结果' }); return; }
              send('fetching', { animeId, matchSource: match.source || 'unknown', matchTitle: match.title || match.name || '' });
              meta = await registry.fetchMetadata(match.source, folderParsed.cleanTitle, coverDir, match.id, config, match._detail);
              if (timedOut) return;
              if (!meta) { send('progress', { animeId, success: false, error: '获取元数据失败' }); return; }
              matchedSeason = match.matchedSeason;
            }
            Object.assign(anime, meta);
          // Cover resize removed — browser handles display scaling
            if (matchedSeason != null) anime.matchedSeason = matchedSeason;
            send('progress', { animeId, success: true, meta, matchedSeason });
            // 拉取 AniList banner，完成后落盘（不阻塞 progress 事件，但确保 done 前 banner 就绪）
            if (anime.anilistId === -1) anime.anilistId = null;
            try {
              await syncAnilist(anime, config, bannerDir, coverDir);
            } catch (e) {
              logger.error('AniList sync failed: ' + e.message);
            }
          })();
          const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('处理超时')), 60000));
          await Promise.race([itemPromise, timeout]);
          timedOut = true;
        } catch (e) {
          send('progress', { animeId, success: false, error: e.message });
        }
        processed++;
        if (processed % 5 === 0) await Promise.all([db.saveLibrary(data), saveScannedTree(data.scannedTree)]);
      }, 2);

      await Promise.all([db.saveLibrary(data), saveScannedTree(data.scannedTree)]);
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
