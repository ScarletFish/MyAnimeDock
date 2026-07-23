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
  → Body: { filePath, position }  // position = ep.progress, 0-1 float
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
      │   │   ├─ ep.progress = Math.min(1, max(0, timePos / duration))  // normalize to 0-1
      │   │   ├─ session.duration = peakPos - progressStart  // both in seconds
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

  NOTE: Frontend sends ep.progress (0-1 float). Server converts to seconds
  using known ep.duration before passing to mpv --start or storing as
  progressStart. This ensures duration = peakPos - startSeconds is correct.
  ep.progress in SQLite is always 0-1 (normalized on every onProgress call).
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
  → Filter playSessions by animeId + endTime truthy
  → Aggregate duration by LOCAL date
    (avoid toISOString() — UTC conversion shifts date in UTC+8 timezone)
  → Fill last 90 days using LOCAL dates
  → Return { "YYYY-MM-DD": minutes }
  → Frontend: Canvas bar chart in detail.js renderWatchStats()
```

## Gotchas

- `activePlays` Map 是内存的，服务器重启丢失。已落盘的 playSessions 保留在 SQLite
- mpv 启动错误通过 Promise + 2s timeout 捕获，超时为"启动中"而非错误
- `ep.progress` 是 0-1 浮点数，入库前从秒归一化；`session.progressStart` 始终是秒
- UTC/local time：session startTime 存的是 `new Date().toISOString()`，取用时必须用 local 访问器（`getFullYear/getMonth/getDate`），不能用 `toISOString().slice()` 做 UTC 转换
- **手动 toggle watched 不会触发 auto-complete**。auto-complete 只在 mpv 进程关闭的 `final` 回调中执行。这意味着如果用户通过右击标记最后一集 watched，myListStatus 不会自动变为 completed
- **无 myList 条目的动画**：播放后不会自动创建 myList 记录。status 更新仅作用于已有的 myList 条目
