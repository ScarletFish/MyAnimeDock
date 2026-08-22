# 后端开发规范 — Backend

## 核心原则

**单机单实例、前后端同仓同发**：没有外部客户端，没有多版本部署。

- API 响应字段改了就改——**不保留旧字段**，不加 deprecated 过渡期，不做向后兼容
- 前端和后端一起改，一起验证
- 旧代码/旧字段/旧路由 → 直接删。留着的死代码是未来的 bug 源
- 唯一的"兼容"场景：SQLite 数据库 schema 同步（`ensureSchema()` 幂等建表/补列，只加字段不改现有数据）

## 架构概要

```
server/
├── server.ts           → HTTP 服务入口，路由注册 + 中间件
├── db.ts               → better-sqlite3 原生 SQL 封装层
├── scanner.ts           → 媒体目录扫描 + 文件夹名解析
├── mpv-ipc.ts           → mpv IPC 纯传输层（connect/send/call/observeProperty/onEvent）
├── thumbnail-queue.ts   → ffmpeg 缩略图生成队列
├── logger.ts            → [TAG] 结构化日志
├── bangumi-sync.ts      → Pull→Merge→Push 同步引擎
├── types.ts             → 共享类型（AppData/ServerState/Anime/MyListItem/ScanNode 等）
├── players/             → 播放器策略抽象层（base-player / mpv-strategy / registry）
├── scrapers/            → 元数据抓取器（index/bangumi/bangumi-personal/anilist/node-fetch）
├── routes/              → 路由处理模块（9 个 .ts）
└── lib/
    ├── paths.js         → 路径单点计算（故意留 JS，不转 TS）
    ├── http-fetch.ts    → 共享 HTTP 请求层
    ├── utils.ts         → jsonResp/serveImage/readBody/getFfmpegPath 等工具
    ├── config.ts        → 配置/路径/scannedTree 管理
    └── enrich.ts        → enrichAnime 运行时字段注入
```

> 源码全部为 TypeScript（strict 模式），`npm run build:ts`（tsc）编译到 `server/dist/`；运行/测试/打包都吃 dist 产物。改完源码不 build，dist 是旧的"改了没生效"。

## TypeScript 纪律

| 规则 | 说明 |
|------|------|
| 后端源码必须 `.ts`，strict 模式 | tsconfig `strict: true`；`npm run typecheck`（tsc --noEmit）必须 0 错误才允许提交 |
| **禁止新增 `any`** | 存量 any 已清零；新代码用真实类型，边界数据用最小强转 + 注释说明 |
| 共享类型放 `server/types.ts` | AppData/ServerState/Anime/MyListItem/ScanNode/ActivePlay 等，禁止在各路由文件里各自定义 |
| 测试吃 dist | 测试文件仍是 CJS `.test.js`，`require('../dist/xxx.js')`，先跑 tsc |
| `lib/paths.js` 故意留 JS | 路径单点计算（findServerRoot 按 name=anime-manager-server），不转 TS |

改后端后的标准验证链：`npm run typecheck` → `cd server && npm test`（232 全绿）。

## 注释规范

**代码即文档。方法名/变量名/类型签名能表达的，不注释。**

### 禁止

| 类型 | 原因 |
|------|------|
| 否定声明（`不涉及 X`） | 噪音 |
| 历史引用（`对应旧 X`） | 旧代码已删 |
| JSDoc 复述类型签名（`@param {string} name - 名字`） | 类型已表达 |
| 注释复述代码（`// 是否已连接` / `isConnected()`） | 方法名已表达 |
| 装饰性分隔线（<200 行文件） | 视觉 clutter |

### 允许（只在这些情况写）

| 情况 | 示例 |
|------|------|
| 设计决策/WHY | `// 匹配优先级：bangumiId → folderPath 兜底` |
| 技术陷阱 | `// No g flag: test() without g is not stateful` |
| 业务规则 | `// 推送：状态 + 已看集数 + 评分，不含感想` |
| 非显而易见的副作用 | `// 用于文件存在性检查` |
| TODO/HACK | `//TODO: 显示受伤数字` |
| 函数 summary（行为描述） | `/** 按文件名解析 bangumiId，失败返回 null */` |

### JSDoc

- **summary** → 函数名不能完全表达行为时写
- **@param / @returns** → 类型签名已清晰时不写
- 简单 getter/setter/一行函数 → 不写

### 文件头

一行描述职责：`// db.ts — SQLite 数据层`，不重复文件名。

## 路由层约定

### 文件结构

每个路由文件导出一个函数，接收 `(req, res)`，注册方式：

```ts
// server.ts
import * as mylistRoutes from './routes/mylist';
app.get('/api/mylist', mylistRoutes.handleGetMyList);
```

### 路由处理模式

```ts
// routes/example.ts
import { jsonResp } from '../lib/utils';
async function handleAction(req: IncomingMessage, res: ServerResponse) {
  try {
    const { id } = new URL(req.url || '', 'http://localhost').searchParams; // GET 参数
    const body = await parseBody(req); // POST body
    const data = await doWork(id, body);
    jsonResp(res, 200, data);
  } catch (err) {
    logger.error('[example]', err);
    jsonResp(res, 500, { error: (err as Error).message });
  }
}
module.exports = { handleAction };
```

### 规则

| 规则 | 说明 |
|------|------|
| 每个 handler 必须 try/catch | 未捕获的 rejection → `process.on('unhandledRejection')` 兜底（仅 warn，不 exit），但不应依赖 |
| 用 `jsonResp` / `serveImage` / `serveRaw` | 统一响应格式（`lib/utils.ts`） |
| 路由不直接调 scrapers | scrapers 只通过 `bangumi-sync.ts` 或 `routes/library.ts` 调用 |
| 路由不直接写文件 | 写操作委托给 `db.ts` 的方法；`saveScannedTree` 在 `lib/config.ts` |
| 查询参数用 URL 编码 | 路径参数先 `encodeURIComponent` 再拼入 URL |
| 文件名：kebab-case | `db-manager.js` 而非 `dbManager.js` |

## DB 层约定（db.ts）

### 细粒度写入原则

**只写实际修改的表**，禁止无差别调全量 `saveData()`：

```js
// ✅ 正确
db.saveLibrary(library);          // 只写 Anime 表
db.updateEpisodesWatched(...);    // 只写 Episode.progress
db.updateMyItemStatus(id, 'completed'); // 只写 MyList.status
db.saveAll(...);                  // 内部批量同步 library/myList/playSessions

// ❌ 错误
db.saveData(library, null, myList, memories); // 全量写（已不存在），nodemon 误触发重启
```

### 生命周期

```
db.loadData() → 读 SQLite 初始化
  └─ anime, myList, episodes, config, scannedTree, playSessions

写入路径 (任一):
  db.saveLibrary(library)          → anime + episodes
  db.saveAll(...)                  → 批量同步 library/myList/playSessions
  db.savePlaySessions(sessions)    → playSessions（mpv 启动/关闭/出错）
  db.updateEpisodeProgress(...)    → 单集进度
  db.updateEpisodesWatched(...)    → 批量标记已看
  db.updateMyItemStatus(id, s)    → myList 状态
  db.updateMyListItem(id, item)   → myList 条目
  db.updatePlaySession(id, data)  → 会话更新
  db.updateAnime(id, data)        → Anime 字段更新
  db.deletePlaySession(id)        → 删除会话
  db.clearSessions()              → 清空会话
  db.saveScannedTree(tree)        → JSON 文件同步写入（lib/config.ts）
```

### better-sqlite3 注意事项

- `server/db.ts` 用 better-sqlite3 原生 SQL，单例 `Database`（PRAGMA `foreign_keys=ON` / WAL / busy_timeout）
- schema 变更：改 `db.ts` 的 INIT_SQL，`npm run db:migrate` 触发 `ensureSchema()`（幂等建表 + ALTER 补列，无版本化迁移历史）
- **布尔陷阱**：SQLite 布尔存 0/1，读回后需 `!!` 强转（downloaded/watched），否则透传给前端会挂 `if (a.downloaded)` 和 `watched === true` 断言
- **undefined 字段陷阱**：动态 SET 前必须过滤 `undefined` 键，否则 `SET x = undefined` 直接报错（ORM 会忽略 undefined，原生 SQL 层不会）
- DB 路径：dev=`<项目根>/data/anime.db`，pkg=`%APPDATA%/MyAnimeDock/anime.db`（见 `db.ts` DB_PATH）

## Scanner 约定

- `parseFolderName(name)` — 纯函数，从文件夹名提取 `{ title, cjkTitle, cleanTitle, season, year, animeTitle, episode, seasonRaw, resolution, source, videoCodec, audioCodec, releaseGroup, specialSuffix, bangumiId, _raw }`
- `extractBgmId(name)` — 提取 `[bgmN]` 格式的数字 ID，用作 `bangumiId`（内容身份，唯一索引）
- `findVideos(dir)` — 递归查找视频文件（`VIDEO_EXTS = mkv/mp4/avi/mov/webm`）
- `scanMediaDirFlat(dir)` — 扫描返回扁平 leaf 数组（含 `parentChain`）
- 手动导入项主键同样为 UUID（`crypto.randomUUID()`）

### isExtraVideo 判断

视频文件是否"额外内容"（NCED/OVA/PV 等），基于文件名模式匹配。

## mpv-ipc 约定

- `mpv-ipc.ts` 是**纯 IPC 传输层**：`MpvIpcConnection` 类（connect/send/call/observeProperty/onEvent，含重试与超时），不承载播放逻辑
- `activePlays` Map（内存）在 `server.ts` 与 `routes/playback.ts` 维护
- 播放器策略在 `players/`（base-player 抽象 + mpv-strategy 实现 + registry 注册）
- `--start` 改为 IPC seek（connect 后 seek，不污染队列）
- 进度由 mpv IPC 实时推送 `time-pos` 更新，不做定时轮询
- mpv 关闭时发 `final: true` 标记，触发一次性落盘 + Map 清理（`routes/playback.ts` 的 onProgress 回调）
- 播放路径编码：`escAttr` → HTML `dataset` → JSON.parse 全链路

## Thumbnail 约定

- `thumbnail-queue.ts`：队列 + 去重（single-flight）+ 限并发（默认 4）
- 依赖 ffmpeg：dev 模式用仓库内置 `scripts/ffmpeg-upx.exe`（Windows），打包模式用 `sidecar-modules/ffmpeg.exe`，均无需系统安装 ffmpeg；仅当两者缺失时才回落系统 PATH
- 生成缓存到 `thumbs/` 目录
- ffmpeg 命令：`ffmpeg -ss {time} -i {video} -vframes 1 -vf scale=480:-2 {output}`（`THUMB_WIDTH=480`）
- 首次请求可能延迟（同步等待生成）
- 启动时 `enqueueMissingForLibrary()` 对账补全缺失缩略图

## http-fetch 共享层

```ts
import * as httpFetch from '../lib/http-fetch';
const data = await httpFetch.fetch(url, { headers, retries: 2 });
```

封装在 `server/lib/http-fetch.ts`，统一超时/重试/错误处理。约 80% 的重复 HTTP 调用代码已抽取至此。

## Bangumi 同步

- `bangumi-sync.ts`：Pull → Merge → Push 三阶段
- Pull：从 Bangumi API 拉取用户收藏
- Merge：与本地 library 做差异合并
- Push：变更写回 SQLite
- 走 `/api/library/sync/stream` SSE 流式同步，前端 `metamatch.js` 展示实时进度

## 配置

`data/config.json`（dev 模式；基于 `server/config.example.json` 复制）：

```json
{
  "mediaDir": "",
  "playerMode": "mpv",
  "mpvPath": "mpv",
  "theme": "default",
  "themeMode": "dark",
  "autoMarkWatched": true,
  "uiScale": 1,
  "reduceMotion": false,
  "apiSources": ["bangumi", "anilist"]
}
```

> 运行时由 `lib/config.ts` 注入字段（不上 JSON）：`bangumiAccessToken`、`bangumiClientId/Secret`、`bangumiLastSync`、`bangumiUsername`。

## 错误处理链

```
route handler try/catch
  → jsonResp(res, code, {error}) 或 logger.error('[TAG]', err)
  └─ 未捕获 → process.on('unhandledRejection') → logger.warn（不 exit）
     uncaughtException → logger.error（不 exit）
```

恢复：重启 sidecar（Rust 监控线程自动检测退出后关闭 Tauri 窗口）。
