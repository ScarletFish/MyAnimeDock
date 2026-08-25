# 蜜柑 RSS 自动订阅功能设计

## 场景

用户通过蜜柑计划（Mikan）浏览番剧，一键订阅后自动下载到媒体库。

## 核心流程

```
用户点击"订阅" → 后端添加 RSS 到 qBittorrent + 设置下载规则 → qBittorrent 自动下载 → scanner 识别新文件
```

## 已确认需求

### 基础功能

| 需求 | 实现 |
|------|------|
| **前端** | 替换"复制 RSS"为"订阅"按钮 |
| **下载目录** | `{基础目录}/{番剧名}/`（如 `E:\Videos\Anime\欺诈游戏\`） |
| **分类** | 固定 `anime` |
| **是否暂停** | 默认直接下载 |
| **bgmId** | 从 Mikan 详情页提取，用于后续匹配 |

### 筛选规则（可选，对应 qBittorrent RSS rule 的 mustContain/mustNotContain）

| 筛选 | 默认值 | 示例 |
|------|--------|------|
| **语言筛选** | 空（全部） | `简体\|简繁` 只下载简体字幕 |
| **集数筛选** | 空（全部） | `\.5` 排除 .5 集（总集篇/特别篇） |
| **画质筛选** | 空（全部） | `1080p` 只下载 1080p |

### 预设 Tag（订阅后弹窗中可快速选择）

| 分类 | 标签 | 正则值 |
|------|------|--------|
| 语言 | 简体 | `简` |
| 语言 | 繁体 | `繁` |
| 语言 | 简繁 | `简繁\|简日\|繁日` |
| 画质 | 1080p | `1080p` |
| 画质 | 720p | `720p` |
| 画质 | 4K | `2160p\|4K` |
| 排除 | 半集 | `\.\d+\]` 或 `\.(5)` |
| 排除 | 合集 | `合集\|BOX\|COMPLETE` |
| 来源 | CR | `CR\|Crunchyroll` |
| 来源 | ABEMA | `ABEMA` |

### 订阅规则

| 规则 | 说明 |
|------|------|
| **单字幕组订阅** | 每部番只订阅一个字幕组，符合主流媒体库设计 |
| **禁止重复订阅** | 同一部番不能同时订阅多个字幕组 |
| **换组流程** | 先取消旧订阅 → 再订新的 |
| **取消订阅** | 从 qBittorrent 移除 RSS + 规则 |

### 完成后清理（可选）

| 选项 | 说明 |
|------|------|
| **删除种子** | 下载完成后从 qBittorrent 删除种子（保持干净） |
| **默认行为** | 不删除，由用户在设置中配置 |

## 文件夹结构

```
E:\Videos\Anime\欺诈游戏\
  ├── [LoliHouse] 欺诈游戏 - 01 [WebRip 1080p].mkv
  ├── [LoliHouse] 欺诈游戏 - 02 [WebRip 1080p].mkv
  └── ...
```

- **文件夹名**：中文番剧名（从 Mikan 获取）
- **文件名**：种子自带文件名
- **bgmId**：用于与 Bangumi 数据匹配

## qBittorrent RSS API

### 添加 RSS Feed

```
POST /api/v2/rss/addFeed
参数: url, path (可选)
```

### 设置自动下载规则

```
POST /api/v2/rss/setRule
参数: ruleName, ruleDef (JSON)
```

ruleDef 结构：
```json
{
  "enabled": true,
  "mustContain": "1080p",
  "mustNotContain": "\\.5",
  "useRegex": true,
  "affectedFeeds": ["https://mikanime.tv/RSS/Bangumi?bangumiId=3941&subgroupid=615"],
  "savePath": "E:\\Videos\\Anime\\欺诈游戏",
  "assignedCategory": "anime",
  "addPaused": false
}
```

### 移除规则

```
POST /api/v2/rss/removeRule
参数: ruleName
```

## 数据库设计

### 新增表：MikanSubscription

```sql
CREATE TABLE MikanSubscription (
  id TEXT PRIMARY KEY,
  animeId TEXT NOT NULL,
  bgmId TEXT,
  name TEXT NOT NULL,
  subgroupId INTEGER NOT NULL,
  subgroupName TEXT NOT NULL,
  rssUrl TEXT NOT NULL,
  savePath TEXT NOT NULL,
  mustContain TEXT,        -- 正则，如 "1080p" 或 "简体\|简繁"
  mustNotContain TEXT,     -- 正则，如 "\.5" 排除半集
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (animeId) REFERENCES Anime(id)
);
```

## API 设计

### 订阅

```
POST /api/mikan/subscribe
Body: {
  animeId: string,
  bgmId: string,
  name: string,
  subgroupId: number,
  subgroupName: string,
  rssUrl: string,
  mustContain?: string,    -- 正则，如 "1080p" 或 "简体\|简繁"
  mustNotContain?: string  -- 正则，如 "\.5" 排除半集
}
```

### 取消订阅

```
POST /api/mikan/unsubscribe
Body: { subscriptionId: string }
```

### 查询订阅状态

```
GET /api/mikan/subscription?animeId=xxx

Response: {
  id: string,
  animeId: string,
  bgmId: string,
  name: string,
  subgroupId: number,
  subgroupName: string,
  rssUrl: string,
  savePath: string,
  mustContain?: string,
  mustNotContain?: string,
  createdAt: string
}
```

## UI 设计

### 订阅按钮（在字幕组列表中）

```
[LoliHouse]  ✓ 已订阅
[RuanZhouFengLin]  [订阅]
[ANi]  [订阅]
```

### 点击"订阅"后弹出状态窗口

```
┌─────────────────────────────────────┐
│  订阅设置 - 欺诈游戏 / LoliHouse    │
├─────────────────────────────────────┤
│  必须包含: [1080p           ]        │
│  排除内容: [\.5             ]        │
│                                     │
│  快捷标签:                          │
│  [简体] [繁体] [简繁] [1080p] [4K]  │
│  [720p] [半集] [合集] [CR] [ABEMA]  │
│                                     │
│        [取消]  [确认订阅]           │
└─────────────────────────────────────┘
```

## 边界情况

| 情况 | 处理 |
|------|------|
| **多字幕组** | 单字幕组订阅，用户选择偏好的组 |
| **弃坑** | qBittorrent 自动跳过，无需处理 |
| **集数差异** | 各字幕组独立，互不影响 |
| **已订阅** | 前端显示状态，禁止重复 |
| **bangumiId 重复** | 库中已存在则跳过（现有逻辑） |

## 实现步骤

1. **后端**：数据库迁移，创建 `MikanSubscription` 表
2. **后端**：实现 `POST /api/mikan/subscribe` 路由（含 mustContain/mustNotContain）
3. **后端**：实现 `POST /api/mikan/unsubscribe` 路由
4. **后端**：实现 `GET /api/mikan/subscription` 路由
5. **后端**：qBittorrent API 封装（addFeed/setRule/removeRule/removeItem）
6. **前端**：订阅按钮 + 状态显示
7. **前端**：订阅弹窗 + 预设 tag 选择器
8. **前端**：取消订阅确认

## 参考

- qBittorrent WebAPI: https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#rss-experimental
- ani-rss: 类似实现，单字幕组订阅模式
