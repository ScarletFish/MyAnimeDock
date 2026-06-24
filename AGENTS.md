# MyAnimeDocker

Vanilla JS SPA + Node.js HTTP server. 自托管动漫媒体库管理器。

## Commands

```bash
npm run dev:server   # Start Node.js server on port 3456
npm run dev:server:watch  # Nodemon 自动重启（监听 server/ + public/ 变化）
npm run dev:tauri    # Start Tauri dev window (requires server running first)
npm run dev          # Start both server (nodemon) + Tauri concurrently (single terminal)
npm run build        # Build pkg sidecar + Tauri MSI/NSIS installer
npm run build:server # Build standalone pkg sidecar executable
npm run build:exe    # Build Tauri release EXE only (no MSI/NSIS, ~1min)
npm run check:rust   # Fast Rust type-check (cargo check, ~20s)
npm run dev:prod     # Build sidecar + Tauri dev with production flow (sidecar spawn, visible:false, health polling)
npm run prisma:generate  # Regenerate Prisma client
npm run prisma:migrate   # Create/apply Prisma migrations
npm run prisma:studio    # Open Prisma Studio (SQLite browser)
node scripts/migrate-to-sqlite.js  # 从 JSON 迁移数据到 SQLite（一次性）
start.bat             # Windows 菜单：开发/构建/清理/prisma 操作
```

## API Endpoints

```bash
GET  /api/config              # Get config (+ dirValid)
POST /api/config              # Update config (mediaDir, playerMode, mpvPath, theme, apiSources)
GET  /api/browse?showExcluded # List scanned tree (flat leaves)
GET  /api/scan                # SSE scan progress
POST /api/import              # Import selected items
POST /api/discovery/unlink    # Remove from library, keep in scannedTree
POST /api/discovery/exclude   # Mark node excluded from scan
POST /api/discovery/include   # Remove excluded mark
POST /api/discovery/fetch-meta# Fetch metadata (Bangumi/TMDB)
GET  /api/library             # List library
GET  /api/anime/:id           # Anime detail
DELETE /api/anime/:id         # Remove from library (archive to memories)
GET  /api/anime/:id/sessions  # Watch stats (90 days)
POST /api/play                # Play video (system/mpv)
POST /api/progress            # Update episode progress
POST /api/bangumi/search      # Search all enabled scrapers
POST /api/bangumi/fetch       # Fetch metadata for library item
GET  /api/mpv-status          # Active mpv sessions
POST /api/quit                # Shutdown server
GET  /api/health              # Tauri readiness polling
GET  /api/thumbnail?path=&time # Video thumbnail (ffmpeg)
GET  /covers/xxx.jpg?w=&q=    # Dynamic cover resize (ffmpeg)
POST /api/library/sync        # Batch metadata sync (JSON)
GET  /api/library/sync/stream # SSE batch sync (流式，支持取消)
GET  /api/memories            # List memories
POST /api/memories            # Create/update memory
```

## Architecture

**Monolithic Node.js** (no framework), **vanilla HTML/CSS/JS frontend** (no bundler).
**Desktop shell:** Tauri v2 (Rust) with Node.js sidecar.

```
server/            → Tauri sidecar (Node.js backend)
├── server.js      → HTTP server + REST API (@ :3456)
├── db.js          → Prisma 封装层（loadData / syncToSqlite / shutdown）
├── scanner.js     → 扫描媒体目录，解析文件夹名（anitomy 增强）
│   ├── scanMediaDirFlat() → 返回扁平 leaf 数组（含 parentChain）
│   ├── buildLeaf()        → 单条目构造（parentChain 回溯处理 Season 文件夹）
│   └── parseFolderName()  → 使用 anitomy 提取标题和季号，回退到正则清洗
├── scrapers/      → 多源刮削架构
│   ├── index.js   → ScraperRegistry（统一注册、优先级、批量搜索 + Sorensen-Dice 模糊匹配 + 搜索结果缓存 5min TTL）
│   ├── node-fetch.js → pkg 兼容的 fetch polyfill（http/https 原生模块）
│   ├── bangumi.js → Bangumi API（curl fallback）
│   ├── anilist.js → AniList GraphQL API（免费无需 Key，含 seasonChain 提取）
│   └── tmdb.js    → TMDB API（需配置 API Key）
├── mpv-controller.js → mpv 进度追踪（spawn + --term-status-msg，final 标记）
├── logger.js      → 结构化日志（debug/info/warn/error + [TAG] 前缀，LOG_LEVEL 环境变量控制）
└── package.json   → Sidecar dependencies (pkg target)
src-tauri/         → Tauri v2 desktop shell (Rust)
├── src/main.rs    → Sidecar spawning + window management
├── tauri.conf.json → Window config, externalBin, capabilities (v2)
├── capabilities/  → v2 permissions (fs.json, shell.json)
└── icons/         → App icons (ico, png)
prisma/            → SQLite schema + migrations
├── schema.prisma  → Anime, Episode, PlaySession, Memory, ScannedTree, Config
├── anime.db       → SQLite database file
└── migrations/    → Versioned migration history
public/            → 前端静态文件（无构建步骤）
├── index.html
├── styles.css
└── js/
    ├── api.js         → fetch() 封装
    ├── app.js         → 路由、主题、toast、设置页
    ├── discovery.js   → 发现/扫描视图（扁平卡片列表 + 兄弟组连续竖线 + 右侧详情抽屉）
    ├── library.js     → 资料库网格
    ├── detail.js      → 详情 + GSAP Flip Hero 动画 + 右侧 3 模块
    │                   （继续播放卡片 / 剧集热力图 / 观看统计图表）
    ├── metamatch.js   → MetaMatch 批量元数据匹配工作台（列表+面板布局，SSE 流式同步）
    └── memory.js      → 观看记录
scripts/            → 构建/迁移工具
├── copy-sidecar-deps.js   → pkg 打包后复制原生模块（Prisma 引擎 + ffmpeg）
└── migrate-to-sqlite.js   → JSON → SQLite 数据迁移（一次性）
```

**数据持久化**: SQLite (Prisma ORM)，规范化表 (Anime, Episode, PlaySession, Memory) + JSON 列 (ScannedTree, Config)。
运行时保持 JSON + SQLite 双写：`saveData()` 同步写入 JSON（立刻落盘），异步同步到 SQLite（副本保证）。
`init()` 时从 JSON 加载最新数据，再从 SQLite 回填确保一致性。

**scannedTree 叶子节点字段**：
```json
{
  "name": "文件夹名",
  "path": "完整路径",
  "type": "leaf",
  "parsedTitle": "解析出的标题",
  "parsedSeason": 1,
  "videoCount": 12,
  "totalSize": 123456789,
  "videos": [{"name": "ep01.mkv", "size": 12345678}],
  "parentChain": ["父文件夹"],
  "alreadyImported": true,
  "excluded": false,
  "bangumiMatched": true,
  "bangumiId": 12345,
  "bangumiTitle": "中文标题",
  "bangumiTitleJp": "日文标题",
  "summary": "简介",
  "coverUrl": "https://...",
  "localCover": "covers/12345.jpg",
  "rating": 8.7,
  "metadataSource": "bangumi"
}
```

**视图切换**: CSS `hidden` class toggle，无客户端路由器。

## Key Patterns

- **API 调用**: `await API.get('/api/...')`, `API.post()`, `API.del()`（`api.js` 封装）
- **XSS 防护**: 所有用户数据用 `escHtml()` / `escAttr()` 包裹
- **封面动画**: `detail.js` 中 `animateHeroCoverFlip()` — GSAP Flip，创建 `position:fixed` overlay，`Flip.getState()` → DOM 变化 → `Flip.from(state, { absolute: true })`
- **主题**: CSS 自定义属性，`[data-theme="light"]` 覆盖深色变量
- **图片动态缩放**: ffmpeg 实时缩放（替代已移除的 sharp），列表缩略图 `/covers/xxx.jpg?w=400&q=75`，详情页 `/covers/xxx.jpg?w=540&q=80`；首请求生成后缓存到 `covers/.resized/`
- **视频缩略图**: ffmpeg `-ss {time} -i "{path}" -vframes 1 -q:v 5` 截帧，缓存到 `thumbs/`，API `/api/thumbnail?path=&time=`
- **播放会话追踪**: mpv 模式在服务器内存维护 `activePlays` Map（`filePath → {sessionId, episode, anime}`），每 10s `saveData` 更新进度，mpv 关闭时 `final: true` 标记落盘
- **剧集热力图**: `detail.js` 中 `renderEpisodeHeatmap()` — 10 列色块网格（未观看/观看中/已观看），`addEventListener('click')` 绑定播放（此组件有意违反 onclick 约定）
- **观看统计**: `detail.js` 中 `renderWatchStats()` — Canvas 柱状图，数据来自 `GET /api/anime/:id/sessions`；无数据时整个 `#watchStats` 模块隐藏
- **详情页导航箭头**: `detail.js` 中 `initDetailNav()` — 左右边缘热区（50px）显示 SVG 箭头，点击/键盘 ArrowLeft/Right 切换动漫；顶部全宽热区（48px）显示 X 图标，点击返回资料库
- **导航动画锁定**: `slideToAnime()` 中 `isSliding` 标志 + `document.body.style.pointerEvents = 'none'` 防止动画期间重复点击；`goPrev()`/`goNext()` 开头有 early guard
- **拼音搜索**: `server.js` 中 `/api/library` 返回的 `pinyinTitle` 去掉声调（`normalize('NFD')` + 去除组合变音符号）；`library.js` 中 `renderLibrary()` 同时匹配 `title`/`bangumiTitle`/`pinyinTitle`
- **浅色模式修正**: Canvas 图表色值根据 `data-theme` 切换（`rgba(44,36,24,...)` vs `rgba(237,232,226,...)`）；`.watch-card-title` 固定 `color: #fff`；`.season-badge` 在卡片覆盖层内使用白色文字；修复未定义的 `--text1`/`--text2`/`--text3` 变量
- **GSAP 引用**: `public/vendor/gsap/`（从 `node_modules/gsap/dist/` 拷贝），不经过 npm 构建；`index.html` 中 `<script>` 直接加载
- **Discovery 扁平扫描**: `data.scannedTree` 存扁平 leaf 数组（含 `parentChain`），旧树格式（`branch` 节点）在 `/api/browse` 时自动递归展平为 leaf，无需重扫
- **兄弟组连续竖线**: `discovery.js` 中 `renderDiscovery()` 按 `parentChain` 分组，连续同 parent 的卡片包裹于 `.discovery-sibling-group`，其 `::before` 绘制 3px 垂直 accent 线（`position: absolute; left: -10px`，不参与布局）
- **滚动条隐藏**: `html { overflow: hidden }` 禁用页面滚动条；`.main-content` 设为独立滚动容器，`scrollbar-width: none` + `::-webkit-scrollbar { display: none }` 彻底隐藏
- **多源刮削**: `scrapers/index.js` → `ScraperRegistry` 统一注册、优先级、批量搜索；`bangumi.js`/`tmdb.js` 实现统一接口
- **内联操作**: 卡片内直接显示「取消导入」「排除」「取消排除」按钮，无需详情抽屉
- **数据持久化双写**: `saveData()` 同步写 JSON（立即落盘）+ 异步同步到 SQLite；`init()` 优先加载 JSON（最新版本），再从 SQLite 回填确保一致性
- **MetaMatch 批量匹配**: `metamatch.js` 列表+面板布局，SSE 流式同步 `/api/library/sync/stream`，支持取消、重试失败项、手动修正搜索
- **AniList 刮削**: `scrapers/anilist.js` — GraphQL API，免费无需 Key，返回 `seasonChain` 数据用于季度关系分析；扫描后自动后台预取
- **季度匹配**: Anime 表 `matchedSeason`/`totalSeasons` 字段（Prisma schema），由 AniList `extractSeasonChain()` 提取
- **结构化日志**: `server/logger.js` — `debug/info/warn/error` + `[TAG]` 前缀，`logger.child('[TAG]')` 模块级标签，`LOG_LEVEL` 环境变量控制
- **Sorensen-Dice 模糊匹配**: `scrapers/index.js` 中 `sorensenDice()` 用于搜索结果匹配，5 分钟 TTL 缓存避免重复请求

## Config

```json
{
  "mediaDir": "",
  "playerMode": "system",
  "mpvPath": "mpv",
  "theme": "dark",
  "uiScale": 100,
  "scrapers": {
    "bangumi": { "enabled": true, "apiBase": "https://api.bgm.tv" },
    "tmdb": { "enabled": false }
  },
  "tmdbApiKey": ""
}
```

定义于 `server/config.example.json`（同级目录），复制为 `server/config.json` 使用。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mediaDir` | string | `""` | 动漫文件夹根目录 |
| `playerMode` | string | `"system"` | `"system"`（系统播放器）或 `"mpv"`（mpv + 进度追踪） |
| `mpvPath` | string | `"mpv"` | mpv 可执行文件路径 |
| `theme` | string | `"dark"` | `"dark"` 或 `"light"` |
| `uiScale` | number | `100` | UI 缩放百分比 75-150 |
| `scrapers.bangumi.enabled` | bool | `true` | 启用 Bangumi |
| `scrapers.bangumi.apiBase` | string | `"https://api.bgm.tv"` | 可换为镜像 `https://api.bangumi.one` |
| `scrapers.tmdb.enabled` | bool | `false` | 启用 TMDB（需 API Key） |
| `tmdbApiKey` | string | `""` | TMDB API Key |

**注意**: Discovery（发现）视图执行扫描后显示候选列表供用户勾选导入，支持排除/取消关联/获取元数据等管理操作。

## Play Sessions（播放会话追踪）

mpv 模式下自动记录播放进度到 `anime-data.json` 和 SQLite。

```json
{
  "playSessions": [
    {
      "animeId": "string",
      "episodeNumber": 1,
      "sessionId": "timestamp-random",
      "startTime": "ISO 8601",
      "endTime": "ISO 8601",
      "duration": 600,       // 内容进度秒数 (endPos - startPos)
      "clockTime": 620,      // 挂钟秒数 (endTime - startTime)
      "progressStart": 0
    }
  ]
}
```

**服务器内存**: `activePlays` Map（`filePath → {sessionId, episode, anime}`），`onProgress` 回调通过此 Map 直接修改剧集引用，每 10 秒落盘。mpv 关闭时 `final: true` 标记触发最终保存和 Map 清理。

## Gotchas

- Bangumi API 受代理影响时 fallback 到 `curl`（`scrapers/bangumi.js` 中自动检测）
- `anime-data.json` 和 `config.json` 在 `.gitignore` 中，不会提交
- 标题解析依赖 `anitomy`（TypeScript 移植版，纯 JS 无原生模块），pkg 打包无额外步骤
- 视频缩略图依赖 `ffmpeg`（PATH 中可用），生成时缓存到 `thumbs/` 目录，首次请求可能延迟
- 无认证/授权，局域网内 `/api/quit` 可关闭服务器
- mpv 通过 `spawn` + `--term-status-msg` 启动，解析 stderr 获取状态（JSON 格式 `{"time-pos":...,"duration":...,"pause":...}`），不依赖任何第三方模块
- `activePlays` Map（`filePath → {sessionId, episode, anime}`）仅存内存，服务器重启后丢失；持久化的 `playSessions` 保存在 SQLite/JSON
- 动漫 ID 由 `parsedTitle + (parsedSeason ? '-Season ' + parsedSeason : '')` 生成，重命名文件夹会导致 ID 变化
- 系统播放器模式不追踪播放时长（无可编程回调），只有 mpv 模式会写入 `playSessions`
- pkg 打包用 `process.pkg ? path.dirname(process.execPath) : __dirname` 处理路径
- TMDB API 需要配置 API Key 才能启用（设置页填入）
- 旧格式 `branch` 节点在 `/api/browse` 时自动递归展平为 leaf，无需手动重扫描
- Tauri 开发模式：sidecar 不自动启动，需先运行 `npm run dev:server`，再运行 `npm run dev:tauri`
- Tauri 生产构建：`npm run build`（先 pkg 打包 sidecar，然后 Tauri 构建 MSI/NSIS），依赖 Rust MSVC 工具链
- Cargo mirror：清华源配置在 `src-tauri/.cargo/config.toml`
- 构建缓存：`src-tauri/target/` 可达 5GB+，可安全删除后重新构建
- pkg 打包 sidecar 后输出到 `src-tauri/server-x86_64-pc-windows-msvc.exe`，copy-sidecar-deps.js 复制原生模块到 `src-tauri/sidecar-modules/`
- **DATA_DIR 差异**：dev 模式 DATA_DIR = `server/`；pkg/MSI 模式 DATA_DIR = `%APPDATA%/com.myanimedocker.app`
- **数据加载顺序**：`init()` 从 JSON（`loadData()`）加载最新数据，再从 SQLite（`db.loadData()`）回填——JSON 是同步写入源，SQLite 是异步副本
- **退出行为**：`/api/quit` 不调 `server.close()`（避免 keep-alive 阻塞响应），延迟 1.5s 后 `process.exit(0)`；Rust 监控线程检测 sidecar 退出后自动关闭 Tauri 窗口
- **封面路径**：`localCover` 存储为绝对路径，迁移 DATA_DIR 后文件可能不存在，`init()` 中验证文件存在性，缺失则清空字段（前端显示灰色占位）
- **window.close() 无效**：Tauri WebView 中 `window.close()` 仅对弹出窗口生效，需要通过 Rust `window.close()` 或 `__TAURI__` IPC 关闭主窗口
- **Prisma 引擎路径**：pkg 模式下通过 `PRISMA_QUERY_ENGINE_LIBRARY` 环境变量指定引擎 DLL 路径，`NODE_PATH` 指向 `sidecar-modules/`
- **AniList 预取**：扫描完成后自动后台调用 AniList 预取元数据（`prefetch()`），不阻塞主流程
- **批量同步取消**：`/api/library/sync/stream` 支持客户端取消，`cancelledSyncSessions` Map 追踪取消状态
- **Tauri sidecar 监控**：Rust 监控线程检测 sidecar 退出后自动关闭 Tauri 窗口；窗口关闭时 kill sidecar 进程

## 设计理念与用户工作流

本软件以「个人本地动漫库管理」为核心理念。用户的典型工作流如下：

```
发现好番 → 下载到本地 → 导入软件观看管理 → 看完归档
```

### 用户期望的完整能力链

1. **了解基本信息** — 自动刮削元数据（标题、封面、简介、评分等），支持多源（Bangumi/TMDB）
2. **追踪观看进度** — 记录每集观看状态（未看/观看中/已看）、播放进度、观看时长统计
3. **同步到 Bangumi** — 自动更新 Bangumi 个人列表的集数进度（未来功能）
4. **看完后管理** — 支持个人评分、感想笔记（Memories 归档页）
5. **BD 盘内容扩展** — 未来支持查看 SCANS、OST 音乐等 BD 特典内容
6. **本地清理** — 看完后可删除本地文件，归档页作为「已观看证明」保留记录

### 数据分层

| 层级 | 页面 | 数据源 | 生命周期 |
|------|------|--------|---------|
| 资料库 | Library | `data.library`（本地文件） | 当前下载、正在观看 |
| 追番列表 | Watching（未来） | 本地+Bangumi 同步 | 想看/在看/搁置的番 |
| 归档 | Memories | `data.memories`（看完归档） | 已看完、已删除本地文件 |

- 资料库 = 本地有文件的番，可播放、可管理进度
- 追番列表 = 用户在 Bangumi 上关注的番，无论本地是否有文件（未来功能）
- 归档 = 已看完的番的「纪念册」，保留评分、感想、封面
  - **展示形式**：与资料库一致的瀑布流卡片网格（`anime-grid` + `anime-card`），封面 + 标题 + 评分 + 简评
  - 点击卡片进入详情页（只读模式，不可播放本地不存在的文件）

### 外部集成

- **[ani-rss](https://github.com/wushuo894/ani-rss)** — 主要本地动漫下载来源（自动 RSS 订阅下载）
- ani-rss 提供 **Webhook 通知**（`下载完成`/`开始下载`等事件），Payload 包含 `downloadPath`、`title`、`season`、`episode`、`tmdbid`、`bgmUrl`、`image` 等字段——是集成的主要接入点
- ani-rss v3.0.1+ 内置 **Swagger REST API**（需鉴权），可用于查询订阅列表、下载状态
- 未来计划：Webhook 接收 → 自动添加到 scannedTree/自动导入 → 双向联动（追番列表点订阅 → ani-rss 添加 RSS）

### 设计原则

- **离线优先**：核心功能不依赖网络，Bangumi 同步为增强特性
- **渐进增强**：先做本地管理，再打通外部同步
- **尊重用户数据**：删除本地文件 ≠ 删除记录，归档自动保留

## Tauri 桌面壳（Phases 0-6 已完成）

### 架构路线

Tauri v2 作为**桌面壳**，Node.js 后端以 **sidecar 进程** 方式运行。不重写 Rust 后端。

```
Tauri (窗口壳)
  └── Sidecar: Node.js server (现有 server.js，不变)
        └── HTTP API (:3456)
              └── WebView: 现有前端 (HTML/CSS/JS，不变)
```

### 关键注意事项

- Dev 模式：sidecar 不自动启动，需先 `npm run dev:server`，再 `npm run dev:tauri`
- 生产构建：`npm run build:server`（pkg打包 sidecar）→ `npm run build:tauri`（Tauri 构建 MSI）
- Cargo mirror：清华源配置在 `src-tauri/.cargo/config.toml`
- 构建缓存：`src-tauri/target/` 可达 5GB+，可安全删除后重新构建

## Frontend Conventions

- `camelCase` 命名，2 空格缩进
- 默认启动视图为 library（`app.js` 中 `showView('library')`），侧边栏 `btnDiscovery` 不再默认 `active`
- HTML 事件用 `onclick` 属性（非 `addEventListener`），除 `settingsPlayerMode.change` 以及 `detail.js` 中 `renderEpisodeHeatmap()` 的热力方格点击（动态渲染必须用 `addEventListener`）
- GSAP 已注册全局 `gsap.registerPlugin(Flip)`
- 动画 `onComplete` 中不删除 `detail-enter-active` class（防止 `.view fadeSlideUp` 激活），由 `resetDetailEnter()` 在下次导航时清理
- 搜索无结果时显示「未检索到结果 · 没有匹配"xxx"的动漫」（`library.js` 中动态切换 empty state 文案）
- **Modal 弹窗模式**：`.modal-overlay` 包裹 `.modal`，overlay 设 `onclick="if(event.target===this)closeFn()"` 支持点击遮罩层关闭；右上角加 `.modal-close-btn`（✕ SVG 图标）作为显式关闭入口；底部 `.modal-actions` 不设「取消」文字按钮。参见 `#syncModal` 和 `#memoryModal`。

## Development Workflow — 四层验证

**目标**：避免每次修改都打包 MSI/NSIS，根据改动类型选择最快的验证方式。

### Tier 0 — Rust 类型检查（~20 秒）

仅检查 Rust 代码是否编译通过，不生成二进制，比完整构建快得多。

```bash
npm run check:rust           # cargo check，只检查类型不编译
```

- 用于 `into_string` 这类编译错误的快速发现
- 无需启动 server 或 Tauri 窗口

### Tier 1 — JS 改动（秒级）

含 `server/*.js` 后端逻辑和 `public/*` 前端文件。

```bash
npm run dev:server:watch   # nodemon 自动监听 server/ + public/，修改后立即重启
```

- 后端改动 → nodemon 自动重启 Node.js 进程
- 前端改动 → 直接 F5 刷新 Tauri 窗口（或浏览器 http://localhost:3456）
- 无需任何构建步骤

### Tier 2 — Rust 改动 + 生产流程模拟（~1 分钟）

含 `src-tauri/src/main.rs`、`tauri.conf.json`、`Cargo.toml`。

```bash
# 方式 A：普通 dev（sidecar 手动启动，window 自动显示）
npm run dev:server:watch    # 终端 1：后端
npm run dev:tauri           # 终端 2：Tauri 窗口

# 方式 B：生产流程模拟（sidecar 自启，visible:false → 轮询 → 显示）
npm run dev:prod            # 先 build:server，再 TAURI_PROD=1 tauri dev
```

- **方式 A** 适用于日常 Rust 修改验证
- **方式 B** 模拟完整生产启动流程（`TAURI_PROD=1` 环境变量使 dev 模式也启动 sidecar、隐藏窗口、轮询 /api/health、就绪后显示），可发现 toast 闪烁、窗口时序等问题
- 也可以单独打包 release .exe 测试安装目录行为（不含 MSI 捆绑）：
  ```bash
  npm run build:exe   # cargo build --release，产出 target/release/myanimedocker.exe
  ```

### Tier 3 — 最终打包（~5 分钟）

Tier 0-2 验证通过后，确认 MSI/NSIS 安装体验：

```bash
npm run build                # pkg sidecar → copy-sidecar-deps → tauri build (MSI + NSIS)
npm run build:msi            # 仅 MSI
npm run build:nsis           # 仅 NSIS
```

仅用于验证安装器效果、中文界面、升级覆盖等最终场景。

## Available Skills

| Skill | Load with | Purpose |
|-------|-----------|---------|
| **data-flow** | `skill("data-flow")` | Complete data flow reference: 10 major flows (config, scan, import, metadata, play sessions, memories, covers/thumbnails, dual-write, startup, call chain) with file:line references. Load before making data path changes or debugging persistence issues. |
