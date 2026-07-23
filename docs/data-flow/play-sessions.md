# Play Session 流

## 隐式决策规则

以下逻辑散落在代码中但未在任一文件里显式声明，阅读 / 修改播放流程前必读：

### 看完判定阈值
`server/mpv-controller.js:8` — `WATCHED_RATIO = 0.9`

mpv 关闭时（`close` 事件），若 `peakPos / duration >= 0.9`，`watched = true`。
也即播放进度达到全长的 **90%** 即视为看完。这个比值判断在 mpv 进程关闭前最后一条 `onProgress` 和关闭时的 `final` 回调中都会执行。

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

### 前端轮询 + Toast
`public/js/detail.js:101-123` — `startDetailRefresh()`

前端在详情页启动后，每 2 秒轮询 `/api/mpv-status`。当检测到 mpv 从活跃变为不活跃时：
1. 重新 GET `/api/anime/:id` 拉取最新数据
2. 重渲染详情页
3. 判断是否全部 watched + `myListStatus === 'completed'`
   - 是 → toast `"播放已结束，已看完所有剧集"`，跳过通用 toast
   - 否 → toast `"播放已结束，进度已更新"`

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
      │   ├─ --start receives seconds (not 0-1 percentage)
      │   ├─ Spawn mpv with IPC pipe (--input-ipc-server)
      │   ├─ onProgress (every 10s) → db.updateEpisodeProgress() + db.updatePlaySession()
      │   │   ├─ mpv time-pos is in SECONDS
      │   │   ├─ ep.progress = currentPos  // 秒数（raw time-pos from mpv）
      │   │   ├─ session.duration = peakPos - progressStart  // 实际观看内容量（秒）
      │   │   └─ session.clockTime = wall clock (endTime - startTime)
      │   ├─ onError → clean up session, return error to frontend via Promise
      │   └─ onClose (code≠0 && lived<3s) → report crash to frontend
      ├─ final callback (mpv process close):
      │   ├─ watched = currentDuration > 0 && peakPos / currentDuration >= 0.9
      │   ├─ If watched: ep.watched = true, db.updateEpisodeProgress()
      │   ├─ Auto-complete check: all episodes watched?
      │   │   ├─ Yes + myEntry exists → myEntry.status = 'completed' + completedAt
      │   │   ├─ No + myEntry exists → myEntry.status = 'watching'
      │   │   └─ No myEntry → skip
      │   └─ bangumiSync.pushStatusChange() if anime has bangumiId
      ├─ await Promise with 2s timeout (capture sync spawn errors)
      └─ Return 200 OK or 500 { error: msg }

  NOTE: Frontend sends ep.progress (seconds). Server checks if 0 < position < 1
  (legacy ratio guard), otherwise assumes seconds. mpv --start receives seconds.
  progressStart is also in seconds, so duration = peakPos - progressStart is correct.
```

## 手动更新进度

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

## 隐式实现细节

### `ep.progress` 的单位
`server/routes/playback.js:139`

`ep.progress` 统一以**秒**为单位：

| 来源 | 值 | 说明 |
|------|----|------|
| mpv `onProgress` | 秒数 | `currentPos` 来自 mpv `time-pos`，前端用 `ep.progress / ep.duration * 100` 算百分比 |
| 主动标记未看完 | `0` | toggle watched OFF 时重置进度 |

注意：
- `ep.progress > 0` 判断的是**是否有过播放进度**，不区分"正在看"还是"看完重温"
- toggle watched ON **不修改** `ep.progress`，保留 mpv 最后写入的秒数
- 播放续播时有兜底（`playback.js:96-98`）：如果 `0 < position < 1` 则按比例换算秒，否则直接当秒用

### Session 二次绑定验证
`server/routes/playback.js:133,137`

`onProgress` 回调中有两层 sessionId 校验避免异步污染：

```
① cbSid !== sessionId        ← callback 的 session 不属于当前 handlePlay 调用
② active.sessionId !== cbSid  ← activePlays 中的 session 已被新播放替换
```

典型场景：用户快速切换播放不同文件，旧 mpv 进程的 `onProgress` 到达时不应修改新 session 的数据。

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
| `onProgress({final: true})` | 落盘当前进度 + auto-complete 检查 |

`onError` 的清理和 `onProgress` 的数据落盘不会冲突——`onError` 删 session 记录，`final` 写 episode 进度。

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

### 进度轮询精度
`server/mpv-controller.js:132-143`

`onProgress` 每 10 秒固定间隔发送，非事件驱动。这意味着：
- 两次轮询间的进度变化丢失（最多丢失 10 秒）
- 关窗口时的 `final:true` 回调**会补发最后一次的位置**（`currentPos` + `peakPos`）
- `peakPos` 是 session 期间的最高 `time-pos`，用于计算 `session.duration`（`peakPos - progressStart`）
