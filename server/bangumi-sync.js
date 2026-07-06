// server/bangumi-sync.js — Bangumi 同步编排层
// 能力：从 Bangumi 拉取收藏（→ Wishlist）、推送终态（看过/抛弃 + 评分）
// 推送：状态（全部类型）+ 已看集数 + 评分，不包含感想

const logger = require('./logger').child('[BGM-SYNC]');
const { BGM_TYPE_TO_STATUS, STATUS_TO_BGM_TYPE } = require('./scrapers/bangumi-personal');

class BangumiSync {
  constructor(personalApi) {
    /** BangumiPersonal 实例 */
    this.api = personalApi;
    /** 上次同步时间戳 */
    this.lastSyncTime = null;
  }

  // ════════════════════════════════════════════════
  //  MyList 双向同步
  // ════════════════════════════════════════════════

  /**
   * 全量同步 MyList（Pull → Push，本地优先）
   *
   * 流程：
   *   Pull: 从 Bangumi 拉取所有动漫收藏
   *   Merge: 匹配本地 anime（by bangumiId），缺失→创建本地 MyList / Wishlist
   *   Push: 本地状态（全部类型）+ 已看集数 + 评分不一致 → 推送到 Bangumi
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
      //   - 远程有 & 本地无匹配 anime → 创建 MyList wish 条目
      if (!data.myList) data.myList = [];

      for (const remote of remoteItems) {
        const bgmId = String(remote.subject_id);
        const anime = animeByBgmId.get(bgmId);

        if (!anime) {
          // 本地没有这个番的文件 → 存入 MyList (wish 状态)
          const subject = remote.subject || {};
          const existingIdx = data.myList.findIndex(m => !m.animeId && String(m.bangumiId) === bgmId);
          const wishEntry = {
            bangumiId: parseInt(bgmId),
            title: subject.name_cn || subject.name || `Subject #${bgmId}`,
            bangumiTitle: subject.name || null,
            coverUrl: subject.images?.common || null,
            summary: subject.summary || null,
            rating: subject.score || null,
            status: 'wish',
          };
          if (existingIdx >= 0) {
            Object.assign(data.myList[existingIdx], wishEntry);
          } else {
            data.myList.push(wishEntry);
            result.wishlistAdded = (result.wishlistAdded || 0) + 1;
          }
          logger.info(`MyList 同步：从 Bangumi 创建 Wishlist ${wishEntry.title}`);
          continue;
        }

        const existingLocal = myListByBgmId.get(bgmId);
        if (!existingLocal) {
          // 远程有收藏但本地无 MyList → 从 Bangumi 创建本地 MyList
          const localStatus = BGM_TYPE_TO_STATUS[remote.type] || 'watching';
          data.myList.push({
            animeId: anime.id,
            status: localStatus,
            rating: remote.rate || null,
            thoughts: '',
            notes: '',
          });
          result.created++;
          logger.info(`MyList 同步：从 Bangumi 创建 ${anime.title} → ${localStatus}`);
        }
        // 如果本地已有条目不覆盖（本地优先）
      }

      // ─── Push: 推送本地状态 + 已看集数 + 评分到 Bangumi ───
      // 不推送感想
      const remoteByBgmId = new Map();
      for (const r of remoteItems) {
        remoteByBgmId.set(String(r.subject_id), r);
      }

      for (const localItem of (data.myList || [])) {
        const anime = (data.library || []).find(a => a.id === localItem.animeId);
        if (!anime || !anime.bangumiId) continue;

        const bgmId = String(anime.bangumiId);
        const remote = remoteByBgmId.get(bgmId);

        const remoteType = remote?.type;
        const localType = STATUS_TO_BGM_TYPE[localItem.status];
        const remoteRate = remote?.rate || 0;
        const localRate = localItem.rating || 0;
        const remoteEp = remote?.ep_status || 0;
        const watchedCount = (anime.episodes || []).filter(e => e.watched).length;
        const differs = localType !== remoteType || localRate !== remoteRate || watchedCount !== remoteEp;

        if (!differs) continue;

        if (!opts.dryRun) {
          try {
            await this.api.pushCollectionStatus(bgmId, { ...localItem, episodeProgress: watchedCount });
            result.pushed++;
            logger.info(`MyList 同步：推送 ${anime.title} → type=${localType} rating=${localRate} ep=${watchedCount}`);
          } catch (e) {
            logger.error(`MyList 同步推送失败 ${anime.title}:`, e.message);
            result.errors.push(`推送 ${anime.title} 失败: ${e.message}`);
          }
        } else {
          result.pushed++;
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
   * 推送单条 MyList 状态到 Bangumi（轻量，不触发全量同步）
   * 由 server.js 在状态/评分改变时调用，推送状态 + 已看集数 + 评分
   */
  async pushStatusChange(animeId, data) {
    if (!this.api.isAuthed()) return;
    const anime = (data.library || []).find(a => a.id === animeId);
    if (!anime || !anime.bangumiId) return;

    const localItem = (data.myList || []).find(m => m.animeId === animeId);
    if (!localItem) return;

    // 计算本地已看集数
    const watchedCount = (anime.episodes || []).filter(e => e.watched).length;
    const bgmId = String(anime.bangumiId);
    const payload = { ...localItem, episodeProgress: watchedCount };

    try {
      await this.api.pushCollectionStatus(bgmId, payload);
      logger.info(`Bangumi 同步: ${anime.title} → ${localItem.status} ep=${watchedCount}`);
    } catch (e) {
      if (e.message.includes('404')) {
        // 收藏不存在 → 先创建再同步
        try {
          const type = STATUS_TO_BGM_TYPE[localItem.status] || 3;
          await this.api.createCollection(bgmId, { type });
          await this.api.pushCollectionStatus(bgmId, payload);
          logger.info(`Bangumi 创建+同步: ${anime.title}`);
        } catch (e2) {
          logger.warn(`Bangumi 创建/同步失败 ${anime.title}: ${e2.message}`);
        }
      } else {
        logger.warn(`Bangumi 同步失败 ${anime.title}: ${e.message}`);
      }
    }
  }
}

module.exports = BangumiSync;
