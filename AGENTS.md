# MyAnimeDocker

Vanilla JS SPA + Node.js HTTP server. 自托管动漫媒体库管理器。

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
cd server && npm test    # 运行后端测试（79 tests）
npm run test:frontend    # 运行前端单元测试（58 tests）
npm run test:e2e         # 运行 E2E 测试
npm run test:e2e:ui      # E2E 测试 UI 模式
node scripts/generate-tests.js server/scanner.js  # 生成测试骨架
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
.agents/            → Agent 规则/技能
└── skills/         → 专业技能（16 个：data-flow, gsap-*, feature-dev, code-reviewer 等）
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
- **封面动画**: `detail.js` 中 `animateHeroCoverFlip()` — GSAP Flip，创建 `position:fixed` overlay，`Flip.getState()` → DOM 变化 → `Flip.from(state, { absolute: true })`
- **主题**: CSS 自定义属性，`[data-theme="light"]` 覆盖深色变量
- **图片动态缩放**: ffmpeg 实时缩放（替代已移除的 sharp），列表缩略图 `/covers/xxx.jpg?w=400&q=75`，详情页 `/covers/xxx.jpg?w=540&q=80`；首请求生成后缓存到 `covers/.resized/`
- **视频缩略图**: ffmpeg `-ss {time} -i "{path}" -vframes 1 -q:v 5` 截帧，缓存到 `thumbs/`，API `/api/thumbnail?path=&time=`
- **播放会话追踪**: mpv 模式在服务器内存维护 `activePlays` Map（`filePath → {sessionId, episode, anime}`），每 10s 通过 `db.updateEpisodeProgress()` + `db.updatePlaySession()` 精细化更新，mpv 关闭时 `db.savePlaySessions()` 落盘
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
- **多源刮削**: `scrapers/index.js` → `ScraperRegistry` 统一注册、优先级、批量搜索；`bangumi.js`/`tmdb.js` 实现统一接口。注意：Bangumi 是唯一元数据来源，AniList 仅限罗马音/季度链。TMDB 为可选图片源。
- **内联操作**: 卡片内直接显示「取消导入」「排除」「取消排除」按钮，无需详情抽屉
- **细粒度数据持久化**: 每个 API 端点只写入实际修改的 SQLite 表（`saveLibrary` / `saveMemories` / `savePlaySessions` / `updateEpisodeProgress`），避免全量 `saveData()` 导致 nodemon 误重启
- **MetaMatch 批量匹配**: `metamatch.js` 列表+面板布局，SSE 流式同步 `/api/library/sync/stream`，支持取消、重试失败项、手动修正搜索
- **元数据来源：只有 Bangumi**: Bangumi 是唯一元数据来源（标题、封面、简介、评分、标签）。AniList 仅用于罗马音标题辅助匹配 + seasonChain 季度关系提取，其 genres/tags 不写入数据库，不作为分类标签来源。TMDB 为可选额外图片源（需配置 API Key）。
- **AniList 罗马音辅助**: `scrapers/anilist.js` — GraphQL API，免费无需 Key。扫描后后台预取仅提取罗马音标题（`romajiTitle`）和季度链（`seasonChain`），不获取元数据字段。
- **季度匹配**: Anime 表 `matchedSeason`/`totalSeasons` 字段（Prisma schema），由 AniList `extractSeasonChain()` 提取
- **结构化日志**: `server/logger.js` — `debug/info/warn/error` + `[TAG]` 前缀，`logger.child('[TAG]')` 模块级标签，`LOG_LEVEL` 环境变量控制
- **Sorensen-Dice 模糊匹配**: `scrapers/index.js` 中 `sorensenDice()` 用于搜索结果匹配，5 分钟 TTL 缓存避免重复请求
- **MyList 状态管理**: `mylist.js` 中 `toggleStatusPopover()`/`setMyListItemStatus()` 管理状态（watching/wish/completed/on_hold/dropped）；卡片左上角 `.mylist-badge` 显示当前状态；弹窗支持鼠标离开 >100px 自动关闭
- **状态自动创建**: 导入时自动创建 MyList 条目（默认 `watching`），删除动画时自动标记 `completed`；`db.saveMyList()` 仅写入 mylist 表
- **主题切换按钮**: 设置页 theme 从 `<select>` 改为 toggle switch（`<input type="checkbox">`），onchange 实时调用 `handleThemeToggle()` + GSAP 波纹动画（从 toggle 位置向外扩散） + 全页 CSS 过渡（bg 0.7s/其他 0.55s）
- **多主题系统**: 6 种色彩主题（default/amber/ocean/sakura/emerald/violet）+ 独立 dark/light 模式，`data-theme` 存色彩名、`data-theme-mode` 存明暗；default 主题用 `data-theme="dark|light"` 兼容旧选择器；底部 dock 选择器切换即时生效
- **主题配色规范**: 所有主题 secondary 与 accent 同色系（色轮距离 ≤40°），渐变过渡自然无脏色；深色背景统一中性黑（R≈G≈B），不泛蓝；浅色背景保持中性或极微色偏，不铺满主题色
- **底部视觉设置 Dock**: 主题选择、明暗切换、缩放滑块从设置模态框抽离到底部浮动 dock（`#themeDock`），支持折叠/展开（▾ 按钮），点击遮罩层折叠而非关闭；folded 状态显示 8px 手柄条
- **启动自动导入**: `autoImportNewFolders()`（`server.js:2006`）在服务器启动后异步执行，扫描 mediaDir 下所有子文件夹，对有 `[bgmN]` 标识且尚未导入的文件夹自动执行全流程导入（metadata fetch + 回写入库 + MyList watching + Bangumi sync），无需用户干预
- **bangumiId 精准匹配**: `extractBgmId(name)`（`scanner.js:398`）从文件夹名提取 `[bgmN]` 数字 ID，作为 anime 主键（`id: String(bgmId)`），匹配精度 100%；手动导入项（无 `[bgmN]`）仍使用 `parsedTitle + Season` 方案
- **自动导入 Toast**: 首次页面加载时 `GET /api/config` 返回 `autoImport` 字段（一次性消费），前端检查 >0 则 `showToast('自动导入了 N 部新番')`
- **仪表盘统计**: `renderStatsSection()` 异步获取 `/api/stats`，渲染为纯文字行（无卡片无图标），`justify-content: space-evenly` 均匀分布；数字用 `fg-primary`，标签用 `fg-muted`
- **继续播放卡片**: `renderContinueSection()` 用剧集缩略图（`/api/thumbnail`）作背景，fallback 到封面；点击调用 `navigateToDetailWithPlay()` 进详情并自动播放（`pendingAutoPlay` 标记 + `setTimeout(playEpisode, 400)`）；卡片尺寸 480×210px
- **仪表盘设置拖拽**: 用 pointer events（`pointerdown/pointermove/pointerup`）实现拖拽排序，六点手柄触发；同时保留上下箭头按钮；`list._dragCleanup` 防止监听器叠加
- **浅色主题阴影**: 所有 `rgba(0,0,0,0.4~0.7)` 硬编码阴影在浅色主题下替换为 `rgba(44,36,24, 0.06~0.12)`，暖棕色低透明度

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

**注意**: Discovery（发现）视图执行扫描后显示候选列表供用户勾选导入，支持排除/取消关联/获取元数据等管理操作。

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

- Bangumi API 受代理影响时 fallback 到 `curl`（`scrapers/bangumi.js` 中自动检测）
- `config.json` 在 `.gitignore` 中，不会提交
- 标题解析依赖 `anitomy`（TypeScript 移植版，纯 JS 无原生模块），pkg 打包无额外步骤
- 视频缩略图依赖 `ffmpeg`（PATH 中可用），生成时缓存到 `thumbs/` 目录，首次请求可能延迟
- 无认证/授权，局域网内 `/api/quit` 可关闭服务器
- mpv 通过 `spawn` + IPC pipe（`--input-ipc-server`）启动，实时追踪播放进度；spawn 错误通过 Promise 2s 超时窗口捕获并返回前端
- `activePlays` Map（`filePath → {sessionId, episode, anime}`）仅存内存，服务器重启后丢失；持久化的 `playSessions` 保存在 SQLite
- **动漫 ID 使用 bangumiId 作为主键**（`String(bangumiId)`），不怕改名，数据可重建。手动导入项（无 `[bgmN]` 标识）仍使用 `parsedTitle + Season` 方案。
- **只支持 mpv 播放器**（`--input-ipc-server` IPC 管道实时追踪进度）。系统播放器模式已移除。
- pkg 打包用 `process.pkg ? path.dirname(process.execPath) : __dirname` 处理路径
- TMDB API 需要配置 API Key 才能启用（设置页填入）
- 旧格式 `branch` 节点在 `/api/browse` 时自动递归展平为 leaf，无需手动重扫描
- Tauri 开发模式：sidecar 不自动启动，需先运行 `npm run dev:server`，再运行 `npm run dev:tauri`
- Tauri 生产构建：`npm run build`（先 pkg 打包 sidecar，然后 Tauri 构建 MSI/NSIS），依赖 Rust MSVC 工具链
- Cargo mirror：清华源配置在 `src-tauri/.cargo/config.toml`
- 构建缓存：`src-tauri/target/` 可达 5GB+，可安全删除后重新构建
- pkg 打包 sidecar 后输出到 `src-tauri/server-x86_64-pc-windows-msvc.exe`，copy-sidecar-deps.js 复制原生模块到 `src-tauri/sidecar-modules/`
- **DATA_DIR 差异**：dev 模式 DATA_DIR = `server/`；pkg/MSI 模式 DATA_DIR = `%APPDATA%/com.myanimedocker.app`
- **数据加载顺序**：`init()` 从 SQLite（`db.loadData()`）加载数据——JSON 是同步写入源，SQLite 是持久化副本
- **退出行为**：`/api/quit` 不调 `server.close()`（避免 keep-alive 阻塞响应），延迟 1.5s 后 `process.exit(0)`；Rust 监控线程检测 sidecar 退出后自动关闭 Tauri 窗口
- **封面路径**：`localCover` 存储为绝对路径，迁移 DATA_DIR 后文件可能不存在，`init()` 中验证文件存在性，缺失则清空字段（前端显示灰色占位）
- **window.close() 无效**：Tauri WebView 中 `window.close()` 仅对弹出窗口生效，需要通过 Rust `window.close()` 或 `__TAURI__` IPC 关闭主窗口
- **Prisma 引擎路径**：pkg 模式下通过 `PRISMA_QUERY_ENGINE_LIBRARY` 环境变量指定引擎 DLL 路径，`NODE_PATH` 指向 `sidecar-modules/`
- **AniList 预取**：扫描完成后自动后台调用 AniList 预取罗马音标题 + seasonChain（`prefetch()`），不获取元数据/分类标签，不阻塞主流程
- **批量同步取消**：`/api/library/sync/stream` 支持客户端取消，`cancelledSyncSessions` Map 追踪取消状态
- **Tauri sidecar 监控**：Rust 监控线程检测 sidecar 退出后自动关闭 Tauri 窗口；窗口关闭时 kill sidecar 进程
- **nodemon data ignore**：`dev:server:watch` 忽略 `server/prisma/`、`server/covers/`、`server/thumbs/`、`server/scanned-tree.json`，防止数据写入触发重启
- **详情页封面不能加 `decoding="async"` 或 `loading="lazy"`**：`renderDetail()` 中封面 `<img>` 必须 eager 加载，`animateHeroCoverFlip()` 的 `onComplete` 必须直接 reveal（不能用 `revealCover()` 检查 `img.complete`）。`decoding="async"` 会导致 GSAP Flip 动画完成时封面尚未解码，露出空白框架闪白。0.35s Flip 时长足够本地服务端图片完成加载+解码，不需要任何延迟/检查。

## 设计理念与用户工作流

本软件以「个人本地动漫库管理」为核心理念。用户的典型工作流如下：

```
下载好番（[bgmN] 命名规范） → 启动软件 → 自动扫描导入 → 观看管理 → 看完归档
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
- ani-rss v3.0.1+ 内置 **Swagger REST API**（需鉴权），可用于查询订阅列表、下载状态

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
- **模块化与全局状态**：
  - 全局监听器只在脚本顶层绑一次，内部通过 `getElementById` 延迟查找 DOM（lazy lookup），不在绑定时捕获引用
  - 局部刷新（filter/sort/status）只更新内容区域，不重建父容器（避免搜索框失焦、排序状态丢失）
  - 数据逻辑和 DOM 渲染分离：纯函数处理 filter/sort，渲染函数只管 innerHTML
  - 高频路径（搜索 oninput）不触发重量级操作（如 `applyGridZoom` 的 layout recalc）
  - 操作 DOM 前检查元素存在性（非当前页面时 `getElementById` 返回 null）

### CSS 缩放标准（`--scale` 变量）

UI 缩放使用 CSS 自定义属性 `--scale` 实现，**禁止使用 CSS `zoom`**（导致 GSAP Flip 断裂、fixed 元素错位）。

**机制**：
- `:root { --scale: 1 }` 定义基准值（`styles.css:43`）
- `applyZoom(scale)`（`app.js:173`）设置 `document.documentElement.style.setProperty('--scale', s)`
- 所有可缩放尺寸通过 `calc(X * var(--scale))` 级联计算

**硬性规则**：

| 场景 | 做法 | 示例 |
|------|------|------|
| 间距/内边距 | 使用 `--space-*` 变量 | `padding: var(--space-4)` |
| 圆角 | 使用 `--radius-*` 变量 | `border-radius: var(--radius-md)` |
| font-size | 必须用 `calc(Xrem * var(--scale))` | `font-size: calc(0.8125rem * var(--scale))` |
| 容器 max-width | 乘以 `--scale` | `max-width: calc(75rem * var(--scale))` |
| grid gap/clamp 值 | 乘以 `--scale` | `gap: calc(clamp(1.5rem, 3vw, 3rem) * var(--scale))` |
| 网格卡片尺寸 | `applyGridZoom()` 已自动处理 | 通过 `library.js:50` 乘入 `--scale` |
| 固定覆盖层（dock/toast/context-menu） | 禁用缩放：`--scale: 1` | `.theme-dock { --scale: 1; }` |
| JS inline style 尺寸 | 读取 `getComputedStyle` 的 `--scale` 乘算 | `parseFloat(getComputedStyle(docEl).getPropertyValue('--scale'))` |

**可用的 CSS 变量**（`:root`，均自动缩放）：
```
--space-1/2/3/4/5/6/8/10/12/16  → 间距、内边距、外边距、gap
--radius-sm/md/lg/xl             → 圆角
```

**例外**（不缩放的值）：
- `z-index`、`opacity`、`flex`（无单位值）
- `vw`/`vh`/`%` 值（视口/容器相对）
- `s`/`ms`（动画时长）
- `deg`（角度）
- `line-height`（无单位时）
- `box-shadow` 偏移（不缩放更自然）

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

## Testing

```bash
cd server && npm test    # 运行所有测试（79 tests）
npm run test:frontend    # 运行前端单元测试（58 tests）
npm run test:e2e         # 运行 E2E 测试
```

**测试框架**: Node.js 内置 `node:test` + `node:assert`，无外部依赖。

**测试文件**:

| 文件 | 测试数 | 覆盖模块 |
|------|--------|----------|
| `server/__tests__/scanner.test.js` | 28 | `extractBgmId`, `isExtraVideo`, `parseFolderName` |
| `server/__tests__/scrapers.test.js` | 38 | `normalizeTitle`, `sorensenDice`, `detectSpecialType`, `extractBaseAndSuffix` |
| `server/__tests__/db.test.js` | 7 | `loadData`, `saveLibrary`, `saveMyList`（集成测试，操作真实 SQLite） |
| `server/__tests__/snapshot-demo.test.js` | 6 | 快照测试示例 |
| `public/__tests__/utils.test.js` | 58 | 前端纯函数：escHtml, basename, formatFileSize 等 |
| `e2e/app.spec.js` | 8 | E2E：页面加载、导航、主题切换 |

**何时运行测试**:
- 修改 `scanner.js`、`scrapers/`、`db.js` 后运行
- 添加新功能前先写测试（TDD）
- 提交前确认全部通过
- CI/CD 管道中自动运行

**测试生成**:
```bash
node scripts/generate-tests.js server/scanner.js  # 为模块生成测试骨架
```

**快照测试**:
```bash
set UPDATE_SNAPSHOTS=1 && cd server && node --test __tests__/*.test.js  # 更新快照
```

## Available Skills

| Skill | Load with | Purpose |
|-------|-----------|---------|
| **data-flow** | `skill("data-flow")` | Complete data flow reference: 10 major flows (config, scan, import, metadata, play sessions, memories, covers/thumbnails, dual-write, startup, call chain) with file:line references. Load before making data path changes or debugging persistence issues. |
| **agents-md-improver** | `skill("agents-md-improver")` | Audit, evaluate, and improve project-rules files (AGENTS.md, CLAUDE.md) |
| **code-architect** | `skill("code-architect")` | Design feature architecture by analyzing existing codebase patterns, produce implementation blueprint |
| **code-explorer** | `skill("code-explorer")` | Deeply analyze existing feature by tracing execution paths, mapping architecture layers |
| **code-reviewer** | `skill("code-reviewer")` | Review code for bugs, logic errors, security vulnerabilities, code quality |
| **feature-dev** | `skill("feature-dev")` | Guide a feature through a structured 7-phase workflow with codebase understanding, architecture, and review |
| **req-implement-test** | `skill("req-implement-test")` | Complete requirements-implementation-testing workflow: structured templates, TDD, regression testing, quality gates |
| **test-generator** | `skill("test-generator")` | Auto-generate test skeletons by analyzing function signatures and code patterns |
| **frontend-design** | `skill("frontend-design")` | Create distinctive, production-grade frontend interfaces with high design quality |
| **security-review** | `skill("security-review")` | Focused security review of pending git changes |
| **gsap-core** | `skill("gsap-core")` | GSAP core API — gsap.to(), from(), fromTo(), easing, stagger, matchMedia |
| **web-design-guidelines** | `skill("web-design-guidelines")` | Review UI code for Web Interface Guidelines compliance |
| **gsap-timeline** | `skill("gsap-timeline")` | Timeline sequencing, position parameter, nesting, playback |
| **gsap-scrolltrigger** | `skill("gsap-scrolltrigger")` | Scroll-linked animations, pinning, scrub, triggers |
| **gsap-plugins** | `skill("gsap-plugins")` | GSAP plugins: Flip, Draggable, ScrollTrigger, SplitText, ScrollSmoother |
| **gsap-react** | `skill("gsap-react")` | GSAP with React/Next.js — useGSAP hook, refs, cleanup |
| **gsap-frameworks** | `skill("gsap-frameworks")` | GSAP with Vue, Svelte, and other non-React frameworks |
| **gsap-performance** | `skill("gsap-performance")` | Performance optimizations: transforms, will-change, layout avoidance |
| **gsap-utils** | `skill("gsap-utils")` | gsap.utils utilities: clamp, mapRange, random, snap, wrap, toArray |
