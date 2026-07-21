// server/routes/bangumi.js — Bangumi 搜索、同步、OAuth 路由
const path = require('path');
const { jsonResp, readBody } = require('../lib/utils');
const { saveConfig, DATA_DIR } = require('../lib/config');
const { syncAnilist } = require('../scrapers');

module.exports = {
  async handleBangumiSearch(req, res, state) {
    const { data, config, logger } = state;
    try {
      const body = await readBody(req);
      let { keyword } = JSON.parse(body);
      if (!keyword) { jsonResp(res, 400, { error: 'keyword is required' }); return; }
      keyword = keyword.replace(/[~～]/g, '').trim();
      const { registry, searchViaAniList } = require('../scrapers');
      let results = await registry.searchAll(keyword, config);
      results = results.filter(r => r.source !== 'anilist');
      // Bangumi 直搜无结果时，走 AniList 桥接反查日文名（与批量匹配路径一致）
      if (results.length === 0) {
        const bangumi = registry.get('bangumi');
        if (bangumi) {
          const bridge = await searchViaAniList(registry, bangumi, keyword, config);
          results = bridge.bangumiResults;
        }
      }
      jsonResp(res, 200, { results });
    } catch (e) {
      jsonResp(res, 500, { error: e.message });
    }
  },

  async handleBangumiFetch(req, res, state) {
    const { data, config, db, bangumiSync, logger } = state;
    try {
      const body = await readBody(req);
      let { animeId, subjectId, source = 'bangumi' } = JSON.parse(body);
      if (!animeId) { jsonResp(res, 400, { error: 'animeId is required' }); return; }
      const anime = data.library.find(a => a.id === animeId);
      if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }
      const { registry, matchSeason } = require('../scrapers');
      const { parseFolderName } = require('../scanner');
      const coverDir = path.join(DATA_DIR, 'covers');
      let matchInfo = null;
      if (!subjectId) {
        const folderParsed = parseFolderName(anime.folderName);
        const videoCount = anime.episodes?.length || 0;
        const match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
        if (!match) {
          const results = (await registry.searchAll(anime.title, config)).filter(r => r.source !== 'anilist');
          if (results.length === 0) { jsonResp(res, 404, { error: '未找到匹配结果' }); return; }
          jsonResp(res, 200, { results, animeId: anime.id });
          return;
        }
        subjectId = match.id;
        source = match.source;
        matchInfo = match;
      }
      const meta = await registry.fetchMetadata(source, anime.title, coverDir, subjectId, config);
      if (!meta) { jsonResp(res, 404, { error: '获取元数据失败' }); return; }
      const hadBangumiId = !!anime.bangumiId;
      Object.assign(anime, meta);
      if (matchInfo) {
        if (matchInfo.matchedSeason != null) anime.matchedSeason = matchInfo.matchedSeason;
        if (matchInfo.anilistId) anime.anilistId = matchInfo.anilistId;
      }
      // AniList 双源同步（手动同步时重置 -1 重新搜索）
      const bannerDir = path.join(DATA_DIR, 'banners');
      if (anime.anilistId === -1) anime.anilistId = null;
      try {
        await syncAnilist(anime, config, bannerDir, coverDir);
      } catch (e) {
        logger.error('AniList sync failed: ' + e.message);
      }
      if (!hadBangumiId && anime.bangumiId) {
        bangumiSync.pushStatusChange(anime.id, data);
      }
      const { saveScannedTree } = require('../lib/config');
      await Promise.all([db.saveLibrary(data), saveScannedTree(data.scannedTree)]);
      jsonResp(res, 200, { ok: true, anime });
    } catch (e) {
      jsonResp(res, 500, { error: e.message });
    }
  },

  async handleBangumiSync(req, res, state) {
    const { data, config, db, bangumiSync, logger } = state;
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const result = await bangumiSync.syncMyList(data, { dryRun: parsed.dryRun });
      if (result.lastSyncTime) {
        config.bangumiLastSync = result.lastSyncTime;
        saveConfig(config);
      }
      if (result.created > 0 || result.wishlistAdded > 0) db.saveMyList(data);
      jsonResp(res, 200, result);
    } catch (e) {
      jsonResp(res, 400, { error: e.message });
    }
  },

  // --- Bangumi OAuth routes ---
  handleBangumiAuthStatus(req, res, state) {
    const { bangumiPersonal, config } = state;
    jsonResp(res, 200, { ...bangumiPersonal.getState(), lastSyncTime: config.bangumiLastSync || null });
  },

  handleBangumiAuthUrl(req, res, state) {
    const { bangumiPersonal } = state;
    const url = bangumiPersonal.generateAuthUrl();
    jsonResp(res, 200, { url });
  },

  handleBangumiAuthCallback(req, res, state) {
    const { bangumiPersonal, config, logger } = state;
    const params = new URL(req.url, 'http://localhost').searchParams;
    const code = params.get('code');
    if (!code) {
      const deniedHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>\u6388\u6743\u5df2\u62d2\u7edd</title><style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;text-align:center}.msg{max-width:400px;padding:2rem}h2{margin:0 0 .5rem;color:#f59e0b}p{margin:0;color:#a0a0a0;font-size:.9rem}</style></head><body><div class="msg"><h2>\u2717 \u6388\u6743\u5df2\u62d2\u7edd</h2><p>\u6b64\u9875\u9762\u53ef\u4ee5\u5173\u95ed\uff0c\u8bf7\u8fd4\u56de\u5e94\u7528\u3002</p></div><script>window.close()</script></body></html>';
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(deniedHtml)
      });
      res.end(deniedHtml);
      return;
    }
    bangumiPersonal.exchangeCode(code).then(state => {
      saveConfig(config);
      const closeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>\u6388\u6743\u5b8c\u6210</title><style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;text-align:center}.msg{max-width:400px;padding:2rem}h2{margin:0 0 .5rem;color:#22c55e}p{margin:0;color:#a0a0a0;font-size:.9rem}</style></head><body><div class="msg"><h2>\u2713 \u6388\u6743\u5b8c\u6210</h2><p>\u6b64\u9875\u9762\u53ef\u4ee5\u5173\u95ed\uff0c\u8bf7\u8fd4\u56de\u5e94\u7528\u7ee7\u7eed\u64cd\u4f5c\u3002</p></div><script>window.close()</script></body></html>';
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(closeHtml)
      });
      res.end(closeHtml);
    }).catch(e => {
      logger.error('Bangumi OAuth callback error:', e.message);
      const errMsg = (e.message || '\u67e5\u770b\u63a7\u5236\u53f0\u8f93\u51fa').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c]);
      const closeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>\u6388\u6743\u5931\u8d25</title><style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;text-align:center}.msg{max-width:400px;padding:2rem}h2{margin:0 0 .5rem;color:#ef4444}p{margin:0;color:#a0a0a0;font-size:.9rem}</style></head><body><div class="msg"><h2>\u2717 \u6388\u6743\u5931\u8d25</h2><p>' + errMsg + '</p></div><script>window.close()</script></body></html>';
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(closeHtml)
      });
      res.end(closeHtml);
    });
  },

  handleBangumiAuthLogout(req, res, state) {
    const { bangumiPersonal } = state;
    bangumiPersonal.clearAuth();
    jsonResp(res, 200, { ok: true });
  },

  async handleBangumiAuthCreds(req, res, state) {
    const { bangumiPersonal, config } = state;
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      if (parsed.clientId !== undefined && parsed.clientSecret !== undefined) {
        bangumiPersonal.setCredentials(parsed.clientId, parsed.clientSecret);
        config.bangumiClientId = parsed.clientId;
        config.bangumiClientSecret = parsed.clientSecret;
        saveConfig(config);
      }
      jsonResp(res, 200, bangumiPersonal.getState());
    } catch (e) {
      jsonResp(res, 400, { error: e.message });
    }
  },

  handleBangumiMe(req, res, state) {
    const { bangumiPersonal } = state;
    if (!bangumiPersonal.isAuthed()) {
      jsonResp(res, 401, { error: 'Not authenticated' });
      return;
    }
    bangumiPersonal.getMe().then(me => jsonResp(res, 200, me)).catch(e => jsonResp(res, 500, { error: e.message }));
  },
};
