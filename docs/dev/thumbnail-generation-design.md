# 剧集缩略图生成统一方案（设计文档）

> 状态：已确认，已实现（含"生成与加载解耦"202 no-wait 里程碑）
> 背景：详情页打开时 ffmpeg 进程风暴导致卡顿
> 相关代码：`server/thumbnail-queue.ts`、`server/routes/playback.ts`

## 1. 问题现状

打开详情页时缩略图存在**两条并行生成路径**：

| 路径 | 触发 | 并发控制 | 缓存键 |
|------|------|---------|--------|
| 后台队列 `thumbnail-queue.ts` | 详情页打开 `enqueue(anime,true)` 插队、扫描/入库 | ✅ 并发=3，mpv 播放时暂停 | md5(path + THUMB_HASH_SEED) |
| 按需端点 `playback.ts handleThumbnail` | EpisodeHeatmap 懒加载 `/api/thumbnail?time=mid` | ❌ 无上限，cache miss 直接 spawn ffmpeg | 同键 |

**核心矛盾**：两条路径共享缓存键，但并发闸门只作用于队列。详情页打开时两者并行 → 可见集直连 spawn + 队列 3 并发，峰值十几个 ffmpeg 进程，CPU/IO 打满。且无 in-flight 去重，同一文件并发请求会重复生成。

## 2. 目标

- 所有缩略图生成走**一条带闸门的管线**（统一并发闸门）。
- 常态命中缓存（后台空闲预生成兜底）。
- miss 有兜底：`202 {status:'pending'}` no-wait + 入队受闸生成（`scheduleGeneration` priority=ondemand）+ status 三态轮询判定就绪，**前端零改动**。
- 消除"边播放边开详情页卡 30s"问题（mpv 暂停只作用于后台项）。

## 3. 方案设计

### 3.1 架构总览

```
后台预生成（空闲）                         按需请求（用户正在看）
  扫描/入库 enqueue ─────────────┐        /api/thumbnail (time=mid)
  详情页打开 enqueue(anime,true) ─┼─┐     cache 命中 → 直接返回 ✅
                                  ▼  ▼     cache miss → 202 pending + 后台受闸生成
                     ┌─ ThumbnailQueue（唯一闸门，并发=4）───────────┐
                     │ • 优先级：按需 miss > 详情页插队 > 后台预生成    │
                     │ • single-flight：thumbPath 去重                │
                     │ • mpv 播放时：仅暂停后台项，按需项照常处理       │
                     │ • 生成完成 → 写盘（status 端点返 ready）        │
                     └─────────────────────────────────────────────┘
```

### 3.2 统一生成管线（`server/thumbnail-queue.ts`）

**队列项加类型标记**：`{ type: 'ondemand' | 'background', resolve?, reject? }`

**新增 `scheduleGeneration(filePath, opts?)`**（统一入队入口，返回 `'cached' | 'queued' | 'added'`）：
- `opts`: `{ time?, cacheKey?, animeId?, episodeNumber?, priority?, prepend? }`；默认 `cacheKey=THUMB_HASH_SEED`、`priority='background'`、`prepend=false`
1. 缓存文件已存在 → `'cached'`（不入队）
2. **single-flight 去重**：已在 `_enqueuedThumbs`（入队）或 `_ongoing`（生成中）→ `'queued'`，不再重复入队
3. 否则新建 item 入队（`prepend ? unshift : push`）→ `'added'`；`priority==='ondemand'` 立即 `_drain()`，`background` 走 200ms 合并 `_scheduleDrain()`

**time 语义**：`_generate` 用 `item.time ?? (item.duration ? Math.floor(duration/2) : 探测)`——ondemand 项带显式 time 则直接用；**不带 time（mid 语义）→ 队列内部 `_probeDuration` 探测真实时长取中点**。探测结果缓存于 `_durCache`，且**探测到的真实时长会写回 DB**（`updateEpisodeProgress(animeId, episodeNumber, { duration })`）——一次探测双用途：既算缩略图 mid 时间点，又补全 `ep.duration` 供前端（看完判断、继续观看缩略图时间点）使用。**探测失败直接报错（`duration unknown`），不兜底 60s**。`_probeDuration`/`_durCache` 是全代码库**唯一**的时长探测源。

**`enqueue(anime, prepend)` / `enqueueMissingForLibrary(library)` 改为薄包装**：保留原有去重语义（已缓存/已入队/生成中跳过）与批量日志，内部逐集调 `scheduleGeneration`（静态 type=background）。

**mpv 暂停改为按项判断**：`_drain` 中当 mpv 播放时，仅跳过 `background` 类型项；`ondemand` 项照常处理。

**`_generate` 完成/失败统一走 `_settle` 结算**：写盘成功即缓存可用（status 端点 `ready`）；失败打 warn（`item.resolve?/reject?` 保留为接口兼容，scheduleGeneration 项不再挂等待方）。

**并发数**：`_concurrency` 3 → **4**（剧集一页默认 4 个，一次生成可覆盖首屏）。

### 3.3 按需端点（`server/routes/playback.ts`）

`handleThumbnail` **绝不等待生成**：请求路径 0 探测、0 spawn：
- cache 命中（`_thumbPath` 文件存在）→ 直接 `serveThumbWithRevalidate`（200 + ETag/no-cache）
- cache miss → `res.setHeader('Cache-Control','no-store')` 后 `jsonResp(res, 202, { status: 'pending' })`，同时入队后台受闸生成：
  - `time=mid` → `scheduleGeneration(videoPath, { priority: 'ondemand' })`（不传 time/cacheKey，队列内部探测取中点，缓存键默认 THUMB_HASH_SEED）
  - 自定义 `time`（Library 继续播放卡片）→ `scheduleGeneration(videoPath, { time, cacheKey: String(time), priority: 'ondemand' })`

**新增 `handleThumbnailStatus`**（GET `/api/thumbnail/status?path=...&time=mid|数值`）：纯只读三态轮询，绝不触发生成/探测——缓存文件存在 → `{ status: 'ready' }`；`_enqueuedThumbs`/`_ongoing` 命中 → `{ status: 'generating' }`；否则/文件不存在/无效 time → `{ status: 'missing' }`。前端据此决定何时重发缩略图请求。

**范围**：mid（详情页 EpisodeHeatmap）+ 自定义 time（Library 继续播放卡片）**都走统一管线**。自定义 time 是播放进度帧，天然按需（无法预生成），但纳入统一闸门 + single-flight，消除库页加载时最多 10 个并发直连 spawn。

### 3.4 ffmpeg 命令优化（队列 `_generate`）

| 改动 | 效果 |
|------|------|
| `-ss <t>` 在 `-i` 前（已有 ✅） | input seeking，比 filter 快 ~3.8x |
| 加 `-skip_frame nokey` | 只解码关键帧，抽帧提速 |
| 加 `-threads 2` | 限单进程线程数，避免单进程吃满多核 |
| `-vframes 1` → `-frames:v 1` | 弃用参数替换 |
| 加 `-vf scale=480:-2` | 降采样到最大宽 480（高度自动且偶数，适配 yuv420p），避免输出源分辨率（1080P） |

### 3.5 前端

**本次改动范围不含前端**（仅后端 + 文档，按需求确认表）。冷缩略图请求**不再挂起**：cache miss 立即返回 `202 {status:'pending'}`（`Cache-Control: no-store`）；就绪判定走 `GET /api/thumbnail/status` 三态轮询（`ready` / `generating` / `missing`），ready 后重发缩略图请求即可命中缓存的成图。占位观感依赖前端既有占位机制，**不需要 SSE 推送**。

## 4. 改动范围

| 文件 | 改动 |
|------|------|
| `server/thumbnail-queue.ts` | 核心：类型标记、`scheduleGeneration` 统一入队入口（`'cached'/'queued'/'added'`）、`enqueue`/`enqueueMissingForLibrary` 改薄包装、删除 `ensureGenerated`、single-flight 去重、按项暂停、并发 4、ffmpeg 优化 |
| `server/routes/playback.ts` | `handleThumbnail` 冷缓存 202 no-wait（请求路径 0 探测 0 spawn）、新增 `handleThumbnailStatus` 三态端点、删除模块级 `_probeDuration`/`_durCache`/`THUMB_MIDPOINT_RATIO` |
| `server/routes/discovery.ts` | handleImport 导入完成钩子：`enqueueMissingForLibrary(data.library)` 一次 readdir 对账（缺口③） |
| `server/server.ts` | 注册 `GET /api/thumbnail/status` 路由 |
| 前端 | 无 |

**不动**：`library.ts` / `discovery.ts` 的 `enqueue` 调用、缓存键（md5(path+seed)）、空闲自动生成、mpv 暂停（仅针对后台项）。

## 5. 验证

1. `npm run typecheck`（后端 strict 0 错误）
2. `cd server && npm test`
3. 手动：清空 `data/thumbs/` → 打开长番详情页 → 观察 ffmpeg 进程数 ≤4、缩略图逐张出现（占位→图片）
4. 边播放边开详情页：按需缩略图不卡 30s
5. 回归：库页、播放进度、扫描入库不受影响

## 6. 决策记录

- 并发数 = 4（剧集一页默认 4 个，一次生成覆盖首屏）
- 纳入 ffmpeg 全部优化（`-skip_frame nokey` + `-threads 2` + `-frames:v 1`）
- 自定义 time 请求（Library 继续播放卡片）**纳入统一管线**（显式 time 参数），消除库页加载时最多 10 个并发直连 spawn
- 按需 miss **不阻塞等待**：冷缓存立即 `202 {status:'pending'}` + `scheduleGeneration(..., { priority:'ondemand' })` 后台受闸生成，前端经 `GET /api/thumbnail/status` 三态轮询判定就绪；不引入 SSE 推送
- 重构：**统一入队入口 `scheduleGeneration`**（返回 `'cached'/'queued'/'added'`），`enqueue`/`enqueueMissingForLibrary` 降级为薄包装；删除 `ensureGenerated`
- 重构：**请求路径 0 探测 0 spawn**——删除 `playback.ts` 模块级 `_probeDuration`/`_durCache`/`THUMB_MIDPOINT_RATIO`；mid 时长探测全部收敛到队列内部（`_probeDuration`/`_durCache` 唯一存活处）
- 缺口③：导入完成钩子 `enqueueMissingForLibrary(data.library)` —— 一次 readdir 对账，新增动画在首次点开前就有预生成
- 修复：后台项 duration 为 NULL 时 `_probeDuration` 探测真实时长取中点（否则回退 60s 落在 OP 画面、多集重复）
- 修复：ffmpeg 加 `-vf scale=480:-2` 降采样（卡片不需要 1080P）
- 修复：缩略图生成时 duration null 则 `_probeDuration` 探测真实时长取中点，**查不到直接报错，不兜底 60s**（自定义 time 解析失败 400）
- 重构：**时长探测收敛到缩略图队列**——导入流程不再额外探测（移除 `_probeEpisodes`），队列生成缩略图时探测到的 duration 顺便写回 DB（`updateEpisodeProgress`），一次探测双用途。导入响应零探测开销，`ep.duration` 由后台队列补齐
