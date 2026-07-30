# Startup Init + Config 流

## 启动初始化

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

### 端口回退机制

```
server.init()
  └─ PORT_RANGE = 5（BASE_PORT 3456 → 3460）
      ├─ 尝试 BASE_PORT（3456）
      │   ├─ 成功 → actualPort = 3456
      │   └─ EADDRINUSE → 尝试 +1
      └─ 写入 .port 文件（供 Tauri 侧读取）
          └─ 路径：DATA_DIR/.port（dev: server/, pkg: %APPDATA%/MyAnimeDock/）
```

### Tauri 侧启动（生产/MSI 模式）

```
main.rs setup()
  ├─ 1. 单实例保护（tauri-plugin-single-instance）
  │     └─ 第二次启动 → 把已有窗口唤起到前台
  ├─ 2. 启动 sidecar（Node.js 后端，仅 release/TAURI_PROD=1 时）
  ├─ 3. 等待 server 就绪（10s 等 .port，22.5s 等 /api/health）
  └─ 4. 导航窗口到 http://localhost:{actualPort} 并显示
```

### Gotchas

- **`.port` 文件无锁保护**：从前两个 sidecar 同时写 `.port` 会相互覆盖，导致 Tauri 读到错误端口。单实例保护通过阻止第二个进程彻底解决此问题。
- **`core.json` remote URLs 必须通配端口**：`"urls": ["http://localhost:3456"]` 无法匹配 3457+，端口回退后 `__TAURI__` API 全部失效。使用 `"http://localhost:*"`。
- **前端 origin 检测必须协议级**：`window.location.origin === 'http://localhost:3456'` 在端口回退后条件为 false，视图函数静默跳过。使用 `window.location.origin.startsWith('http')`。

## Config 流

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

### Data Files

| File | Location (dev) | Location (MSI/pkg) | Purpose |
|------|---------------|-------------------|---------|
| `anime.db` | `prisma/anime.db` | `%APPDATA%/MyAnimeDock/anime.db` | SQLite — primary store for library, playSessions |
| `config.json` | `server/config.json` | `%APPDATA%/MyAnimeDock/config.json` | Settings (JSON only, managed by lib/config.js) |
| `scanned-tree.json` | `server/scanned-tree.json` | `%APPDATA%/MyAnimeDock/scanned-tree.json` | Scan result tree (JSON only, managed by lib/config.js) |
| `covers/*.jpg` | `server/covers/` | `%APPDATA%/MyAnimeDock/covers/` | Downloaded cover images |
| `banners/*.jpg` | `server/banners/` | `%APPDATA%/MyAnimeDock/banners/` | AniList banner images |
| `thumbs/*.jpg` | `server/thumbs/` | `%APPDATA%/MyAnimeDock/thumbs/` | Video thumbnails (ffmpeg) |
