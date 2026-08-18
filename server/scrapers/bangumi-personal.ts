// server/scrapers/bangumi-personal.ts — Bangumi 个人 API（OAuth + Bangumi 收藏管理）
// 能力：OAuth 认证、拉取收藏列表（→ Wishlist）、推送终态（看过/抛弃 + 评分）
// 推送：状态（全部类型）+ 已看集数 + 评分，不包含感想

import { nodeFetch } from './node-fetch';
import { Logger } from '../logger';
const logger: Logger = require('../logger').child('[BANGUMI-P]');

const AUTH_ENDPOINT = 'https://bgm.tv/oauth/authorize';
const TOKEN_ENDPOINT = 'https://bgm.tv/oauth/access_token';
const API_BASE = 'https://api.bgm.tv';
const UA = 'MyAnimeDock/1.0 (github.com/ScarletFish/MyAnimeDock)';

// ─── 状态映射（Bangumi type ↔ 本地 MyList status） ───
// Bangumi: 1=想看 2=看过 3=在看 4=搁置 5=抛弃
// Local:   wish completed watching on_hold dropped
const BGM_TYPE_TO_STATUS: Record<string, string> = { 1: 'wish', 2: 'completed', 3: 'watching', 4: 'on_hold', 5: 'dropped' };
const STATUS_TO_BGM_TYPE: Record<string, number> = { wish: 1, completed: 2, watching: 3, on_hold: 4, dropped: 5 };

// ─── 请求超时 ───
const TIMEOUT = 8000;

async function bgmFetch(url: string, options: any = {}, timeoutMs: number = TIMEOUT): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetcher = typeof fetch === 'function' ? fetch : nodeFetch;
    return await fetcher(url, { ...options, signal: controller.signal });
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Bangumi API 请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

class BangumiPersonal {
  private accessToken: string | null;
  private username: string | null;
  private clientId: string | null;
  private clientSecret: string | null;
  private apiBase: string;
  private redirectUri: string;
  private onTokenChange: ((payload: Record<string, any>) => void) | null;

  /**
   * @param opts
   * @param opts.apiBase - Bangumi API 基地址，默认 https://api.bgm.tv（可用镜像站如 https://api.bangumi.lol）
   */
  constructor(opts: { apiBase?: string } = {}) {
    this.accessToken = null;
    this.username = null;
    this.clientId = null;
    this.clientSecret = null;
    this.apiBase = opts.apiBase || API_BASE;
    this.redirectUri = 'http://localhost:3456/api/bangumi/auth/callback';
    /** (tokenInfo) => void — 持久化回调，由 server.js 绑定 */
    this.onTokenChange = null;
  }

  // ─── 认证状态 ───

  isAuthed(): boolean { return !!this.accessToken; }

  getState(): Record<string, any> {
    return {
      authed: this.isAuthed(),
      username: this.username,
      hasCredentials: !!this.clientId,
      clientId: this.clientId ? this.clientId.slice(0, 8) + '…' : null,
    };
  }

  // ─── 持久化：从 config 恢复 / 回调保存 ───

  loadFromConfig(cfg: Record<string, any>): void {
    if (cfg.bangumiAccessToken) this.accessToken = cfg.bangumiAccessToken;
    if (cfg.bangumiUsername) this.username = cfg.bangumiUsername;
    if (cfg.bangumiClientId) this.clientId = cfg.bangumiClientId;
    if (cfg.bangumiClientSecret) this.clientSecret = cfg.bangumiClientSecret;
  }

  toConfigPayload(): Record<string, any> {
    return {
      bangumiAccessToken: this.accessToken,
      bangumiUsername: this.username,
      bangumiClientId: this.clientId,
      bangumiClientSecret: this.clientSecret,
    };
  }

  // ─── 更新 OAuth 凭据 ───

  setCredentials(clientId: string | null, clientSecret: string | null): void {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
  }

  // ─── OAuth 流程 ───

  generateAuthUrl(): string | null {
    if (!this.clientId) return null;
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
    });
    return `${AUTH_ENDPOINT}?${p}`;
  }

  async exchangeCode(code: string): Promise<Record<string, any>> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('请先填入 Bangumi Client ID 和 Client Secret');
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    });
    const res = await bgmFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: params.toString(),
    }, 10000);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`OAuth 令牌交换失败 (${res.status}): ${txt}`);
    }
    const data = await res.json();
    this.accessToken = data.access_token;
    // 获取用户名
    try {
      const me = await this.getMe();
      this.username = me.username;
    } catch { /* 非关键 */ }
    if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
    logger.info(`Bangumi OAuth 绑定成功，用户: ${this.username || '未知'}`);
    return this.getState();
  }

  clearAuth(): void {
    this.accessToken = null;
    this.username = null;
    if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
  }

  // ─── API 方法 ───

  /** GET /v0/me */
  async getMe(): Promise<any> {
    return this._get('/v0/me');
  }

  /** GET /v0/users/{username}/collections?subject_type=2 */
  async getCollections(subjectType: number = 2): Promise<any> {
    if (!this.username) {
      const me = await this.getMe();
      this.username = me.username;
      if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
    }
    return this._get(`/v0/users/${this.username}/collections`, { subject_type: subjectType });
  }

  /** PATCH /v0/users/-/collections/{subjectId} — 更新条目收藏 */
  async updateCollection(subjectId: number | string, data: Record<string, any>): Promise<any> {
    return this._patch(`/v0/users/-/collections/${subjectId}`, data);
  }

  /** POST /v0/users/-/collections/{subjectId} — 创建条目收藏 */
  async createCollection(subjectId: number | string, data: Record<string, any>): Promise<any> {
    return this._post(`/v0/users/-/collections/${subjectId}`, data);
  }

  // ─── MyList 同步相关方法 ───

  /**
   * GET /v0/users/{username}/collections?subject_type=2 — 拉取用户所有动漫收藏（分页自动处理）
   * 返回数据含 subject 对象（name, name_cn, images, summary, score），可用于无本地文件时写入 Wishlist
   */
  async getAllMyCollections(): Promise<any[]> {
    if (!this.username) {
      const me = await this.getMe();
      this.username = me.username;
      if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
    }
    const allData: any[] = [];
    const BGM_PAGE_SIZE = 100;
    const limit = BGM_PAGE_SIZE;
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const res = await this._get(`/v0/users/${this.username}/collections`, {
        subject_type: 2,
        limit,
        offset,
      });
      // 响应格式：{ data: [...], total, limit, offset }
      const items = res.data || [];
      allData.push(...items);
      total = res.total || items.length;
      offset += limit;
      if (items.length === 0) break;
    }
    return allData;
  }

  /**
   * PATCH /v0/users/-/collections/{subjectId} — 将本地状态推送到 Bangumi
   * 推送所有状态 + 评分 + 已看集数，不推送感想
   * @param subjectId - Bangumi 条目 ID
   * @param localItem - 本地 MyList 条目
   */
  async pushCollectionStatus(subjectId: number | string, localItem: { status?: string; rating?: number; episodeProgress?: number }): Promise<any> {
    const body: Record<string, any> = {};
    if (localItem.status && STATUS_TO_BGM_TYPE[localItem.status]) {
      body.type = STATUS_TO_BGM_TYPE[localItem.status];
    }
    if (localItem.rating != null) {
      body.rating = Math.round(localItem.rating);
    }
    if (localItem.episodeProgress != null) {
      body.ep_status = localItem.episodeProgress;
    }
    if (Object.keys(body).length === 0) return null;
    return this._patch(`/v0/users/-/collections/${subjectId}`, body);
  }

  // ─── 内部 HTTP 方法 ───

  _headers(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': UA };
    if (this.accessToken) h['Authorization'] = `Bearer ${this.accessToken}`;
    return h;
  }

  _fullUrl(path: string): string {
    const base = this.apiBase.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  _url(path: string, params: Record<string, any> = {}): string {
    const url = new URL(this._fullUrl(path));
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  async _get(path: string, params: Record<string, any> = {}): Promise<any> {
    const res = await bgmFetch(this._url(path, params), { headers: this._headers() });
    if (!res.ok) {
      if (res.status === 401) { this.accessToken = null; this.username = null; }
      const txt = await res.text().catch(() => '');
      throw new Error(`Bangumi GET ${path} 失败 (${res.status}): ${txt}`);
    }
    return res.json();
  }

  async _patch(path: string, body: Record<string, any>): Promise<any> {
    return this._mutate('PATCH', path, body);
  }

  async _post(path: string, body: Record<string, any>): Promise<any> {
    return this._mutate('POST', path, body);
  }

  async _mutate(method: string, path: string, body: Record<string, any>): Promise<any> {
    const res = await bgmFetch(this._fullUrl(path), {
      method,
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 401) { this.accessToken = null; this.username = null; }
      const txt = await res.text().catch(() => '');
      throw new Error(`Bangumi ${method} ${path} 失败 (${res.status}): ${txt}`);
    }
    return res.json();
  }
}

// 保持 CJS 导出形状：module.exports = 类（server.js 直接 new），
// 同时把状态映射挂到类静态属性 STATUS_MAP（bangumi-sync.js 从模块解构引用）
namespace BangumiPersonal {
  export const STATUS_MAP = { BGM_TYPE_TO_STATUS, STATUS_TO_BGM_TYPE };
}

export = BangumiPersonal;
