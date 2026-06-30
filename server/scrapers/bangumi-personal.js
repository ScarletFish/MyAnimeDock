// server/scrapers/bangumi-personal.js — Bangumi 个人 API（OAuth + 播放进度同步）
// Phase 1: 认证管理 + scrobble
// Phase 2: MyList 双向同步

const { nodeFetch } = require('./node-fetch');
const logger = require('../logger').child('[BANGUMI-P]');

const AUTH_ENDPOINT = 'https://bgm.tv/oauth/authorize';
const TOKEN_ENDPOINT = 'https://bgm.tv/oauth/access_token';
const API_BASE = 'https://api.bgm.tv';
const UA = 'MyAnimeDocker/1.0 (github.com/ScarletFish/MyAnimeDocker)';

// ─── 状态映射（Bangumi type ↔ 本地 MyList status） ───
// Bangumi: 1=想看 2=看过 3=在看 4=搁置 5=抛弃
// Local:   wish completed watching on_hold dropped
const BGM_TYPE_TO_STATUS = { 1: 'wish', 2: 'completed', 3: 'watching', 4: 'on_hold', 5: 'dropped' };
const STATUS_TO_BGM_TYPE = { wish: 1, completed: 2, watching: 3, on_hold: 4, dropped: 5 };

// ─── 请求超时 ───
const TIMEOUT = 8000;

async function bgmFetch(url, options = {}, timeoutMs = TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetcher = typeof fetch === 'function' ? fetch : nodeFetch;
    return await fetcher(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Bangumi API 请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

class BangumiPersonal {
  /**
   * @param {object} [opts]
   * @param {string} [opts.apiBase] - Bangumi API 基地址，默认 https://api.bgm.tv（可用镜像站如 https://api.bangumi.one）
   */
  constructor(opts = {}) {
    this.accessToken = null;
    this.username = null;
    this.clientId = null;
    this.clientSecret = null;
    this.apiBase = opts.apiBase || API_BASE;
    this.redirectUri = 'http://localhost:3456/api/bangumi/auth/callback';
    /** (tokenInfo) => void — 持久化回调，由 server.js 绑定 */
    this.onTokenChange = null;
    this._episodeCache = new Map(); // bangumiId -> [{ sort, id, name_cn }]
  }

  // ─── 认证状态 ───

  isAuthed() { return !!this.accessToken; }

  getState() {
    return {
      authed: this.isAuthed(),
      username: this.username,
      hasCredentials: !!this.clientId,
      clientId: this.clientId ? this.clientId.slice(0, 8) + '…' : null,
    };
  }

  // ─── 持久化：从 config 恢复 / 回调保存 ───

  loadFromConfig(cfg) {
    if (cfg.bangumiAccessToken) this.accessToken = cfg.bangumiAccessToken;
    if (cfg.bangumiUsername) this.username = cfg.bangumiUsername;
    if (cfg.bangumiClientId) this.clientId = cfg.bangumiClientId;
    if (cfg.bangumiClientSecret) this.clientSecret = cfg.bangumiClientSecret;
  }

  toConfigPayload() {
    return {
      bangumiAccessToken: this.accessToken,
      bangumiUsername: this.username,
      bangumiClientId: this.clientId,
      bangumiClientSecret: this.clientSecret,
    };
  }

  // ─── 更新 OAuth 凭据 ───

  setCredentials(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
  }

  // ─── OAuth 流程 ───

  generateAuthUrl() {
    if (!this.clientId) return null;
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
    });
    return `${AUTH_ENDPOINT}?${p}`;
  }

  async exchangeCode(code) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('请先填入 Bangumi Client ID 和 Client Secret');
    }
    const body = JSON.stringify({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    });
    const res = await bgmFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body,
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

  clearAuth() {
    this.accessToken = null;
    this.username = null;
    if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
    this._episodeCache.clear();
  }

  // ─── API 方法 ───

  /** GET /v0/me */
  async getMe() {
    return this._get('/v0/me');
  }

  /** GET /v0/users/{username}/collections?subject_type=2 */
  async getCollections(subjectType = 2) {
    if (!this.username) {
      const me = await this.getMe();
      this.username = me.username;
      if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
    }
    return this._get(`/v0/users/${this.username}/collections`, { subject_type: subjectType });
  }

  /** GET /v0/subjects/{subjectId}/episodes — 获取 Bangumi 剧集列表 */
  async getSubjectEpisodes(subjectId) {
    const cacheKey = String(subjectId);
    if (this._episodeCache.has(cacheKey)) {
      return this._episodeCache.get(cacheKey);
    }
    const data = await this._get(`/v0/subjects/${subjectId}/episodes`);
    const episodes = (data || []).map(ep => ({
      bangumiEpId: ep.id,
      sort: ep.sort || ep.ep,
      name: ep.name_cn || ep.name,
    }));
    this._episodeCache.set(cacheKey, episodes);
    return episodes;
  }

  /** PUT /v0/users/-/collections/-/episodes/{episodeId} — 标记单集状态 */
  async markEpisode(episodeId, type) {
    // type: 1=想看, 2=看过, 3=在看, 4=搁置, 5=抛弃
    return this._put(`/v0/users/-/collections/-/episodes/${episodeId}`, { type });
  }

  /** PATCH /v0/users/-/collections/{subjectId} — 更新条目收藏 */
  async updateCollection(subjectId, data) {
    return this._patch(`/v0/users/-/collections/${subjectId}`, data);
  }

  /** POST /v0/users/-/collections/{subjectId} — 创建条目收藏 */
  async createCollection(subjectId, data) {
    return this._post(`/v0/users/-/collections/${subjectId}`, data);
  }

  // ─── MyList 双向同步相关方法 ───

  /**
   * GET /v0/users/{username}/collections?subject_type=2 — 拉取用户所有动漫收藏（分页自动处理）
   * 返回数据含 subject 对象（name, name_cn, images, summary, score），可用于无本地文件时写入 Wishlist
   * @returns {Promise<Array<{ subject_id: number, type: number, rate: number, ep_status: number, comment: string, updated_at: string, subject?: { id: number, name: string, name_cn: string, images: { common: string, large: string }, summary: string, score: number, url: string } }>>}
   */
  async getAllMyCollections() {
    if (!this.username) {
      const me = await this.getMe();
      this.username = me.username;
      if (this.onTokenChange) this.onTokenChange(this.toConfigPayload());
    }
    const allData = [];
    const limit = 100;
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
   * PATCH /v0/users/-/collections/{subjectId} — 将本地 MyList 状态推送到 Bangumi
   * @param {number} subjectId - Bangumi 条目 ID
   * @param {{ status?: string, rating?: number }} localItem - 本地 MyList 条目
   */
  async pushCollectionStatus(subjectId, localItem) {
    const body = {};
    if (localItem.status && STATUS_TO_BGM_TYPE[localItem.status]) {
      body.type = STATUS_TO_BGM_TYPE[localItem.status];
    }
    if (localItem.rating != null) {
      body.rating = Math.round(localItem.rating);
    }
    if (localItem.thoughts) {
      body.comment = localItem.thoughts;
    }
    if (Object.keys(body).length === 0) return null;
    return this._patch(`/v0/users/-/collections/${subjectId}`, body);
  }

  // ─── Scrobble 快捷方法 ───
  // 根据已有的 bangumiId + 剧集号，标记对应 Bangumi 剧集为「看过」

  async scrobbleEpisode(bangumiId, episodeNumber, watched = true) {
    if (!this.isAuthed()) {
      logger.info(`Scrobble 跳过（未认证）: subject=${bangumiId} ep=${episodeNumber}`);
      return { skipped: true, reason: 'not_authed' };
    }
    try {
      // 1) 确保条目在用户收藏中（POST 创建收藏，已存在则静默忽略错误）
      //    这是 PUT episodes 的前置条件，即使之前没标记过也能工作
      try {
        await this.createCollection(bangumiId, { type: 3 });
        logger.debug(`确保收藏: subject=${bangumiId} type=3`);
      } catch (colErr) {
        // 409/400 表示已收藏，可以继续
        logger.debug(`收藏已存在或跳过: ${colErr.message}`);
      }

      // 2) 获取 Bangumi 剧集列表，匹配本地剧集号
      const episodes = await this.getSubjectEpisodes(bangumiId);
      const target = episodes.find(ep => ep.sort === episodeNumber);
      if (!target) {
        logger.warn(`Scrobble 失败：找不到 episode ${episodeNumber}（subject ${bangumiId}）`);
        return { skipped: true, reason: 'episode_not_found' };
      }

      // 3) 标记为已看/想看
      await this.markEpisode(target.bangumiEpId, watched ? 2 : 1);
      logger.info(`Scrobble OK: subject=${bangumiId} ep=${episodeNumber} → ${watched ? '看过' : '想看'}`);
      return { ok: true, bangumiEpId: target.bangumiEpId };
    } catch (e) {
      logger.error(`Scrobble 失败: subject=${bangumiId} ep=${episodeNumber}`, e.message);
      return { skipped: true, reason: e.message };
    }
  }

  // ─── 内部 HTTP 方法 ───

  _headers() {
    const h = { 'User-Agent': UA };
    if (this.accessToken) h['Authorization'] = `Bearer ${this.accessToken}`;
    return h;
  }

  _fullUrl(path) {
    const base = this.apiBase.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  _url(path, params = {}) {
    const url = new URL(this._fullUrl(path));
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  async _get(path, params = {}) {
    const res = await bgmFetch(this._url(path, params), { headers: this._headers() });
    if (!res.ok) {
      if (res.status === 401) { this.accessToken = null; this.username = null; }
      const txt = await res.text().catch(() => '');
      throw new Error(`Bangumi GET ${path} 失败 (${res.status}): ${txt}`);
    }
    return res.json();
  }

  async _put(path, body) {
    return this._mutate('PUT', path, body);
  }

  async _patch(path, body) {
    return this._mutate('PATCH', path, body);
  }

  async _post(path, body) {
    return this._mutate('POST', path, body);
  }

  async _mutate(method, path, body) {
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

module.exports = BangumiPersonal;
module.exports.STATUS_MAP = { BGM_TYPE_TO_STATUS, STATUS_TO_BGM_TYPE };
