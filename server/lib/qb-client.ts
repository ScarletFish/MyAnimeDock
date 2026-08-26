// server/lib/qb-client.ts — qBittorrent WebAPI 客户端
import { nodeFetch } from '../scrapers/node-fetch';
import { Logger } from '../logger';

const logger: Logger = require('../logger').child('[QB]');

const QB_BASE = (port: number) => `http://localhost:${port}`;

let cachedSid: string | null = null;
let cachedPort: number = 0;
let cachedCookieName: string = 'SID';
const loginPromises = new Map<number, Promise<string>>();

async function qbLogin(port: number, username: string, password: string): Promise<string> {
  // 如果同一 port 正在登录，复用 promise
  const pending = loginPromises.get(port);
  if (pending) return pending;

  const promise = doLogin(port, username, password);
  loginPromises.set(port, promise);
  try {
    return await promise;
  } finally {
    loginPromises.delete(port);
  }
}

async function doLogin(port: number, username: string, password: string): Promise<string> {
  const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const res = await nodeFetch(`${QB_BASE(port)}/api/v2/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': QB_BASE(port),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`qB login failed: ${res.status} - ${text}`);
  const setCookie = res.headers?.['set-cookie'];
  if (!setCookie) throw new Error('qB login: no Set-Cookie header');
  const cookieArr = Array.isArray(setCookie) ? setCookie : [setCookie];
  // 新版 qBittorrent 用 QBT_SID_<port> 作为 cookie 名，老版用 SID
  let sid = '';
  let cookieName = 'SID';
  for (const c of cookieArr) {
    const m = c.match(/^(QBT_SID_\d+|SID)=([^;]+)/);
    if (m) { cookieName = m[1]; sid = m[2]; break; }
  }
  if (!sid) throw new Error(`qB login: SID not found in cookie (${JSON.stringify(cookieArr)})`);
  cachedSid = sid;
  cachedPort = port;
  cachedCookieName = cookieName;
  logger.debug(`Logged in to qB (port ${port})`);
  return sid;
}

async function qbRequest(
  port: number,
  username: string,
  password: string,
  method: string,
  apiPath: string,
  body?: string,
  contentType?: string,
): Promise<any> {
  if (cachedPort !== port || !cachedSid) {
    await qbLogin(port, username, password);
  }
  const headers: Record<string, string> = {
    Cookie: `${cachedCookieName}=${cachedSid}`,
    Referer: QB_BASE(port),
  };
  if (body && contentType) {
    headers['Content-Type'] = contentType;
  }
  const res = await nodeFetch(`${QB_BASE(port)}${apiPath}`, {
    method,
    headers,
    body,
  });
  // SID expired → re-login once
  if (res.status === 403) {
    logger.debug('SID expired, re-logging in...');
    await qbLogin(port, username, password);
    headers.Cookie = `${cachedCookieName}=${cachedSid}`;
    const retry = await nodeFetch(`${QB_BASE(port)}${apiPath}`, { method, headers, body });
    if (!retry.ok) throw new Error(`qB API ${apiPath} failed after re-login: ${retry.status}`);
    return parseResponse(retry);
  }
  if (!res.ok) throw new Error(`qB API ${apiPath} failed: ${res.status}`);
  return parseResponse(res);
}

async function parseResponse(res: any): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Public API ──

export async function qbTestConnection(port: number, username: string, password: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    await qbLogin(port, username, password);
    const ver = await qbRequest(port, username, password, 'GET', '/api/v2/app/version');
    return { ok: true, version: ver };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function qbGetTorrents(port: number, username: string, password: string): Promise<any[]> {
  return qbRequest(port, username, password, 'GET', '/api/v2/torrents/info');
}

export async function qbGetFiles(port: number, username: string, password: string, hash: string): Promise<any[]> {
  return qbRequest(port, username, password, 'GET', `/api/v2/torrents/files?hash=${hash}`);
}

export async function qbAddTorrent(port: number, username: string, password: string, urls: string, savepath?: string): Promise<void> {
  const params = new URLSearchParams({ urls });
  if (savepath) params.set('savepath', savepath);
  await qbRequest(port, username, password, 'POST', '/api/v2/torrents/add', params.toString(), 'application/x-www-form-urlencoded');
}

export async function qbPauseTorrent(port: number, username: string, password: string, hashes: string): Promise<void> {
  await qbRequest(port, username, password, 'POST', '/api/v2/torrents/pause', `hashes=${hashes}`, 'application/x-www-form-urlencoded');
}

export async function qbResumeTorrent(port: number, username: string, password: string, hashes: string): Promise<void> {
  await qbRequest(port, username, password, 'POST', '/api/v2/torrents/resume', `hashes=${hashes}`, 'application/x-www-form-urlencoded');
}

export async function qbDeleteTorrent(port: number, username: string, password: string, hashes: string, deleteFiles = false): Promise<void> {
  await qbRequest(port, username, password, 'POST', '/api/v2/torrents/delete', `hashes=${hashes}&deleteFiles=${deleteFiles}`, 'application/x-www-form-urlencoded');
}

export async function qbSetDownloadLimit(port: number, username: string, password: string, limit: number): Promise<void> {
  await qbRequest(port, username, password, 'POST', '/api/v2/transfer/setDownloadLimit', `limit=${limit}`, 'application/x-www-form-urlencoded');
}

export async function qbPauseAll(port: number, username: string, password: string): Promise<void> {
  await qbRequest(port, username, password, 'POST', '/api/v2/torrents/pause', 'hashes=all', 'application/x-www-form-urlencoded');
}

export async function qbResumeAll(port: number, username: string, password: string): Promise<void> {
  await qbRequest(port, username, password, 'POST', '/api/v2/torrents/resume', 'hashes=all', 'application/x-www-form-urlencoded');
}

export async function qbGetTransfer(port: number, username: string, password: string): Promise<any> {
  return qbRequest(port, username, password, 'GET', '/api/v2/transfer/info');
}

// ── RSS API ──

export async function qbAddRssFeed(port: number, username: string, password: string, url: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ url });
  if (path) params.set('path', path);
  await qbRequest(port, username, password, 'POST', '/api/v2/rss/addFeed', params.toString(), 'application/x-www-form-urlencoded');
}

export async function qbRemoveRssItem(port: number, username: string, password: string, path: string): Promise<void> {
  await qbRequest(port, username, password, 'POST', '/api/v2/rss/removeItem', `path=${encodeURIComponent(path)}`, 'application/x-www-form-urlencoded');
}

export async function qbSetRssRule(port: number, username: string, password: string, ruleName: string, ruleDef: Record<string, any>): Promise<void> {
  const params = new URLSearchParams({
    ruleName,
    ruleDef: JSON.stringify(ruleDef),
  });
  await qbRequest(port, username, password, 'POST', '/api/v2/rss/setRule', params.toString(), 'application/x-www-form-urlencoded');
}

export async function qbRemoveRssRule(port: number, username: string, password: string, ruleName: string): Promise<void> {
  await qbRequest(port, username, password, 'POST', '/api/v2/rss/removeRule', `ruleName=${encodeURIComponent(ruleName)}`, 'application/x-www-form-urlencoded');
}

export async function qbGetRssRules(port: number, username: string, password: string): Promise<Record<string, any>> {
  return qbRequest(port, username, password, 'GET', '/api/v2/rss/rules');
}
