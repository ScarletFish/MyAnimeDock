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
├── src-tauri/                 # === Tauri v2 桌面壳 (Rust) ===
├── prisma/                    # === DB 文件存放（better-sqlite3 读写）===
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
├── db.js                      # better-sqlite3 原生 SQL 封装（ensureSchema + MigrationLog 版本化迁移器）
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
├── index.html                 # HTML 入口（22 个 <script> 严格顺序）
├── vite.config.js             # Vite 配置（复制模式）
├── package.json
│
├── src/
│   ├── js/                    # 前端 JS 源码（22 个文件）
│   │   ├── i18n-zh.js         #   i18n 文案字典（唯一，改文案只改这里）
│   │   ├── i18n.js            #   i18next 初始化 + 全局 t() + data-i18n 绑定
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
│   └── public/                    # Vite 静态资源目录（第三方库，构建时复制到 dist/）
│       └── vendor/            # gsap/d3/wordcloud/i18next
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
│   ├── better-sqlite3/        #   原生 SQLite 模块（含 .node 二进制）
│   ├── bindings/              #   原生模块绑定依赖
│   ├── file-uri-to-path/      #   文件 URI 工具
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

## prisma/ — DB 文件存放

```
prisma/
└── anime.db                   # SQLite 数据库（better-sqlite3 读写，DATA_DIR 指向此文件）
```

> schema 与迁移不由此目录管理：表结构真源在 `server/db.js`（INIT_SQL + `ensureSchema()` 版本化迁移器，写 MigrationLog 表）。`npm run db:migrate` 触发迁移。

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
```

---

## 关键路径速查

| 要找什么 | 路径 |
|---------|------|
| HTTP 入口 | `server/server.js` |
| 路由模块 | `server/routes/*.js` (9 个) |
| DB 操作 | `server/db.js` |
| 元数据抓取 | `server/scrapers/*.js` (5 个) |
| 前端 JS | `frontend/src/js/*.js` → Vite build → `frontend/dist/assets/app.js` |
| 前端 CSS | `frontend/src/css/` |
| HTML 入口 | `frontend/index.html` |
| 页面视图样式 | `frontend/src/css/views/*.css` (11 个) |
| 组件样式 | `frontend/src/css/components/*.css` (10 个) |
| 布局样式 | `frontend/src/css/layouts/*.css` (2 个) |
| 设计 Token | `frontend/src/css/tokens.css` |
| 第三方库 | `frontend/public/vendor/` (gsap/d3/wordcloud/i18next) |
| 前端文案字典 | `frontend/src/js/i18n-zh.js`（i18n，改文案只改这里） |
| 前端检查脚本 | `scripts/check-frontend.js`（`npm run check:frontend` 一键检查+构建） |
| Rust 入口 | `src-tauri/src/main.rs` |
| Tauri 配置 | `src-tauri/tauri.conf.json` |
| DB schema 与迁移 | `server/db.js`（`ensureSchema` + MigrationLog，`npm run db:migrate`） |
| 后端测试 | `server/__tests__/` |
| 路由测试 | `server/__tests__/routes/*.test.js` (8 个) |
| 配置文件 | `server/config.json` |
| 封面缓存 | `server/covers/` |
| 缩略图缓存 | `server/thumbs/` |
| 构建脚本 | `scripts/` |
| 项目文档总入口 | `docs/` |
