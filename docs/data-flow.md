# MyAnimeDock — Data Flow 枢纽

涉及数据持久化、API 端点、或数据模型改动时，根据改动范围选读对应子文件。

## 流一览

| 流 | 文件 | 涉及场景 |
|----|------|----------|
| 启动初始化 + Config 读写 | `docs/data-flow/startup-config.md` | 改 init(), config.json, 数据文件路径 |
| 媒体扫描 + Discovery 管理 | `docs/data-flow/scan-discovery.md` | 改 scanner, browse, exclude/include/unlink |
| 导入 + Metadata 获取 + AniList 同步 | `docs/data-flow/import-metadata.md` | 改 import, fetch, scrapers, AniList 双源 |
| Play Session 追踪 | `docs/data-flow/play-sessions.md` | 改播放, progress, stats 图表 |
| Cover + Thumbnail 服务 | `docs/data-flow/covers-thumbnails.md` | 改 cover 服务, ffmpeg 缩略图, thumbnail queue |
| MyList 状态 + Bangumi 同步 | `docs/data-flow/mylist-sync.md` | 改 mylist, status, bangumi-sync |
| Save 函数分类 (db.ts) | `docs/data-flow/save-taxonomy.md` | 改 db.ts save/load, 了解持久化架构 |
| HTTP 完整调用链 | `docs/data-flow/http-call-chain.md` | 理解请求→响应通用路径 |
| 跨领域陷阱 | `docs/data-flow/gotchas.md` | 交叉陷阱速查 |

## 架构概览

```
┌─ Tauri Shell (Rust) ─────────────────────────────────────────────┐
│  src-tauri/src/main.rs                                            │
│    • Spawns sidecar (Node.js server.exe)                          │
│    • Monitors sidecar exit → closes window                        │
│    • Hides window until server ready (visible:false → show())     │
│    • In production: navigates to http://localhost:3456 after ready│
│                                                                   │
│  Sidecar: server/server.ts → lib/ + routes/ (Node.js, pkg-bundled)│
│    • HTTP server @ :3456                                          │
│    • Routes: config, discovery, library, playback, mylist, stats, │
│      bangumi — each exports handler(req, res, state)              │
│    • Persistence: SQLite (better-sqlite3) — library/playSessions    │
│    • JSON files: config.json, scanned-tree.json                   │
│    • Static files: frontend/dist/ covers/ thumbs/                  │
│    • ffmpeg: thumbnail extraction + cover resize                  │
└──────────────────────────────────────────────────────────────────┘
```

## 关键约束

- Anime 主键统一 UUID（`crypto.randomUUID()`）；`bangumiId` 为内容身份（唯一索引），手动导入不再用 `parsedTitle + Season`
- 细粒度写入：每个 API 只写实际修改的表，不调全量 `saveData()`
- AniList 是 Bangumi 的补充源，仅罗马音 + seasonChain + banner
- SSE-only MetaMatch（`/api/library/sync/stream`），无 batch fallback
- 播放器只支持 mpv（`--input-ipc-server` IPC 管道）
- DATA_DIR: dev=`server/`（config/scanned-tree 等）、DB 在 `<项目根>/data/anime.db`；pkg=`%APPDATA%/MyAnimeDock`

> 详见各子文件及 `docs/dev/backend.md` 后端开发规范。
