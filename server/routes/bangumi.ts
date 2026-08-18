// server/routes/bangumi.ts — Bangumi 搜索、同步、OAuth 路由
import path from 'path';
import { jsonResp, readBody } from '../lib/utils';
import { saveConfig, DATA_DIR } from '../lib/config';
import { ensureMetadata } from '../scrapers';
import type { ServerState } from '../types';

type State = ServerState;

async function handleBangumiSearch(req: any, res: any, state: State) {
  const { data, config, logger } = state;
  try {
    const body = await readBody(req);
    let { keyword } = JSON.parse(body);
    if (!keyword) { jsonResp(res, 400, { error: 'keyword is required' }); return; }
    keyword = keyword.replace(/[~～]/g, '').trim();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registry, searchViaAniList } = require('../scrapers') as any;
    let results = await registry.searchAll(keyword, config);
    results = results.filter((r: any) => r.source !== 'anilist');
    // Bangumi 直搜无结果时，走 AniList 桥接反查日文名（与批量匹配路径一致）
    if (results.length === 0) {
      const bangumi = registry.get('bangumi');
      if (bangumi) {
        const bridge = await searchViaAniList(registry, bangumi, keyword, config);
        results = bridge.bangumiResults;
      }
    }
    jsonResp(res, 200, { results });
  } catch (e: any) {
    jsonResp(res, 500, { error: e.message });
  }
}

async function handleBangumiFetch(req: any, res: any, state: State) {
  const { data, config, db, bangumiSync, logger } = state;
  try {
    const body = await readBody(req);
    let { animeId, subjectId, source = 'bangumi' } = JSON.parse(body);
    if (!animeId) { jsonResp(res, 400, { error: 'animeId is required' }); return; }
    const anime = data.library.find((a: any) => a.id === animeId);
    if (!anime) { jsonResp(res, 404, { error: 'Anime not found' }); return; }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registry, matchSeason, pickBestBySimilarity } = require('../scrapers') as any;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseFolderName } = require('../scanner') as any;
    const coverDir = path.join(DATA_DIR, 'covers');
    let matchInfo = null;
    if (!subjectId) {
      const folderParsed = parseFolderName(anime.folderName);
      const videoCount = anime.episodes?.length || 0;
      const match = await matchSeason(registry, folderParsed.cleanTitle, folderParsed, videoCount, config);
      if (!match) {
        const results = (await registry.searchAll(anime.title, config)).filter((r: any) => r.source !== 'anilist');
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
    } else {
      // 手动指定了 subjectId（修正），清空旧 anilist 数据后重新搜索
      anime.anilistId = null;
      anime.anilistBanner = null;
      // 用 Bangumi 日文原名搜 AniList 拿 anilistId
      try {
        const anilist = registry.get('anilist');
        if (anilist && anilist.enabled(config)) {
          const source = config.apiSources?.find((s: any) => s.type === 'anilist');
          const searchTerm = anime.bangumiTitleJp || anime.folderName || anime.title;
          if (searchTerm) {
            const results = await anilist.search(searchTerm, source);
            if (results && results.length > 0) {
              const bestMatch = pickBestBySimilarity(searchTerm, results);
              if (bestMatch.item && bestMatch.score >= 0.5) {
                anime.anilistId = bestMatch.item.id;
              }
            }
          }
        }
      } catch (e: any) {
        logger.error(`AniList search failed for ${anime.id}: ${e.message}`);
      }
    }
    // AniList 双源同步（统一入口 ensureMetadata：有 anilistId 则拉元数据 + 下载横幅到本地）
    const bannerDir = path.join(DATA_DIR, 'banners');
    if (anime.anilistId === -1) anime.anilistId = null;
    try {
      await ensureMetadata(anime, config, { coverDir, bannerDir });
    } catch (e: any) {
      logger.error('AniList sync failed: ' + e.message);
    }
    if (!hadBangumiId && anime.bangumiId) {
      bangumiSync.pushStatusChange(anime.id, data);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveScannedTree } = require('../lib/config') as any;
    await Promise.all([db.saveLibrary(data, new Set([anime.id])), saveScannedTree(data.scannedTree)]);
    jsonResp(res, 200, { ok: true, anime });
  } catch (e: any) {
    jsonResp(res, 500, { error: e.message });
  }
}

async function handleBangumiSync(req: any, res: any, state: State) {
  const { data, config, db, bangumiSync, logger } = state;
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    const result = await bangumiSync.syncMyList(data, { dryRun: parsed.dryRun });
    if (result.lastSyncTime) {
      config.bangumiLastSync = result.lastSyncTime;
      saveConfig(config);
    }
    if (result.created > 0) {
      try { await db.saveMyList(data); } catch (e: any) { logger.error('MyList save after sync failed:', e.message); }
    }
    jsonResp(res, 200, result);
  } catch (e: any) {
    jsonResp(res, 400, { error: e.message });
  }
}

// --- Bangumi OAuth routes ---
function handleBangumiAuthStatus(req: any, res: any, state: State) {
  const { bangumiPersonal, config } = state;
  jsonResp(res, 200, { ...bangumiPersonal.getState(), lastSyncTime: config.bangumiLastSync || null });
}

function handleBangumiAuthUrl(req: any, res: any, state: State) {
  const { bangumiPersonal } = state;
  const url = bangumiPersonal.generateAuthUrl();
  jsonResp(res, 200, { url });
}

function handleBangumiAuthCallback(req: any, res: any, state: State) {
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
  bangumiPersonal.exchangeCode(code).then((st: any) => {
    saveConfig(config);
    const closeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>\u6388\u6743\u5b8c\u6210</title><style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;text-align:center}.msg{max-width:400px;padding:2rem}h2{margin:0 0 .5rem;color:#22c55e}p{margin:0;color:#a0a0a0;font-size:.9rem}</style></head><body><div class="msg"><h2>\u2713 \u6388\u6743\u5b8c\u6210</h2><p>\u6b64\u9875\u9762\u53ef\u4ee5\u5173\u95ed\uff0c\u8bf7\u8fd4\u56de\u5e94\u7528\u7ee7\u7eed\u64cd\u4f5c\u3002</p></div><script>window.close()</script></body></html>';
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(closeHtml)
    });
    res.end(closeHtml);
  }).catch((e: any) => {
    logger.error('Bangumi OAuth callback error:', e.message);
    const errMsg = (e.message || '\u67e5\u770b\u63a7\u5236\u53f0\u8f93\u51fa').replace(/[<>&"']/g, (c: string) => (({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }) as Record<string, string>)[c]);
    const closeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>\u6388\u6743\u5931\u8d25</title><style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;text-align:center}.msg{max-width:400px;padding:2rem}h2{margin:0 0 .5rem;color:#ef4444}p{margin:0;color:#a0a0a0;font-size:.9rem}</style></head><body><div class="msg"><h2>\u2717 \u6388\u6743\u5931\u8d25</h2><p>' + errMsg + '</p></div><script>window.close()</script></body></html>';
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(closeHtml)
    });
    res.end(closeHtml);
  });
}

function handleBangumiAuthLogout(req: any, res: any, state: State) {
  const { bangumiPersonal } = state;
  bangumiPersonal.clearAuth();
  jsonResp(res, 200, { ok: true });
}

async function handleBangumiAuthCreds(req: any, res: any, state: State) {
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
  } catch (e: any) {
    jsonResp(res, 400, { error: e.message });
  }
}

function handleBangumiMe(req: any, res: any, state: State) {
  const { bangumiPersonal } = state;
  if (!bangumiPersonal.isAuthed()) {
    jsonResp(res, 401, { error: 'Not authenticated' });
    return;
  }
  bangumiPersonal.getMe().then((me: any) => jsonResp(res, 200, me)).catch((e: any) => jsonResp(res, 500, { error: e.message }));
}

export {
  handleBangumiSearch,
  handleBangumiFetch,
  handleBangumiSync,
  handleBangumiAuthStatus,
  handleBangumiAuthUrl,
  handleBangumiAuthCallback,
  handleBangumiAuthLogout,
  handleBangumiAuthCreds,
  handleBangumiMe,
};
