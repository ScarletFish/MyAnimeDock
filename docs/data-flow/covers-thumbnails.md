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
GET /api/thumbnail?path=VIDEO_PATH&time=60
  → routes/playback.ts:handleThumbnail()
  → Validate videoPath exists
  → hash = MD5(videoPath + time)
  → thumbPath = DATA_DIR/thumbs/${hash}.jpg
  → If cache hit: serveImage(thumbPath, ...) → same cover pipeline
  → If cache miss:
      ├─ mkdir thumbs/ if needed
      ├─ spawn(ffmpegPath, ['-ss', time, '-i', videoPath,
      │                      '-vframes', '1', '-q:v', '5',
      │                      '-y', thumbPath, '-loglevel', 'error'])
      ├─ 30s timeout
      ├─ On close(code===0): serveImage(thumbPath, ...)
      └─ On error/timeout: jsonResp 500
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
| Discovery 导入 | `discovery.ts` handleImport | 响应后异步 | FIFO（队尾） |
| MetaMatch 同步 | `library.ts` handleLibrarySyncStream | stream `done` 后 | FIFO（队尾） |
| 详情页加载 | `library.ts` handleGetAnimeDetail | 响应后异步 | **插队**（队首） |

### 队列行为

- **并发**：3 路 ffmpeg `-vframes 1`（0.5-2s/张）
- **空闲检测**：`activePlays.size === 0`，mpv 运行时暂停 → 30s 后重试
- **生成位置**：25% 时长（30-120s 区间），已知 `ep.duration` 则用，否则 60s
- **缓存键**：`md5(filePath + 'mid').jpg`，与 `time=mid` 按需生成共享缓存
- **无持久化队列**：重启后队列丢失，缩略图可重新生成
- **按需兜底**：`handleThumbnail` 保持不变，队列没来得及时即时生成

### 模块

```
server/thumbnail-queue.ts
  └─ ThumbnailQueue class
      ├─ enqueue(anime, prepend=false) → 加入队列（去重：已缓存跳过）
      ├─ clear() → 清空队列
      ├─ length / busy → 状态查询
      └─ _drain() → 空闲循环 × 3 并发
```
