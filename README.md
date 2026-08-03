<h1 align="center">MyAnimeDock</h1>

<p align="center">
  <b>本地优先的动漫收藏管理工具</b><br>
  智能扫描、Bangumi 元数据匹配、mpv 进度追踪——现代化的一站式本地番剧库。
</p>

<div align="center">
<img alt="Windows 10+" src="https://img.shields.io/badge/Windows-10%2B-blue?logo=windows">
<img alt="Tauri v2" src="https://img.shields.io/badge/Tauri-v2-orange?logo=tauri">
<img alt="Node.js" src="https://img.shields.io/badge/Node.js-18-green?logo=nodedotjs">
<img alt="mpv" src="https://img.shields.io/badge/mpv-player-brightgreen?logo=mpv">
<img alt="Bangumi" src="https://img.shields.io/badge/Bangumi-metadata-yellow">
<img alt="License" src="https://img.shields.io/badge/License-ISC-lightgrey">
</div>

<p align="center">
🇨🇳 <a href="./README.md">简体中文</a> | 🇺🇸 <a href="./README.en.md">English</a>
</p>

---

## 目录

- [简介](#简介)
- [设计思路](#设计思路)
- [功能特性](#功能特性)
- [支持的文件夹命名](#支持的文件夹命名)
- [快速开始](#快速开始)
- [技术栈](#技术栈)
- [许可证](#许可证)

---

## 简介

**MyAnimeDock** 是一款 Windows 桌面应用，用于管理你下载到本地的番剧库——自动匹配 Bangumi 元数据，并通过 mpv 追踪播放进度。

> [!IMPORTANT]
> **需要 [mpv](https://mpv.io) 播放器**。MyAnimeDock 不内置播放器，请自行安装；推荐 [hooke007/MPV_lazy](https://github.com/hooke007/MPV_lazy) 整合包，开箱即用。

![效果图](images/README/library.png)

---

## 设计思路

MyAnimeDock 围绕以下原则设计：

| 原则 | 说明 |
|------|------|
| **本地优先** | 数据全部留在本地 SQLite，不强制依赖实时网络环境 |
| **播放器中转站** | 播放体验完全由播放器本身决定,目前仅支持 mpv，未来可能集成更多外部播放器 |
| **低成本刮削** | 自动识别本地动漫文件夹匹配元数据，无需严格重命名文件夹 |
| **全生命周期覆盖** | 计划中、进行中、已完结、搁置、抛弃状态全覆盖 |
| **单机体验优先** | 桌面原生应用，无需部署 Web 服务，打开即用 |

---

## 功能特性

- **智能扫描**：递归遍历媒体目录，用 anitomy 解析标题、季度与字幕组；文件夹名带 `[bgmN]` 时自动精准匹配 Bangumi。
- **元数据匹配**：从 Bangumi 拉取封面、简介、评分、标签与角色声优；批量匹配工作台支持 SSE 流式同步、取消与重试；支持模糊匹配、镜像站设置。
- **资料库主页**：默认启动视图，含多个快捷模块，主页采用可定制模块化设计。
- **mpv 播放与进度追踪**：通过 IPC 管道实时追踪进度，每 10 秒落盘、关闭时最终保存；自动标记已看、支持断点续播。
- **完整状态管理**：覆盖导入到完结的全周期，支持 5 种状态、评分、进度、日期与笔记。
- **统计看板**：完善的数据统计页面，展示标签词云、观看活跃度、评分分布与季度分布等。
- **主题系统**：6 种色彩主题 + 独立深色/浅色模式，底部 Dock 一键切换。
- ~~**Bangumi 双向同步**：授权后 Pull → Merge → Push，每次操作自动同步状态。~~
  由于Bangumi原站网络访问受限，基于安全问题暂时停止相关方向开发
- **启动自动导入**：启动时异步扫描带 `[bgmN]` 的新文件夹并自动导入。
- **拼音搜索**：同时匹配 `title` / `bangumiTitle` / `pinyinTitle`，支持全拼搜索。

## 支持的文件夹命名

MyAnimeDock 通过文件夹名自动识别标题、季度与字幕组，以下格式均可识别：

```
[SubGroup] Anime Title S01
Anime Title/Season 1
[VCB-Studio] Another Title [Ma10p_1080p]
Anime Title [bgm12345]/
```

- 含 `[bgmN]` 的文件夹会精准匹配对应 Bangumi 条目，支持自动导入
- `NCOP` / `NCED` / `PV` 等非正片视频自动排除，不计入剧集

---

## 快速开始

### 安装（推荐）

从 [Releases](https://github.com/ScarletFish/MyAnimeDock/releases) 下载 MSI 或 NSIS 安装包，双击安装。仅支持Windows 10+

---

## 技术栈

- **后端** — Node.js（原生 `http` 模块），单文件 HTTP 服务
- **前端** — Vanilla HTML / CSS / JavaScript，浏览器直接加载
- **桌面壳** — Tauri v2（Rust）
- **数据库** — SQLite（better-sqlite3 原生 SQL）
- **动画** — GSAP + Flip 插件
- **播放器** — mpv，通过 IPC 实时追踪进度
- **元数据** — Bangumi API + AniList GraphQL（罗马音辅助）
- **解析** — anitomy（TypeScript 移植版）
- **可视化** — D3.js + wordcloud2.js（图表与词云）
- **搜索** — pinyin（拼音转写）
- **打包** — pkg（Node.js sidecar）

---

## 许可证

[ISC](LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/ScarletFish">ScarletFish</a></sub>
</p>

