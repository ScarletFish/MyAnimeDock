# MyAnimeDock — 文件结构

> 项目完整文件结构标注。改文件前先查此图定位。

## 顶层

```
MyAnimeDocker/
├── AGENTS.md                  # Agent 工作指导（核心入口）
├── opencode.json              # OpenCode 配置
├── package.json               # 根 package（dev/sync/build 脚本）
├── start.bat                  # Windows 启动脚本
├── README.md / README.en.md   # 项目说明
│
├── server/                    # === 后端 (Node.js HTTP) ===
├── frontend/                  # === 前端源码 (Vite 构建) ===
├── public/                    # === 前端产物/静态资源 ===
├── src-tauri/                 # === Tauri v2 桌面壳 (Rust) ===
├── prisma/                    # === Prisma ORM (SQLite) ===
├── docs/                      # === 项目文档 ===
├── scripts/                   # === 构建/打包脚本 ===
├── .agents/                   # Agent skill 文件
├── .opencode/                 # OpenCode skill 文件
└── images/                    # 仓库图片资源
```

---

## server/ — 后端

```
server/
├── server.js                  # HTTP 入口：注册路由 + 中间件
├── db.js                      # Prisma/SQLite 封装（load/save 方法）
├── scanner.js                 # 媒体目录扫描 + 文件夹名解析
├── mpv-controller.js          # mpv IPC 播放进度追踪
├── thumbnail-queue.js         # ffmpeg 缩略图生成队列
├── logger.js                  # 结构化日志 [TAG]
├── bangumi-sync.js            # Pull→Merge→Push Bangumi 同步引擎
├── config.json                # 运行时配置（gitignore）
├── config.example.json        # 配置模板
│
├── routes/                    # 路由处理模块（9 个）
│   ├── bangumi.js             #   Bangumi 同步路由
│   ├── config.js              #   配置读写
│   ├── db-manager.js          #   数据备份/恢复/导出
│   ├── discovery.js           #   媒体目录浏览
│   ├── library.js             #   库/元数据管理
│   ├── mylist.js              #   我的列表/状态
│   ├── playback.js            #   播放控制
│   ├── relations.js           #   关联条目
│   └── stats.js               #   统计图表
│
├── scrapers/                  # 元数据抓取器
│   ├── index.js               #   抓取器入口/路由
│   ├── bangumi.js             #   Bangumi API 抓取
│   ├── bangumi-personal.js    #   Bangumi 个人收藏抓取
│   ├── anilist.js             #   AniList API 抓取（补充源）
│   └── node-fetch.js          #   fetch polyfill
│
├── lib/                       # 共享工具库
│   ├── http-fetch.js          #   统一 HTTP 请求层（超时/重试）
│   ├── config.js              #   配置加载
│   └── utils.js               #   通用工具（escHtml/escAttr 等）
│
├── __tests__/                 # 测试
│   ├── scrapers.test.js       #   抓取器测试
│   ├── scanner.test.js        #   扫描器测试
│   ├── db.test.js             #   数据库测试
│   ├── playback-encoding.test.js
│   ├── debug-season.test.js
│   ├── helpers/
│   │   └── mock-http.js       #   HTTP mock 辅助
│   └── routes/                #   路由测试（8 个，匹配 routes/）
│       ├── bangumi.test.js
│       ├── config.test.js
│       ├── db-manager.test.js
│       ├── discovery.test.js
│       ├── library.test.js
│       ├── mylist.test.js
│       ├── playback.test.js
│       └── stats.test.js
│
├── covers/                    # 封面缓存目录
├── thumbs/                    # 缩略图缓存目录
├── banners/                   # Banner 缓存目录
├── backups/                   # 备份目录
└── node_modules/
```

---

## frontend/ — 前端源码（Vite 构建输入）

```
frontend/
├── index.html                 # HTML 入口（19 个 <script> 严格顺序）
├── vite.config.js             # Vite 配置（复制模式）
├── package.json
│
├── src/
│   ├── js/                    # 前端 JS 源码（20 个文件）
│   │   ├── state.js           #   UI 全局状态管理
│   │   ├── debug.js           #   F12 调试系统
│   │   ├── ui.js              #   通用 UI 工具
│   │   ├── api.js             #   HTTP API 封装
│   │   ├── components.js      #   UI 组件工厂（dropdown/filterBar）
│   │   ├── utils.js           #   工具函数（escHtml/escAttr）
│   │   ├── discovery.js       #   媒体浏览视图
│   │   ├── library.js         #   库视图（grid 列公式 GRID_CARD_MIN/MAX）
│   │   ├── detail.js          #   详情页
│   │   ├── detail-nav.js      #   详情页导航
│   │   ├── detail-stats.js    #   详情页统计
│   │   ├── detail-pagination.js # 详情页分页
│   │   ├── mylist.js          #   我的列表
│   │   ├── metamatch.js       #   元数据匹配 SSE 流
│   │   ├── stats.js           #   统计图表页
│   │   ├── search.js          #   搜索
│   │   ├── titlebar.js        #   自定义标题栏
│   │   ├── onboarding.js      #   首次引导
│   │   ├── keyboard.js        #   键盘快捷键
│   │   └── app.js             #   应用主控（视图切换/缩放）
│   │
│   └── css/                   # 前端 CSS 源码
│       ├── styles.css         #   入口（勿改，仅 @import）
│       ├── tokens.css         #   设计 Token（颜色/间距/圆角）
│       ├── base.css           #   基础样式重置 + 全局排版
│       ├── light.css          #   亮色模式覆盖
│       ├── components/        #   组件样式（10 个）
│       │   ├── patterns.css   #     @utility 小组件（复用入口）
│       │   ├── buttons.css
│       │   ├── card-grid.css
│       │   ├── dropdowns.css
│       │   ├── forms.css
│       │   ├── modals.css
│       │   ├── badges.css
│       │   ├── toast.css
│       │   ├── discovery.css
│       │   └── theme-controls.css
│       ├── layouts/           #   布局样式（2 个）
│       │   ├── sidebar.css
│       │   └── titlebar.css
│       └── views/             #   视图样式（11 个）
│           ├── dashboard.css
│           ├── archive.css
│           ├── detail-layout.css
│           ├── detail-banner.css
│           ├── detail-episodes.css
│           ├── detail-characters.css
│           ├── mylist.css
│           ├── metamatch.css
│           ├── stats.css
│           ├── onboarding.css
│           └── keyboard.css
│
└── public/
    └── vendor/                # vendor 代理到 public/vendor/
        ├── gsap/              #   实际在 public/vendor/gsap/
        ├── d3/
        └── wordcloud/
```

---

## public/ — 前端构建产物 + 静态资源（HTTP 服务根目录）

```
public/
├── index.html                 # 构建后 HTML（同 frontend/index.html 输出）
├── styles.css                 # CSS 入口（构建合并）
│
├── js/                        # JS 构建产物（与 frontend/src/js/ 1:1）
│   ├── state.js               #   npm run sync:js 从 src/js 同步
│   ├── debug.js
│   ├── ui.js
│   ├── api.js
│   ├── components.js
│   ├── utils.js
│   ├── discovery.js
│   ├── library.js
│   ├── detail.js
│   ├── detail-nav.js
│   ├── detail-stats.js
│   ├── detail-pagination.js
│   ├── mylist.js
│   ├── metamatch.js
│   ├── stats.js
│   ├── search.js
│   ├── titlebar.js
│   ├── onboarding.js
│   ├── keyboard.js
│   └── app.js
│
├── css/
│   └── light.css              # 亮色模式 CSS
│
├── vendor/                    # 第三方库（非 npm，直接引用）
│   ├── gsap/
│   │   ├── gsap.min.js
│   │   ├── Flip.min.js
│   │   └── ScrollTrigger.min.js
│   ├── d3/
│   └── wordcloud/
│
├── icon.svg
└── favicon.svg
```

---

## src-tauri/ — Tauri v2 桌面壳

```
src-tauri/
├── Cargo.toml                 # Rust 依赖
├── Cargo.lock
├── tauri.conf.json            # Tauri 配置（窗口/侧载/权限）
├── build.rs                   # 构建脚本
│
├── src/
│   └── main.rs                # Rust 入口：显隐窗口/sidecar 管理
│
├── capabilities/              # Tauri v2 权限声明
│   ├── core.json              #   核心权限
│   ├── dialog.json            #   对话框权限
│   ├── fs.json                #   文件系统权限
│   └── shell.json             #   Shell（sidecar）权限
│
├── sidecar-modules/           # Sidecar 运行时依赖
│   ├── @prisma/               #   Prisma 客户端 for pkg
│   ├── prisma-engine/         #   Prisma 引擎二进制
│   └── ffmpeg.exe             #   ffmpeg 捆绑
│
├── icons/                     # 应用图标
│   ├── icon.png
│   ├── icon.svg
│   ├── icon.ico
│   └── icon.icns
│
├── resources/                 # Tauri 资源目录
├── server-x86_64-pc-windows-msvc.exe  # pkg 构建的后端 exe
├── gen/                       # Tauri 生成代码
└── target/                    # Rust 编译输出
```

---

## prisma/ — ORM / 数据库

```
prisma/
├── schema.prisma              # 表结构定义（Anime/Episode/MyList/Memory/PlaySession）
├── anime.db                   # SQLite 数据库（运行时复制到 DATA_DIR）
├── migrations/                # 数据库迁移历史
│   ├── migration_lock.toml
│   ├── 20260617110218_init/
│   ├── 20260621164732_add_season_chain/
│   ├── 20260625162226_mylist/
│   └── 20260704062223_add_mylist_fields/
├── prisma/                    # Prisma 客户端产物
└── server/                    # server/ 引用的 Prisma 客户端
```

---

## docs/ — 项目文档

```
docs/
├── data-flow.md               # 数据流枢纽（选子文件入口表）
├── code-explorer.md           # 代码探索方法论
├── testing.md                 # 测试总览
├── file-structure.md          # 本文件 ← 文件结构标注
│
├── data-flow/                 # 数据流子文档（9 个）
│   ├── startup-config.md      #   启动初始化 + Config
│   ├── scan-discovery.md      #   媒体扫描 + Discovery
│   ├── import-metadata.md     #   导入 + Metadata + AniList
│   ├── play-sessions.md       #   播放会话追踪
│   ├── covers-thumbnails.md   #   Cover + Thumbnail 服务
│   ├── mylist-sync.md         #   MyList + Bangumi 同步
│   ├── save-taxonomy.md       #   db.js save 函数分类
│   ├── http-call-chain.md     #   HTTP 完整调用链
│   └── gotchas.md             #   跨领域陷阱
│
└── dev/                       # 开发规范（6 个）
    ├── workflow.md            #   6 阶段开发工作流
    ├── backend.md             #   后端规范
    ├── frontend.md            #   前端规范
    ├── testing.md             #   测试规范
    ├── report.md              #   变更报告模板
    └── migration-vite-tailwind.md  # 迁移记录
```

---

## 关键路径速查

| 要找什么 | 路径 |
|---------|------|
| HTTP 入口 | `server/server.js` |
| 路由模块 | `server/routes/*.js` (9 个) |
| DB 操作 | `server/db.js` |
| 元数据抓取 | `server/scrapers/*.js` (5 个) |
| 前端 JS | `frontend/src/js/*.js` → sync → `public/js/*.js` |
| 前端 CSS | `frontend/src/css/` |
| HTML 入口 | `frontend/index.html` |
| 页面视图样式 | `frontend/src/css/views/*.css` (11 个) |
| 组件样式 | `frontend/src/css/components/*.css` (10 个) |
| 布局样式 | `frontend/src/css/layouts/*.css` (2 个) |
| 设计 Token | `frontend/src/css/tokens.css` |
| 第三方库 | `public/vendor/` (gsap/d3/wordcloud) |
| Rust 入口 | `src-tauri/src/main.rs` |
| Tauri 配置 | `src-tauri/tauri.conf.json` |
| Prisma schema | `prisma/schema.prisma` |
| 数据库迁移 | `prisma/migrations/` (4 个) |
| 后端测试 | `server/__tests__/` |
| 路由测试 | `server/__tests__/routes/*.test.js` (8 个) |
| 配置文件 | `server/config.json` |
| 封面缓存 | `server/covers/` |
| 缩略图缓存 | `server/thumbs/` |
| 构建脚本 | `scripts/` |
| 项目文档总入口 | `docs/` |
