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
├── mpv-controller.js → mpv IPC 进度追踪
└── public/        → 前端静态文件（无构建步骤）
    ├── index.html
    ├── styles.css
    └── js/
        ├── api.js         → fetch() 封装
        ├── app.js         → 路由、主题、toast
        ├── discovery.js   → 发现/扫描视图
        ├── library.js     → 资料库网格
        ├── detail.js      → 详情 + GSAP Flip Hero 动画
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

## Gotchas

- `build.bat` 需手动复制 `sharp` 原生模块到 `dist/node_modules/`（pkg 无法打包 native modules）
- Bangumi API 受代理影响时 fallback 到 `curl`（`bangumi.js` 中自动检测）
- `anime-data.json` 和 `config.json` 在 `.gitignore` 中，不会提交
- 无认证/授权，局域网内 `/api/quit` 可关闭服务器
- mpv IPC socket 硬编码为 `/tmp/mpv-anime-manager.sock`，同一时间只能控制一个实例
- 动漫 ID 由 `parsedTitle + (parsedSeason ? '-Season ' + parsedSeason : '')` 生成，重命名文件夹会导致 ID 变化
- pkg 打包用 `process.pkg ? path.dirname(process.execPath) : __dirname` 处理路径

## Frontend Conventions

- `camelCase` 命名，2 空格缩进
- HTML 事件用 `onclick` 属性（非 `addEventListener`），除 `settingsPlayerMode.change`
- GSAP 已注册全局 `gsap.registerPlugin(Flip)`
- 动画 `onComplete` 中不删除 `detail-enter-active` class（防止 `.view fadeSlideUp` 激活），由 `resetDetailEnter()` 在下次导航时清理
