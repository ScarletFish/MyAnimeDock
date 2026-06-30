---
name: data-flow
description: Complete data flow reference for MyAnimeDocker — covers all 10 major data flows: config, scan/discovery, import, metadata fetch, play sessions, memories, covers/thumbnails, SQLite persistence, startup init, full call chain. Load this skill when you need to understand how data moves through the system, before making changes to data paths, or when debugging data persistence issues.
---

# MyAnimeDocker — Complete Data Flow Reference

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
│  Sidecar: server/server.js (Node.js, pkg-bundled)                            │
│    • HTTP server @ :3456                                                      │
│    • REST API (40+ endpoints)                                                 │
│    • Persistence: SQLite (Prisma ORM) — library/memories/playSessions         │
│    • JSON files: config.json (settings), scanned-tree.json (scan result)      │
│    • Static file serving: public/ frontend + covers/ + thumbs/                │
│    • ffmpeg: thumbnail extraction + cover resize                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Files

| File | Location (dev) | Location (MSI/pkg) | Purpose |
|------|---------------|-------------------|---------|
| `anime.db` | `prisma/anime.db` | `%APPDATA%/com.myanimedocker.app/anime.db` | SQLite — primary store for library, memories, playSessions |
| `config.json` | `server/config.json` | `%APPDATA%/com.myanimedocker.app/config.json` | Settings (JSON only, managed by server.js) |
| `scanned-tree.json` | `server/scanned-tree.json` | `%APPDATA%/com.myanimedocker.app/scanned-tree.json` | Scan result tree (JSON only, managed by server.js) |
| `anime-data.json` | (legacy) | (legacy) | **Removed**. Only used as migration fallback for scannedTree on first startup |
| `covers/*.jpg` | `server/covers/` | `%APPDATA%/com.myanimedocker.app/covers/` | Downloaded cover images |
| `thumbs/*.jpg` | `server/thumbs/` | `%APPDATA%/com.myanimedocker.app/thumbs/` | Video thumbnails (ffmpeg) |

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
  │     (SQLite is the PRIMARY store for library/memories/playSessions)
  │     ├─ Anime + Episode records → data.library
  │     ├─ Memory records → data.memories
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
  └─ 7. Start HTTP server (http.createServer, listen :3456)
```

## 2. Config Flow

### Read: `GET /api/config`
```
server.js:handleRequest()
  → /api/config (line ~360)
  → jsonResp(res, 200, { ...config, dirValid })
    dirValid = fs.existsSync(config.mediaDir)
```

### Write: `POST /api/config`
```
server.js:handleRequest()
  → /api/config (line ~400)
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
| `theme` | string | `"dark"` | `"dark"` or `"light"` |
| `uiScale` | number | `100` | 75–150, applied as CSS rem font-size |
| `scrapers.bangumi.enabled` | bool | `true` | Enable Bangumi metadata |
| `scrapers.bangumi.apiBase` | string | `"https://api.bgm.tv"` | Bangumi API mirror |
| `scrapers.tmdb.enabled` | bool | `false` | Enable TMDB (needs API Key) |
| `tmdbApiKey` | string | `""` | TMDB API Key |

## 3. Scan / Discovery Flow

```
GET /api/browse?showExcluded
  → server.js (line ~260)
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
  → server.js (line ~280)
  → Sets res.headers: Content-Type: text/event-stream, Cache-Control: no-cache
  → scanner.scanMediaDirFlat() with progress callback:
      write `data: ${JSON.stringify({ type: 'progress'|'done', ... })}\n\n`
  → Connection stays open until scan completes
```

## 4. Import Flow

```
POST /api/import
  → server.js (line ~310)
  → Body: { items: [{ path, name, parsedTitle, parsedSeason, specialSuffix, ... }] }
  → For each item:
      ├─ Generate animeId = `${parsedTitle}${parsedSeason ? '-Season '+parsedSeason : ''}`
      ├─ Build anime + episodes in data.library[]:
      │   { id, title, folderName, folderPath, season, specialSuffix,
      │     episodes: [{ animeId, episodeNumber, filePath, fileName, fileSize }] }
      ├─ Mark node.alreadyImported = true in scannedTree
      └─ db.saveLibrary(data) + saveScannedTree(scannedTree)
  → jsonResp(res, 200, { count: N })
```

## 5. Metadata Fetch Flow

```
POST /api/discovery/fetch-meta (for scanned items)
POST /api/bangumi/fetch (for library items)
  → server.js
  → coverDir = path.join(DATA_DIR, 'covers')
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
  → Update node/anime metadata fields
  → db.saveLibrary(data) + saveScannedTree(scannedTree)
```

## 6. Cover Serving Flow

### Dev mode (`server/covers/`):
```
GET /covers/12345.jpg?w=400&q=75
  → server.js (line ~970)
  → serveImage(coverPath, req.url, res)
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
DATA_DIR = %APPDATA%/com.myanimedocker.app
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
  → server.js (line ~915)
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
server.js: const ffmpegPath = require('ffmpeg-static') || 'ffmpeg';
  → Dev: resolves to server/node_modules/ffmpeg-static/ffmpeg.exe
  → pkg: db.js sets process.env.FFMPEG_BIN → sidecar-modules/ffmpeg.exe
         (ffmpeg-static reads FFMPEG_BIN env var first)
  → Fallback: 'ffmpeg' (system PATH)
```

## 8. Play Session Flow

### Play Start
```
POST /api/play
  → server.js (line ~831)
  → Body: { filePath, position }
  → Validate filePath exists (fs.existsSync)
  → Always mpv (system player removed):
      ├─ Find targetAnime/targetEp from data.library
      ├─ Create playSession record in data.playSessions
      ├─ activePlays.set(filePath, { sessionId, episode, anime })
      ├─ db.savePlaySessions(data) — only writes playSession table
      ├─ startMpv(mpvPath, filePath, position, callbacks):
      │   ├─ Spawn mpv with IPC pipe (--input-ipc-server)
      │   ├─ onProgress (every 10s) → db.updateEpisodeProgress() + db.updatePlaySession()
      │   ├─ onError → clean up session, return error to frontend via Promise
      │   └─ onClose (code≠0 && lived<3s) → report crash to frontend
      ├─ await Promise with 2s timeout (capture sync spawn errors)
      └─ Return 200 OK or 500 { error: msg }
```

### Progress Update (manual via API)
```
POST /api/progress
  → server.js (line ~942)
  → Body: { animeId, episodeNumber, progress, duration, watched }
  → Update ep.progress/duration/watched in memory
  → db.updateEpisodeProgress(animeId, epNumber, { progress, duration, watched })
    (only writes episode table, no full saveAll)
```

### Watch Stats
```
GET /api/anime/:id/sessions
  → server.js (line ~950)
  → Query data.playSessions filtered by animeId
  → Return last 90 days grouped by date
  → Frontend: Canvas bar chart in detail.js renderWatchStats()
```

## 9. Memory Flow

### List
```
GET /api/memories
  → server.js (line ~160)
  → Return data.memories[] sorted by updatedAt desc
  → Frontend: memory-masonry grid (cards with cover + rating + thoughts)
```

### Create / Update
```
POST /api/memories
  → server.js (line ~170)
  → Body: { animeId, title, coverLocal, coverUrl, rating, thoughts, notes,
             episodesWatched, totalEpisodes }
  → Upsert: find by animeId → update, or create new
  → db.saveMemories(data) — only writes memory table
  → Frontend: open archive modal from detail view or memory page
```

## 10. Save Function Taxonomy (db.js)

| Function | Writes | When to use |
|----------|--------|-------------|
| `db.saveLibrary(data)` | anime + episode tables | Import, delete, metadata fetch |
| `db.saveMemories(data)` | memory table | Archive create/update |
| `db.savePlaySessions(data)` | playSession table | Play start, mpv final/error |
| `db.updateEpisodeProgress(id, n, fields)` | single episode row | mpv progress (every 10s), manual update |
| `db.updatePlaySession(sid, fields)` | single playSession row | mpv progress (every 10s) |
| `db.saveAll(data)` | all three tables in parallel | Composite fallback for multi-table saves |
| `saveScannedTree(tree)` | `scanned-tree.json` (sync) | Scan, exclude, unlink, metadata |

### Call Site → Save Function Mapping

| Scenario | Save function used |
|----------|-------------------|
| Scan/browse/exclude/unlink/fetch-meta | `saveScannedTree()` |
| Import, delete anime, bangumi fetch | `db.saveLibrary()` + `saveScannedTree()` |
| Memory create/update | `db.saveMemories()` |
| Play start, mpv final/error cleanup | `db.savePlaySessions()` |
| Episode progress (manual/mpv) | `db.updateEpisodeProgress()` |

### `db.loadData()` — db.js

```
async loadData() {
  ├─ ensureSchema() — auto-create tables if missing
  ├─ Read all Anime + Episode from SQLite
  ├─ Read all Memory from SQLite
  ├─ Read all PlaySession from SQLite
  ├─ Read ScannedTree from SQLite (JSON stringified in single row)
  ├─ Convert Prisma models → legacy JSON format
  └─ Return → server.js assigns to global `data`
}
```

### Persistence Architecture
```
SQLite (anime.db): primary store for library, memories, playSessions
  → Fine-grained writes: each function writes only its table
  → Full-state sync: db.saveAll() writes all three tables

scanned-tree.json: independent JSON file for scan tree
  → sync write, separate from SQLite
  → Also persisted in SQLite ScannedTree table for consistency

config.json: independent JSON file for settings
  → Managed separately, never in SQLite
```

## 11. Full HTTP Call Chain

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
  │   │   │   ├─ db.saveMemories() — memory changes
  │   │   │   ├─ db.savePlaySessions() — play session changes
  │   │   │   ├─ db.updateEpisodeProgress() — single episode update
  │   │   │   ├─ db.updatePlaySession() — single session update
  │   │   │   └─ saveScannedTree() — scanned tree JSON
  │   │   └─ jsonResp(res, status, payload)
  │   └─ Cover/thumbnail routes:
  │       ├─ /covers/* → serveImage() → ffmpeg resize pipeline
  │       └─ /api/thumbnail → ffmpeg extract → serveImage()
  └─ 404 fallback
})
```

## Key Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| `server/server.js` | ~1499 | HTTP server, routes, fine-grained saves, init, play sessions, cover serving |
| `server/db.js` | ~465 | Prisma wrapper: saveLibrary, saveMemories, savePlaySessions, loadData, updateEpisodeProgress, updatePlaySession |
| `server/scanner.js` | ~372 | Media directory scanner, folder name parsing (anitomy) with extra video filtering |
| `server/mpv-controller.js` | ~177 | mpv process spawn, IPC progress tracking, error/crash reporting |
| `server/scrapers/index.js` | ~557 | ScraperRegistry: multi-source metadata aggregation |
| `server/scrapers/bangumi.js` | — | Bangumi API client + cover download |
| `server/scrapers/tmdb.js` | — | TMDB API client + cover download |
| `server/scrapers/node-fetch.js` | — | Node.js http/https fetch polyfill (pkg-compatible) |
| `scripts/copy-sidecar-deps.js` | — | Build: copies Prisma engine + ffmpeg.exe to sidecar-modules/ |
| `public/js/api.js` | — | Frontend fetch() wrapper (API.get, API.post, API.del) |
| `public/js/app.js` | — | Router, theme, toast, settings, zoom |
| `public/js/discovery.js` | — | Scan/browse UI, import panel |
| `public/js/library.js` | — | Library grid, search, sort |
| `public/js/detail.js` | — | Detail view, hero animation, episodes, heatmap, stats |
| `public/js/memory.js` | — | Memories grid, archive |
| `public/styles.css` | 3373 | All styling (dark/light theme, responsive, animations) |

## Key Gotchas

1. **Fine-grained saves**: Each API endpoint only writes the SQLite table(s) it actually modifies. `saveScannedTree()` writes `scanned-tree.json` (sync). Never use `db.saveAll()` unless you're changing data in multiple tables simultaneously.
2. **Fetch in pkg**: Global `fetch()` is unavailable in pkg-bundled Node.js. `node-fetch.js` polyfill with http/https native modules replaces it in scrapers.
3. **ffmpeg path**: Dev mode uses `require('ffmpeg-static')` from server/node_modules. pkg mode sets `FFMPEG_BIN` env var → `sidecar-modules/ffmpeg.exe` (copied during build by copy-sidecar-deps.js).
4. **DATA_DIR differs**: Dev = `server/`, pkg/MSI = `%APPDATA%/com.myanimedocker.app`. File paths (config.json, scanned-tree.json, covers/, thumbs/) all resolve through DATA_DIR.
5. **covers/ migration**: Covers downloaded in dev mode go to `server/covers/`. After MSI install, covers must be re-fetched (new AppData path). `init()` validates localCover existence and clears missing ones → gray placeholder shown.
6. **Play sessions**: `activePlays` Map is in-memory only (lost on server restart). Persisted playSessions survive in SQLite.
7. **CSS zoom** (`uiScale`): Applied via `document.documentElement.style.fontSize = (16 * scale/100) + 'px'`. All font sizes use rem units. Card grid min widths also in rem.
8. **mpv error propagation**: `/api/play` uses Promise with 2s timeout to capture spawn errors. `mpv-controller.js` reports ENOENT/early crashes via `onError` callback. Frontend sees "播放失败: ..." toast.
9. **nodemon data ignore**: `dev:server:watch` must ignore `server/prisma/`, `server/covers/`, `server/thumbs/`, `server/scanned-tree.json` to prevent data writes from triggering server restarts.
10. **DB path in dev mode**: `server/db.js` uses `path.join(__dirname, '..', 'prisma', 'anime.db')` — i.e. project root → `prisma/anime.db`. The SQLite database is at project root `prisma/` directory, not inside `server/`.
