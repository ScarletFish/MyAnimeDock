# 剧集缩略图生成统一方案（设计文档）

> 状态：已确认，待实现
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
- miss 有兜底：入队高优先级 + 去重，前端占位自动替换，**前端零改动**。
- 消除"边播放边开详情页卡 30s"问题（mpv 暂停只作用于后台项）。

## 3. 方案设计

### 3.1 架构总览

```
后台预生成（空闲）                         按需请求（用户正在看）
  扫描/入库 enqueue ─────────────┐        /api/thumbnail (time=mid)
  详情页打开 enqueue(anime,true) ─┼─┐     cache 命中 → 直接返回 ✅
                                 ▼  ▼     cache miss → 入队高优先级 + 等待
                    ┌─ ThumbnailQueue（唯一闸门，并发=4）───────────┐
                    │ • 优先级：按需 miss > 详情页插队 > 后台预生成    │
                    │ • single-flight：Map<thumbPath, Promise> 去重  │
                    │ • mpv 播放时：仅暂停后台项，按需项照常处理       │
                    │ • 生成完成 → resolve 等待方 → 返回图片          │
                    └─────────────────────────────────────────────┘
```

### 3.2 统一生成管线（`server/thumbnail-queue.ts`）

**队列项加类型标记**：`{ type: 'ondemand' | 'background', resolve?, reject? }`

**新增 `ensureGenerated(filePath, time, cacheKey, timeout)`**（供按需端点调用，`time` 为显式目标时间，直接作为 ffmpeg `-ss` 值）：
1. 缓存文件已存在 → 立即 resolve
2. **single-flight 去重**：`_ongoing: Map<thumbKey, Promise>`，同文件并发请求共享一次生成（thumbKey = 最终 thumbPath）
3. 否则以 `ondemand` 类型高优先级入队 + 立即 drain + 返回带超时（30s）的 Promise

**time 语义**：`_generate` 用 `item.time ?? (item.duration ? Math.floor(duration/2) : 探测)`——ondemand 项用显式 time，background 项（`enqueue`）从 duration 取 mid。**duration 缺失（NULL）时先 `_probeDuration` 探测真实时长再取中点**；**探测失败直接报错（`duration unknown`），不兜底 60s**。探测结果缓存于 `_durCache`，且**探测到的真实时长会写回 DB**（`updateEpisodeProgress(animeId, episodeNumber, { duration })`）——一次探测双用途：既算缩略图 mid 时间点，又补全 `ep.duration` 供前端（看完判断、继续观看缩略图时间点）使用。

**`enqueue(anime, prepend)` 保留**（后台预生成/详情页插队），增加**入队去重**：已在队列中或已在生成中的 thumbKey 跳过。

**mpv 暂停改为按项判断**：`_drain` 中当 mpv 播放时，仅跳过 `background` 类型项；`ondemand` 项照常处理。

**`_generate` 完成后 resolve/reject 等待方**（调用 `item.resolve()` / `item.reject()`）。

**并发数**：`_concurrency` 3 → **4**（剧集一页默认 4 个，一次生成可覆盖首屏）。

### 3.3 按需端点（`server/routes/playback.ts`）

`handleThumbnail` cache miss 时**不再直接 spawn ffmpeg**：
- `time=mid` → `thumbnailQueue.ensureGenerated(path, time, THUMB_HASH_SEED, 30000)`（`time = Math.floor(dur/2)`）
- 自定义 `time`（Library 继续播放卡片）→ `thumbnailQueue.ensureGenerated(path, time, String(time), 30000)`
- await Promise → `serveImage`；超时/失败 → 500
- `_probeDuration` 保留（`_durCache` 已去重）；时长探测失败 fallback 60s 逻辑不变
- 原 `_generateThumb` 直连 spawn 已删除

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

**零改动**。占位机制已有：`lazyBg`（`frontend/src/lib/lazy-bg.js`）设 CSS 背景 → 浏览器请求挂起直到服务端响应 → 占位期间显示 CSS 底色 → 图片就绪自动出现。本地应用持几个挂起 HTTP 连接无压力，**不需要 SSE 推送**。

## 4. 改动范围

| 文件 | 改动 |
|------|------|
| `server/thumbnail-queue.ts` | 核心：类型标记、`ensureGenerated`（显式 time）、single-flight 去重、入队去重、按项暂停、并发 4、ffmpeg 优化 |
| `server/routes/playback.ts` | 按需端点 mid + 自定义 time 都改走队列，删直连 spawn（`_generateThumb`） |
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
- 按需 miss 采用阻塞等待（single-flight Promise），不引入 SSE 推送
- 修复：`ensureGenerated` 参数语义为显式 `time`（非 duration），避免 mid 双半 bug
- 修复：后台项 duration 为 NULL 时 `_probeDuration` 探测真实时长取中点（否则回退 60s 落在 OP 画面、多集重复）
- 修复：ffmpeg 加 `-vf scale=480:-2` 降采样（卡片不需要 1080P）
- 修复：缩略图生成时 duration null 则 `_probeDuration` 探测真实时长取中点，**查不到直接报错，不兜底 60s**（on-demand mid 探测失败 500、自定义 time 解析失败 400）
- 重构：**时长探测收敛到缩略图队列**——导入流程不再额外探测（移除 `_probeEpisodes`），队列生成缩略图时探测到的 duration 顺便写回 DB（`updateEpisodeProgress`），一次探测双用途。导入响应零探测开销，`ep.duration` 由后台队列补齐
