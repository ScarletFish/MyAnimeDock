<h1 align="center">MyAnimeDocker</h1>

<p align="center">
  <b>自托管动漫媒体库管理器</b><br>
  统一管理本地动漫文件，自动获取元数据，追踪观看进度，看完写感想留念。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-10%2B-blue?logo=windows" alt="Windows 10+">
  <img src="https://img.shields.io/badge/Tauri-v2-orange?logo=tauri" alt="Tauri v2">
  <img src="https://img.shields.io/badge/mpv-player-green?logo=mpv" alt="mpv">
  <img src="https://img.shields.io/badge/Bangumi-metadata-yellow" alt="Bangumi">
  <img src="https://img.shields.io/badge/License-ISC-lightgrey" alt="ISC License">
</p>

<table>
<tr>
<td><img src="images/README/1782107943635.png" alt="深色主题" width="100%"></td>
<td><img src="images/README/1782108177728.png" alt="浅色主题" width="100%"></td>
</tr>
</table>

---

## 为什么做这个

市面上的动漫管理工具要么太重，要么依赖在线服务。MyAnimeDocker 的思路很简单：

- **本地优先** — 数据全部存在你自己的 SQLite 数据库里，不依赖任何云服务
- **零配置解析** — 丢进文件夹就行，anitomy 智能识别标题、季度、字幕组
- **自动元数据** — 从 Bangumi 拉取封面、简介、评分、角色信息
- **进度追踪** — mpv 播放时自动记录每集进度，重启不丢失
- **观看管理** — 想看 / 在看 / 已完成 / 搁置 / 抛弃，一目了然

---

## 快速开始

### 安装

从 [Releases](https://github.com/user/MyAnimeDocker/releases) 下载安装包，双击即可。需要 Windows 10+（WebView2 已内置）。

### 三步上手

**配置** → **扫描** → **观看**

**1. 设置媒体目录**

点击左侧「设置」，选择你的动漫文件夹。主题、播放器、刮削源、UI 缩放都在这里，不用碰任何配置文件。

![设置页](images/README/1782107996526.png)

**2. 扫描并导入**

切换到「发现」页面，点击「扫描目录」。程序自动解析文件夹名，识别标题、季度、字幕组，以卡片列表呈现。勾选想导入的条目，一键导入。

![发现页](images/README/1782108031166.png)

**3. 浏览和播放**

「动漫库」以卡片墙展示所有收藏。点击封面进入详情页，查看简介、评分、角色声优，直接播放。

![动漫库](images/README/1782108275791.png)

---

## 核心功能

### 智能扫描

递归遍历媒体文件夹，anitomy 解析文件夹名提取标题、季度、字幕组。支持 `[字幕组] 标题 S01`、`标题/Season 1` 等常见格式，中英文均兼容，解析失败自动回退正则清洗。

### 元数据匹配

从 Bangumi 自动拉取封面、简介、评分、标签、角色信息。支持批量匹配工作台，可手动修正、重试失败项，实时显示进度。

### 播放追踪

mpv 播放时通过 IPC 自动追踪进度，播放下一集自动标记前序集数为已看，所有数据实时写入 SQLite。

### 观看状态管理

导入时自动创建「进行中」条目，删除动漫时自动标记为「已完成」。支持 6 种状态：计划中、进行中、已完成、搁置、抛弃。可设置评分（0–10）、观看进度、开始/结束日期和笔记。

### 数据可视化

四张图表展示观看数据：分类词云、观看活跃度趋势、评分分布、季度分布。

### 详情页

封面、标题、评分、简介、标签、角色声优、继续播放、剧集列表、观看统计。已完成的动漫显示归档杂志风格的感想和评分。

### 主题系统

6 种色彩主题（默认 / 琥珀 / 海洋 / 樱花 / 翡翠 / 紫罗兰）+ 独立深色/浅色模式，底部 Dock 切换即时生效。

---

## 媒体文件夹结构

```
media/
├── [SubGroup] Anime Title/
├── [VCB-Studio] Another Title S2 [Ma10p_1080p]/
└── Some Anime/Season 1/
```

文件夹名支持多种常见格式，anitomy 解析 + 正则兜底。

---

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Node.js（原生 HTTP，无框架） |
| 前端 | 原生 HTML/CSS/JS（无构建工具，无框架） |
| 动画 | GSAP + Flip 插件 |
| 元数据 | Bangumi API + AniList GraphQL |
| 播放器 | mpv（spawn + IPC 进度追踪） |
| 存储 | SQLite（Prisma ORM）+ JSON |
| 桌面壳 | Tauri v2（Rust, sidecar 模式） |
| 解析 | anitomy（TypeScript 移植版） |

## License

ISC

