# MyAnimeDocker

自托管动漫媒体库管理器。扫描本地媒体文件夹，从 [Bangumi](https://bangumi.tv) / [TMDB](https://www.themoviedb.org/) 获取元数据，提供干净的 Web UI 来浏览、管理和追踪你的动漫收藏。

## 功能

- **媒体扫描** — 递归扫描目录，自动解析文件夹名（字幕组、季度、分辨率等），输出扁平候选列表
- **多源刮削** — 支持 Bangumi / TMDB，可在设置中启用、配置 API Key、调整优先级
- **候选管理** — 扫描后显示可勾选列表，支持导入、排除、取消关联、获取元数据、重新扫描
- **置信度评分** — 基于标题提取、季号、命名规范、父链、集数自动评分 0-1，高置信度 (默认 ≥85%) 可一键自动导入
- **Bangumi/TMDB 元数据** — 搜索匹配、下载封面、获取简介、评分，支持批量绑定
- **Web UI** — 原生 JS SPA，深色/浅色主题，响应式布局，GSAP Flip 卡片转场动画
- **观看追踪** — 标记已看剧集、记录进度（逐集 / mpv 联动自动落盘）
- **观看统计** — 90 天热力图柱状图、继续播放卡片、剧集热力图网格
- **观看历史** — 评分 + 笔记 + 归档
- **mpv 集成** — 启动 mpv 播放，通过 `--term-status-msg` 解析 stderr 追踪进度
- **封面缩放** — sharp 实时处理，缩略图与详情页不同画质
- **视频缩略图** — ffmpeg 截帧缓存，悬停预览

## 环境要求

- Node.js 18+
- npm
- 可选：ffmpeg（视频缩略图）、mpv（进度追踪）

## 快速开始

```bash
# 安装依赖
npm install

# 复制配置
cp config.example.json config.json

# 编辑 config.json 设置媒体目录
# "mediaDir": "/path/to/your/anime/folder"

# 启动服务
npm start
```

打开 http://localhost:3456 即可访问。

## 配置说明

```json
{
  "mediaDir": "/path/to/anime/folder",
  "playerMode": "system",
  "mpvPath": "mpv",
  "theme": "dark",
  "scrapers": {
    "bangumi": { "enabled": true },
    "tmdb": { "enabled": false }
  },
  "tmdbApiKey": "",
  "autoImportThreshold": 0.85
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mediaDir` | string | `""` | 动漫文件夹根目录 |
| `playerMode` | string | `"system"` | `"system"`（系统默认播放器）或 `"mpv"`（mpv + 进度追踪） |
| `mpvPath` | string | `"mpv"` | mpv 可执行文件路径 |
| `theme` | string | `"dark"` | `"dark"` 或 `"light"` |
| `scrapers.bangumi.enabled` | boolean | `true` | 启用 Bangumi 刮削 |
| `scrapers.tmdb.enabled` | boolean | `false` | 启用 TMDB 刮削（需配置 API Key） |
| `tmdbApiKey` | string | `""` | TMDB API Key（从 themoviedb.org/settings/api 获取） |
| `autoImportThreshold` | number | `0.85` | 自动导入置信度阈值（0.5-1.0） |

`config.json` 已被 `.gitignore` 忽略。从 `config.example.json` 复制使用。

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
| POST | `/api/discovery/auto-import` | 自动导入高置信度项目 |
| GET | `/api/library` | 获取资料库列表 |
| GET | `/api/anime/:id` | 获取动漫详情 |
| DELETE | `/api/anime/:id` | 删除动漫（归档到记忆） |
| GET | `/api/anime/:id/sessions` | 观看统计 (90 天) |
| POST | `/api/play` | 播放剧集 |
| POST | `/api/progress` | 更新播放进度 |
| POST | `/api/bangumi/search` | 搜索所有启用的刮削源 |
| POST | `/api/bangumi/fetch` | 为资料库项目获取元数据 |
| GET | `/api/mpv-status` | 活跃 mpv 会话 |
| POST | `/api/quit` | 优雅关闭服务器 |
| GET | `/api/thumbnail?path=&time` | 视频缩略图 (ffmpeg) |
| GET | `/covers/xxx.jpg?w=&q=` | 动态封面缩放 (sharp) |
| GET | `/api/memories` | 获取观看历史 |
| POST | `/api/memories` | 创建/更新记忆 |

## 构建单文件可执行程序

```bash
npm run build
```

生成 `dist/anime-manager.exe`（Windows x64, Node 18），使用 `pkg` 打包。

**注意**：sharp 原生模块需要构建后手动复制到 `dist/node_modules/`（参考 `build.bat`）。

## 技术栈

- **后端**: Node.js（无框架，原生 `http.createServer`）
- **前端**: 原生 HTML/CSS/JS（无构建工具，无框架）
- **动画**: GSAP + Flip 插件，已拷贝到 `public/vendor/gsap/`
- **图片处理**: sharp（查询参数控制实时缩放）
- **元数据**: Bangumi API + TMDB API（多源刮削架构，`scrapers/` 模块）
- **播放器**: mpv（`spawn` + `--term-status-msg` 解析 stderr 进度追踪）
- **存储**: JSON 文件（`anime-data.json`），无数据库
- **解析**: anitomy（TypeScript 移植版，纯 JS 无原生模块）

## 项目结构

```
├── server.js              HTTP 服务器 + REST API
├── scanner.js             媒体目录扫描 + 文件夹名解析 + 置信度计算
├── bangumi.js             Bangumi API 兼容层（委托给 scrapers/）
├── mpv-controller.js      mpv 进度追踪（spawn + --term-status-msg）
├── scrapers/
│   ├── index.js           ScraperRegistry（统一注册、优先级、批量搜索）
│   ├── bangumi.js         Bangumi 刮削器（curl fallback）
│   └── tmdb.js            TMDB 刮削器
├── public/
│   ├── index.html         SPA 入口
│   ├── styles.css         深色/浅色主题（CSS 自定义属性）
│   └── js/
│       ├── api.js         fetch() 封装
│       ├── app.js         路由、主题、toast、设置页
│       ├── discovery.js   发现/扫描视图（扁平卡片 + 右侧详情抽屉）
│       ├── library.js     资料库网格 + 搜索
│       ├── detail.js      详情页 + GSAP Flip 动画
│       └── memory.js      观看历史
```

## 许可证

ISC