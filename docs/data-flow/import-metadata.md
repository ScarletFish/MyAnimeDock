# Import + Metadata 流

## 手动导入（via Discovery UI）

```
POST /api/import
  → routes/discovery.ts:handleImport()
  → Body: { items: [{ path, name, parsedTitle, parsedSeason, specialSuffix, ... }] }
  → For each item:
      ├─ Generate animeId = crypto.randomUUID()
      ├─ Build anime + episodes in data.library[]:
      │   { id, title, folderName, folderPath, season, specialSuffix,
      │     episodes: [{ animeId, episodeNumber, filePath, fileName, fileSize }] }
      ├─ [bgmN] items 跳过 metadata fetch — 只有扫描数据
      ├─ 非 [bgmN] items 通过 scannedNode 携带的预取元数据（如有）
      ├─ Mark node.alreadyImported = true in scannedTree
      └─ db.saveLibrary(data) + saveScannedTree(scannedTree)
  → jsonResp(res, 200, { count: N })
```

## Metadata 获取

### 对库内条目抓取（已导入）

```
POST /api/bangumi/fetch (for library items — already imported)
  → routes/bangumi.ts:handleBangumiFetch()
  → coverDir = path.join(DATA_DIR, 'covers')
  → If no subjectId: matchSeason() auto-detect, or return search results
  → registry.fetchMetadata(source, title, coverDir, subjectId, config)
      ├─ ScraperRegistry (scrapers/index.ts)
      │   ├─ bangumi.ts:
      │   │   ├─ fetchWithTimeout(url) using node-fetch polyfill (node-fetch.ts)
      │   │   │   (pkg compatible: http/https native modules, not global fetch)
      │   │   ├─ getSubjectDetail(subjectId) → detail JSON from api.bgm.tv
      │   │   └─ downloadCover(imageUrl, coverDir, subjectId):
      │   │       ├─ Determine ext from URL (.jpg, .png, etc.)
      │   │       ├─ filename = `${subjectId}${ext}`
      │   │       ├─ Check cache: if exists → return path
      │   │       ├─ fetch image → buffer → write to covers/
      │   │       └─ Return absolute localCover path
      └─ Returns: { source, bangumiId, bangumiTitle, bangumiTitleJp,
                     summary, localCover, rating }
  → Object.assign(anime, meta) — update library anime record
  → db.saveLibrary(data) + saveScannedTree(data.scannedTree)
```

## 双源元数据管线

统一入口为 `ensureMetadata`（单条）/ `ensureMetadataBatch`（批量），取代旧的 `syncAnilist` / `syncAnilistDetail`。存储字段只存本地路径 / null / `__none__`，**不再存远程 URL**（`coverUrl` / `anilistCover` 已移除，前端一律用 `localCover`）。

| 触发方式 | 端点/位置 | 调用方式 | 函数 | 备注 |
|---------|-----------|---------|------|------|
| 详情页刷元数据 | `POST /api/bangumi/fetch` → `bangumi.ts` | `await` | `ensureMetadata` | 重置 `-1` 重新搜索 |
| SSE 流式同步 | `GET /api/library/sync/stream` → `library.ts` | `parallelMap` | 流内内联 AniList 搜索取 ID + 收尾 `ensureMetadataBatch` | [bgmN] 跳过 matchSeason，ID 直取 |

### 搜索优化策略

> **清横幅缓存行为**：`POST /api/db/clear-cache`（`db-manager.ts handleDbClearCache`）清 `banners` 目标时，会同步把 DB 中 `anilistBanner` 为**本地路径**（非 http / 非 `__none__` / 非 null）的引用置 null 并落盘（`saveLibrary`），避免残留失效路径。远程 URL / `__none__` / 已有 null 的引用不动。置 null 后 banner 需通过匹配工作台或手动刷元数据重新获取。

1. **搜索词分级**：两档优先搜索（romaji / 日文名 → 英文 / 中文 / 文件夹名），前者命中即停
2. **搜索结果预取 banner**：流内内联 AniList 搜索从 SEARCH 结果直接提取 `bannerImage` + `title_english`，对 ~80%+ 条目免去后续 DETAIL_QUERY
3. **去重缓存**：`registry._searchCache`（5 分钟 TTL）缓存 SEARCH 结果；`anilist._pendingSearches` Map 共享相同关键词的 in-flight Promise
4. **批量补全**：流末一次 `ensureMetadataBatch(chunk)`（`id_in` 一次最多 50 条）补全剩余缺 banner/tags 的条目，AniList 批量 DETAIL + 并行下载 banner 到本地，Bangumi 侧逐条 `fetchMetadata`
5. **Retry-After 感知**：429 响应优先用 `Retry-After` / `X-RateLimit-Reset` 头确定等待时间
