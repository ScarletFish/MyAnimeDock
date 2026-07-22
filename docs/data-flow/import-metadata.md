# Import + Metadata 流

## 手动导入（via Discovery UI）

```
POST /api/import
  → routes/discovery.js:handleImport()
  → Body: { items: [{ path, name, parsedTitle, parsedSeason, specialSuffix, ... }] }
  → For each item:
      ├─ Generate animeId = `${parsedTitle}${parsedSeason ? '-Season '+parsedSeason : ''}`
      ├─ Build anime + episodes in data.library[]:
      │   { id, title, folderName, folderPath, season, specialSuffix,
      │     episodes: [{ animeId, episodeNumber, filePath, fileName, fileSize }] }
      ├─ [bgmN] items 跳过 metadata fetch — 只有扫描数据
      ├─ 非 [bgmN] items 通过 scannedNode 携带的预取元数据（如有）
      ├─ Mark node.alreadyImported = true in scannedTree
      └─ db.saveLibrary(data) + saveScannedTree(scannedTree)
  → For each imported item with bangumiId → syncAnilist() async fire-and-forget
  → jsonResp(res, 200, { count: N })
```

## Metadata 获取

### 从 Discovery 页抓取（导入前）

```
POST /api/discovery/fetch-meta (for scanned items — NOT yet imported)
  → routes/discovery.js:handleDiscoveryFetchMeta()
  → coverDir = path.join(DATA_DIR, 'covers')
  → registry.fetchMetadata(source, title, coverDir, subjectId, config)
      └─ Returns: { source, bangumiId, bangumiTitle, bangumiTitleJp,
                     summary, coverUrl, localCover, rating }
  → Update scannedTree node metadata fields (no library entry yet)
  → saveScannedTree(data.scannedTree)
  → ⚠️ No AniList sync here — the item hasn't been imported.
```

### 对库内条目抓取（已导入）

```
POST /api/bangumi/fetch (for library items — already imported)
  → routes/bangumi.js:handleBangumiFetch()
  → coverDir = path.join(DATA_DIR, 'covers')
  → If no subjectId: matchSeason() auto-detect, or return search results
  → registry.fetchMetadata(source, title, coverDir, subjectId, config)
      ├─ ScraperRegistry (scrapers/index.js)
      │   ├─ bangumi.js:
      │   │   ├─ fetchWithTimeout(url) using node-fetch polyfill (node-fetch.js)
      │   │   │   (pkg compatible: http/https native modules, not global fetch)
      │   │   ├─ getSubjectDetail(subjectId) → detail JSON from api.bgm.tv
      │   │   └─ downloadCover(imageUrl, coverDir, subjectId):
      │   │       ├─ Determine ext from URL (.jpg, .png, etc.)
      │   │       ├─ filename = `${subjectId}${ext}`
      │   │       ├─ Check cache: if exists → return path
      │   │       ├─ fetch image → buffer → write to covers/
      │   │       └─ Return absolute localCover path
      └─ Returns: { source, bangumiId, bangumiTitle, bangumiTitleJp,
                     summary, coverUrl, localCover, rating }
  → Object.assign(anime, meta) — update library anime record
  → db.saveLibrary(data) + saveScannedTree(data.scannedTree)
```

## AniList 双源同步

同步拆为三步：**resolveAnilistId**（轻量，仅搜索取 ID + 预取 banner）
→ **batchGetDetails**（批量补缺 banner）→ **syncAnilistDetail**（重量，单条 metadata + banner）。

| 触发方式 | 端点/位置 | 调用方式 | 函数 | 备注 |
|---------|-----------|---------|------|------|
| 发现页手动导入 | `POST /api/import` → `discovery.js` | 元数据落盘后 `.then()` | `syncAnilist` | [bgmN] 跳过搜索,直接取元数据 |
| 详情页 banner 懒加载 | `GET /api/anime/:id` → `library.js` | 响应后异步 | `syncAnilistDetail` | 仅 `anilistId` 存在且缺 banner 时触发 |
| 详情页刷元数据 | `POST /api/bangumi/fetch` → `bangumi.js` | `await` | `syncAnilist` | 重置 `-1` 重新搜索 |
| AniList 批量回填 | `POST /api/library/sync-anilist-backfill` → `library.js` | `parallelMap`,每 5 部落盘 | `syncAnilist` | 传参 `result` |
| SSE 流式同步 | `GET /api/library/sync/stream` → `library.js` | `parallelMap` | `resolveAnilistId`(流内) + `batchGetDetails`(流末) | [bgmN] 跳过 matchSeason，ID 直取 |

### 搜索优化策略

1. **搜索词分级**：两档优先搜索（romaji / 日文名 → 英文 / 中文 / 文件夹名），前者命中即停
2. **搜索结果预取 banner**：`resolveAnilistId` 从 SEARCH 结果直接提取 `bannerImage` + `title_english`，对 ~80%+ 条目免去后续 DETAIL_QUERY
3. **去重缓存**：`registry._searchCache`（5 分钟 TTL）缓存 SEARCH 结果；`anilist._pendingSearches` Map 共享相同关键词的 in-flight Promise
4. **批量 DETAIL**：流末一次 `batchGetDetails(chunk)`（50 条/批）补全剩余缺 banner 的条目
5. **Retry-After 感知**：429 响应优先用 `Retry-After` / `X-RateLimit-Reset` 头确定等待时间
