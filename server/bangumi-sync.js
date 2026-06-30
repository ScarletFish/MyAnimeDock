// server/bangumi-sync.js — Bangumi 同步编排层
// Phase 1: scrobbler（mpv 播放完成 → 自动标记 Bangumi 剧集）
// Phase 2: MyList 双向同步（本地 ↔ Bangumi collection）

const logger = require('./logger').child('[BGM-SYNC]');
const { STATUS_MAP } = require('./scrapers/bangumi-personal');

class BangumiSync {
  constructor(personalApi) {
    /** BangumiPersonal 实例 */
    this.api = personalApi;
    /** Scrobble 去重队列 */
    this._queue = [];
    this._processing = false;
    /** 上次同步时间戳 */
    this.lastSyncTime = null;
  }

  // ════════════════════════════════════════════════
  //  Phase 1: Scrobble
  // ════════════════════════════════════════════════

  async scrobble(anime, episode, opts = {}) {
    if (!anime || !episode) return;
    const bangumiId = anime.bangumiId || anime.bangumiId;
    if (!bangumiId) {
      logger.debug(`Scrobble 跳过：${anime.id} 无 bangumiId`);
      return;
    }
    if (!this.api.isAuthed()) {
      logger.debug('Scrobble 跳过：Bangumi 未绑定');
      return;
    }

    const watched = opts.watched !== undefined ? opts.watched : episode.watched;
    if (!watched) {
      logger.debug(`Scrobble 跳过：ep ${episode.number} 未看完`);
      return;
    }

    const key = `${bangumiId}:${episode.number}`;
    if (this._queue.some(q => q.key === key)) {
      logger.debug(`Scrobble 已入队：${key}`);
      return;
    }
    this._queue.push({ key, bangumiId, episodeNumber: episode.number, watched: true });
    this._processQueue();
  }

  async _processQueue() {
    if (this._processing) return;
    this._processing = true;
    while (this._queue.length > 0) {
      const job = this._queue.shift();
      try {
        await this.api.scrobbleEpisode(job.bangumiId, job.episodeNumber, job.watched);
      } catch (e) {
        logger.error(`Scrobble 队列处理错误:`, e.message);
      }
    }
    this._processing = false;
  }

  // ════════════════════════════════════════════════
  //  Phase 2: MyList 双向同步
  // ════════════════════════════════════════════════

  /**
   * 全量同步 MyList（Pull → Merge → Push，本地优先）
   *
   * 流程：
   *   Pull: 从 Bangumi 拉取所有动漫收藏
   *   Merge: 匹配本地 anime（by bangumiId），缺失→创建本地 MyList 条目
   *   Push: 本地 MyList 中有但远程没有/不一致的 → 推送到 Bangumi
   *
   * @param {object} data - 全局 data 对象（包含 library, myList）
   * @param {object} [opts]
   * @param {boolean} [opts.dryRun] - 仅返回 diff，不实际写入
   * @returns {Promise<{ pulled: number, pushed: number, created: number, wishlistAdded: number, errors: string[], lastSyncTime: string }>}
   */
  async syncMyList(data, opts = {}) {
    const result = { pulled: 0, pushed: 0, created: 0, wishlistAdded: 0, errors: [], lastSyncTime: null };

    if (!this.api.isAuthed()) {
      result.errors.push('Bangumi 未绑定');
      return result;
    }

    try {
      // ─── Pull: 从 Bangumi 拉取 ───
      logger.info('MyList 同步：开始拉取 Bangumi 收藏...');
      let remoteItems = [];
      try {
        remoteItems = await this.api.getAllMyCollections();
      } catch (e) {
        logger.error('拉取 Bangumi 收藏失败:', e.message);
        result.errors.push(`拉取失败: ${e.message}`);
        return result;
      }
      result.pulled = remoteItems.length;
      logger.info(`MyList 同步：拉取到 ${remoteItems.length} 条收藏`);

      // 建立 bangumiId → anime 索引（来自 library）
      const animeByBgmId = new Map();
      for (const a of (data.library || [])) {
        if (a.bangumiId) animeByBgmId.set(String(a.bangumiId), a);
      }

      // 建立 bangumiId → local MyList 索引
      const myListByBgmId = new Map();
      for (const m of (data.myList || [])) {
        const anime = (data.library || []).find(a => a.id === m.animeId);
        if (anime && anime.bangumiId) {
          myListByBgmId.set(String(anime.bangumiId), m);
        }
      }

      // ─── Merge ───
      //   - 远程有 & 本地有匹配 anime → 创建缺失的本地 MyList 条目
      //   - 远程有 & 本地无匹配 anime → 创建 Wishlist 条目
      if (!data.myList) data.myList = [];
      if (!data.wishlist) data.wishlist = [];

      for (const remote of remoteItems) {
        const bgmId = String(remote.subject_id);
        const anime = animeByBgmId.get(bgmId);

        if (!anime) {
          // 本地没有这个番的文件 → 存入 Wishlist（包含封面/简介/评分等信息）
          const subject = remote.subject || {};
          const existingIdx = data.wishlist.findIndex(w => String(w.bangumiId) === bgmId);
          const wishEntry = {
            id: 'bgm-' + bgmId,
            bangumiId: parseInt(bgmId),
            title: subject.name_cn || subject.name || `Subject #${bgmId}`,
            bangumiTitle: subject.name || null,
            coverUrl: subject.images?.common || null,
            summary: subject.summary || null,
            rating: subject.score || null,
            addedAt: remote.updated_at || new Date().toISOString(),
            // 记录 Bangumi 收藏类型（想看/在看/看过/搁置/抛弃），前端可据此筛选
            bgmStatus: STATUS_MAP.BGM_TYPE_TO_STATUS[remote.type] || null,
          };
          if (existingIdx >= 0) {
            Object.assign(data.wishlist[existingIdx], wishEntry);
          } else {
            data.wishlist.push(wishEntry);
            result.wishlistAdded = (result.wishlistAdded || 0) + 1;
          }
          logger.info(`MyList 同步：从 Bangumi 创建 Wishlist ${wishEntry.title}`);
          continue;
        }

        const existingLocal = myListByBgmId.get(bgmId);
        if (!existingLocal) {
          // 远程有收藏但本地无 MyList → 从 Bangumi 创建本地 MyList
          const localStatus = STATUS_MAP.BGM_TYPE_TO_STATUS[remote.type] || 'watching';
          data.myList.push({
            animeId: anime.id,
            status: localStatus,
            rating: remote.rate || null,
            thoughts: remote.comment || '',
            notes: '',
          });
          result.created++;
          logger.info(`MyList 同步：从 Bangumi 创建 ${anime.title} → ${localStatus}`);
        }
        // 如果本地已有条目不覆盖（本地优先）
      }

      // ─── Push: 本地有但远程不一致/缺失 → 推送到 Bangumi ───
      // 构建远程 subject_id → remote item 索引
      const remoteByBgmId = new Map();
      for (const r of remoteItems) {
        remoteByBgmId.set(String(r.subject_id), r);
      }

      for (const localItem of (data.myList || [])) {
        const anime = (data.library || []).find(a => a.id === localItem.animeId);
        if (!anime || !anime.bangumiId) continue;

        const bgmId = String(anime.bangumiId);
        const remote = remoteByBgmId.get(bgmId);

        if (remote) {
          // 已存在远程收藏 → 检查是否一致，不一致则推送本地值
          const remoteType = remote.type;
          const localType = STATUS_MAP.STATUS_TO_BGM_TYPE[localItem.status];
          const remoteRate = remote.rate || 0;
          const localRate = localItem.rating || 0;
          const remoteComment = (remote.comment || '').trim();
          const localComment = (localItem.thoughts || '').trim();

          if (localType && (localType !== remoteType || localRate !== remoteRate || localComment !== remoteComment)) {
            if (!opts.dryRun) {
              try {
                await this.api.pushCollectionStatus(bgmId, localItem);
                result.pushed++;
                logger.info(`MyList 同步：推送 ${anime.title} → type=${localType} rating=${localRate}`);
              } catch (e) {
                logger.error(`MyList 同步推送失败 ${anime.title}:`, e.message);
                result.errors.push(`推送 ${anime.title} 失败: ${e.message}`);
              }
            } else {
              result.pushed++;
            }
          }
        } else {
          // 远程无此条目 → 创建 Bangumi 收藏
          if (!opts.dryRun) {
            try {
              const type = STATUS_MAP.STATUS_TO_BGM_TYPE[localItem.status] || 3;
              await this.api.createCollection(bgmId, { type });
              // 如果有评分，额外推送
              if (localItem.rating != null || localItem.thoughts) {
                await this.api.pushCollectionStatus(bgmId, localItem);
              }
              result.pushed++;
              logger.info(`MyList 同步：创建 Bangumi 收藏 ${anime.title}`);
            } catch (e) {
              logger.error(`MyList 同步创建失败 ${anime.title}:`, e.message);
              result.errors.push(`创建 ${anime.title} 失败: ${e.message}`);
            }
          } else {
            result.pushed++;
          }
        }
      }

      this.lastSyncTime = new Date().toISOString();
      result.lastSyncTime = this.lastSyncTime;
      logger.info(`MyList 同步完成：拉取=${result.pulled} 创建=${result.created} 推送=${result.pushed} 错误=${result.errors.length}`);
      return result;
    } catch (e) {
      logger.error('MyList 同步异常:', e.message);
      result.errors.push(`同步异常: ${e.message}`);
      return result;
    }
  }

  /**
   * 推送单条 MyList 状态变更到 Bangumi（轻量，不触发全量同步）
   * 由 server.js 在状态改变时调用
   */
  async pushStatusChange(animeId, data) {
    if (!this.api.isAuthed()) return;
    const anime = (data.library || []).find(a => a.id === animeId);
    if (!anime || !anime.bangumiId) return;

    const localItem = (data.myList || []).find(m => m.animeId === animeId);
    if (!localItem) return;

    try {
      await this.api.pushCollectionStatus(String(anime.bangumiId), localItem);
      logger.info(`状态变更推送: ${anime.title} → ${localItem.status}`);
    } catch (e) {
      logger.warn(`状态变更推送失败 ${anime.title}: ${e.message}`);
    }
  }
}

module.exports = BangumiSync;
