# Play Session 流

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
  → Always mpv (system player removed):
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
- `ep.progress` 是 0-1 浮点数，入库前从秒归一化
- UTC/local time：session startTime 存的是 `new Date().toISOString()`，取用时必须用 local 访问器（`getFullYear/getMonth/getDate`），不能用 `toISOString().slice()` 做 UTC 转换
