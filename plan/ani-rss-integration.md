# ani-rss 集成方案

> 基于 [ani-rss](https://github.com/wushuo894/ani-rss) v3.1.50 的功能调研

---

## 总览

ani-rss 是自托管的 RSS 自动追番下载工具。本计划分三阶段打通「订阅 → 下载 → 导入」全流程。

---

## 第一阶段：Webhook 接收（低复杂度）

### 目标

ani-rss 下载完成后自动通知 MyAnimeDocker，新文件进入 Discovery 视图甚至自动导入。

### 原理

ani-rss 的通知系统支持自定义 Webhook URL。当触发 `下载完成` 事件时，POST 以下 JSON 到指定 URL：

```json
{
  "action": "下载完成",
  "title": "Re：从零开始的异世界生活",
  "jpTitle": "Re:ゼロから始める異世界生活",
  "themoviedbName": "Re:Zero",
  "tmdbid": "65942",
  "bgmUrl": "https://bgm.tv/subject/12345",
  "season": "3",
  "episode": "1",
  "downloadPath": "/Media/ReZero S3/[ANi] ... .mp4",
  "subgroup": "ANi",
  "image": "https://image.tmdb.org/...",
  "episodeTitle": "起始的终结与终结的起始"
}
```

### 实现步骤

1. **server.js** — 新增 `POST /api/webhook/ani-rss`
   - 从 `downloadPath` 提取父文件夹路径
   - 调用 scanner 扫描该路径，加入 `scannedTree`
   - 若已配置自动导入，直接执行导入逻辑
   - 返回 200 确认

2. **设置页 UI** — 添加 Webhook URL 显示（`http://host:3456/api/webhook/ani-rss`）+ 启用开关

3. **用户操作**：在 ani-rss 通知设置中添加 Webhook URL，事件选择「下载完成」

### 依赖

- ani-rss 需可达 MyAnimeDocker 服务器（同网段/同机）
- Scanner 模块已可增量扫描单路径

### 预估改动

| 文件 | 改动 |
|------|------|
| `server.js` | +1 路由，+scanner 调用 |
| `public/index.html` | 设置页加 URL 提示 |
| `public/styles.css` | 可选样式 |
| `public/js/app.js` | 可选配置字段 |

---

## 第二阶段：Swagger API 对接（中等复杂度）

### 目标

在 MyAnimeDocker UI 中查看 ani-rss 订阅状态和下载进度。

### 前提

ani-rss v3.0.1+ 内置 Swagger，需开启鉴权并获取 API Token。

### 功能点

1. **获取订阅列表** — `GET /api/ani-rss/subscriptions`
   - 调用 ani-rss Swagger 接口拉取订阅列表
   - 显示标题、进度、状态

2. **获取下载队列** — `GET /api/ani-rss/queue`
   - 显示当前正在下载和排队中的任务

3. **设置页** — 添加 ani-rss 连接配置（Host + API Token）

### 依赖

- 需摸清 ani-rss Swagger 具体端点（从源码或实际部署抓取）
- 需处理鉴权 token 刷新

### 预估改动

| 文件 | 改动 |
|------|------|
| `server.js` | +2-3 代理路由，转发到 ani-rss API |
| `config.json` | +ani-rss.apiBase, ani-rss.apiToken |
| `public/js/app.js` | 设置页连接配置 |
| `public/index.html` | 设置页表单 |
| `public/styles.css` | 可选 |

---

## 第三阶段：双向联动（较高复杂度）

### 目标

在 MyAnimeDocker 追番列表页面可以直接操作 ani-rss 订阅。

### 功能点

1. **从追番列表订阅** — 点击「订阅」按钮 → 调用 ani-rss API 添加 RSS 订阅
2. **下载完成自动导入** — Webhook → 自动导入到资料库 + 通知
3. **本地删除同步** — 资料库删除文件 → ani-rss 取消订阅？
4. **进度同步** — 本地观看进度 → 可选推送给 ani-rss？

### 依赖

- 追番列表页面（Watching）已完成
- ani-rss API 稳定可靠
- 需要清晰的冲突处理策略

---

## 关键风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| ani-rss 部署不在同一网络 | 无法 Webhook | 要求同局域网/同机部署 |
| ani-rss API 变更 | 第二阶段失效 | 先走 Webhook（URL 稳定） |
| 下载路径跨机器 | 路径无效 | 必须有共享存储或同机 |
| 自动导入误操作 | 导入不想导入的内容 | 先进入 Discovery 人工确认 |

---

## 建议执行顺序

```
Phase 1 (Webhook) — 立即可以开始
  ↓
Phase 2 (API) — 等 Needs investigation（摸清 Swagger 端点）
  ↓
Phase 3 (双向联动) — 等 Watching 页面做好
```
