# MyAnimeDocker

Vanilla JS SPA + Node.js HTTP server. 自托管动漫媒体库管理器。

## Commands

```bash
npm run dev:server   # Start Node.js server on port 3456
npm run dev:tauri    # Start Tauri dev window (requires server running first)
npm run dev          # Start both server + Tauri concurrently
npm run build        # Build pkg sidecar + Tauri MSI/NSIS installer
npm run build:server # Build standalone pkg sidecar executable
npm run build:tauri  # Build Tauri MSI/NSIS installer only
npm run prisma:generate  # Regenerate Prisma client
npm run prisma:migrate   # Create/apply Prisma migrations
npm run prisma:studio    # Open Prisma Studio (SQLite browser)
```

## API Endpoints

```bash
GET  /api/config              # Get config (+ dirValid)
POST /api/config              # Update config (mediaDir, playerMode, mpvPath, theme, tmdbApiKey, scrapers)
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
GET  /api/thumbnail?path=&time # Video thumbnail (ffmpeg)
GET  /covers/xxx.jpg?w=&q=    # Dynamic cover resize (sharp)
GET  /api/memories            # List memories
POST /api/memories            # Create/update memory
```

## Architecture

**Monolithic Node.js** (no framework), **vanilla HTML/CSS/JS frontend** (no bundler).
**Desktop shell:** Tauri v2 (Rust) with Node.js sidecar.

```
server/            → Tauri sidecar (Node.js backend)
├── server.js      → HTTP server + REST API (@ :3456)
├── scanner.js     → 扫描媒体目录，解析文件夹名（anitomy 增强）
│   ├── scanMediaDirFlat() → 返回扁平 leaf 数组（含 parentChain）
│   ├── buildLeaf()        → 单条目构造（parentChain 回溯处理 Season 文件夹）
│   └── parseFolderName()  → 使用 anitomy 提取标题和季号，回退到正则清洗
├── scrapers/      → 多源刮削架构
│   ├── index.js   → ScraperRegistry（统一注册、优先级、批量搜索）
│   ├── bangumi.js → Bangumi API（curl fallback）
│   └── tmdb.js    → TMDB API（需配置 API Key）
├── mpv-controller.js → mpv 进度追踪（spawn + --term-status-msg，final 标记）
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
    └── memory.js      → 观看记录
```

**数据持久化**: SQLite (Prisma ORM)，规范化表 (Anime, Episode, PlaySession, Memory) + JSON 列 (ScannedTree, Config)。
运行时仍通过 `anime-data.json` 同步读写以保证旧格式兼容，长期目标是完全切换到 Prisma/SQLite。

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
- **图片动态缩放**: sharp 实时处理，列表缩略图 `/covers/xxx.jpg?w=400&q=75`，详情页 `/covers/xxx.jpg?w=540&q=80`
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

## Config

```json
{
  "mediaDir": "",       // 动漫文件夹根目录
  "playerMode": "system", // "system"（系统默认播放器）或 "mpv"（mpv + 进度追踪）
  "mpvPath": "mpv",     // mpv 可执行文件路径
  "theme": "dark",       // "dark" 或 "light"
  "scrapers": {          // 刮削源配置
    "bangumi": { "enabled": true, "apiBase": "https://api.bgm.tv" },  // apiBase 可换为镜像 https://api.bangumi.one
    "tmdb": { "enabled": false }
  },
  "tmdbApiKey": ""       // TMDB API Key（从 themoviedb.org 获取）
}
```

同级目录下有 `config.example.json` 作为模板，复制为 `config.json` 即可使用。

**注意**: Discovery（发现）视图执行扫描后显示候选列表供用户勾选导入，支持排除/取消关联/获取元数据等管理操作。

## Play Sessions（播放会话追踪）

mpv 模式下自动记录播放进度到 `anime-data.json`。

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

- `build.bat` 需手动复制 `sharp` 原生模块到 `dist/node_modules/`（pkg 无法打包 native modules）
- Bangumi API 受代理影响时 fallback 到 `curl`（`scrapers/bangumi.js` 中自动检测）
- `anime-data.json` 和 `config.json` 在 `.gitignore` 中，不会提交
- 标题解析依赖 `anitomy`（TypeScript 移植版，纯 JS 无原生模块），pkg 打包无额外步骤
- 视频缩略图依赖 `ffmpeg`（PATH 中可用），生成时缓存到 `thumbs/` 目录，首次请求可能延迟
- 无认证/授权，局域网内 `/api/quit` 可关闭服务器
- mpv 通过 `spawn` + `--term-status-msg` 启动，解析 stderr 获取状态（JSON 格式 `{"time-pos":...,"duration":...,"pause":...}`），不依赖任何第三方模块
- `activePlays` Map（`filePath → {sessionId, episode, anime}`）仅存内存，服务器重启后丢失；持久化的 `playSessions` 保存在 `anime-data.json`
- 动漫 ID 由 `parsedTitle + (parsedSeason ? '-Season ' + parsedSeason : '')` 生成，重命名文件夹会导致 ID 变化
- 系统播放器模式不追踪播放时长（无可编程回调），只有 mpv 模式会写入 `playSessions`
- pkg 打包用 `process.pkg ? path.dirname(process.execPath) : __dirname` 处理路径
- TMDB API 需要配置 API Key 才能启用（设置页填入）
- 旧格式 `branch` 节点在 `/api/browse` 时自动递归展平为 leaf，无需手动重扫描
- Tauri 开发模式：sidecar 不自动启动，需先运行 `npm run dev:server`，再运行 `npm run dev:tauri`
- Tauri 生产构建：`npm run build`（先 pkg 打包 sidecar，然后 Tauri 构建 MSI/NSIS），依赖 Rust MSVC 工具链
- Cargo mirror：清华源配置在 `src-tauri/.cargo/config.toml`
- 构建缓存：`src-tauri/target/` 可达 5GB+，可安全删除后重新构建
- pkg 打包 sidecar 后输出到 `src-tauri/server.exe-x86_64-pc-windows-msvc.exe`，Tauri externalBin 自动追加 target triple 后缀

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

## Tauri 桌面壳（Phases 0-3 已完成）

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
- 生产构建：`npm run build:server`（pkg打包 sidecar）→ `npm run build:tauri`（Tauri 构建 MSI/NSIS）
- `sharp` 在 sidecar 中仍有原生模块问题（pkg 无法打包 native modules），`build.bat` 需手动复制 sharp 模块
- `config.json` 和 `anime-data.json` 路径策略需要对齐 Tauri 的 `app_data_dir`
- Cargo mirror：清华源配置在 `src-tauri/.cargo/config.toml`
- 构建缓存：`src-tauri/target/` 可达 5GB+，可安全删除后重新构建

## Frontend Conventions

- `camelCase` 命名，2 空格缩进
- 默认启动视图为 library（`app.js` 中 `showView('library')`），侧边栏 `btnDiscovery` 不再默认 `active`
- HTML 事件用 `onclick` 属性（非 `addEventListener`），除 `settingsPlayerMode.change` 以及 `detail.js` 中 `renderEpisodeHeatmap()` 的热力方格点击（动态渲染必须用 `addEventListener`）
- GSAP 已注册全局 `gsap.registerPlugin(Flip)`
- 动画 `onComplete` 中不删除 `detail-enter-active` class（防止 `.view fadeSlideUp` 激活），由 `resetDetailEnter()` 在下次导航时清理
- 搜索无结果时显示「未检索到结果 · 没有匹配"xxx"的动漫」（`library.js` 中动态切换 empty state 文案）
