# MyAnimeDock — Complete Data Flow Reference

> 涵盖 13 个主要数据流：config, scan/discovery, import, metadata fetch, play sessions, covers/thumbnails, SQLite persistence, startup init, MyList status, Bangumi sync, discovery management, full call chain。
> 涉及数据持久化、API 端点、或数据模型改动时，必须先读此文档。

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Tauri Shell (Rust)                                │
│  src-tauri/src/main.rs                                                       │
│    • Spawns sidecar (Node.js server.exe)                                      │
│    • Monitors sidecar exit → closes window                                    │
│    • Hides window until server ready (visible:false → window.show())          │
│    • In production: navigates to http://localhost:3456 after ready            │
│                                                                               │
│  Sidecar: server/server.js → lib/ + routes/ (Node.js, pkg-bundled)           │
│    • HTTP server @ :3456                                                      │
│    • lib/config.js: path/constants + config loading                           │
│    • lib/utils.js: mime, serveImage, jsonResp, readBody, ffmpeg helpers       │
│    • routes/*.js: 7 route modules (config, discovery, library, playback,       │
│      mylist, stats, bangumi) — each exports handler(req, res, state)          │
│    • Persistence: SQLite (Prisma ORM) — library/playSessions         │
│    • JSON files: config.json (settings), scanned-tree.json (scan result)      │
│    • Static file serving: public/ frontend + covers/ + thumbs/                │
│    • ffmpeg: thumbnail extraction + cover resize                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Files

| File | Location (dev) | Location (MSI/pkg) | Purpose |
|------|---------------|-------------------|---------|
| `anime.db` | `prisma/anime.db` | `%APPDATA%/MyAnimeDock/anime.db` | SQLite — primary store for library, playSessions |
| `config.json` | `server/config.json` | `%APPDATA%/MyAnimeDock/config.json` | Settings (JSON only, managed by lib/config.js) |
| `scanned-tree.json` | `server/scanned-tree.json` | `%APPDATA%/MyAnimeDock/scanned-tree.json` | Scan result tree (JSON only, managed by lib/config.js) |
| `anime-data.json` | (legacy) | (legacy) | **Removed**. Only used as migration fallback for scannedTree on first startup |
| `covers/*.jpg` | `server/covers/` | `%APPDATA%/MyAnimeDock/covers/` | Downloaded cover images |
| `banners/*.jpg` | `server/banners/` | `%APPDATA%/MyAnimeDock/banners/` | AniList banner images (downloaded to local, filename `al-{id}.jpg`) |
| `thumbs/*.jpg` | `server/thumbs/` | `%APPDATA%/MyAnimeDock/thumbs/` | Video thumbnails (ffmpeg) |

## 1. Startup Init Flow

```
server.js ⇒ init()
  │
  ├─ 1. Load config.json → global `config` object
  │     (includes mediaDir, playerMode, mpvPath, theme, uiScale, scrapers config)
  │
  ├─ 2. db.ensureSchema() — auto-create SQLite tables if not exist
  │
  ├─ 3. db.loadData() — read all data from SQLite → global `data` object
  │     (SQLite is the PRIMARY store for library/playSessions)
  │     ├─ Anime + Episode records → data.library
  │     ├─ PlaySession records → data.playSessions
  │     └─ ScannedTree record (JSON stored in SQLite) → data.scannedTree
  │
  ├─ 4. Fallback: if scannedTree empty, check legacy anime-data.json
  │     (one-time migration for users upgrading from old JSON-only version)
  │
  ├─ 5. Validate localCover paths
  │     (if file missing → clear field → frontend shows gray placeholder)
  │
  ├─ 6. Initialize mpv-controller (activePlays Map)
  │
  ├─ 7. Start HTTP server (http.createServer, listen :3456)
  │
        └─ 8. Start HTTP server — 启动完成，无后台自动导入
```

## 2. Config Flow

### Read: `GET /api/config`
```
server.js: route dispatch (routeTable)
  → match: GET /api/config → routes/config.js:handleGetConfig()
  → jsonResp(res, 200, { ...config, dirValid })
    dirValid = fs.existsSync(config.mediaDir)
```

### Write: `POST /api/config`
```
server.js: route dispatch (routeTable)
  → match: POST /api/config → routes/config.js:handlePostConfig()
  → Read body (JSON)
  → Merge: config = { ...config, ...body }
  → Save: fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  → Apply side effects:
      ├─ theme → document.documentElement.dataset.theme (if hot-reload in Tauri)
      └─ (no server restart needed)
  → jsonResp(res, 200, { ok: true })
```

### Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mediaDir` | string | `""` | Anime folder root path |
| `playerMode` | string | `"mpv"` | `"mpv"` only (system player removed) |
| `mpvPath` | string | `"mpv"` | MPV executable path |
| `theme` | string | `"default"` | Color theme: default/amber/ocean/sakura/emerald/violet |
| `themeMode` | string | `"dark"` | `"dark"` or `"light"` |
| `autoMarkWatched` | bool | `true` | Auto-mark episode watched on completion |
| `uiScale` | number | `1.25` | 0.75–1.50, applied as CSS `--scale` variable |
| `reduceMotion` | bool | `false` | Reduced motion preference |
| `apiSources` | array | `[{type:"bangumi",...}]` | Metadata source list (type/url/key) |
| `bangumiClientId` | string | `""` | Bangumi OAuth Client ID |
| `bangumiClientSecret` | string | `""` | Bangumi OAuth Client Secret |

## 3. Scan / Discovery Flow

```
GET /api/browse?showExcluded
  → routes/discovery.js:handleBrowse()
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

  NOTE: Also runs migrations on existing data:
    • parsedSeason === 1 → null
    • Remove S\d+ from parsedTitle
    • Compute specialSuffix from parsedTitle
```

### Scan Progress (SSE)

```
GET /api/scan
  → routes/discovery.js:handleScan()
  → Sets res.headers: Content-Type: text/event-stream, Cache-Control: no-cache
  → scanner.scanMediaDirFlat() with progress callback:
      write `data: ${JSON.stringify({ type: 'progress'|'done', ... })}\n\n`
  → Connection stays open until scan completes
```

## 4. Import Flow

### Manual Import (via Discovery UI)

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

## 5. Metadata Fetch Flow

```
POST /api/discovery/fetch-meta (for scanned items — NOT yet imported)
  → routes/discovery.js:handleDiscoveryFetchMeta()
  → coverDir = path.join(DATA_DIR, 'covers')
  → registry.fetchMetadata(source, title, coverDir, subjectId, config)
      └─ Returns: { source, bangumiId, bangumiTitle, bangumiTitleJp,
                     summary, coverUrl, localCover, rating }
  → Update scannedTree node metadata fields (no library entry yet)
  → saveScannedTree(data.scannedTree)
  → ⚠️ No AniList sync here — the item hasn't been imported. syncAnilist
    runs when the user later imports via POST /api/import.

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
      │   └─ tmdb.js:
      │       ├─ Same pattern (TMDB image base + seriesId)
      │       └─ Requires tmdbApiKey in config
      └─ Returns: { source, bangumiId, bangumiTitle, bangumiTitleJp,
                     summary, coverUrl, localCover, rating }
  → Object.assign(anime, meta) — update library anime record
  → AniList 双源同步 (async, fire-and-forget):
      syncAnilist(anime, config, bannerDir, coverDir)
      ├─ 如果已有 anilistId → 直接用 ID 调 fetchMetadata 刷新
      ├─ 如果 anilistId === -1 → 重置为 null 重新搜索（手动同步可重试）
      ├─ 如果无 anilistId → 按标题优先级搜 AniList（Jp→Cn→En）
      │   ├─ 搜索前 toHiragana() 归一化（片假名→平假名，解决 Bangumi 返回
      │   │   カタカナ如 "ハイ" 而 AniList 用 "はい" 导致搜索为空的问题）
      │   ├─ Sørensen-Dice ≥ 0.5 匹配成功 → fetchMetadata + downloadBanner
      │   └─ 匹配失败 → 标记 anilistId = -1
      ├─ 下载 banner 到 DATA_DIR/banners/ 目录
      └─ db.saveLibrary(data) — 写 anilistId/anilistBanner/anilistTitleEn
  → db.saveLibrary(data) + saveScannedTree(data.scannedTree)
```

## 6. Cover Serving Flow

### Dev mode (`server/covers/`):
```
GET /covers/12345.jpg?w=400&q=75
  → server.js: handleCoverImage() (inline)
  → lib/utils.js:serveImage(coverPath, req.url, res)
      ├─ If no ?w param: readFile + serve raw
      ├─ If ?w param present:
      │   ├─ Check cache: covers/.resized/thumb_W_Q_NAME
      │   ├─ Cache hit: serve cached file
      │   ├─ Cache miss:
      │   │   ├─ ffmpeg -i INPUT -vf "scale=W:-1" -q:v Q -y CACHEPATH
      │   │   │   (W=width from ?w=, Q=quality from ?q= or default 75)
      │   │   ├─ On success: serve CACHEPATH
      │   │   └─ On error: fallback to raw file
      └─ Cache-Control: max-age=86400
```

### MSI/pkg mode:
```
DATA_DIR = %APPDATA%/MyAnimeDock
coverPath = path.join(DATA_DIR, 'covers/12345.jpg')
  → Same serveImage() pipeline
  → Resized cache at DATA_DIR/covers/.resized/
```

### Covers not in AppData yet:
```
init() validates localCover — if file doesn't exist → clear field
Frontend shows gray SVG placeholder
User must re-fetch metadata to download covers to AppData
```

## 7. Thumbnail Flow

```
GET /api/thumbnail?path=VIDEO_PATH&time=60
  → routes/playback.js:handleThumbnail()
  → Validate videoPath exists
  → hash = MD5(videoPath + time)
  → thumbPath = DATA_DIR/thumbs/${hash}.jpg
  → If cache hit: serveImage(thumbPath, ...) → same cover pipeline
  → If cache miss:
      ├─ mkdir thumbs/ if needed
      ├─ spawn(ffmpegPath, ['-ss', time, '-i', videoPath,
      │                      '-vframes', '1', '-q:v', '5',
      │                      '-y', thumbPath, '-loglevel', 'error'])
      ├─ 30s timeout
      ├─ On close(code===0): serveImage(thumbPath, ...)
      └─ On error/timeout: jsonResp 500
```

### ffmpeg Path Resolution
```
lib/utils.js: const ffmpegPath = require('ffmpeg-static') || 'ffmpeg'; (module-level, settable via setFfmpegPath)
  → Dev: resolves to server/node_modules/ffmpeg-static/ffmpeg.exe
  → pkg: db.js sets process.env.FFMPEG_BIN → sidecar-modules/ffmpeg.exe
         (ffmpeg-static reads FFMPEG_BIN env var first)
  → Fallback: 'ffmpeg' (system PATH)
```

## 8. Play Session Flow

### Play Start
```
POST /api/play
  → routes/playback.js:handlePlay()
  → Body: { filePath, position }  // position = ep.progress, 0-1 float
  → Validate filePath exists (fs.existsSync)
  → Convert position to seconds:
      if (targetEp.duration && position > 0 && position < 1)
        startSeconds = Math.round(position * targetEp.duration)
      else
        startSeconds = Math.round(position || 0)
  → Always mpv (system player removed):
      ├─ Find targetAnime/targetEp from data.library
      ├─ Auto-mark previous episodes as watched (if autoMarkWatched enabled):
      │   ├─ For each ep with number < targetEp.number && !ep.watched:
      │   │   ├─ ep.watched = true (in memory)
      │   │   └─ Collect ep.number into autoMarked[]
      │   └─ db.updateEpisodesWatched(animeId, autoMarked) — batch update SQLite
      ├─ Create playSession record in data.playSessions:
      │   progressStart: startSeconds  // always in seconds, not 0-1
      ├─ activePlays.set(filePath, { sessionId, episode, anime })
      ├─ db.savePlaySessions(data) — only writes playSession table
      ├─ startMpv(mpvPath, filePath, startSeconds, callbacks):
      │   ├─ --start receives seconds (not 0-1 percentage)
      │   ├─ Spawn mpv with IPC pipe (--input-ipc-server)
      │   ├─ onProgress (every 10s) → db.updateEpisodeProgress() + db.updatePlaySession()
      │   │   ├─ mpv time-pos is in SECONDS
      │   │   ├─ ep.progress = Math.min(1, max(0, timePos / duration))  // normalize to 0-1
      │   │   ├─ session.duration = peakPos - progressStart  // both in seconds
      │   │   └─ session.clockTime = wall clock (endTime - startTime)
      │   ├─ onError → clean up session, return error to frontend via Promise
      │   └─ onClose (code≠0 && lived<3s) → report crash to frontend
      ├─ await Promise with 2s timeout (capture sync spawn errors)
      └─ Return 200 OK or 500 { error: msg }

  NOTE: Frontend sends ep.progress (0-1 float). Server converts to seconds
  using known ep.duration before passing to mpv --start or storing as
  progressStart. This ensures duration = peakPos - startSeconds is correct.
  ep.progress in SQLite is always 0-1 (normalized on every onProgress call).
```

### Progress Update (manual via API)
```
POST /api/progress
  → routes/playback.js:handleProgress()
  → Body: { animeId, episodeNumber, progress, duration, watched }
  → Update ep.progress/duration/watched in memory
  → db.updateEpisodeProgress(animeId, epNumber, { progress, duration, watched })
    (only writes episode table, no full saveAll)
```

### Watch Activity (stats page)
```
GET /api/stats/watch-activity
  → routes/stats.js:handleStatsWatchActivity()
  → Build last 6 months labels using LOCAL year-month
    (avoid toISOString() — UTC conversion shifts month in UTC+8 timezone)
  → For each playSession with endTime:
      ├─ Parse startTime as Date, extract LOCAL ym: `${y}-${pad(m)}`
      ├─ watchSecs = Math.max(duration, clockTime)  // duration = content progress
      └─ minutes += Math.round(watchSecs / 60)
  → Return { months: [{ label, minutes }] }
  → Frontend: D3 area chart in stats.js loadActivityChart()
  → Empty state when totalMinutes === 0
```

### Anime Sessions (detail page)
```
GET /api/anime/:id/sessions
  → routes/stats.js:handleAnimeSessions()
  → Filter playSessions by animeId + endTime truthy
  → Aggregate duration by LOCAL date
    (avoid toISOString() — UTC conversion shifts date in UTC+8 timezone)
  → Fill last 90 days using LOCAL dates
  → Return { "YYYY-MM-DD": minutes }
  → Frontend: Canvas bar chart in detail.js renderWatchStats()
```

## 9. MyList Status Flow

### Status Change (manual)
```
PUT /api/mylist/:id/status
  → routes/mylist.js:handleUpdateMyListStatus()
  → Body: { status: 'watching'|'wish'|'completed'|'on_hold'|'dropped' }
  → Find MyList entry by animeId
  → Update status + updatedAt
  → db.saveMyList(data) — only writes mylist table
  → bangumiSync.pushStatusChange(animeId, data) — async fire-and-forget to Bangumi
```

### Auto-creation on Import
```
POST /api/import (or autoImportNewFolders)
  → After anime record saved to library
  → Create MyList entry: { animeId, status: 'watching' }
  → db.saveMyList(data)
```

### Auto-completion on Delete
```
DELETE /api/anime/:id
  → After removing anime from data.library
  → Find MyList entry → set status: 'completed'
  → db.saveMyList(data) + db.saveLibrary(data)
```

## 10. Bangumi Sync Flow

### Full Sync (Pull → Merge → Push)
```
POST /api/bangumi/sync
  → routes/bangumi.js:handleBangumiSync()
  → Body: { dryRun?: boolean }
  → bangumiSync.syncMyList(data, { dryRun })
      ├─ Pull: fetch user's Bangumi collection (anime + episodes)
      ├─ Merge: compare local MyList with Bangumi collection
      │   ├─ Local has, Bangumi doesn't → push to Bangumi
      │   ├─ Bangumi has, local doesn't → pull from Bangumi
      │   └─ Both have → reconcile by updatedAt
      └─ Push: batch update Bangumi collection
  → Return sync result (created/updated/deleted counts)
```

### Per-Item Push (on status change)
```
PUT /api/mylist/:id/status
  → After local status update
  → bangumiSync.pushStatusChange(animeId, data) — async fire-and-forget
  → Sends single status update to Bangumi API
```

## 11. Discovery Management Flow

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

## 12. Save Function Taxonomy (db.js)

| Function | Writes | When to use |
|----------|--------|-------------|
| `db.saveLibrary(data)` | anime + episode tables | Import, delete, metadata fetch, auto-import |
| `db.saveMyList(data)` | mylist table | Import, auto-import, status change |
| `db.savePlaySessions(data)` | playSession table | Play start, mpv final/error |
| `db.updateEpisodeProgress(id, n, fields)` | single episode row | mpv progress (every 10s), manual update |
| `db.updateEpisodesWatched(id, numbers[])` | batch episode rows | Auto-mark previous episodes as watched |
| `db.updatePlaySession(sid, fields)` | single playSession row | mpv progress (every 10s) |
| `db.saveAll(data)` | all tables in parallel | Composite fallback for multi-table saves |
| `saveScannedTree(tree)` | `scanned-tree.json` (sync) | Scan, exclude, unlink, metadata |

**saveLibrary uniqueness checks**: Before upserting each anime, `saveLibrary` checks:
- `bangumiId` uniqueness — if another anime already owns the same `bangumiId`, skip the current entry
- `anilistId` uniqueness — if another anime already owns the same `anilistId`, clear the old owner's AniList fields (current record wins; manual match takes priority)

### Call Site → Save Function Mapping

| Scenario | Save function used |
|----------|-------------------|
| Scan/browse | `saveScannedTree()` |
| Exclude/Include node | `saveScannedTree()` |
| Unlink anime from library | `db.saveLibrary()` + `saveScannedTree()` |
| Import (manual/auto) | `db.saveLibrary()` + `saveScannedTree()` (or `db.saveMyList()` for auto-import) |
| Delete anime | `db.saveLibrary()` + `db.saveMyList()` (status → completed) |
| Fetch metadata | `db.saveLibrary()` + `saveScannedTree()` |
| MyList status change | `db.saveMyList()` + `bangumiSync.pushStatusChange()` |
| Bangumi full sync | `bangumiSync.syncMyList()` (handles own persistence) |
| Play start | `db.savePlaySessions()` + `db.updateEpisodesWatched()` (auto-mark) |
| mpv final/error | `db.savePlaySessions()` |
| Episode progress (manual/mpv) | `db.updateEpisodeProgress()` |

### `db.loadData()` — db.js

```
async loadData() {
  ├─ ensureSchema() — auto-create tables if missing
  ├─ Read all Anime + Episode from SQLite
  ├─ Read all PlaySession from SQLite
  ├─ Read ScannedTree from SQLite (JSON stringified in single row)
  ├─ Convert Prisma models → legacy JSON format
  └─ Return → server.js assigns to global `data`
}
```

### Persistence Architecture
```
SQLite (anime.db): primary store for library, playSessions
  → Fine-grained writes: each function writes only its table
  → Full-state sync: db.saveAll() writes all three tables

scanned-tree.json: independent JSON file for scan tree
  → sync write, separate from SQLite
  → Also persisted in SQLite ScannedTree table for consistency

config.json: independent JSON file for settings
  → Managed separately, never in SQLite
```

## 13. Full HTTP Call Chain

Each API request flows through:

```
http.createServer((req, res) => {
  ├─ CORS headers (Access-Control-Allow-*)
  ├─ Parse URL + method
  ├─ Route matching:
  │   ├─ Static files: public/ (index.html, css, js, vendor/)
  │   ├─ API routes (/api/*):
  │   │   ├─ Read body (if POST/PUT/DELETE)
  │   │   ├─ Execute handler logic
  │   │   ├─ Mutate global `data` (if applicable)
  │   │   ├─ Fine-grained save (only affected table/file):
  │   │   │   ├─ db.saveLibrary() — anime/episode changes
  │   │   │   ├─ db.savePlaySessions() — play session changes
  │   │   │   ├─ db.updateEpisodeProgress() — single episode update
  │   │   │   ├─ db.updatePlaySession() — single session update
  │   │   │   └─ saveScannedTree() — scanned tree JSON
  │   │   └─ jsonResp(res, status, payload)
  │   └─ Cover/banner/thumbnail routes:
  │       ├─ /covers/* → serveImage() → ffmpeg resize pipeline
  │       ├─ /banners/* → serveImage()
  │       └─ /api/thumbnail → ffmpeg extract → serveImage()
  └─ 404 fallback
})
```

## Key Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| `server/server.js` | 430 | Initialization + route dispatch (http.createServer → routeTable → handler calls) |
| `server/lib/config.js` | 87 | Path constants, config load/save, scannedTree load/save |
| `server/lib/utils.js` | 177 | MIME, serveImage, jsonResp, readBody, ffmpeg cover helpers, cache cleanup |
| `server/routes/config.js` | 77 | GET/POST /api/config, /api/health, /api/notifications |
| `server/routes/discovery.js` | 329 | Browse, scan (SSE), import, discovery unlink/exclude/include/fetch-meta |
| `server/routes/library.js` | 240 | Library list, anime detail/delete, library sync (batch + SSE stream), AniList backfill |
| `server/routes/playback.js` | 179 | Play, progress, mpv-status, thumbnail |
| `server/routes/mylist.js` | 216 | MyList CRUD, wishlist |
| `server/routes/stats.js` | 131 | Dashboard stats, tags, seasons, ratings, watch-activity, anime sessions |
| `server/routes/bangumi.js` | 162 | Bangumi search, fetch, sync, OAuth (auth status/url/callback/logout/creds/me) |
| `server/db.js` | 732 | Prisma wrapper: saveLibrary, savePlaySessions, saveMyList, loadData, updateEpisodeProgress, updatePlaySession |
| `public/js/stats.js` | 561 | Stats view: word cloud, activity/rating/season charts |
| `server/scanner.js` | 404 | Media directory scanner, folder name parsing (anitomy) with extra video filtering, [bgmN] ID extraction |
| `server/mpv-controller.js` | 178 | mpv process spawn, IPC progress tracking, error/crash reporting |
| `server/bangumi-sync.js` | 206 | Bangumi sync orchestration: Pull→Merge→Push, OAuth status push |
| `server/scrapers/index.js` | 470 | ScraperRegistry: multi-source metadata aggregation, syncAnilist() helper |
| `server/scrapers/anilist.js` | — | Anilist GraphQL client: search (with toHiragana normalization), fetchMetadata, downloadBanner. `enabled()` defaults to true when apiSources exists but no anilist entry. |
| `server/scrapers/bangumi.js` | — | Bangumi API client + cover download |
| `server/scrapers/tmdb.js` | — | TMDB API client + cover download |
| `server/scrapers/node-fetch.js` | — | Node.js http/https fetch polyfill (pkg-compatible) |
| `scripts/copy-sidecar-deps.js` | — | Build: copies Prisma engine + ffmpeg.exe to sidecar-modules/ |
| `public/js/api.js` | — | Frontend fetch() wrapper (API.get, API.post, API.del) |
| `public/js/app.js` | — | Router, theme, toast, settings, zoom |
| `public/js/discovery.js` | — | Scan/browse UI, import panel |
| `public/js/library.js` | — | Library grid, search, sort |
| `public/js/detail.js` | — | Detail view, hero animation, episodes, heatmap, stats |
| `public/styles.css` | 3373 | All styling (dark/light theme, responsive, animations) |

## 14. AniList 双源同步 — 所有触发路径一览

AniList 同步拆分为两步：**resolveAnilistId**（轻量，仅搜索取 ID）和 **syncAnilistDetail**（重量，metadata + banner）。导入时只做第一步，banner 在详情页懒加载。

| 触发方式 | 端点/位置 | 调用方式 | 函数 | 备注 |
|---------|-----------|---------|------|------|
| 发现页手动导入 | `POST /api/import` → `discovery.js` | 元数据落盘后 `.then()` | `syncAnilist` | [bgmN] 跳过搜索，直接取元数据 |
| 详情页 banner 懒加载 | `GET /api/anime/:id` → `library.js` | 响应后异步 | `syncAnilistDetail` | `anilistId` 有但 `anilistBanner` 缺失时触发 |
| 详情页刷元数据 | `POST /api/bangumi/fetch` → `bangumi.js` | fire-and-forget `.then()` | `syncAnilist` | 重置 `-1` 重新搜索，含完整同步 |
| AniList 批量回填 | `POST /api/library/sync-anilist-backfill` → `library.js` | `await` 串行，每 5 部落盘 | `syncAnilist` | 传参 `result` 含成功/跳过/失败 |
| SSE 流式同步 | `POST /api/library/sync/stream` → `library.js` | `parallelMap` | `syncAnilist` | [bgmN] 跳过 matchSeason，ID 直取 |
| 详情页搜索框/自动匹配 | `POST /api/bangumi/search` → `bangumi.js` | `searchAll()` | — (缓存) | 搜 Bangumi 前也从 `searchAll` 经过，命中缓存跳过 API |

## 15. Thumbnail Queue

### 触发路径

| 触发点 | 文件位置 | 方式 | 优先级 |
|--------|---------|------|--------|
| Discovery 导入 | `discovery.js` handleImport | 响应后异步 | FIFO（队尾） |
| MetaMatch 同步（JSON） | `library.js` handleLibrarySync | 响应后异步 | FIFO（队尾） |
| MetaMatch 同步（SSE） | `library.js` handleLibrarySyncStream | stream `done` 后 | FIFO（队尾） |
| 详情页加载 | `library.js` handleGetAnimeDetail | 响应后异步 | **插队**（队首） |

### 队列行为

- **并发**：3 路 ffmpeg `-vframes 1`（0.5-2s/张）
- **空闲检测**：`activePlays.size === 0`，mpv 运行时暂停 → 30s 后重试
- **生成位置**：25% 时长（30-120s 区间），已知 `ep.duration` 则用，否则 60s
- **缓存键**：`md5(filePath + 'mid').jpg`，与 `time=mid` 按需生成共享缓存
- **无持久化队列**：重启后队列丢失，缩略图可重新生成
- **按需兜底**：`handleThumbnail` 保持不变，队列没来得及时即时生成

### 模块

```
server/thumbnail-queue.js
  └─ ThumbnailQueue class
      ├─ enqueue(anime, prepend=false) → 加入队列（去重：已缓存跳过）
      ├─ clear() → 清空队列
      ├─ length / busy → 状态查询
      └─ _drain() → 空闲循环 × 3 并发
```

**通用搜索缓存**：`registry._searchCache`（5 分钟 TTL）由 `searchAll()` 写入，`anilist.search()` 优先读缓存再调 API。缓存是惰性填充的——只在实际发生搜索时写入，不再有扫描时后台预取。

**AniList 限流保护**：`anilist.js` 内置全局请求队列（每次请求间隔 1.5s）+ 429 自动重试（指数退避 1.5s→3s→6s，最多 3 次）。导入时 21 部动漫的 `resolveAnilistId` 并发调用，通过共享的 `_lastRequestTime` 自动串行化，不会触发限流。

## Key Gotchas

1. **Fine-grained saves**: Each API endpoint only writes the SQLite table(s) it actually modifies. `saveScannedTree()` writes `scanned-tree.json` (sync). Never use `db.saveAll()` unless you're changing data in multiple tables simultaneously.
2. **Save order matters**: Auto-import always calls `db.saveLibrary()` before `db.saveMyList()` — MyList has a foreign key constraint on animeId, so the anime record must exist first.
3. **bangumiId as primary key**: Anime records use `String(bangumiId)` as their `id` field. This means anime identity is stable across folder renames. Manual imports (no `[bgmN]`) still use `parsedTitle + Season` scheme for backward compatibility.
4. **Fetch in pkg**: Global `fetch()` is unavailable in pkg-bundled Node.js. `node-fetch.js` polyfill with http/https native modules replaces it in scrapers.
5. **ffmpeg path**: Dev mode uses `require('ffmpeg-static')` from server/node_modules. pkg mode sets `FFMPEG_BIN` env var → `sidecar-modules/ffmpeg.exe` (copied during build by copy-sidecar-deps.js).
6. **DATA_DIR differs**: Dev = `server/`, pkg/MSI = `%APPDATA%/MyAnimeDock`. File paths (config.json, scanned-tree.json, covers/, thumbs/) all resolve through DATA_DIR.
7. **covers/ migration**: Covers downloaded in dev mode go to `server/covers/`. After MSI install, covers must be re-fetched (new AppData path). `init()` validates localCover existence and clears missing ones → gray placeholder shown.
8. **Play sessions**: `activePlays` Map is in-memory only (lost on server restart). Persisted playSessions survive in SQLite.
9. **CSS zoom** (`uiScale`): Applied via `--scale` CSS variable (`applyZoom()` in `app.js:180`). All scalable sizes use `calc(X * var(--scale))`. **禁止使用 CSS `zoom` 属性**（导致 GSAP Flip 断裂、fixed 元素错位）。
10. **mpv error propagation**: `/api/play` uses Promise with 2s timeout to capture spawn errors. `mpv-controller.js` reports ENOENT/early crashes via `onError` callback. Frontend sees "播放失败: ..." toast.
11. **nodemon data ignore**: `dev:server:watch` must ignore `server/prisma/`, `server/covers/`, `server/thumbs/`, `server/scanned-tree.json` to prevent data writes from triggering server restarts.
12. **DB path in dev mode**: `server/db.js` uses `path.join(__dirname, '..', 'prisma', 'anime.db')` — i.e. project root → `prisma/anime.db`. The SQLite database is at project root `prisma/` directory, not inside `server/`.
13. **[bgmN] extraction**: `extractBgmId()` (`scanner.js:398`) uses regex `/\[bgm(\d+)\]/i` — case-insensitive, supports `[bgm123]` and `[BGM123]`. Only the first match is returned. Must match the Bangumi subject ID exactly.
15. **Auto-mark requires DB save**: When auto-marking previous episodes as watched on play start, `db.updateEpisodesWatched()` must be called to persist to SQLite. Without this, the watched state is only in memory and lost on server restart.
16. **Persistence testing rule**: Any code that modifies in-memory state MUST be followed by a DB save call. When adding new persistence code, always write a test that verifies: (1) save to SQLite, (2) `loadData()` reload, (3) state matches expected. Testing only in-memory state catches nothing.
17. **UTC/local time in stats APIs**: `watch-activity` and `sessions` APIs compare time-series data (session startTime against current date). Use LOCAL year/month/day via `getFullYear()/getMonth()/getDate()` — never `toISOString().slice()` which converts to UTC and shifts dates in UTC+8 timezones. Session startTime is stored as UTC ISO string from `new Date().toISOString()`, parse it as `new Date()` then use local accessors for matching.
18. **AniList sync is fire-and-forget**: `syncAnilist()` runs async after the main response is sent (except backfill which `await`s sequentially). It mutates the anime object in place and calls `db.saveLibrary()` on completion. This means the frontend won't see AniList fields until the next page refresh after the async call completes. All sync paths (manual import, bangumi-fetch, backfill, MetaMatch) are covered; only `discovery/fetch-meta` is exempt because the item isn't in the library yet.
19. **Banner path conversion**: `anilistBanner` stores the absolute filesystem path (e.g., `C:\Users\...\banners\al-12345.jpg`). The frontend converts this to a URL path `/banners/al-12345.jpg` via `path.basename()` + `/banners/` prefix, matched by `handleBannerImage` in server.js.
20. **Backfill endpoint**: `POST /api/library/sync-anilist-backfill` iterates all library items without `anilistId`, calls `syncAnilist()` on each with batch save every 5 items. Returns `{ total, succeeded, failed, skipped }`. Non-blocking but slow for large libraries.
18. **ep.progress is always 0-1**: The Episode model has `progress Float @default(0) // 0-1`. mpv IPC reports time-pos in seconds; the `onProgress` callback normalizes via `Math.min(1, Math.max(0, timePos / duration))` before storing. When resuming, convert 0-1 progress to seconds using `ep.duration * progress` for `--start` and `progressStart`.
21. **AniList enabled() defaults to true**: `AniListScraper.enabled(config)` returns true when `apiSources` exists but has no anilist entry, or when anilist entry has no `enabled` field. Only `enabled: false` explicitly disables it. This matches the comment "AniList is free, enabled by default".
22. **anilistId uniqueness in saveLibrary**: `saveLibrary()` checks `anilistId` uniqueness before upsert. If another anime already owns the same `anilistId`, the old owner's AniList fields are cleared (current record wins). This supports manual re-matching where the user intentionally overrides an existing AniList association.
23. **syncAnilist katakana normalization**: `syncAnilist()` applies `toHiragana()` (Unicode offset U+30A1-30F6 → U+3041-3096) to search terms before querying AniList. This handles Bangumi returning katakana titles (e.g., "ハイ") that AniList stores as hiragana ("はい"), which would otherwise return 0 search results.
24. **[bgmN] MetaMatch 跳过搜索**: SSE 流式同步和批量同步中，有 `bangumiId` 的条目直接 `fetchMetadata('bangumi', id)` 取元数据，跳过 `matchSeason()` 的多轮搜索 + 季度链。`matchedSeason` 从条目已有值保留。非 [bgmN] 条目仍走完整搜索路径。
