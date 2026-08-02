# Play Session 流

## 隐式决策规则

以下逻辑散落在代码中但未在任一文件里显式声明，阅读 / 修改播放流程前必读：

### 看完判定（Finish Confirm）
`frontend/src/js/detail.js:572,611,849` — `findPendingFinishConfirm` / `showFinishConfirm` / `checkAndShowFinishConfirm`

**后端不再自动标记 watched**（`server/mpv-controller.js` 不再设 `WATCHED_RATIO`，`/api/play` 的 `final` 回调不再写 `ep.watched`）。

看完处理由设置项"进度确认"决定，三态互斥（`localStorage['myAnimDock_finishConfirm']`，默认 `prompt`；存量 `on` 自动迁移为 `prompt`）：

| 模式 | 值 | 行为 |
|------|----|------|
| 弹窗确认 | `prompt`（默认） | 弹模态框问"是否标记为已看完"，[标记]/[取消] |
| 自动标记 | `auto` | 直接标记，Toast + 滚动下一集，不弹窗 |
| 不处理 | `off` | 什么都不做（等价于旧的关闭开关） |

```
mpv 关闭 → SSE `mpv-status: {active: false}` → app.js 全局监听 onGlobalMpvStatus
  → 自动聚焦 App 窗口（focusAppWindow，不跳页）
  → 在详情页且结束的正是当前番 → window.handleDetailPlaybackEnded(animeId)
      → checkAndShowFinishConfirm(anime)
        → mode = localStorage['myAnimDock_finishConfirm'] || 'prompt'（on→prompt 迁移）
        → off → return（不处理）
        → findPendingFinishConfirm(anime):
            遍历 episodes，找 ep.progress / ep.duration >= 0.9
        → prompt 模式：弹出模态框："第 N / 总 集" + "是否标记为已看完？"
            → [取消] → _dismissedFinishConfirm Set 记录，不再弹（刷新页面后重置）
            → [标记] → 走标记流程
        → auto 模式：跳过弹窗，直接走标记流程
        → 标记流程：POST /api/progress { watched: true, progress: 0 }
          → 重新 GET /api/anime/:id 刷新数据
          → re-render 详情页（播放按钮、剧集列表）
          → scrollToNextUnwatched() 滚动列表到下一未观看
          → Toast "已标记第 N 集为已看完"
  → 不在详情页 → Toast "播放已结束，进度已更新" + 记 window.pendingFinishAnimeId
      → 之后回到该番详情页（showDetail）→ 补弹完工确认
```

关键点：
- **SSE 监听在全局（app.js `startGlobalMpvStatus`）**，任何页面都能收到播放结束事件；详情页通过 `window.handleDetailPlaybackEnded` 注册消费回调（`detail.js`），返回 false 时由全局兜底（toast + pending）
- **不在详情页时进度照样落盘**（server 每次事件写库），只丢失结束反馈；pending 机制保证回详情页后补弹"标记看完"
- **模态框是临时 DOM**（`modal-overlay` + `modal`），用完销毁
- **`_dismissedFinishConfirm`** 是 `Set`，key 为 `"animeId:epNumber"`，仅当前 session 有效；只在 `prompt` 模式下使用
- 确认后 `progress=0`，`findContinueEpisode` / `findTargetEpisode` 会跳过该集，自然落到下一集

### 自动标记前序集
`server/routes/playback.js:102-113`

当 `config.autoMarkWatched === true`（默认开启）且 `targetEp.number >= 2` 时，播放第 N 集前，自动将 **第 1 ~ N-1 集** 中未 watched 的标记为 watched。这是批量 SQLite 写入（`db.updateEpisodesWatched`），非逐集操作。

### 自动完成（Auto-Complete）
`server/routes/playback.js:154-176`

在 `final` 回调中（用户关闭 mpv 后），先检查当前动画的全部 episode 是否都已 watched：
- **全部看完**：如果该动画已有 myList 条目，设 `status = 'completed'` + `completedAt = now`，落盘
- **未全部看完**：如果已有 myList 条目且状态不是 `watching`，设 `status = 'watching'`
- 如果该动画没有 myList 条目，不创建也不写任何状态

这个逻辑接在 auto-mark 之后，保证统计 `stats("看完")` 会准确地映射到实际看完的动画。

### 前端全局 SSE + Finish Confirm + Toast
`frontend/src/js/app.js:9-50` — `startGlobalMpvStatus()` / `onGlobalMpvStatus()`；`frontend/src/js/detail.js:116-143` — `window.handleDetailPlaybackEnded`

**SSE 监听是全局的**（app.js 在 `DOMContentLoaded` 时建立 `EventSource` 连 `/api/events/mpv-status`），不随页面切换断开：

当前端收到 `mpv-status: { active: false }`（mpv 从活跃变为不活跃）时，`onGlobalMpvStatus` 统一处理：
1. 自动聚焦 App 窗口（`focusAppWindow`，Tauri 下 `unminimize + setFocus`，**不跳转页面**）
2. 若当前在详情页且结束的番正是当前展示的番 → 调用 `window.handleDetailPlaybackEnded(animeId)` 消费事件：刷新数据 + `checkAndShowFinishConfirm` + toast
3. 否则（其他页面或番不匹配）→ 通用 toast `"播放已结束，进度已更新"` + 记录 `window.pendingFinishAnimeId`

`handleDetailPlaybackEnded` 返回 `true` 表示已消费（详情页刷新），返回 `false` 则由全局兜底处理。`startDetailRefresh` / `stopDetailRefresh` 保留为兼容占位（不再各自建连接）。

**Pending 兜底：** 播放结束在非详情页时，回到该番详情页（`showDetail`）会检查 `window.pendingFinishAnimeId === id`，命中则补弹完工确认。end 事件本身不带 animeId，靠最近一次 `active:true` 事件缓存的 `gMpvAnimeId` 补全。

**HTTP 兜底：** `startGlobalMpvStatus()` 建立 SSE 后立即发一次 `GET /api/mpv-status` 查询当前播放状态（`app.js`）。这解决 SSE 刚建立时的延迟以及不支持的浏览器降级。

## 开始播放

```
POST /api/play
  → routes/playback.js:handlePlay()
  → Body: { filePath, position }  // position = ep.progress, in seconds
  → Validate filePath exists (fs.existsSync)
  → Convert position to seconds:
      if (targetEp.duration && position > 0 && position < 1)
        startSeconds = Math.round(position * targetEp.duration)
      else
        startSeconds = Math.round(position || 0)
  → Always mpv:
      ├─ Find targetAnime/targetEp from data.library
      ├─ Auto-mark previous episodes as watched (if autoMarkWatched enabled):
      │   ├─ For each ep with number < targetEp.number && !ep.watched:
      │   │   ├─ ep.watched = true (in memory)
      │   │   └─ Collect ep.number into autoMarked[]
      │   └─ db.updateEpisodesWatched(animeId, autoMarked) — batch update SQLite
      ├─ Create playSession record in data.playSessions:
      │   progressStart: startSeconds  // always in seconds, not 0-1
      ├─ activePlays.set(filePath, { sessionId, episode, anime })
      ├─ db.savePlaySessions(data) — only writes playSession table
      ├─ startMpv(mpvPath, filePath, startSeconds, callbacks):
      │   ├─ Spawn mpv with IPC pipe (--input-ipc-server) — no --start arg
      │   ├─ IPC seek after connect (if startSeconds > 0)
      │   │   ├─ mpv time-pos is in SECONDS
      │   │   ├─ final ep.progress = currentPos  // 秒数（raw time-pos from mpv）
      │   │   ├─ session.duration = peakPos - progressStart  // 实际观看内容量（秒）
      │   │   └─ session.clockTime = endTime - startTime     // 壁钟耗时（秒）
      │   ├─ onError → clean up session, return error to frontend via Promise
      │   └─ onClose (code≠0 && lived<3s) → report crash to frontend
       ├─ final callback (mpv process close):
       │   ├─ (不再设置 watched — 由前端完工确认逻辑处理：prompt/auto/off 三态)
       │   ├─ 仅落盘 progress/duration: db.updateEpisodeProgress({ progress, duration })
       │   ├─ Auto-complete check: all episodes watched?
      │   │   ├─ Yes + myEntry exists → myEntry.status = 'completed' + completedAt
      │   │   ├─ No + myEntry exists → myEntry.status = 'watching'
      │   │   └─ No myEntry → skip
      │   └─ bangumiSync.pushStatusChange() if anime has bangumiId
      ├─ await Promise with 2s timeout (capture sync spawn errors)
      └─ Return 200 OK or 500 { error: msg }

  NOTE: Frontend sends ep.progress (seconds). Server checks if 0 < position < 1
  (legacy ratio guard), otherwise assumes seconds. IPC seek receives seconds.
  progressStart is also in seconds, so duration = peakPos - progressStart is correct.
```

## 继续播放目标定位

三个位置各自独立实现，但核心逻辑统一（`findTargetEpisode` / `findContinueEpisode`）：

| 位置 | 函数 | 文件 | 用途 |
|------|------|------|------|
| Dashboard「继续观看」卡片 | `findContinueEpisode` | `library.js:209` | 选缩略图 + 点击跳转 |
| 详情页播放按钮 | `findTargetEpisode` | `detail.js:537` | 选目标集 + 按钮文字 |
| Dashboard→自动播放 | `findWatchEpisode`（委托 `findTargetEpisode`） | `detail.js:561` | 跳转后立即播放 |

**`pendingAutoPlay` 实现：**
- Dashboard「继续观看」卡片点击 → `library.js` 设 `window.pendingAutoPlay = animeId`
- 页面跳转到详情页后（`showDetail`）→ `detail.js:179-183` 检查 `pendingAutoPlay`，匹配则自动调用播放
- 使用后清空，防止重复触发
- 只对 Dashboard 点击生效，直接进入详情页不触发

### 定位优先级

```
① lastPlayedEp（最近播放会话）→ 如果未完全看完（!watched || progress > 0）→ 用它
② 数组顺序第一个未观看 → 用它
③ 全部看完 → 第一集（重新看）
```

### 播放按钮文字推断

`renderPlayButton` 根据观看历史设置按钮文字，而非仅看目标集的 progress：

```
全部看完                        → "重新播放"
targetEp.progress > 0 或观看历史  → "继续播放"
全新番（无任何观看记录）           → "开始播放"
```

隐性规则：「观看历史」定义为 `anime.episodes.some(e => e.watched || e.progress > 0)`——任一集有进度或标记即算有历史。

### 剧集列表滚动

`renderEpisodeHeatmap` 在每次渲染时自动滚动到 `lastPlayedEp`，但新增兜底：

```
lastPlayedEp 有进度（!watched || progress > 0）→ 滚到该集
lastPlayedEp 已完全看完（watched && progress=0）→ 滚到第一个未观看
无 lastPlayedEp                                   → 不滚动（自然起始位置）
```

这解决了完工确认后重新进入详情页时列表又滚回已看完那集的问题。

```
POST /api/progress
  → routes/playback.js:handleProgress()
  → Body: { animeId, episodeNumber, progress, duration, watched }
  → Update ep.progress/duration/watched in memory
  → db.updateEpisodeProgress(animeId, epNumber, { progress, duration, watched })
    (only writes episode table, no full saveAll)
  → NOTE: 手动 toggle watched (右键菜单 / 热力图点击) 不会触发 auto-complete。
    auto-complete 只在 mpv 播放结束的 final 回调中执行。
```

## Watch Activity（stats 页）

```
GET /api/stats/watch-activity
  → routes/stats.js:handleStatsWatchActivity()
  → Build last 6 months labels using LOCAL year-month
    (avoid toISOString() — UTC conversion shifts month in UTC+8 timezone)
  → For each playSession with endTime:
      ├─ Parse startTime as Date, extract LOCAL ym: `${y}-${pad(m)}`
      ├─ watchSecs = Math.max(duration, clockTime)  // duration = content progress
      └─ minutes += Math.round(watchSecs / 60)
  → Return { months: [{ label, minutes }] }
  → Frontend: D3 area chart in stats.js loadActivityChart()
  → Empty state when totalMinutes === 0
```

## Anime Sessions（详情页）

```
GET /api/anime/:id/sessions
  → routes/stats.js:handleAnimeSessions()
  → Filter: playSessions where animeId matches && endTime truthy
    (只统计已完成的 session，正在播放的不计入)
  → Aggregate by LOCAL date key (YYYY-MM-DD):
      for (const s of sessions) {
        const sd = new Date(s.startTime);
        const dateKey = LOCAL date string;  // 避免 toISOString() UTC 偏移
        byDate[dateKey] += Math.max(0, s.duration || 0);  // 只用 duration，不用 clockTime
      }
  → Fill last 90 days (i = 89 → 0) with LOCAL dates:
      result[key] = Math.round((byDate[key] || 0) / 60);  // 秒 → 分钟
  → Return { "YYYY-MM-DD": minutes }
  → Frontend: renderWatchStats() in detail-stats.js:
      ├─ totalMinutes === 0 → 隐藏整个模块（#watchStats display:none）
      ├─ 按 Mon-Sun 周聚合（new Date(dateStr + 'T00:00:00') 解析日期）
      ├─ Canvas 柱状图，x 轴 = 周，y 轴 = 分钟
      └─ 入场动画：单数据点无动画，多数据点 cubic-bezier ease-in 300ms
```

### 与 Watch Activity（stats 页）的差异

| 维度 | Anime Sessions（详情页） | Watch Activity（统计页） |
|------|------------------------|------------------------|
| API | `GET /api/anime/:id/sessions` | `GET /api/stats/watch-activity` |
| 时间窗口 | 固定 90 天 | 最近 6 个完整月份 |
| 统计范围 | 单部动画 | 全部动画 |
| 数据源 | `s.duration` 仅内容时长 | `Math.max(duration, clockTime)` 取较大值 |
| 输出粒度 | 天 → 前端聚合周 | 月 |
| 前端渲染 | Canvas 自绘柱状图 | D3 面积图 |
| 空状态 | 隐藏整个模块 | 显示 暂无播放记录 |

## Gotchas

- `activePlays` Map 是内存的，服务器重启丢失。已落盘的 playSessions 保留在 SQLite
- mpv 启动错误通过 Promise + 2s timeout 捕获，超时为"启动中"而非错误
- `session.progressStart` 始终是秒；`duration = peakPos - progressStart`，两端单位一致
- UTC/local time：session startTime 存的是 `new Date().toISOString()`，取用时必须用 local 访问器（`getFullYear/getMonth/getDate`），不能用 `toISOString().slice()` 做 UTC 转换
- **手动 toggle watched 不会触发 auto-complete**。auto-complete 只在 mpv 进程关闭的 `final` 回调中执行。这意味着如果用户通过右击标记最后一集 watched，myListStatus 不会自动变为 completed
- **无 myList 条目的动画**：播放后不会自动创建 myList 记录。status 更新仅作用于已有的 myList 条目
- **完工弹窗全局触发 + pending 兜底**：SSE 全局监听（app.js）。播放结束在详情页按"进度确认"三态处理（prompt 弹窗 / auto 直接标记 / off 忽略）；在其他页面则 toast + 记 `pendingFinishAnimeId`，回到该番详情页时补处理。进度数据不受页面切换影响（server 每次事件落盘）
- **`_dismissedFinishConfirm` 是内存 Set**：刷新页面后重置，同一集可再次弹窗；仅 prompt 模式使用，auto/off 模式不触碰
- **`lastPlayedEp` 不由完工确认更新**：`lastPlayedEp` 始终由 playSessions 基于 `startTime` 排序生成，标记 watched 不改变它。但 `findTargetEpisode` / `findContinueEpisode` 会跳过已看完的集，所以下一集才是目标
- **Dashboard 缩略图区分**：targetEp 有 progress 时缩略图取进度位置；progress=0（下一新集）时用 `&time=mid` 取中间帧

## 隐式实现细节

### `ep.progress` 的单位
`server/routes/playback.js:139`

`ep.progress` 统一以**秒**为单位：

| 来源 | 值 | 说明 |
|------|----|------|
| mpv `final` 事件 | 秒数 | `currentPos` 来自 mpv `time-pos`，前端用 `ep.progress / ep.duration * 100` 算百分比 |
| 主动标记未看完 | `0` | toggle watched OFF 时重置进度 |

注意：
- `ep.progress > 0` 判断的是**是否有过播放进度**，不区分"正在看"还是"看完重温"
- toggle watched ON **不修改** `ep.progress`，保留 mpv 最后写入的秒数
- 播放续播时有兜底（`playback.js:96-98`）：如果 `0 < position < 1` 则按比例换算秒，否则直接当秒用

### Session 二次绑定验证
`server/routes/playback.js:133,137`

`final` 回调（mpv 进程关闭时触发）中有两层 sessionId 校验避免异步污染：

```
① cbSid !== sessionId          ← callback 的 session 不属于当前 handlePlay 调用
② active.sessionId !== cbSid  ← activePlays 中的 session 已被新播放替换
```

典型场景：用户快速切换播放不同文件，旧 mpv 进程的 `final` 回调到达时不应修改新 session 的数据。

### 单例 mpv 进程
`server/mpv-controller.js:186-192`

`startMpv()` 的包装函数 `start()` 先 `stopCurrent()` 再创建新进程。任意时刻最多一个 mpv 窗口。
`stopCurrent()` 通过 `process.kill()` 关闭旧进程，旧进程的 `close` 事件会触发 `final:true` 回调并落盘。

### `--keep-open=yes`
`server/mpv-controller.js:34`

mpv 播完不会自动关闭，用户必须手动关窗口。`final: true` 事件只在窗口关闭时触发。

### 错误退出时的双路径回调
`server/mpv-controller.js:145-169`

mpv 异常退出（`code !== 0`）时**两条路径都会执行**：

| 回调 | 作用 |
|------|------|
| `onError` | 清理 session + 通知前端（仅 crash 场景：`lived < 3s`）|
| `final` 回调 | 落盘当前进度 + auto-complete 检查 |

`onError` 的清理和 `final` 回调的数据落盘不会冲突——`onError` 删 session 记录，`final` 写 episode 进度。

### Crash 判定门限
`server/mpv-controller.js:150-153`

```
code !== 0 && lived < 3000ms  →  算 crash，报告给前端
code !== 0 && lived >= 3000ms → 正常退出（用户 kill），不报错
```

3 秒阈值区分"启动闪退"和"用户主动关闭"。长寿命进程非 0 退出（如 `SIGTERM`）不会触发前端错误提示。

### IPC 重试退避
`server/mpv-controller.js:61-128`

```
每次重试: delay = min(1000 × 1.5^(n-1), 10000) ms
最多: 7 次
总窗口: ~1 + 1.5 + 2.25 + 3.375 + 5.062 + 7.594 + 10 ≈ 30 秒
```

首次连接延迟 500ms（line 130）。连接成功后 `ipcRetries` 重置为 0。

### 窗口置顶策略
`server/mpv-controller.js:35,76-85`

- 启动参数 `--ontop` 确保 mpv 窗口在所有窗口之上
- 2 秒后通过 IPC 发 `set ontop no` 解除置顶
- 避免 mpv 永久挡在其他窗口前面

### 进度获取机制
`server/mpv-controller.js:95-104`

进度不是轮询的。`currentPos` 由 mpv IPC 实时推送 `time-pos` property-change 事件更新（事件驱动，非固定间隔）：

- mpv 默认在播放中持续推送 `time-pos` 变化
- `peakPos` 跟踪 session 期间的最高 `time-pos`
- 关闭窗口时的 `final:true` 回调读取 `currentPos` + `peakPos` 一次性落盘
