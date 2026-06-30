// server/bangumi-sync.js — Bangumi 同步编排层
// 能力：从 Bangumi 拉取收藏（→ Wishlist）、推送终态（看过/抛弃 + 评分）
// 不涉及：单集 scrobble、感想同步、状态变更自动推送

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
   *   Push: 本地终态（completed/dropped + 评分）不一致 → 推送到 Bangumi
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
          // 本地没有这个番的文件 → 存入 Wishlist
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
            bgmStatus: BGM_TYPE_TO_STATUS[remote.type] || null,
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

      // ─── Push: 推送本地终态（completed/dropped + 评分）到 Bangumi ───
      // 不推送其他状态（watching/wish/on_hold），不推送感想
      const remoteByBgmId = new Map();
      for (const r of remoteItems) {
        remoteByBgmId.set(String(r.subject_id), r);
      }

      for (const localItem of (data.myList || [])) {
        const anime = (data.library || []).find(a => a.id === localItem.animeId);
        if (!anime || !anime.bangumiId) continue;

        const bgmId = String(anime.bangumiId);
        const remote = remoteByBgmId.get(bgmId);

        const shouldPush = localItem.status === 'completed' || localItem.status === 'dropped';
        if (!shouldPush) continue;

        const remoteType = remote?.type;
        const localType = STATUS_TO_BGM_TYPE[localItem.status];
        const remoteRate = remote?.rate || 0;
        const localRate = localItem.rating || 0;
        const differs = localType !== remoteType || localRate !== remoteRate;

        if (!differs) continue;

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
   * 推送单条 MyList 终态到 Bangumi（轻量，不触发全量同步）
   * 由 server.js 在状态变为 completed/dropped 时调用
   */
  async pushStatusChange(animeId, data) {
    if (!this.api.isAuthed()) return;
    const anime = (data.library || []).find(a => a.id === animeId);
    if (!anime || !anime.bangumiId) return;

    const localItem = (data.myList || []).find(m => m.animeId === animeId);
    if (!localItem) return;

    // 只推送终态（看过/抛弃），且与远程不一致才推
    if (localItem.status !== 'completed' && localItem.status !== 'dropped') return;

    try {
      await this.api.pushCollectionStatus(String(anime.bangumiId), localItem);
      logger.info(`状态变更推送: ${anime.title} → ${localItem.status}`);
    } catch (e) {
      logger.warn(`状态变更推送失败 ${anime.title}: ${e.message}`);
    }
  }
}

module.exports = BangumiSync;
