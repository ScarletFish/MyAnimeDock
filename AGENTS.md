# MyAnimeDock

Vanilla JS SPA + Node.js HTTP server. 自托管动漫媒体库管理器。

> **设计理念**: 本地优先（数据全在本地 SQLite，无需注册账号）| 播放器中转站（播放体验由 mpv 决定）| 低成本刮削（自动识别文件夹，无需严格重命名）| 全生命周期覆盖 | 单机体验优先（桌面原生，打开即用）

## Agent Instructions

**禁止跳过需求确认直接写代码。**

1. **需求确认** → `skill("req-implement-test")` 提炼需求表，用户确认
2. **理解数据流** → 涉及数据/API/模型改动时先读 `.agents/docs/data-flow.md`
3. **架构探索** → 小改动读代码，跨模块读 `.agents/docs/code-explorer.md`，新功能 `skill("code-architect")`
4. **实现** → 按项目规范（Key Patterns / CSS 缩放）
5. **验证** → 数据相关 `cd server && npm test`；测试编写见 `.agents/docs/testing.md`
6. **审查** → `skill("code-reviewer")`；外部输入时加 `skill("security-review")`
7. **回归测试** → 见 [Testing](#testing) 节
8. **文档更新** → 改 API/数据模型/持久化时同步更新 `.agents/docs/` 对应文档

### 技能速查

| 场景 | 加载 |
|------|------|
| 需求不明确 | `skill("req-implement-test")` |
| 数据流/API/模型 | 读 `.agents/docs/data-flow.md` |
| 探索代码路径 | 读 `.agents/docs/code-explorer.md` |
| 新功能设计 | `skill("code-architect")` |
| 代码审查 | `skill("code-reviewer")` |
| 安全审查（外部输入） | `skill("security-review")` |
| 测试编写 | 读 `.agents/docs/testing.md` |

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
cd server && npm test    # 全量测试（81 tests）
```

完整 API 端点参考见 `.agents/docs/data-flow.md`（14 个主要数据流，40+ 端点）。

## Architecture

**Monolithic Node.js** (no framework), **vanilla HTML/CSS/JS frontend** (no bundler).
**Desktop shell:** Tauri v2 (Rust) with Node.js sidecar.

```
server/            → Tauri sidecar (Node.js backend)
├── server.js      → HTTP server + REST API (@ :3456)
├── db.js          → Prisma 封装层
├── scanner.js     → 扫描媒体目录，解析文件夹名（anitomy + [bgmN] 提取）
├── mpv-controller.js → IPC 进度追踪
├── logger.js      → [TAG] 结构化日志
├── bangumi-sync.js→ Pull→Merge→Push 同步
└── scrapers/      → Bangumi 主源 + AniList(罗马音) + TMDB(可选)
src-tauri/         → Tauri v2 desktop shell (Rust)
├── src/main.rs    → Sidecar spawning + window management
└── tauri.conf.json + capabilities/ + icons/
prisma/            → SQLite (Prisma ORM) — anime.db + schema.prisma + migrations/
public/            → 无构建前端
├── index.html + styles.css
└── js/            → api.js, app.js, library.js, detail.js, discovery.js, mylist.js, stats.js, metamatch.js, ui.js, state.js, utils.js
scripts/           → copy-sidecar-deps.js, migrate-to-sqlite.js
.agents/           → 规则/技能/文档
```

**数据持久化**: SQLite (Prisma ORM)，规范化表 (Anime, Episode, PlaySession, Memory) + JSON 文件 (ScannedTree)。
细粒度写入：每个 API 端点只写入实际修改的表——`db.saveLibrary()` / `db.saveMemories()` / `db.savePlaySessions()` / `db.updateEpisodeProgress()`。
`saveScannedTree()` 同步写入 `scanned-tree.json`。`saveData()` 为全量组合函数（多类型数据同时变更时使用）。

**视图切换**: CSS `hidden` class toggle，无客户端路由器。

**scannedTree 叶子节点字段**见 `.agents/docs/data-flow.md`（Scan / Discovery Flow 节）。

**网格卡片尺寸基准**: `GRID_CARD_BASE = 240`（`library.js`），最小尺寸 = `240 × --scale`（= 详情封面宽度）。`repeat(auto-fill, minmax(size, 1fr))` 填满行宽，无 `max-width` 限制，卡片自适应列宽。gap = `calc(1.25rem × --scale)`。仪表盘各模块以此为锚点对齐。

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

## Play Sessions（播放会话追踪）

mpv 模式下自动记录播放进度到 SQLite。`activePlays` Map（内存）每 10s 精细化更新 SQLite，mpv 关闭时 `final: true` 标记触发最终保存和 Map 清理。

Play Session 字段定义见 `.agents/docs/data-flow.md`（Play Session Flow 节）。

## Gotchas

- **DATA_DIR 差异**：dev 模式 DATA_DIR = `server/`；pkg/MSI 模式 DATA_DIR = `%APPDATA%/MyAnimeDock`
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

`public/js/debug.js` — 前端诊断系统，默认关闭（F12 启用），全环境可用。遇到滚动/视图切换/数据不一致时先开日志复现。

```js
__debug.toggle()              // 启用/关闭（localStorage 持久化）
__debug.log(tag, ...args)     // 带标签的 console.log，关闭时不输出
__debug.snapshot(label)       // 快照：view, scrollTop, scrollHeight, 数据长度等
```

**埋点位置**（遇到新 bug 时追加 snapshot/log）：`showView()`（app.js:24-28，view 切换 + scrollTop）、`loadLibrary()`（library.js:144-155，soft 判定）、`restoreLibraryScroll()`（library.js:169-173，实际 scrollTop）。

## Development Workflow — 四层验证

| 层级 | 耗时 | 命令 | 场景 |
|------|------|------|------|
| Tier 0 | ~20s | `npm run check:rust` | Rust 类型检查（cargo check） |
| Tier 1 | 秒级 | `npm run dev:server:watch` | JS 改动，nodemon 自动重启 |
| Tier 2 | ~1min | `npm run dev:server:watch` + `npm run dev:tauri` | Rust 改动，Tauri 开发窗口 |
| Tier 3 | ~5min | `npm run build` | 最终打包 MSI/NSIS |

## Testing

测试指南见 `.agents/docs/testing.md`（模式惯例、已知行为、陷阱记录）。

```bash
cd server && npm test    # 全量测试（81 tests）
```

| 文件 | 测试数 | 覆盖模块 |
|------|--------|----------|
| `server/__tests__/db.test.js` | 17 | `loadData`, `saveLibrary`, `saveMyList`, `updateEpisodesWatched`, 全生命周期（导入→播放→归档→删除） |
| `server/__tests__/scanner.test.js` | 65 | `parseFolderName`(21), `isExtraVideo`(16), `extractBgmId`(7), `findVideos`(5), `hasDirectVideos`(5), `buildLeaf` via `scanMediaDirFlat`(5), `scanMediaDirFlat`(5), `scanMediaDir`(1) |

### 修 bug / 新增功能

- **修 bug 时**：先写一个能复现 bug 的测试（确认失败），再修代码让它通过
- **新增数据持久化功能时**：测试必须覆盖"修改 → `loadData()` 重载 → 验证"路径，只测内存状态不够
- **新增 scanner 类型功能时**：按 `scanner.test.js` 模式（纯函数 + 文件系统集成 + 已知行为记录）