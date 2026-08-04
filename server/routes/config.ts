// server/routes/config.ts — 配置、健康检查、通知路由
import path from 'path';
import fs from 'fs';
import { jsonResp, readBody } from '../lib/utils';
import { saveConfig } from '../lib/config';
import * as registry from '../players/registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = any;

function handleGetConfig(req: any, res: any, state: State) {
    const { config, data } = state;
    const dirValid = config.mediaDir
        ? fs.existsSync(config.mediaDir) && fs.statSync(config.mediaDir).isDirectory()
        : false;
    const firstRun = !config.mediaDir && (!data?.library || data.library.length === 0);
    // 附上可用播放器列表供前端渲染选择器
    const players = registry.getAvailable(config);
    jsonResp(res, 200, { ...config, players, dirValid, firstRun, autoImport: { count: 0, message: '' } });
}

function handleGetNotifications(req: any, res: any, state: State) {
    const notifs = state.pendingNotifications.splice(0);
    jsonResp(res, 200, { notifications: notifs });
}

function handleHealth(req: any, res: any, state: State) {
    jsonResp(res, 200, {
        ready: true,
        library: state.data ? state.data.library.length : 0,
        uptime: Date.now() - state.startupTime,
    });
}

async function handlePostConfig(req: any, res: any, state: State) {
    const { config, bangumiPersonal } = state;
    try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (parsed.mediaDir !== undefined) {
            const resolved = path.resolve(parsed.mediaDir);
            if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
                jsonResp(res, 400, { error: 'Directory does not exist: ' + resolved });
                return;
            }
            config.mediaDir = resolved;
        }
        if (parsed.playerMode !== undefined) config.playerMode = parsed.playerMode;
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
}

export {
    handleGetConfig,
    handleGetNotifications,
    handleHealth,
    handlePostConfig,
};
