# 双源元数据架构：Bangumi + AniList

> 将 AniList 从"仅搜索时查罗马音"升级为完整的第二元数据源。
> 核心变动：新增 schema 字段 + 同步编排层 + 前端 banner 展示。

---

## Schema（Prisma）

```prisma
model Anime {
  // ... existing fields ...

  anilistId         Int?    @unique    // AniList media ID
  anilistBanner     String?            // 本地绝对路径（与 localCover 一致，下载到 DATA_DIR/banners/）
  anilistCover      String?            // 本地绝对路径（仅当 Bangumi 封面缺失时使用）
  anilistTitleEn    String?            // 英文标题
  seasonChain       String?            // JSON 持久化季度链
}
```

- 不塞 `metadata` JSON 字段——专用列更清晰、可查询、Prisma 有类型
- `anilistId` 设 `@unique`，后续可用它直接查 AniList 推荐/关联
- 已有 Bangumi 字段不变，双源同存，前缀区分
- 评分以 Bangumi 为准，不存 `anilistRating`

---

## 爬虫增强

### `server/scrapers/anilist.js`

**SEARCH_QUERY** 加 `bannerImage`：

```graphql
query ($search: String!, $type: MediaType) {
  Page(perPage: 10) {
    media(search: $search, type: $type, sort: POPULARITY_DESC) {
      id
      bannerImage          # ← 新增
      title { romaji english native }
      coverImage { large medium }
      meanScore
      ...
    }
  }
}
```

**`fetchMetadata()` 返回值**加：

```js
return {
  ...existing,
  bannerImage: detail.bannerImage || null,  // 原始 CDN URL，供下载用
};
```

**新增 `downloadBanner(imageUrl, bannerDir, subjectId)`**
逻辑与 `downloadCover` 一致：
- `bannerDir = path.join(DATA_DIR, 'banners')`
- 文件名：`al-${subjectId}.jpg`
- 返回值：绝对路径（存入 `anilistBanner` 字段）
- 已有缓存直接返回路径

---

## 同步编排

### 新增辅助函数 `syncAnilist(anime, config)`

位置：`server/scrapers/index.js`

```
输入：anime 对象（已有 bangumiTitle/bangumiTitleJp/bangumiTitleEn）
输出：{ anilistId, anilistBanner, anilistRating, seasonChain, ... } 或 null

逻辑：
  1. 如果 anime.anilistId > 0 → 直接用 ID 调 fetchMetadata 刷新
  2. 如果 anime.anilistId === -1 → 跳过（之前搜过但没找到）
  3. 如果 anime.anilistId 不存在 → 按优先级搜 AniList：
       bangumiTitleJp（日文名）→ bangumiTitle（中文名）→ bangumiTitleEn
     用 pickBestBySimilarity 匹配
     Sørensen-Dice < 0.5 → 弃用，标记 anilistId = -1
     匹配成功 → fetchMetadata(anilistId) → 下载 banner 到本地
     返回 { anilistId, anilistBanner（本地路径）, anilistCover, anilistTitleEn, seasonChain }
```

### 同步触发点

| 触发点 | 位置 | 行为 |
|--------|------|------|
| 手动获取元数据 | `routes/bangumi.js:handleBangumiFetch` | Bangumi fetch 后追加 `syncAnilist` |
| 自动导入 | `server.js:autoImportNewFolders` | 每部导入后追加 `syncAnilist` |
| 回填已有库 | 独立端点或一次性脚本 | 遍历缺 anilistId 的条目 |

### 合并规则

```
Object.assign(anime, bgmMeta, alMeta)
```

| 字段 | 优先级 | 说明 |
|------|--------|------|
| bangumiTitle | Bangumi | 中文名 |
| bangumiTitleJp | Bangumi | 日文名 |
| anilistTitleEn | AniList | 仅 AniList 有 |
| summary | Bangumi | Bangumi 简介更准确 |
| coverUrl / localCover | Bangumi | Bangumi 封面优先 |
| anilistBanner（本地路径） | AniList | 下载到 banners/，与封面一致 |
| rating | Bangumi | 以 Bangumi 为准 |
| episodes | Bangumi | Bangumi 数据更准确 |
| seasonChain | AniList | 仅 AniList 有 |

---

## 前端

### Banner 展示

`public/js/detail.js` — `renderDetail()` 中：

```js
if (anime.anilistBanner) {
  // 在 .detail-banner 区域显示全宽 hero 背景图
  bannerEl.innerHTML = `<img src="${escAttr(anime.anilistBanner)}"
    alt="" onerror="this.parentElement.style.display='none'">`;
}
```

### CSS

`public/css/detail.css` — Banner hero 样式：

- 全宽、在标题区上方或作为背景
- 渐变遮罩（确保标题/按钮可读）
- 高度 ~250-300px
- `onerror` 隐藏（CDN 挂了不破坏布局）

---

## 边界情况

| 情况 | 处理 |
|------|------|
| AniList 搜索不到 | `anilistId = -1`，跳过后续尝试 |
| 匹配置信度低 | Sørensen-Dice < 0.5 弃用，标记 -1 |
| Banner CDN 挂 | 前端 `onerror` 隐藏 banner |
| 已有 anilistId 想刷新 | 跳过搜索，直接用 ID fetchMetadata |
| AniList API 限流/超时 | 静默跳过，不影响主流程 |
| 反代环境无法访问 AniList | 可配 apiSources 禁用 |

---

## 构建顺序

```
Phase 1 — Schema + 爬虫增强
  □ prisma/schema.prisma 加字段
  □ npm run prisma:migrate
  □ anilist.js: SEARCH_QUERY 加 bannerImage
  □ anilist.js: fetchMetadata 透传 bannerImage

Phase 2 — 同步编排
  □ scrapers/index.js: 新增 syncAnilist(anime, config)
  □ routes/bangumi.js: handleBangumiFetch 追加 syncAnilist
  □ server.js: autoImportNewFolders 追加 syncAnilist

Phase 3 — API + 前端
  □ library.js API 响应包含 anilist 字段
  □ detail.js + CSS: banner hero 渲染

Phase 4 — 回填 + 文档
  □ 为已有库条目跑批处理回填 anilistId
  □ 更新 docs/data-flow.md
```
