# My List — 实现计划

> 设计确认于 2026-06-26。
> 状态：待执行。

---

## 设计概要

### 页面定位

| 页面 | 定位 | 内容 |
|------|------|------|
| **动漫库** (Library) | 本地主页 | 只有本地有文件的可播放项，维持现有行为不变 |
| **我的列表** (My List) | 全生命周期总览 | Library 项 + 愿望单（Bangumi），按状态分类展示 |

### 分类 Tab 栏

```
[ 全部 ] [ 当前观看 ] [ 计划中 ] [ 已完成 ] [ 搁置 ] [ 抛弃 ]
```

- **全部 tab**：卡片按状态分组，每组有 section 标题行（`当前观看 · 3` / `计划中 · 2`）
- **其他 tab**：只显示该状态的卡片网格，无 section 标题
- 卡片上不标注任何状态文字（tab/section 标题已说明上下文）

### 状态体系

| 英文值 | 显示名 | 说明 |
|--------|--------|------|
| `watching` | 当前观看 | 正在看的番 |
| `wish` | 计划中 | 想看的番（含愿望单） |
| `completed` | 已完成 | 已看完 |
| `on_hold` | 搁置 | 暂缓 |
| `dropped` | 抛弃 | 弃番 |

- 状态纯手动标记，不自动推断
- 归档（completed）也由用户手动标记，不检测本地文件是否存在
- 未标记状态的本地项目不出现在 MyList，只在 Library 显示

### 数据架构

```prisma
// Memory → 改名为 MyList，关联 Anime FK 不变
model MyList {
  id        String   @id @default(cuid())
  animeId   String   @unique
  status    String   @default("watching")
  rating    Float?
  thoughts  String?
  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  anime     Anime    @relation(fields: [animeId], references: [id], onDelete: Cascade)
}

// 愿望单（Bangumi 无本地文件的项目）
model Wishlist {
  id           String   @id @default(cuid())
  bangumiId    Int      @unique
  title        String
  bangumiTitle String?
  coverUrl     String?
  summary      String?
  rating       Float?
  addedAt      DateTime @default(now())
}
```

### 合并返回

`GET /api/mylist` 合并 MyList + Wishlist 返回，每条记录带 `source` 字段：

| source | 含义 | 本地文件 |
|--------|------|---------|
| `library` | 来自 MyList（有本地文件） | ✅ |
| `wishlist` | 来自 Wishlist（Bangumi） | ❌ |

---

## Phase 1 — Schema + Backend

### 1.1 Prisma schema

文件：`prisma/schema.prisma`

- `model Memory` → `model MyList`，重命名字段名一致，新增 `status String @default("watching")`
- 新增 `model Wishlist`（独立表，无 FK 约束）
- 移除旧的 `Memory` 表

### 1.2 数据库迁移

```bash
npx prisma migrate dev --name mylist
```

生成迁移文件并应用到 SQLite。测试模式数据量小，直接删旧表重建。

### 1.3 db.js

文件：`server/db.js`

**新增函数：**

| 函数 | 作用 |
|------|------|
| `saveMyList(data)` | 全量保存 MyList 表（类比 saveMemories，但不做 deleteMany 和 animeId 存在性过滤） |
| `loadMyList()` | 返回 `{ library: Anime[], myList: MyList[], wishlist: Wishlist[], playSessions }` |
| `saveWishlist(data)` | 全量保存 Wishlist 表 |
| `updateMyItemStatus(animeId, status)` | 单条更新状态 |

**修改函数：**

| 函数 | 改动 |
|------|------|
| `loadData()` | 额外读取 MyList + Wishlist 表到 data 对象 |
| ~~`saveMemories()`~~ | 保留别名，内部调用 saveMyList（向后兼容）|

### 1.4 server.js — API 端点

文件：`server/server.js`

**新增端点：**

| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/mylist` | GET | 返回合并列表：MyList items + Wishlist items |
| `/api/wishlist` | GET | 仅返回愿望单 |
| `/api/wishlist` | POST | 手动添加愿望单项 |
| `/api/wishlist/:id` | DELETE | 移除愿望单项 |
| `/api/mylist/:animeId/status` | PUT | 手动设置状态 `{ status: "completed" }` |

**修改端点：**

| 端点 | 改动 |
|------|------|
| `POST /api/memories` | 改为写入 MyList 表，兼容旧调用 |
| `DELETE /api/anime/:id` | 删除本地文件时，如果已有关联 MyList 记录则保留（保留感想），无则创建 MyList{status:completed} |

### 1.5 数据迁移

文件：`server/server.js` （或独立脚本 `scripts/migrate-my-list.js`）

- 启动时检测是否有旧的 Memory 数据
- 迁移 Memory → MyList（字段映射一致，新增 status=completed）
- 一次性，运行后标记

---

## Phase 2 — 前端 MyList 视图

### 2.1 新文件：public/js/mylist.js

**全局变量：**

```js
let mylistData = [];
let currentStatusFilter = 'all';
const STATUS_LABELS = {
  watching: '当前观看',
  wish: '计划中',
  completed: '已完成',
  on_hold: '搁置',
  dropped: '抛弃'
};
```

**核心函数：**

| 函数 | 作用 |
|------|------|
| `loadMyList()` | GET /api/mylist → 缓存到 mylistData |
| `renderMyList(filter)` | 主渲染入口 |
| `renderAllTab()` | 按状态分组，每组加 section 标题 |
| `renderFilteredTab(status)` | 单状态网格（无标题） |
| `renderCard(item)` | 卡片渲染（复用 library 的 anime-card 结构） |
| `openStatusMenu(item)` | 右键/点击菜单：设置状态、写感想、同步 Bangumi |
| `filterMyListByStatus(filter)` | 数据过滤 |

**所有 tab 渲染（全部）：**

```html
<!-- 按状态分组，完整渲染 -->
<div class="mylist-section">
  <div class="mylist-section-header">
    <span class="mylist-section-title">当前观看</span>
    <span class="mylist-section-count">3</span>
  </div>
  <div class="anime-grid" data-zoom="${gridZoom}">
    ${cards}
  </div>
</div>
```

**单 tab 渲染（当前观看 / 计划中...）：**

```html
<div class="anime-grid" data-zoom="${gridZoom}">
  ${cards}
</div>
```

**卡片渲染（复用 library 的 anime-card 结构）：**

- `source=wishlist` 的卡片：封面灰显（`opacity: 0.5`），右下角加"愿望"小标签
- `source=library` 的卡片：正常显示，hover 显示播放按钮（同 Library）
- 卡片不显示状态文字

### 2.2 index.html

文件：`public/index.html`

- 侧边栏：「归档」→「我的列表」，更换图标
- 新增 view 容器 `#mylistView`
- 保留 `#memoriesView` 但隐藏（或删除）
- Tab 栏结构在 `#mylistView` 内

### 2.3 styles.css

文件：`public/styles.css`

**新增样式：**

| 选择器 | 作用 |
|--------|------|
| `.mylist-section` | 分组容器，上下间距 |
| `.mylist-section-header` | 标题行（flex，文字+数量+可选分隔线）|
| `.mylist-section-title` | 状态名文本 |
| `.mylist-section-count` | 数量徽标 |
| `.mylist-card-wish` | 愿望单卡片的灰显效果 |
| `.wishlist-badge` | 愿望单小标签 |
| `.mylist-tab` | tab 按钮样式（重用或扩展 metamatch tab）|
| `.mylist-tab.active` | 当前 tab 高亮 |

### 2.4 app.js

文件：`public/js/app.js`

- 注册 `showView('mylist')`
- 点击侧边栏「我的列表」按钮 → 加载并显示
- Tab 切换事件绑定

### 2.5 detail.js

文件：`public/js/detail.js`

- 扩展 detail 模式：当 `source=wishlist` 时：
  - 不显示播放按钮、剧集列表、热力图、mpv 模式选择
  - 显示「未下载，此条目来自愿望单」提示
  - 显示封面、简介、评分等基本信息
- 全局导航 `goPrev`/`goNext` 支持 MyList 数据源

### 2.6 侧边栏删除

- 从 `index.html` 和 `app.js` 中移除 Memories 相关按钮和视图（或隐藏标记）

---

## Phase 3 — Bangumi 集成

### 3.1 OAuth（最小方案）

文件：`server/bangumi-auth.js`

- 用户通过浏览器手动授权 Bangumi，粘贴 token
- 存储 token 到 `config.json`
- `GET /api/bangumi/auth/status` 检查登录状态
- `GET /api/bangumi/auth/logout` 清除 token

### 3.2 愿望单拉取

文件：`server/scrapers/bangumi.js` + `server/server.js`

- 新函数 `getUserCollections(token)` — 调用 Bangumi API `/v0/users/{username}/collections`
- 新端点 `GET /api/bangumi/wishlist` → 拉取 → upsert Wishlist 表
- 前端「同步愿望单」按钮

### 3.3 进度推送

文件：`server/bangumi-sync.js`（新建）

- `POST /api/bangumi/sync/progress` — 推送单条进度到 Bangumi
- `POST /api/bangumi/sync/status` — 推送状态变更到 Bangumi
- 前端卡片菜单「同步到 Bangumi」

---

## 执行顺序

```
Phase 1 (Schema + Backend)
  ├── 1.1 prisma/schema.prisma 修改
  ├── 1.2 prisma migrate dev
  ├── 1.3 db.js 函数新增/修改
  └── 1.4 server.js 端点新增/修改
           │
           ▼
Phase 2 (Frontend MyList View)
  ├── 2.1 public/js/mylist.js (新文件)
  ├── 2.2 index.html (侧边栏 + view container)
  ├── 2.3 styles.css (新增样式)
  ├── 2.4 app.js (视图注册)
  ├── 2.5 detail.js (wishlist 只读模式)
  └── 2.6 清理 Memories 遗留
           │
           ▼
Phase 3 (Bangumi Integration)
  ├── 3.1 OAuth 最小方案
  ├── 3.2 愿望单拉取
  └── 3.3 进度推送
```

---

## 验证清单

| # | 验证项 | 预期 |
|---|--------|------|
| 1 | GET /api/mylist 返回合并数据 | MyList + Wishlist 合并，含 source 字段 |
| 2 | 设置状态 | PUT /api/mylist/:id/status 更新正确 |
| 3 | 全部 tab 渲染 | 按状态分组，每组有 section header+数量 |
| 4 | 单 tab 渲染 | 只显示对应状态卡片，无 header |
| 5 | 愿望单灰显 | source=wishlist 卡片封面 opacity 半透明，有标签 |
| 6 | 详情页 wishlist 模式 | 只读，无播放/剧集列表 |
| 7 | 侧边栏/路由 | 点击「我的列表」正确加载 |
| 8 | 旧 API 兼容 | POST /api/memories 仍写入正确 |
| 9 | 删除本地文件 | 保留 MyList 记录 |
| 10 | 愿望单拉取 | Bangumi API 返回的数据正确写入 Wishlist |
