// server/routes/qb.ts — qBittorrent API 代理路由
import { jsonResp, readBody } from '../lib/utils';
import * as qb from '../lib/qb-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = any;

function getCreds(state: State) {
  const { config } = state;
  return { port: config.qbPort || 8080, username: config.qbUsername || 'admin', password: config.qbPassword || '' };
}

async function handleQbTest(req: any, res: any, state: State) {
  try {
    let port: number, username: string, password: string;
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      port = Number(body.port) || 8080;
      username = String(body.username || 'admin');
      password = String(body.password || '');
      if (!password) password = getCreds(state).password; // 前端未填密码时用已存密码
    } else {
      ({ port, username, password } = getCreds(state));
    }
    const result = await qb.qbTestConnection(port, username, password);
    jsonResp(res, result.ok ? 200 : 502, result);
  } catch (e: any) {
    jsonResp(res, 500, { ok: false, error: e.message });
  }
}

async function handleQbTorrents(req: any, res: any, state: State) {
  try {
    const { port, username, password } = getCreds(state);
    const torrents = await qb.qbGetTorrents(port, username, password);
    jsonResp(res, 200, torrents);
  } catch (e: any) {
    jsonResp(res, 502, { error: e.message });
  }
}

async function handleQbFiles(req: any, res: any, state: State) {
  try {
    const { port, username, password } = getCreds(state);
    const url = new URL(req.url, 'http://localhost');
    const hash = url.searchParams.get('hash');
    if (!hash) { jsonResp(res, 400, { error: 'Missing hash parameter' }); return; }
    const files = await qb.qbGetFiles(port, username, password, hash);
    jsonResp(res, 200, files);
  } catch (e: any) {
    jsonResp(res, 502, { error: e.message });
  }
}

async function handleQbAdd(req: any, res: any, state: State) {
  try {
    const { port, username, password } = getCreds(state);
    const body = JSON.parse(await readBody(req));
    if (!body.urls) { jsonResp(res, 400, { error: 'Missing urls field' }); return; }
    await qb.qbAddTorrent(port, username, password, body.urls, body.savepath);
    jsonResp(res, 200, { ok: true });
  } catch (e: any) {
    jsonResp(res, 502, { error: e.message });
  }
}

async function handleQbAction(req: any, res: any, state: State) {
  try {
    const { port, username, password } = getCreds(state);
    const body = JSON.parse(await readBody(req));
    const { action, hashes, deleteFiles, limit } = body;
    switch (action) {
      case 'pause': await qb.qbPauseTorrent(port, username, password, hashes || 'all'); break;
      case 'resume': await qb.qbResumeTorrent(port, username, password, hashes || 'all'); break;
      case 'delete': await qb.qbDeleteTorrent(port, username, password, hashes || 'all', !!deleteFiles); break;
      case 'pauseAll': await qb.qbPauseAll(port, username, password); break;
      case 'resumeAll': await qb.qbResumeAll(port, username, password); break;
      case 'setDownloadLimit': await qb.qbSetDownloadLimit(port, username, password, Number(limit) || 0); break;
      default: jsonResp(res, 400, { error: `Unknown action: ${action}` }); return;
    }
    jsonResp(res, 200, { ok: true });
  } catch (e: any) {
    jsonResp(res, 502, { error: e.message });
  }
}

async function handleQbTransfer(req: any, res: any, state: State) {
  try {
    const { port, username, password } = getCreds(state);
    const info = await qb.qbGetTransfer(port, username, password);
    jsonResp(res, 200, info);
  } catch (e: any) {
    jsonResp(res, 502, { error: e.message });
  }
}

export {
  handleQbTest,
  handleQbTorrents,
  handleQbFiles,
  handleQbAdd,
  handleQbAction,
  handleQbTransfer,
};
