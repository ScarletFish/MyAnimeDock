# Metadata Matching Flow

## 概览

MyAnimeDocker 的元数据匹配系统负责将本地动漫文件与外部元数据源关联（标题、封面、简介、评分、季度链等）。

```
本地文件 → 扫描发现 → 导入资料库 → 元数据匹配 → 持久化
                                      ├─ 批量（MetaMatch）
                                      ├─ 单个（详情页）
                                      └─ 发现页（fetch-meta）
```

**数据源**（仅 Bangumi 参与匹配）：
- **Bangumi** — 主要匹配源（标题搜索 + ID 获取元数据）
- **AniList** — 仅用于搜索日文原名后反查 Bangumi（不参与匹配结果展示）
- **TMDB** — 配置后用（暂不参与匹配）

---

## 1. 核心数据结构

### Anime（库条目），`prisma/schema.prisma`
```
id, title, folderName, folderPath, season, specialSuffix
episodes: [{ episodeNumber, filePath, ... }]
bangumiId, bangumiTitle, bangumiTitleJp  ← 匹配结果
summary, coverUrl, localCover, rating     ← 匹配结果
matchedSeason, totalSeasons               ← 季度链（来自 AniList）
metadataSource                            ← 'bangumi' | 'tmdb'
```

### ScannedTree Leaf（发现页条目），`scanned-tree.json`
```
path, name, parsedTitle, parsedSeason, videoCount
bangumiMatched, bangumiId, bangumiTitle  ← 匹配标记
alreadyImported, excluded                  ← 状态标记
```

### MyList（MyList 条目），`prisma/schema.prisma`
```
animeId, status (watching|wish|completed|on_hold|dropped)
```

---

## 2. 匹配入口

### 2.1 发现页 → fetch-meta（单条）

```
POST /api/discovery/fetch-meta
server/server.js:757-818
```

**流程：**
1. 客户端发送 `{ path, subjectId?, source? }`
2. 如无 `subjectId`，调用 `matchSeason()` 自动匹配
3. 调用 `registry.fetchMetadata(source, title, coverDir, subjectId, config)` 获取元数据
4. 更新 scannedTree node 字段：`bangumiMatched=true, bangumiId, ...`
5. 下载封面，生成缩略图缓存
6. 持久化：`saveScannedTree()`

### 2.2 详情页 → bangumi/fetch（单条）

```
POST /api/bangumi/fetch
server/server.js:1303-1362
```

**流程：**
1. 客户端发送 `{ animeId, subjectId?, source? }`
2. 如无 `subjectId`，调 `matchSeason()` 自动匹配
   - 失败则调 `registry.searchAll()` 返回候选列表 → 前端手动选择
3. 调 `registry.fetchMetadata()` 获取元数据
4. `Object.assign(anime, meta)` 更新库条目
5. 更新 `matchedSeason/totalSeasons`
6. 如有新 `bangumiId`，异步推送到 Bangumi 个人收藏
7. 持久化：`Promise.all([db.saveLibrary(), saveScannedTree()])`

### 2.3 MetaMatch 批量匹配

```
前端: public/js/metamatch.js
后端:
  POST /api/library/sync        (整批处理)
  GET  /api/library/sync/stream (SSE 流式)
```

**前端 mmLoadModalData()** (metamatch.js:54-108)：
- 加载 `/api/library`，按 `bangumiId` 判定状态：
  - `matched` — 已有 bangumiId
  - `pending` — 未匹配
  - `failed` — 匹配失败
- SST-able 列表展示（状态圆点颜色 + 徽章 + 行内匹配预览）

**后端批量 sync** (server.js:1390-1454)：
- 接收 `{ animeIds: [...] }`
- 跳过已匹配项，用 `parallelMap()` 并发 3 条处理
- 每条：`matchSeason()` → `fetchMetadata()` → `Object.assign(anime, meta)`
- 完成后统一保存：`Promise.all([db.saveLibrary(), saveScannedTree()])`
- 清空搜索缓存：`registry.clearSearchCache()`

**后端 SSE 流式 sync** (server.js:1456-1577)：
- 通过 `EventSource` 实时推送进度事件
- 每条处理发送 `progress` 事件（`{animeId, success, meta?, error?}`）
- 支持取消：`cancelledSyncSessions` Map 追踪
- 每条 60s 超时保护

---

## 3. 匹配核心逻辑

### matchSeason() — 季度感知匹配

```
server/scrapers/index.js:219-256
```

```
async function matchSeason(registry, keyword, folderParsed, videoCount, config)
```

**参数：**
- `keyword` — 文件夹解析后的标题
- `folderParsed` — `{ cleanTitle, title, season, specialSuffix }`（来自 scanner）
- `videoCount` — 库条目的剧集数
- `config` — 全局配置

**流程：**
1. `buildSearchTerms(folderParsed, keyword)` — 构建多组搜索词（原始名、去掉Suffix等）
2. 语言路由：
   - **罗马音标题** → `searchViaAniList(registry, bangumi, term, config)`
     - 先用 AniList 搜索 → 获取日文原名
     - 再用日文原名搜 Bangumi（因为 Bangumi 搜罗马音结果差）
   - **非罗马音（中文/日文）** → `searchBangumi(bangumi, term, config)`
3. `pickBestBySimilarity(folderParsed.cleanTitle, results)` — Sorensen-Dice 相似度选最佳
4. `bangumi.getSubjectDetail(best.id)` — 获取 Bangumi 条目详情
5. `validateMatch(detail, folderParsed)` — 验证匹配置信度（集数比较）
6. 返回 `{ ...detail, source: 'bangumi', matchedSeason, confidence, _detail }`

### searchViaAniList() — AniList 辅助搜索

```
server/scrapers/index.js:152-177
```

```
async function searchViaAniList(registry, bangumi, searchTerm, config)
```

**作用**：针对罗马音标题，利用 AniList 的罗马音→日文原名翻译能力，再反查 Bangumi。

**流程：**
1. 调用 `anilist.search(searchTerm)` 获得候选
2. 取第一个结果的 `title_native`（日文原名）
3. 用日文原名调用 `searchBangumi(bangumi, jpTitle, config)`
4. 返回 Bangumi 结果

⚠️ AniList **不参与最终匹配结果展示**（2026-07 过滤 `source !== 'anilist'`）。

### pickBestBySimilarity() — 相似度选最佳

```
server/scrapers/index.js:179-218
```

- 使用 Sorensen-Dice 系数比较标题相似度
- 评分考虑：标题长度、汉字匹配度
- 5 分钟 TTL 缓存搜索结果

### validateMatch() — 置信度验证

```
server/scrapers/index.js:（matchSeason 内嵌）
```

- 对比 `detail.eps`（Bangumi 总集数）和文件夹 `videoCount`
- 返回 0-1 置信度分数
- 低分项仍会返回给 `matchSeason`，但用户可见标记

---

## 4. Scraper 架构

### ScraperRegistry
```
server/scrapers/index.js:258-361
```

```
注册: registry.register(new BangumiScraper())  // 优先级 1
     registry.register(new AniListScraper())   // 优先级 2
```

**Key Methods：**

| 方法 | 行号 | 用途 |
|------|------|------|
| `searchAll(keyword, config)` | 312 | 遍历所有数据源搜索，缓存 5min |
| `fetchMetadata(name, title, coverDir, id, config, preDetail?)` | 350 | 调指定 scraper 获取元数据 |
| `getSources(config)` | 289 | 从 Config 提取启用的源（过滤 TMDB） |
| `clearSearchCache()` | 341 | 批量操作后清缓存 |

### BangumiScraper

```
server/scrapers/bangumi.js:76
```

**接口：**
- `search(keyword, source)` → `[{ id, name, name_cn, type, ... }]`（type=2 过滤为动画）
- `fetchMetadata(title, coverDir, subjectId, preDetail)` → `{ bangumiId, bangumiTitle, summary, coverUrl, localCover, rating, ... }`
- `downloadCover(imageUrl, coverDir, subjectId)` → 本地路径
- 使用 `node-fetch.js` 原生模块 polyfill（pkg 兼容）
- 支持代理检测 + curl fallback

### AniListScraper

```
server/scrapers/anilist.js:173
```

**接口：**
- `search(keyword, source)` → `[{ id, name, name_cn, title_native, ... }]`
- `fetchMetadata()` — **不实现**，仅用于获取 romaji/native title
- `extractSeasonChain(detail)` → `Map<season, {id, title, title_native}>`
- `prefetch(keywords, registry, config)` — 扫描后后台预搜缓存

**使用场景：**
1. `matchSeason()` 中 `searchViaAniList()` 获取日文原名
2. `extractSeasonChain()` 在 `fetchMetadata` 成功后获取季度链
3. 扫描完成后后台预取（前 20 个罗马音标题）

---

## 5. 数据流全景

### 完整链路

```
扫描 (scanner.js)
  │
  ├─ AniList 后台预取 (缓存到 registry._searchCache)
  │
  ├─ 用户导入 (POST /api/import)
  │   └─ library + myList + scannedTree 更新
  │
  ├─ 元数据匹配 (MetaMatch/详情页/发现页)
  │   │
  │   ├─ matchSeason()
  │   │   ├─ buildSearchTerms()
  │   │   ├─ 语言路由 → searchViaAniList() | searchBangumi()
  │   │   ├─ pickBestBySimilarity() ← Sorensen-Dice
  │   │   ├─ getSubjectDetail() → Bangumi 详情
  │   │   └─ validateMatch() → 置信度打分
  │   │
  │   └─ registry.fetchMetadata()
  │       ├─ downloadCover() → covers/
  │       └─ extractSeasonChain() → matchedSeason/totalSeasons
  │
  └─ 持久化
      ├─ db.saveLibrary() → SQLite anime + episode 表
      └─ saveScannedTree() → scanned-tree.json
```

### 文件依赖

```
scanner.js ─────→ parseFolderName()
   │
   └────→ matchSeason() ──→ searchViaAniList() ──→ anilist.js
                 │                                    │
                 ├─ searchBangumi() ──→ bangumi.js    │
                 │                                    │
                 └─ pickBestBySimilarity()             │
                 └─ validateMatch()                    │
                                                       │
registry.fetchMetadata() ──→ bangumi.js. fetchMetadata()
                           ──→ anilist.js. extractSeasonChain()
```

---

## 6. 状态标记汇总

| 标记 | 位置 | 设置时机 | 读取者 |
|------|------|---------|--------|
| `bangumiMatched` | scannedTree node | fetch-meta 成功 | 发现页过滤 |
| `bangumiId` | scannedTree node + anime | 匹配成功 | MetaMatch 状态判定 |
| `matchedSeason` | anime | fetchMetadata 后 | 详情页显示 |
| `totalSeasons` | anime | fetchMetadata 后 | 详情页显示 |
| `status: matched/pending/failed` | MetaMatch mmItems | `mmLoadModalData()` | MetaMatch 列表渲染 |

---

## 7. 关键注意事项

1. **AniList 不参与匹配结果**：两个后端入口过滤 `source !== 'anilist'`（`/api/bangumi/search` + `/api/bangumi/fetch` fallback）
2. **Sorensen-Dice 相似度匹配**：标题模糊匹配用，5 分钟缓存避免重复请求
3. **并发限制**：批量匹配 `parallelMap()` 并发 3，SSE 流式每条 60s 超时
4. **搜索缓存**：`_searchCache` 5 分钟 TTL，`clearSearchCache()` 批量操作后清除
5. **Type 过滤**：Bangumi 搜索只保留 `type=2`（动画）
6. **语言路由**：罗马音→AniList→日语→Bangumi；中/日文→Bangumi
7. **背景预取**：扫描完成后自动用 AniList 预搜罗马音标题（最多 20 个，2 并发）
