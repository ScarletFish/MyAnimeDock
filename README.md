# MyAnimeDocker

自托管动漫媒体库管理器。扫描本地媒体文件夹，从 [Bangumi](https://bangumi.tv) / [TMDB](https://www.themoviedb.org/) 获取元数据，提供干净的 Web UI 来浏览、管理和追踪你的动漫收藏。

典型工作流：**发现好番 → 下载到本地 → 导入管理 → 观看追踪 → 看完归档**

## 功能

- **媒体扫描** — 递归扫描目录，自动解析文件夹名（字幕组、季度、分辨率等），输出扁平候选列表
- **多源刮削** — 支持 Bangumi / TMDB，可在设置中启用、配置 API Key、调整优先级
- **候选管理** — 扫描后显示可勾选列表，支持导入、排除、取消关联、获取元数据、重新扫描
- **置信度评分** — 基于标题提取、季号、命名规范、父链、集数自动评分 0-1，高置信度（默认 ≥85%）可一键自动导入
- **Bangumi/TMDB 元数据** — 搜索匹配、下载封面、获取简介、评分，支持批量绑定
- **Web UI** — 原生 JS SPA，深色/浅色主题，响应式布局，GSAP Flip 卡片转场动画
- **观看追踪** — 标记已看剧集、记录进度（逐集 / mpv 联动自动落盘）
- **观看统计** — 90 天热力图柱状图、继续播放卡片、剧集热力图网格
- **观看历史（Memories）** — 看完的番归档为瀑布流卡片网格（与资料库同款），支持个人评分、感想笔记
- **ani-rss 集成** — 可通过 Webhook 接收下载完成通知，自动导入到资料库（计划中）
- **mpv 集成** — 启动 mpv 播放，通过 `--term-status-msg` 解析 stderr 追踪进度
- **封面缩放** — ffmpeg 实时缩放，缩略图与详情页不同画质，缓存到 `covers/.resized/`
- **视频缩略图** — ffmpeg 截帧缓存到 `thumbs/`
- **UI 缩放** — 设置页滑动条 75%-150%，基于 rem 缩放，不影响布局质量

## 环境要求

### 开发
- Node.js 18+
- npm
- 可选：ffmpeg（视频缩略图，开发模式下自动使用 ffmpeg-static）、mpv（进度追踪）

### 构建 MSI/NSIS 安装包
- Rust MSVC 工具链（`rustup target add x86_64-pc-windows-msvc` + Visual Studio C++ 生成工具）
- WebView2 运行时（Windows 10+ 自带，Win 8.1 以下需安装）

## 快速开始

```bash
# 安装依赖
npm install
cd server && npm install && cd ..

# 配置媒体目录
# 编辑 server/config.json（从 server/config.example.json 复制）
# "mediaDir": "D:/path/to/your/anime/folder"

# 启动开发服务器
npm run dev:server
```

打开 http://localhost:3456 即可访问。

### Tauri 开发模式（桌面窗口）

```bash
# 终端 1：启动后端
npm run dev:server:watch

# 终端 2：启动 Tauri 开发窗口
npm run dev:tauri
```

### Windows 快捷菜单

```bash
start.bat
```
菜单式界面：启动开发服务器、构建 MSI/NSIS、清理缓存、Prisma 操作。

## 配置说明

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

`server/config.json` 已被 `.gitignore` 忽略。从 `server/config.example.json` 复制使用。

## 媒体文件夹结构

每个动漫放在独立子文件夹中，程序会自动解析标题、季度和字幕组信息。

```
media/
├── [SubGroup] Anime Title/
├── [VCB-Studio] Another Title S2 [Ma10p_1080p]/
└── Some Anime/Season 1/
```

- 文件夹名支持 `[字幕组] 标题 S01`、`标题/Season 1` 等多种常见格式
- anitomy 解析 + 正则兜底，中英文均支持

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 获取配置 (+ dirValid) |
| POST | `/api/config` | 更新配置 |
| GET | `/api/browse?showExcluded` | 列出扫描树（扁平 leaf） |
| GET | `/api/scan` | SSE 扫描进度 |
| POST | `/api/import` | 导入选中项目 |
| POST | `/api/discovery/unlink` | 从资料库移除，保留扫描树 |
| POST | `/api/discovery/exclude` | 标记排除扫描 |
| POST | `/api/discovery/include` | 取消排除 |
| POST | `/api/discovery/fetch-meta` | 获取元数据 (Bangumi/TMDB) |
| GET | `/api/library` | 获取资料库列表 |
| GET | `/api/anime/:id` | 获取动漫详情 |
| DELETE | `/api/anime/:id` | 删除动漫（归档到记忆） |
| GET | `/api/anime/:id/sessions` | 观看统计 (90 天) |
| POST | `/api/play` | 播放剧集 |
| POST | `/api/progress` | 更新播放进度 |
| POST | `/api/bangumi/search` | 搜索所有启用的刮削源 |
| POST | `/api/bangumi/fetch` | 为资料库项目获取元数据 |
| GET | `/api/mpv-status` | 活跃 mpv 会话 |
| GET | `/api/thumbnail?path=&time` | 视频缩略图 (ffmpeg) |
| GET | `/covers/xxx.jpg?w=&q=` | 动态封面缩放 (ffmpeg) |
| GET | `/api/memories` | 获取观看历史 |
| POST | `/api/memories` | 创建/更新记忆 |

## 构建安装包

```bash
npm run build
```

自动执行三步链：
1. `pkg` 打包 Node.js 后端 → `server-x86_64-pc-windows-msvc.exe`
2. 复制原生模块（Prisma 引擎 + ffmpeg）到 `sidecar-modules/`
3. Tauri 构建 MSI + NSIS 安装包

输出到 `src-tauri/target/release/bundle/`：
- `msi/MyAnimeDocker_1.0.0_x64_en-US.msi`
- `nsis/MyAnimeDocker_1.0.0_x64-setup.exe`

也可分别构建：
```bash
npm run build:msi   # 仅 MSI
npm run build:nsis  # 仅 NSIS
```

### 构建注意事项

- **DATA_DIR 差异**：dev 模式 = `server/`；MSI 模式 = `%APPDATA%/com.myanimedocker.app`
- **原生模块**：Prisma 查询引擎 + ffmpeg 二进制通过 `copy-sidecar-deps.js` 复制，pkg 无法直接打包 `.node` 文件
- **Rust 缓存**：`src-tauri/target/` 可达 5GB+，可安全删除后重新构建
- **Cargo mirror**：清华源配置在 `src-tauri/.cargo/config.toml`

## Tauri 桌面壳

Tauri v2 作为**桌面壳**，Node.js 后端以 **sidecar 进程** 方式运行。

```
Tauri (窗口壳)
  └── Sidecar: Node.js server (现有 server.js，不变)
        └── HTTP API (:3456)
              └── WebView: 现有前端 (HTML/CSS/JS，不变)
```

- **无需重写 Rust 后端** — 所有业务逻辑在 Node.js sidecar 中
- **前端不变** — 现有 HTML/CSS/JS 直接迁入 WebView，API 请求保持 localhost:3456
- **窗口隐藏启动** — 启动时窗口不可见，待数据库加载完成 + 服务器就绪后才显示

## 数据存储

| 层级 | 页面 | 存储 | 说明 |
|------|------|------|------|
| 资料库 | Library | SQLite (Anime + Episode 表) | 当前下载、正在观看 |
| 归档 | Memories | SQLite (Memory 表) | 已看完纪念册 |
| 配置 | Settings | JSON (server/config.json) | 轻量 ~300B，无需 DB |
| 扫描树 | Discovery | JSON (server/anime-data.json scannedTree) | 运行时缓存 |

**持久化策略**：`saveData()` 同步写入 JSON（立即落盘），异步同步到 SQLite（副本保证）。
**启动顺序**：从 JSON 加载最新数据 → 从 SQLite 回填确保一致性。

## 技术栈

- **后端**: Node.js（无框架，原生 `http.createServer`）
- **前端**: 原生 HTML/CSS/JS（无构建工具，无框架）
- **动画**: GSAP + Flip 插件，已拷贝到 `public/vendor/gsap/`
- **图片处理**: ffmpeg（`/covers/?w=` 参数实时缩放 + 缓存）
- **元数据**: Bangumi API + TMDB API（多源刮削架构，`scrapers/` 模块）
- **播放器**: mpv（`spawn` + `--term-status-msg` 解析 stderr 进度追踪）
- **存储**: SQLite（Prisma ORM）+ JSON 双写
- **桌面壳**: Tauri v2（Rust, sidecar 模式）
- **解析**: anitomy（TypeScript 移植版，纯 JS 无原生模块）
- **HTTP 请求**: Node.js 原生 `http`/`https` 模块（pkg 兼容，无需 `node-fetch` 包）

## 项目结构

```
├── server/            → Tauri sidecar (Node.js backend)
│   ├── server.js      → HTTP server + REST API (:3456)
│   ├── db.js          → Prisma 封装层
│   ├── scanner.js     → 媒体目录扫描 + anitomy 解析
│   ├── mpv-controller.js → mpv 进度追踪
│   ├── scrapers/      → 多源刮削（bangumi, tmdb）
│   ├── covers/        → 下载的封面原图
│   ├── thumbs/        → 视频缩略图缓存
│   ├── anime-data.json → JSON 运行时缓存
│   ├── config.json    → 用户配置
│   ├── config.example.json → 配置模板
│   └── package.json   → Sidecar 依赖
├── src-tauri/         → Tauri v2 桌面壳
│   ├── src/main.rs    → Sidecar 启动 + 窗口管理
│   ├── tauri.conf.json
│   ├── capabilities/  → v2 权限配置
│   └── icons/         → 应用图标
├── prisma/            → SQLite schema + migrations
│   ├── schema.prisma  → 7 个表定义
│   └── anime.db       → SQLite 数据库
├── public/            → 前端静态文件
│   ├── index.html
│   ├── styles.css
│   ├── vendor/gsap/   → GSAP + Flip（本地拷贝）
│   └── js/            → SPA 各视图
├── scripts/           → 构建/迁移工具
│   ├── copy-sidecar-deps.js  → pkg 后复制原生模块
│   └── migrate-to-sqlite.js  → JSON → SQLite 迁移（一次性）
├── start.bat          → Windows 快捷菜单
├── package.json       → 根项目配置
└── AGENTS.md          → Agent 工作流上下文
```

## License

ISC
