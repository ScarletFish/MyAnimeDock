// server/routes/config.js — 配置、健康检查、通知路由
const path = require('path');
const fs = require('fs');
const { jsonResp, readBody } = require('../lib/utils');
const { saveConfig } = require('../lib/config');

module.exports = {
  handleGetConfig(req, res, state) {
    const { config, data } = state;
    const dirValid = config.mediaDir
      ? fs.existsSync(config.mediaDir) && fs.statSync(config.mediaDir).isDirectory()
      : false;
    const firstRun = !config.mediaDir && (!data?.library || data.library.length === 0);
    jsonResp(res, 200, { ...config, dirValid, firstRun, autoImport: { count: 0, message: '' } });
  },

  handleGetNotifications(req, res, state) {
    const notifs = state.pendingNotifications.splice(0);
    jsonResp(res, 200, { notifications: notifs });
  },

  handleHealth(req, res, state) {
    jsonResp(res, 200, {
      ready: true,
      library: state.data ? state.data.library.length : 0,
      uptime: Date.now() - state.startupTime,
    });
  },

  async handlePostConfig(req, res, state) {
    const { config, bangumiPersonal, logger } = state;
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      if (parsed.mediaDir !== undefined) {
        const resolved = path.resolve(parsed.mediaDir);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          jsonResp(res, 400, { error: 'Directory does not exist: ' + resolved });
          return;
        }
        // 切换媒体目录时，清除所有anime的banner缓存，触发重新同步
        if (state.data && state.data.library) {
          for (const anime of state.data.library) {
            anime.anilistBanner = null;
          }
        }
        config.mediaDir = resolved;
      }
      config.playerMode = 'mpv';
      if (parsed.mpvPath !== undefined) config.mpvPath = parsed.mpvPath;
      if (parsed.theme !== undefined) config.theme = parsed.theme;
      if (parsed.themeMode !== undefined) config.themeMode = parsed.themeMode;
      if (parsed.autoMarkWatched !== undefined) config.autoMarkWatched = !!parsed.autoMarkWatched;
      if (parsed.uiScale !== undefined) config.uiScale = Math.max(0.5, Math.min(2, parsed.uiScale));
      if (parsed.reduceMotion !== undefined) config.reduceMotion = !!parsed.reduceMotion;
      if (parsed.apiSources !== undefined) config.apiSources = parsed.apiSources;
      if (parsed.bangumiClientId !== undefined) {
        config.bangumiClientId = parsed.bangumiClientId;
        bangumiPersonal.clientId = parsed.bangumiClientId;
      }
      if (parsed.bangumiClientSecret !== undefined) {
        config.bangumiClientSecret = parsed.bangumiClientSecret;
        bangumiPersonal.clientSecret = parsed.bangumiClientSecret;
      }
      // Legacy fields
      if (parsed.apiSources === undefined && parsed.scrapers !== undefined) {
        const sources = [];
        if (parsed.scrapers.bangumi?.enabled !== false) {
          sources.push({
            type: 'bangumi',
            url: parsed.scrapers.bangumi?.apiBase || 'https://api.bangumi.lol',
            key: '',
          });
        }
        config.apiSources = sources.length > 0 ? sources : state.config.apiSources;
      }
      saveConfig(config);
      jsonResp(res, 200, { ok: true, ...config });
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },
};
