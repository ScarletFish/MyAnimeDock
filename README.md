# MyAnimeDocker

自托管动漫媒体库管理器。扫描本地媒体文件夹，从 [Bangumi](https://bangumi.tv) 获取元数据，提供干净的 Web UI 来浏览和追踪你的动漫收藏。

## 功能

- **媒体扫描** — 递归扫描目录，自动解析文件夹名（字幕组、季度等）
- **Bangumi 集成** — 搜索并附加元数据、简介、封面图
- **Web UI** — 原生 JS SPA，支持深色/浅色主题，响应式网格布局
- **GSAP Flip 动画** — card 到详情页的封面流畅过渡
- **观看追踪** — 标记已看剧集、记录进度（逐集 / mpv 联动）
- **观看历史** — 评分 + 笔记
- **mpv 集成** — 启动 mpv 播放，可选通过 IPC socket 追踪进度
- **封面缩放** — sharp 实时处理，缩略图与详情页不同画质

## 环境要求

- Node.js 18+
- npm

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
  "theme": "dark"
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mediaDir` | string | `""` | 动漫文件夹根目录 |
| `playerMode` | string | `"system"` | `"system"`（系统默认播放器）或 `"mpv"`（mpv + 进度追踪） |
| `mpvPath` | string | `"mpv"` | mpv 可执行文件路径 |
| `theme` | string | `"dark"` | `"dark"` 或 `"light"` |

`config.json` 已被 `.gitignore` 忽略。从 `config.example.json` 复制使用。

## 媒体文件夹结构

每个动漫放在独立子文件夹中，程序会自动解析标题、季度和字幕组信息。

```
media/
├── [SubGroup] Anime Title/
├── [VCB-Studio] Another Title S2 [Ma10p_1080p]/
└── Some Anime-Season 1/
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 获取配置 |
| POST | `/api/config` | 更新配置 |
| GET | `/api/refresh` | 扫描媒体目录 |
| GET | `/api/library` | 获取资料库 |
| GET | `/api/anime/:id` | 获取动漫详情 |
| DELETE | `/api/anime/:id` | 删除动漫（归档到记忆） |
| POST | `/api/play` | 播放剧集 |
| POST | `/api/progress` | 更新播放进度 |
| GET | `/api/memories` | 获取观看历史 |
| POST | `/api/memories` | 创建/更新记忆 |
| POST | `/api/bangumi/search` | 搜索 Bangumi 条目 |
| POST | `/api/bangumi/fetch` | 获取 Bangumi 元数据 |
| POST | `/api/quit` | 优雅关闭服务器 |

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
- **元数据**: Bangumi API（bangumi.tv）
- **播放器**: mpv 通过 `node-mpv`（可选）
- **存储**: JSON 文件（`anime-data.json`），无数据库

## 项目结构

```
├── server.js              HTTP 服务器 + REST API
├── scanner.js             媒体目录扫描 + 文件夹名解析
├── bangumi.js             Bangumi API 客户端
├── mpv-controller.js      mpv IPC 进度追踪
├── public/
│   ├── index.html         SPA 入口
│   ├── styles.css         深色/浅色主题（CSS 自定义属性）
│   └── js/
│       ├── api.js         fetch() 封装
│       ├── app.js         路由、主题、toast
│       ├── discovery.js   发现/扫描视图
│       ├── library.js     资料库网格 + 搜索
│       ├── detail.js      详情页 + GSAP Flip 动画
│       └── memory.js      观看历史
```

## 许可证

ISC
