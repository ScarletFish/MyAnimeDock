# MyAnimeDocker

Vanilla JS SPA + Node.js HTTP server. 自托管动漫媒体库管理器。

## Commands

```bash
npm start         # Launch dev server on port 3456
npm run build     # Build standalone .exe (pkg, node18-win-x64)
```

## Architecture

**Monolithic Node.js** (no framework), **vanilla HTML/CSS/JS frontend** (no bundler).

```
server.js          → HTTP server + REST API (@ :3456)
├── scanner.js     → 扫描媒体目录，解析文件夹名
├── bangumi.js     → Bangumi API 搜索/获取元数据
├── mpv-controller.js → mpv 进度追踪（spawn + --term-status-msg，final 标记）
└── public/        → 前端静态文件（无构建步骤）
    ├── index.html
    ├── styles.css
    └── js/
        ├── api.js         → fetch() 封装
        ├── app.js         → 路由、主题、toast
        ├── discovery.js   → 发现/扫描视图
        ├── library.js     → 资料库网格
        ├── detail.js      → 详情 + GSAP Flip Hero 动画 + 右侧 3 模块
        │                   （继续播放卡片 / 剧集热力图 / 观看统计图表）
        └── memory.js      → 观看记录
```

**数据持久化**: `anime-data.json`（JSON 文件，同步读写）。**无数据库**。

**视图切换**: CSS `hidden` class toggle，无客户端路由器。

## Key Patterns

- **API 调用**: `await API.get('/api/...')`, `API.post()`, `API.del()`（`api.js` 封装）
- **XSS 防护**: 所有用户数据用 `escHtml()` / `escAttr()` 包裹
- **封面动画**: `detail.js` 中 `animateHeroCoverFlip()` — GSAP Flip，创建 `position:fixed` overlay，`Flip.getState()` → DOM 变化 → `Flip.from(state, { absolute: true })`
- **主题**: CSS 自定义属性，`[data-theme="light"]` 覆盖深色变量
- **图片动态缩放**: sharp 实时处理，列表缩略图 `/covers/xxx.jpg?w=400&q=75`，详情页 `/covers/xxx.jpg?w=540&q=80`
- **视频缩略图**: ffmpeg `-ss {time} -i "{path}" -vframes 1 -q:v 5` 截帧，缓存到 `thumbs/`，API `/api/thumbnail?path=&time=`
- **播放会话追踪**: mpv 模式在服务器内存维护 `activePlays` Map（`filePath → {sessionId, episode, anime}`），每 10s `saveData` 更新进度，mpv 关闭时 `final: true` 标记落盘
- **剧集热力图**: `detail.js` 中 `renderEpisodeHeatmap()` — 10 列色块网格（未观看/观看中/已观看），`addEventListener('click')` 绑定播放（此组件有意违反 onclick 约定）
- **观看统计**: `detail.js` 中 `renderWatchStats()` — Canvas 柱状图，数据来自 `GET /api/anime/:id/sessions`
- **GSAP 引用**: `public/vendor/gsap/`（从 `node_modules/gsap/dist/` 拷贝），不经过 npm 构建；`index.html` 中 `<script>` 直接加载

## Config

```json
{
  "mediaDir": "",       // 动漫文件夹根目录
  "playerMode": "system", // "system"（系统默认播放器）或 "mpv"（mpv + 进度追踪）
  "mpvPath": "mpv",     // mpv 可执行文件路径
  "theme": "dark"       // "dark" 或 "light"
}
```

同级目录下有 `config.example.json` 作为模板，复制为 `config.json` 即可使用。

**注意**: Discovery（发现）视图执行扫描后自动导入所有内容到资料库，不会展示候选列表让用户选择。

## Play Sessions（播放会话追踪）

mpv 模式下自动记录播放进度到 `anime-data.json`。

```json
{
  "playSessions": [
    {
      "animeId": "string",
      "episodeNumber": 1,
      "sessionId": "timestamp-random",
      "startTime": "ISO 8601",
      "endTime": "ISO 8601",
      "duration": 600,       // 内容进度秒数 (endPos - startPos)
      "clockTime": 620,      // 挂钟秒数 (endTime - startTime)
      "progressStart": 0
    }
  ]
}
```

**服务器内存**: `activePlays` Map（`filePath → {sessionId, episode, anime}`），`onProgress` 回调通过此 Map 直接修改剧集引用，每 10 秒落盘。mpv 关闭时 `final: true` 标记触发最终保存和 Map 清理。

## Gotchas

- `build.bat` 需手动复制 `sharp` 原生模块到 `dist/node_modules/`（pkg 无法打包 native modules）
- Bangumi API 受代理影响时 fallback 到 `curl`（`bangumi.js` 中自动检测）
- `anime-data.json` 和 `config.json` 在 `.gitignore` 中，不会提交
- 视频缩略图依赖 `ffmpeg`（PATH 中可用），生成时缓存到 `thumbs/` 目录，首次请求可能延迟
- 无认证/授权，局域网内 `/api/quit` 可关闭服务器
- mpv 通过 `spawn` + `--term-status-msg` 启动，解析 stderr 获取状态（JSON 格式 `{"time-pos":...,"duration":...,"pause":...}`），不依赖任何第三方模块
- `activePlays` Map（`filePath → {sessionId, episode, anime}`）仅存内存，服务器重启后丢失；持久化的 `playSessions` 保存在 `anime-data.json`
- 动漫 ID 由 `parsedTitle + (parsedSeason ? '-Season ' + parsedSeason : '')` 生成，重命名文件夹会导致 ID 变化
- 系统播放器模式不追踪播放时长（无可编程回调），只有 mpv 模式会写入 `playSessions`
- pkg 打包用 `process.pkg ? path.dirname(process.execPath) : __dirname` 处理路径

## Frontend Conventions

- `camelCase` 命名，2 空格缩进
- HTML 事件用 `onclick` 属性（非 `addEventListener`），除 `settingsPlayerMode.change` 以及 `detail.js` 中 `renderEpisodeHeatmap()` 的热力方格点击（动态渲染必须用 `addEventListener`）
- GSAP 已注册全局 `gsap.registerPlugin(Flip)`
- 动画 `onComplete` 中不删除 `detail-enter-active` class（防止 `.view fadeSlideUp` 激活），由 `resetDetailEnter()` 在下次导航时清理
