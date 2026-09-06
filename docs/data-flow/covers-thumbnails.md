# Cover + Thumbnail 流

## Cover 服务

### Dev mode (`data/covers/`):
```
GET /covers/12345.jpg?w=400&q=75
  → server.ts: handleCoverImage() (inline)
  → lib/utils.ts:serveImage(coverPath, req.url, res)
      ├─ If no ?w param: readFile + serve raw
      ├─ If ?w param present:
      │   ├─ Check cache: covers/.resized/thumb_W_Q_NAME
      │   ├─ Cache hit: serve cached file
      │   ├─ Cache miss:
      │   │   ├─ ffmpeg -i INPUT -vf "scale=W:-1" -q:v Q -y CACHEPATH
      │   │   │   (W=width from ?w=, Q=quality from ?q= or default 75)
      │   │   ├─ On success: serve CACHEPATH
      │   │   └─ On error: fallback to raw file
      └─ Cache-Control: max-age=86400
```

### MSI/pkg mode:
```
DATA_DIR = %APPDATA%/MyAnimeDock
coverPath = path.join(DATA_DIR, 'covers/12345.jpg')
  → Same serveImage() pipeline
  → Resized cache at DATA_DIR/covers/.resized/
```

### Covers not in AppData yet:
```
init() validates localCover — if file doesn't exist → clear field
Frontend shows gray SVG placeholder
User must re-fetch metadata to download covers to AppData
```

## Thumbnail 生成

```
GET /api/thumbnail?path=VIDEO_PATH&time=mid|SECONDS
  → routes/playback.ts:handleThumbnail()
  → Validate videoPath exists（缺失 → 404）
  → hash = MD5(videoPath + cacheKey)   // mid → THUMB_HASH_SEED，数值 → String(time)
  → thumbPath = DATA_DIR/thumbs/${hash}.jpg
  → 热路径只服务缓存，请求路径 0 探测、0 spawn：
      ├─ 缓存命中 → serveThumbWithRevalidate（200 + ETag + Cache-Control: no-cache）
      └─ 缓存未命中 → Cache-Control: no-store + 202 { status: 'pending' }
          并行：scheduleGeneration(videoPath, { priority:'ondemand', ... })
          （mid → { priority:'ondemand' }；自定义 time → { time, cacheKey:String(time), priority:'ondemand' }）
          → 队列闸门后台生成，绝不阻塞 HTTP 请求

GET /api/thumbnail/status?path=VIDEO_PATH&time=mid|SECONDS
  → routes/playback.ts:handleThumbnailStatus()   // 纯只读，不触发生成/探测
  → { status: 'ready' | 'generating' | 'missing' }
      （ready = 缓存文件存在；generating = 在 _enqueuedThumbs 或 _ongoing 中）
```

### ffmpeg Path Resolution
```
lib/utils.ts: 解析顺序 FFMPEG_BIN 环境变量 → scripts/ffmpeg-upx.exe → 'ffmpeg'
  → Dev: server/lib/utils.ts 解析 scripts/ffmpeg-upx.exe
         （Windows，git 追踪，UPX 压缩 25.4MB）
  → pkg: db.ts 设置 process.env.FFMPEG_BIN → sidecar-modules/ffmpeg.exe
         （scripts/copy-sidecar-deps.js 从 scripts/ffmpeg-upx.exe 复制）
  → Fallback: 'ffmpeg' (system PATH)
  → 不再依赖 npm 包 ffmpeg-static
```

## Thumbnail Queue (`thumbnail-queue.ts`)

### 触发路径

| 触发点 | 文件位置 | 方式 | 优先级 |
|--------|---------|------|--------|
| Discovery 导入 | `discovery.ts` handleImport | 响应前 `enqueueMissingForLibrary(data.library)` 对账（缺口③）+ 响应后 `enqueue(anime)` | FIFO（队尾） |
| MetaMatch 同步 | `library.ts` handleLibrarySyncStream | stream `done` 后 | FIFO（队尾） |
| 详情页加载 | `library.ts` handleGetAnimeDetail | 响应后异步 | **插队**（队首） |

### 队列行为

- **并发**：4 路 ffmpeg `-frames:v 1`（0.5-2s/张）
- **空闲检测**：`activePlays.size === 0`，mpv 运行时暂停 → 30s 后重试
- **生成位置**：mid 语义取 **50% 时长中点**；`item.time` 显式给出则直接用（ondemand 自定义 time，如播放进度帧）。不带 time 时 `_probeDuration` 探测真实时长取中点（`_durCache` 缓存去重）——探测只在队列内发生，**请求路径 0 探测**
- **时长写库**：探测到的真实时长写回 DB（`updateEpisodeProgress`）——导入流程不再额外探测，`ep.duration` 由队列补齐（供前端看完判断、继续观看缩略图时间点）
- **缓存键**：`md5(filePath + THUMB_HASH_SEED).jpg`，与 `time=mid` 按需生成**共享同一缓存键**——队列已生成的缩略图按需端点直接命中，不再重复跑 ffmpeg
- **无持久化队列**：重启后队列丢失，缩略图可重新生成
- **按需兜底**：冷缩略图热路径立即 `202 {status:'pending'}`（`Cache-Control: no-store`）不挂等，由 `scheduleGeneration(..., { priority:'ondemand' })` 后台受闸生成；`GET /api/thumbnail/status` 三态轮询（ready/generating/missing）判定就绪

### 模块

```
server/thumbnail-queue.ts
  └─ ThumbnailQueue class
      ├─ scheduleGeneration(filePath, opts?) → 'cached' | 'queued' | 'added'（统一入队入口）
      ├─ enqueue(anime, prepend=false) → 薄包装（逐集调 scheduleGeneration，批量日志）
      ├─ enqueueMissingForLibrary(library) → 薄包装（启动/导入对账，一次 readdir）
      ├─ clear() → 清空队列
      ├─ length / busy → 状态查询
      └─ _drain() → 空闲循环 × 4 并发
```
