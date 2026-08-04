# Scan / Discovery + 管理流

## 扫描 / 浏览

```
GET /api/browse?showExcluded
  → routes/discovery.ts:handleBrowse()
  → scanner.scanMediaDirFlat(config.mediaDir)
      ├─ Recursively walk mediaDir
      ├─ For each folder containing video files (.mkv/.mp4/.avi/.mov):
      │   ├─ parseFolderName(name) using anitomy → { title, season, specialSuffix }
      │   └─ buildLeaf(item) → { name, path, type:'leaf', parsedTitle,
      │                          parsedSeason, videoCount, totalVideoFiles,
      │                          videos[], parentChain[], alreadyImported,
      │                          excluded, bangumiMatched, bangumiId, ... }
      └─ Returns flat leaf array
  → Merge with data.scannedTree (preserve existing metadata/exclusion state)
  → saveScannedTree(scannedTree) → scanned-tree.json
  → jsonResp with merged result

  NOTE: alreadyImported 匹配优先级 = bangumiId（内容身份）→ folderPath 兜底
    （手动条目无 bangumiId，仅走 folderPath；见 routes/discovery.ts handleBrowse/handleScan）

  NOTE: Also runs migrations on existing data:
    • parsedSeason === 1 → null
    • Remove S\d+ from parsedTitle
    • Compute specialSuffix from parsedTitle
```

### Scan Progress (SSE)

```
GET /api/scan
  → routes/discovery.ts:handleScan()
  → Sets res.headers: Content-Type: text/event-stream, Cache-Control: no-cache
  → scanner.scanMediaDirFlat() with progress callback:
      write `data: ${JSON.stringify({ type: 'progress'|'done', ... })}\n\n`
  → Connection stays open until scan completes
```

## Discovery 管理

### Exclude from scan
```
POST /api/discovery/exclude
  → Body: { path: string }
  → Find node in scannedTree by path → set excluded = true
  → saveScannedTree(scannedTree) — writes scanned-tree.json
  → Next scan will skip this folder
```

### Include (remove exclusion)
```
POST /api/discovery/include
  → Body: { path: string }
  → Find node in scannedTree by path → set excluded = false
  → saveScannedTree(scannedTree)
```

### Unlink (remove from library, keep in scannedTree)
```
POST /api/discovery/unlink
  → Body: { animeId: string }
  → Remove anime from data.library + episodes
  → Mark node.alreadyImported = false in scannedTree
  → db.saveLibrary(data) + saveScannedTree(scannedTree)
```
