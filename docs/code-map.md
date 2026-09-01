# 代码地图 — 关键抽象速查

> 改代码前必扫。避免重复造轮子，避免漏用已有抽象。

## 前端共享模块 `frontend/src/lib/`

| 文件 | 关键导出 | 用途 | 使用者 |
|------|---------|------|--------|
| `local-store.js` | `localStore(key, fallback)` | localStorage ↔ writable 双向同步 store | ui-state.js |
| `ui-state.js` | `libraryData`, `mylistData`, `pendingAutoPlay`, `pendingFinishAnimeId` | 跨组件共享状态（writable） | Library/Detail/SearchBar |
| | `librarySortMode`, `mylistSortMode` | 排序模式 store（localStore 封装，Detail 左右导航依赖） | LocalAnimeSection/Mylist/Detail |
| | `cardTitleLibrary`, `cardTitleMylist`, `finishConfirmMode`, `detailTitleBg`, `ignoreLocalFileMissing` | 设置项 store（localStore 封装） | Settings/LocalAnimeSection/Mylist/Detail |
| | `startupLibraryPromise`, `setStartupLibraryPromise`, `consumeStartupLibraryPromise` | 启动预取 promise（省 RTT） | main.js → Library |
| `api.js` | `API` (get/post/put/del) | HTTP 请求封装 | 全局 |
| `router.js` | `showView`, `showDetail`, `goBack`, `currentView`, `getLibraryScrollTop`, `getMyListScrollTop` | 视图切换 + 滚动状态 | 全局 |
| `anime-utils.js` | `tr(key, opts)`, `basename(p)`, `coverSrc(item, size)`, `navigateToDetail(id, el, source)`, `STATUS_SECTIONS_LIBRARY`, `STATUS_SECTIONS_MYLIST` | i18n 翻译 / 路径 / 封面 / 状态分区 | 全局 |
| `grid.js` | `GRID_CARD_MIN`, `GRID_CARD_MAX`, `readScale()`, `calcGridCols(scale)` | 网格列公式 | Library/Mylist/LocalAnimeSection |
| `sort.js` | `getStatusLabels()`, `getAnimeSortOptions()`, `sortAnimeItems(items, mode)`, `MYLIST_STATUS_ORDER` | 排序/状态标签 | LocalAnimeSection/Mylist |
| `dashboard-layout.js` | `getDashboardLayout()`, `saveDashboardLayout(l)`, `defaultDashboardLayout()` | 动漫库布局配置 | Settings/Library |
| `theme.js` | `loadTheme`, `applyTheme`, `applyZoom`, `loadReduceMotion`, `applyDetailTitleBg` | 主题/缩放/reduce-motion | main.js |
| `state.js` | `AppState`（CustomEvent 全局总线） | 跨组件事件通信（遗留，新代码用 store） | 旧代码 |
| `portal.js` | `portal(node, target)` | Svelte action：DOM 节点移到 portal 容器 | Modal/ConfirmDialog |
| `sync-stream.js` | `createSyncStream(ids)` | MetaMatch SSE 流封装 | MetaMatch |
| `mpv-status.js` | `startGlobalMpvStatus()` | 全局 mpv-status SSE 监听 | main.js |
| `scroll-dots.js` | `initScrollDots(opts)` | 横向滚动分页圆点 | Library |
| `tag-utils.js` | `filterTags`, `tagZh`, `tagSearchFields` | 标签工具 | Detail |
| `tag-data.js` | `ANILIST_TAG_DATA` | AniList 标签中文映射 | Detail |
| `i18n.js` | `initI18n()`, `bindDom()` | i18next 初始化 | main.js |
| `i18n-zh.js` | `I18N_ZH` | 中文文案字典（改文案只改这里） | i18n.js |
| `debug.js` | `__debug` | F12 调试系统 | 全局 |
| `keyboard.js` | `toggleHelp`, `showHelp`, `hideHelp` | 键盘快捷键帮助 | KbdHelp |

## 前端可复用组件 `frontend/src/components/`

| 组件 | 模块导出 | 用途 |
|------|---------|------|
| `Toast.svelte` | `showToast(msg, type)`, `dismissToast(id)`, `toasts` | 全局 Toast 通知 |
| `ConfirmDialog.svelte` | `showConfirm(message)` | 全局确认弹窗 |
| `Modal.svelte` | — | 通用模态框容器 |
| `StatusModal.svelte` | — | 状态编辑弹窗（标记观看/评分/标签） |
| `ContextMenu.svelte` | — | 右键菜单 |
| `StatusSection.svelte` | — | 状态分区网格容器（Library/Mylist 共用） |
| `AnimeCard.svelte` | — | 动漫卡片（props: `item`, `alwaysShowTitle`, `onClick`, `onContextMenu`, `onMore`） |
| `Sidebar.svelte` | — | 侧边栏导航 |
| `ThemeDock.svelte` | `openVisualDock()` | 主题/缩放控制面板 |
| `Onboarding.svelte` | `onboardingOpen` | 首次使用引导 |
| `KbdHelp.svelte` | `kbdHelpOpen` | 键盘快捷键帮助 |
| `detail/EpisodeHeatmap.svelte` | `scrollToIndex`, `scrollToNextUnwatched`, `scrollToLastPosition` | 剧集热力图 |
| `detail/Characters.svelte` | — | 角色列表 |
| `detail/RelationList.svelte` | `relationListOpen` | 关联条目 |
| `detail/FinishConfirmModal.svelte` | — | 完结确认弹窗 |
| `detail/SyncModal.svelte` | — | Bangumi 同步弹窗 |
| `detail/WatchStats.svelte` | — | 观看统计 |
| `detail/LazySection.svelte` | — | 懒加载区域 |
| `chrome/Titlebar.svelte` | `titlebarContext` | 标题栏上下文 store |
| `chrome/SearchBar.svelte` | `focusSearch()`, `searchTag(tagName)` | 搜索栏 |
| `metamatch/*` | MetaMatchPanel/MetaMatchList/MetaMatchDetail/MetaMatchToolbar/MetaMatchSyncLog | 元数据匹配面板 |

## 前端视图 `frontend/src/views/`

| 视图 | 模块导出 | 用途 |
|------|---------|------|
| `Library.svelte` | `libraryOpen`, `setLoadLibrary`, `loadLibrary` | 动漫库主页 |
| `Mylist.svelte` | `mylistOpen`, `setLoadMyList`, `loadMyList` | 我的列表 |
| `Settings.svelte` | `settingsOpen`, `settingsTab`, `setRefreshBangumiAuthStatus`, `refreshBangumiAuthStatus` | 设置面板 |
| `Detail.svelte` | `setHandleDetailPlaybackEnded` | 详情页 |
| `Discovery.svelte` | `refreshDiscovery` | 发现页 |
| `MetaMatch.svelte` | `metaMatchOpen` | 元数据匹配 |
| `Stats.svelte` | — | 统计图表 |
| `LocalAnimeSection.svelte` | — | 本地动漫模块（Library 子组件） |

## 后端关键模块 `server/`

| 文件 | 关键导出 | 用途 |
|------|---------|------|
| `types.ts` | `Anime`, `AnimeEpisode`, `MyListItem`, `PlaySession`, `AppData`, `ServerState`, `ScanNode`, `LeafNode`, `BranchNode` | 全部共享类型 |
| `db.ts` | `ensureSchema()`, `save()`, `load()`, `updateEpisodesWatched()`, `updateMyListItem()` | SQLite 数据库操作 |
| `server.ts` | HTTP 入口 | 路由注册 + 中间件 |
| `scanner.ts` | `parseFolderName()`, `scanTopDir()`, `scanMediaDirFlat()`, `extractBgmId()`, `isExtraVideo()` | 媒体目录扫描 |
| `scrapers/index.ts` | `registry`, `normalizeTitle()`, `pickBestBySimilarity()`, `buildSearchTerms()`, `ensureMetadata()` | 元数据抓取入口 |
| `lib/enrich.ts` | `enrichAnime()` | 动漫元数据补全 |
| `lib/pinyin.ts` | `computePinyinTitle()` | 拼音标题计算 |
| `lib/config.ts` | `ConfigShape`, 配置加载 | 配置管理 |
| `lib/http-fetch.ts` | `DEFAULT_TIMEOUT`, `USER_AGENT` | HTTP 请求工具 |
| `logger.ts` | `Logger`, `logger` | 结构化日志 |
| `bangumi-sync.ts` | Bangumi 同步引擎 | Pull→Merge→Push |
| `mpv-ipc.ts` | mpv IPC 播放进度追踪 | 播放器通信 |
| `thumbnail-queue.ts` | ffmpeg 缩略图生成队列 | 缩略图生成 |
| `lib/qb-client.ts` | `qbTestConnection()`, `qbGetTorrents()`, `qbGetFiles()`, `qbAddTorrent()`, `qbPauseTorrent()`, `qbResumeTorrent()`, `qbDeleteTorrent()` | qBittorrent WebAPI 客户端 |

## 路由 `server/routes/`

| 路由 | 前缀 | 用途 |
|------|------|------|
| `library.ts` | `/api/library`, `/api/anime/:id` | 库/元数据管理 |
| `mylist.ts` | `/api/mylist` | 我的列表/状态 |
| `config.ts` | `/api/config` | 配置读写 |
| `discovery.ts` | `/api/discovery` | 媒体目录浏览 |
| `playback.ts` | `/api/playback`, `/api/mpv/*` | 播放控制 |
| `stats.ts` | `/api/stats` | 统计图表 |
| `relations.ts` | `/api/relations` | 关联条目 |
| `db-manager.ts` | `/api/db/*` | 数据备份/恢复/导出 |
| `bangumi.ts` | `/api/bangumi/*` | Bangumi 同步/授权 |
| `qb.ts` | `/api/qb/*` | qBittorrent API 代理 |

## 设计模式速查

| 模式 | 位置 | 何时用 |
|------|------|--------|
| **localStore** | `lib/local-store.js` | 需要 localStorage + 跨组件响应式读写 |
| **CustomEvent** | Settings → Library (`dashboard-layout-changed`) | 组件间一对多通知（非 store 场景） |
| **模块级 writable** | 各视图 `export const xxxOpen = writable(false)` | 跨组件打开/关闭状态 |
| **set/load 双入口** | `setLoadLibrary` / `loadLibrary` | 外部触发刷新（挂载时注册） |
| **window 桥接** | `window.showView` / `window.showDetail` 等 | Svelte 组件 ↔ 非 Svelte 代码通信 |
| **portal** | `lib/portal.js` | 弹窗 DOM 移到 `#modal-root` |
