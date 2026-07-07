# MyAnimeDocker

Vanilla JS SPA + Node.js HTTP server. 自托管动漫媒体库管理器。

## Agent Instructions — 工作流程

用户提出任务时，按以下流程执行。**禁止跳过需求确认直接写代码。**

### Step 1: 需求规范化

加载 `skill("req-implement-test")`，用结构化提问提炼完整需求表（功能描述、数据来源、边界情况、验收标准、非目标），用户确认后再进入下一步。

### Step 2: 理解数据流

**任何涉及数据持久化、API 端点、或数据模型改动的任务**，必须先读 `.agents/docs/data-flow.md`，理解数据在系统中的完整流转路径（scan → import → metadata → SQLite → frontend）。

这一步决定你的改动影响哪些文件、哪些 API、哪些数据表。

### Step 3: 架构探索

根据任务复杂度选择：
- **小改动**（单文件/纯函数）→ 直接读代码
- **跨模块改动** → 读 `.agents/docs/code-explorer.md` 按指南追踪执行路径
- **新功能** → 加载 `skill("code-architect")` 设计实现蓝图

### Step 4: 实现

按项目规范编码（见 Key Patterns、Frontend Conventions、CSS 缩放标准）。

### Step 5: 验证

- 数据相关改动 → `cd server && npm test`
- 根据改动类型选择验证层级（见 Development Workflow — 四层验证）

### Step 6: 审查

重要改动加载 `skill("code-reviewer")` 做代码审查；涉及外部输入/API 调用时加载 `skill("security-review")`。

### Step 7: 回归测试

**修 bug 时**：先写一个能复现 bug 的测试（确认失败），再修代码让它通过。
**新增数据持久化功能时**：测试必须覆盖"修改 → `loadData()` 重载 → 验证"路径，只测内存状态不够。

### Step 8: 文档更新

涉及以下改动时，**必须**同步更新 `.agents/docs/` 中的参考文档：

| 改动类型 | 更新文档 |
|----------|----------|
| 新增/修改 API 端点 | `.agents/docs/data-flow.md` — 对应的数据流节 |
| 修改数据模型（Prisma schema） | `.agents/docs/data-flow.md` — Save Function Taxonomy |
| 新增/修改数据持久化路径 | `.agents/docs/data-flow.md` — 对应的数据流节 |
| 新增 scraper/外部集成 | `.agents/docs/data-flow.md` — Metadata Fetch Flow |

### 技能速查

| 场景 | 加载技能/文档 | 时机 |
|------|--------------|------|
| 需求不明确 | `skill("req-implement-test")` | 任何新功能/改动 |
| 数据流相关 | 读 `.agents/docs/data-flow.md` | 涉及 db.js / API / 数据模型 |
| 探索代码 | 读 `.agents/docs/code-explorer.md` | 需要追踪执行路径 |
| 新功能设计 | `skill("code-architect")` | 架构级实现方案 |
| 代码审查 | `skill("code-reviewer")` | 完成实现后 |
| 安全审查 | `skill("security-review")` | 涉及外部输入 |

## Commands

```bash
npm run dev:server   # Start Node.js server on port 3456
npm run dev:server:watch  # Nodemon 自动重启（监听 server/ + public/ 变化）
npm run dev:tauri    # Start Tauri dev window (requires server running first)
npm run dev          # Start both server (nodemon) + Tauri concurrently (single terminal)
npm run build        # Build pkg sidecar + Tauri MSI/NSIS installer
npm run build:msi    # Build MSI installer only
npm run build:nsis   # Build NSIS installer only
npm run build:server # Build standalone pkg sidecar executable
npm run build:exe    # Build Tauri release EXE only (no MSI/NSIS, ~1min)
npm run check:rust   # Fast Rust type-check (cargo check, ~20s)
npm run dev:prod     # Build sidecar + Tauri dev with production flow (sidecar spawn, visible:false, health polling)
npm run prisma:generate  # Regenerate Prisma client
npm run prisma:migrate   # Create/apply Prisma migrations
npm run prisma:studio    # Open Prisma Studio (SQLite browser)
node scripts/migrate-to-sqlite.js  # 从 JSON 迁移数据到 SQLite（一次性）
start.bat             # Windows 菜单：开发/构建/清理/prisma 操作
# 测试命令
cd server && npm test    # 运行数据持久化集成测试（17 tests）
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
GET  /api/mylist              # List MyList (library + wishlist, merged)
PUT  /api/mylist/:id/status   # Update MyList status (watching/wish/completed/on_hold/dropped)
GET  /api/mpv-status          # Active mpv sessions
GET  /api/stats               # Dashboard stats (watching/completed/total/episodes/fileSize/fileCount/watchTime)
GET  /api/recommendations     # Bangumi current-season random picks (6 items)
POST /api/quit                # Shutdown server
GET  /api/health              # Tauri readiness polling
GET  /api/thumbnail?path=&time # Video thumbnail (ffmpeg)
GET  /covers/xxx.jpg?w=&q=    # Dynamic cover resize (ffmpeg)
POST /api/library/sync        # Batch metadata sync (JSON)
GET  /api/library/sync/stream # SSE batch sync (流式，支持取消)
GET  /api/memories            # List memories
POST /api/memories            # Create/update memory
GET  /api/bangumi/auth/status # Bangumi OAuth 状态
GET  /api/bangumi/auth/url    # 获取 Bangumi OAuth 授权 URL
GET  /api/bangumi/auth/callback?code=xxx  # OAuth 回调（自动处理）
POST /api/bangumi/auth/logout # 清除 Bangumi 令牌
POST /api/bangumi/auth/creds  # 保存 Bangumi Client ID/Secret
GET  /api/bangumi/me          # 当前 Bangumi 用户信息
POST /api/bangumi/sync        # MyList 全量同步（Pull→Merge→Push）
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
│   ├── parseFolderName()  → 使用 anitomy 提取标题和季号，回退到正则清洗
│   └── extractBgmId()     → 从文件夹名提取 [bgmN] 数字 ID
├── mpv-controller.js → mpv 进度追踪（spawn + --term-status-msg，final 标记）
├── logger.js      → 结构化日志（debug/info/warn/error + [TAG] 前缀，LOG_LEVEL 环境变量控制）
├── bangumi-sync.js→ Bangumi 同步编排（Pull→Merge→Push，OAuth 终态推送）
├── scrapers/      → 多源刮削架构
│   ├── index.js   → ScraperRegistry（统一注册、优先级、批量搜索 + Sorensen-Dice 模糊匹配 + 搜索结果缓存 5min TTL）
│   ├── node-fetch.js → pkg 兼容的 fetch polyfill（http/https 原生模块）
│   ├── bangumi.js → Bangumi API（curl fallback）
│   ├── bangumi-personal.js → Bangumi 个人 OAuth + 收藏管理 API
│   ├── anilist.js → AniList GraphQL API（仅用于罗马音标题 + seasonChain 提取，非元数据来源）
│   └── tmdb.js    → TMDB API（需配置 API Key）
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
    ├── discovery.js   → 发现/扫描视图（扁平卡片列表 + 兄弟组连续竖线 + 内联操作按钮）
    ├── library.js     → 资料库网格
    ├── detail.js      → 详情 + GSAP Flip Hero 动画 + 右侧 3 模块
    │                   （继续播放卡片 / 剧集热力图 / 观看统计图表）
    ├── metamatch.js   → MetaMatch 批量元数据匹配工作台（列表+右侧滑入面板，SSE 流式同步）
    ├── mylist.js      → MyList 视图（当前观看/计划中/已完成/搁置/抛弃状态管理）
    └── memory.js      → 观看记录
scripts/            → 构建/迁移工具
├── copy-sidecar-deps.js   → pkg 打包后复制原生模块（Prisma 引擎 + ffmpeg）
└── migrate-to-sqlite.js   → JSON → SQLite 数据迁移（一次性）
.agents/            → Agent 规则/技能/文档
├── skills/         → 行为指令（req-implement-test, feature-dev, code-reviewer 等）
└── docs/           → 参考文档（data-flow, code-explorer）
opencode.json       → OpenCode 配置（插件声明）
```

**数据持久化**: SQLite (Prisma ORM)，规范化表 (Anime, Episode, PlaySession, Memory) + JSON 文件 (ScannedTree)。
细粒度写入：每个 API 端点只写入实际修改的表——`db.saveLibrary()` / `db.saveMemories()` / `db.savePlaySessions()` / `db.updateEpisodeProgress()`。
`saveScannedTree()` 同步写入 `scanned-tree.json`。`saveData()` 为全量组合函数（多类型数据同时变更时使用）。

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

**网格卡片尺寸基准**: `GRID_BASE_SIZE = 207`（`library.js:10`），实际渲染尺寸 = `207 × gridZoom × --scale`。122% gridZoom + 125% --scale = 315px 宽度。仪表盘各模块以此为锚点对齐。

## Key Patterns

- **API 调用**: `await API.get('/api/...')`, `API.post()`, `API.del()`（`api.js` 封装）
- **XSS 防护**: 所有用户数据用 `escHtml()` / `escAttr()` 包裹
- **封面动画**: GSAP Flip（`detail.js` 中 `animateHeroCoverFlip()`），创建 `position:fixed` overlay → `Flip.getState()` → DOM 变化 → `Flip.from(state, { absolute: true })`
- **元数据来源：只有 Bangumi**: Bangumi 是唯一元数据来源（标题、封面、简介、评分、标签）。AniList 仅用于罗马音标题 + seasonChain 季度链。TMDB 为可选图片源。
- **播放会话追踪**: `activePlays` Map（内存），每 10s 精细化更新 SQLite，mpv 关闭时落盘
- **细粒度数据持久化**: 每个 API 端点只写入实际修改的 SQLite 表，避免全量 `saveData()` 导致 nodemon 误重启
- **bangumiId 精准匹配**: `extractBgmId(name)` 从文件夹名提取 `[bgmN]` 数字 ID 作为主键（`String(bangumiId)`），手动导入项使用 `parsedTitle + Season`
- **启动自动导入**: `autoImportNewFolders()` 在服务器启动后异步执行，扫描有 `[bgmN]` 标识的文件夹自动全流程导入
- **拼音搜索**: `server.js` 返回 `pinyinTitle`（去声调），`library.js` 同时匹配 `title`/`bangumiTitle`/`pinyinTitle`
- **多主题系统**: 6 种色彩主题（default/amber/ocean/sakura/emerald/violet）+ 独立 dark/light 模式，底部 dock 选择器切换即时生效
- **GSAP 引用**: `public/vendor/gsap/`（从 `node_modules/gsap/dist/` 拷贝），不经过 npm 构建；`index.html` 中 `<script>` 直接加载
- **Discovery 扁平扫描**: `data.scannedTree` 存扁平 leaf 数组（含 `parentChain`），旧树格式在 `/api/browse` 时自动展平
- **MetaMatch 批量匹配**: `metamatch.js` 列表+面板布局，SSE 流式同步 `/api/library/sync/stream`，支持取消、重试
- **MyList 状态管理**: 导入时自动创建 MyList 条目（默认 `watching`），删除动画时自动标记 `completed`
- **Modal 弹窗模式**: `.modal-overlay` 包裹 `.modal`，overlay `onclick` 支持点击遮罩层关闭；右上角 `.modal-close-btn` 显式关闭
- **详情页封面不能加 `decoding="async"`**：`renderDetail()` 中封面 `<img>` 必须 eager 加载，否则 GSAP Flip 动画完成时封面尚未解码，露出空白框架闪白

## Config

```json
{
  "mediaDir": "",
  "playerMode": "mpv",
  "mpvPath": "mpv",
  "theme": "default",
  "themeMode": "dark",
  "autoMarkWatched": true,
  "uiScale": 1.25,
  "apiSources": [
    { "type": "bangumi", "url": "https://api.bangumi.lol", "key": "" }
  ]
}
```

定义于 `server/config.example.json`（同级目录），复制为 `server/config.json` 使用。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mediaDir` | string | `""` | 动漫文件夹根目录 |
| `playerMode` | string | `"mpv"` | 播放器模式，固定为 `"mpv"`（mpv + IPC 进度追踪） |
| `mpvPath` | string | `"mpv"` | mpv 可执行文件路径 |
| `theme` | string | `"default"` | 色彩主题：`"default"`（玫红）、`"amber"`（琥珀）、`"ocean"`（海洋）、`"sakura"`（樱花）、`"emerald"`（翡翠）、`"violet"`（紫罗兰） |
| `themeMode` | string | `"dark"` | `"dark"` 或 `"light"`，与色彩主题独立 |
| `autoMarkWatched` | bool | `true` | 播放完成后自动标记为已看 |
| `uiScale` | number | `1.25` | UI 缩放倍数（前端以 % 显示，范围 75-150，前端除 100 后存储） |
| `apiSources` | array | `[{type:"bangumi",...}]` | 元数据源列表，每项含 `type`/`url`/`key` |

## Play Sessions（播放会话追踪）

mpv 模式下自动记录播放进度到 SQLite。

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

- **DATA_DIR 差异**：dev 模式 DATA_DIR = `server/`；pkg/MSI 模式 DATA_DIR = `%APPDATA%/com.myanimedocker.app`
- **退出行为**：`/api/quit` 不调 `server.close()`（避免 keep-alive 阻塞响应），延迟 1.5s 后 `process.exit(0)`；Rust 监控线程检测 sidecar 退出后自动关闭 Tauri 窗口
- **封面路径**：`localCover` 存储为绝对路径，迁移 DATA_DIR 后文件可能不存在，`init()` 中验证文件存在性，缺失则清空字段
- **Prisma 引擎路径**：pkg 模式下通过 `PRISMA_QUERY_ENGINE_LIBRARY` 环境变量指定引擎 DLL 路径，`NODE_PATH` 指向 `sidecar-modules/`
- **数据加载顺序**：`init()` 从 SQLite（`db.loadData()`）加载数据——JSON 是同步写入源，SQLite 是持久化副本
- **动漫 ID 使用 bangumiId 作为主键**（`String(bangumiId)`），不怕改名，数据可重建。手动导入项使用 `parsedTitle + Season`。
- **只支持 mpv 播放器**（`--input-ipc-server` IPC 管道实时追踪进度）。系统播放器模式已移除。
- **自动标记前集必须落盘**：播放第 N 集时自动标记前 N-1 集为 watched，必须调用 `db.updateEpisodesWatched()` 写入 SQLite，否则重启后丢失。
- **window.close() 无效**：Tauri WebView 中 `window.close()` 仅对弹出窗口生效，需要通过 Rust `window.close()` 或 `__TAURI__` IPC 关闭主窗口
- **Tauri 开发模式**：sidecar 不自动启动，需先 `npm run dev:server`，再 `npm run dev:tauri`
- **Tauri 生产构建**：`npm run build`（先 pkg 打包 sidecar，然后 Tauri 构建 MSI/NSIS），依赖 Rust MSVC 工具链
- **pkg 打包**：sidecar 输出到 `src-tauri/server-x86_64-pc-windows-msvc.exe`，`copy-sidecar-deps.js` 复制原生模块到 `src-tauri/sidecar-modules/`
- **构建缓存**：`src-tauri/target/` 可达 5GB+，可安全删除后重新构建
- **Cargo mirror**：清华源配置在 `src-tauri/.cargo/config.toml`
- **无认证/授权**：局域网内 `/api/quit` 可关闭服务器
- **视频缩略图依赖 ffmpeg**：PATH 中可用，生成时缓存到 `thumbs/`，首次请求可能延迟

## Frontend Conventions

- `camelCase` 命名，2 空格缩进
- 默认启动视图为 library（`app.js` 中 `showView('library')`）
- HTML 事件用 `onclick` 属性（除 `settingsPlayerMode.change` 和热力方格动态渲染用 `addEventListener`）
- GSAP 已注册全局 `gsap.registerPlugin(Flip)`
- 操作 DOM 前检查元素存在性（非当前页面时 `getElementById` 返回 null）
- 局部刷新只更新内容区域，不重建父容器（避免搜索框失焦、排序状态丢失）

### CSS 缩放标准（`--scale` 变量）

UI 缩放使用 CSS 自定义属性 `--scale` 实现，**禁止使用 CSS `zoom`**（导致 GSAP Flip 断裂、fixed 元素错位）。

**机制**：`:root { --scale: 1 }`，`applyZoom(scale)`（`app.js:173`）设置属性，所有可缩放尺寸通过 `calc(X * var(--scale))` 级联计算。

**硬性规则**：

| 场景 | 做法 | 示例 |
|------|------|------|
| font-size | 必须用 `calc(Xrem * var(--scale))` | `font-size: calc(0.8125rem * var(--scale))` |
| 容器 max-width | 乘以 `--scale` | `max-width: calc(75rem * var(--scale))` |
| grid gap/clamp | 乘以 `--scale` | `gap: calc(clamp(1.5rem, 3vw, 3rem) * var(--scale))` |
| 间距/内边距 | 使用 `--space-*` 变量 | `padding: var(--space-4)` |
| 固定覆盖层 | 禁用缩放：`--scale: 1` | `.theme-dock { --scale: 1; }` |

## Debug Diagnostic System

`public/js/debug.js` — 前端诊断系统，默认关闭，全环境可用。

**设计原则**：调试工具跟随代码，不跟随环境。不区分 dev/prod，只区分"需不需要"。默认零开销，需要时 F12 启用。

```js
__debug.toggle()              // 启用/关闭（localStorage 持久化）
__debug.log(tag, ...args)     // 带标签的 console.log，关闭时不输出
__debug.snapshot(label)       // 快照：view, scrollTop, scrollHeight, 数据长度等
```

**何时用**：遇到前端状态类 bug（滚动、视图切换、数据不一致）时，先用 `__debug.toggle()` 打开日志，复现一遍，看锚点输出定位问题，而不是直接猜原因。

**埋点位置**（遇到新 bug 时应在相关代码追加 snapshot/log）：

| 位置 | 文件:行 | 记录内容 |
|------|---------|----------|
| `showView()` 前后 | `app.js:24-28` | view 切换 + scrollTop 变化 |
| `loadLibrary()` 软/硬路径 | `library.js:144-155` | soft判定 + ID 对比结果 |
| `restoreLibraryScroll()` | `library.js:169-173` | 实际设的 scrollTop + max scrollable |

**误区预防**：过去调试 scroll 恢复花了很长时间（6 次尝试），根本原因是`showView()`中 scrollTop 保存**晚于**视图切换，导致坐标空间错误。如果 debug 日志当时就位，一次 snapshot 就能发现——`libraryScrollTop` 的值在 library→detail 时就已经是 detail 空间的值了。

## Development Workflow — 四层验证

### Tier 0 — Rust 类型检查（~20 秒）
```bash
npm run check:rust           # cargo check，只检查类型不编译
```

### Tier 1 — JS 改动（秒级）
```bash
npm run dev:server:watch   # nodemon 自动监听 server/ + public/，修改后立即重启
```
后端改动 → nodemon 自动重启；前端改动 → F5 刷新浏览器/Tauri 窗口。

### Tier 2 — Rust 改动（~1 分钟）
```bash
npm run dev:server:watch    # 终端 1：后端
npm run dev:tauri           # 终端 2：Tauri 窗口
# 或
npm run dev:prod            # 生产流程模拟（sidecar 自启，visible:false → 轮询 → 显示）
```

### Tier 3 — 最终打包（~5 分钟）
```bash
npm run build                # pkg sidecar → tauri build (MSI + NSIS)
npm run build:msi / build:nsis  # 仅安装器
```

## Testing

```bash
cd server && npm test    # 运行数据持久化集成测试（17 tests）
```

| 文件 | 测试数 | 覆盖模块 |
|------|--------|----------|
| `server/__tests__/db.test.js` | 17 | `loadData`, `saveLibrary`, `saveMyList`, `updateEpisodesWatched`, 全生命周期（导入→播放→归档→删除） |

## Available Skills

| Skill | Load with | Purpose |
|-------|-----------|---------|
| **req-implement-test** | `skill("req-implement-test")` | 需求规范化：结构化提问提炼完整需求（功能描述、数据来源、边界情况、验收标准、非目标），确认后再实现 |
| **code-architect** | `skill("code-architect")` | Design feature architecture by analyzing existing codebase patterns, produce implementation blueprint |
| **code-reviewer** | `skill("code-reviewer")` | Review code for bugs, logic errors, security vulnerabilities, code quality |
| **feature-dev** | `skill("feature-dev")` | Guide a feature through a structured 7-phase workflow with codebase understanding, architecture, and review |
| **frontend-design** | `skill("frontend-design")` | Create distinctive, production-grade frontend interfaces with high design quality |
| **security-review** | `skill("security-review")` | Focused security review of pending git changes |
| **gsap-core** | `skill("gsap-core")` | GSAP core API — gsap.to(), from(), fromTo(), easing, duration, stagger, matchMedia |
| **web-design-guidelines** | `skill("web-design-guidelines")` | Review UI code for Web Interface Guidelines compliance |
| **gsap-timeline** | `skill("gsap-timeline")` | Timeline sequencing, position parameter, nesting, playback |
| **gsap-scrolltrigger** | `skill("gsap-scrolltrigger")` | Scroll-linked animations, pinning, scrub, triggers |
| **gsap-plugins** | `skill("gsap-plugins")` | GSAP plugins: Flip, Draggable, ScrollTrigger, SplitText, ScrollSmoother |
| **gsap-react** | `skill("gsap-react")` | GSAP with React/Next.js — useGSAP hook, refs, cleanup |
| **gsap-frameworks** | `skill("gsap-frameworks")` | GSAP with Vue, Svelte, and other non-React frameworks |
| **gsap-performance** | `skill("gsap-performance")` | Performance optimizations: transforms, will-change, layout avoidance |
| **gsap-utils** | `skill("gsap-utils")` | gsap.utils utilities: clamp, mapRange, random, snap, wrap, toArray |

## Reference Docs

| Doc | Location | Purpose |
|-----|----------|---------|
| **data-flow** | `.agents/docs/data-flow.md` | Complete data flow reference: 14 major flows with file:line references. Read before making data path changes. |
| **code-explorer** | `.agents/docs/code-explorer.md` | Code analysis guide: trace execution paths, map architecture layers, document dependencies. |
