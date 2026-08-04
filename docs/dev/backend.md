# 后端开发规范 — Backend

## 核心原则

**单机单实例、前后端同仓同发**：没有外部客户端，没有多版本部署。

- API 响应字段改了就改——**不保留旧字段**，不加 deprecated 过渡期，不做向后兼容
- 前端和后端一起改，一起验证
- 旧代码/旧字段/旧路由 → 直接删。留着的死代码是未来的 bug 源
- 唯一的"兼容"场景：SQLite 数据库 schema 迁移（通过 db.js 版本化迁移器，只加字段不改现有数据）

## 架构概要

```
server/
├── server.ts           → HTTP 服务入口，路由注册 + 中间件
├── db.ts               → better-sqlite3 原生 SQL 封装层
├── scanner.ts           → 媒体目录扫描 + 文件夹名解析
├── mpv-ipc.ts           → mpv IPC 播放进度追踪
├── thumbnail-queue.ts   → ffmpeg 缩略图生成队列
├── logger.ts            → [TAG] 结构化日志
├── bangumi-sync.ts      → Push→Merge→Pull 同步引擎
├── types.ts             → 共享类型（AppData/ServerState/Anime/MyListItem/ScanNode 等）
├── scrapers/            → 元数据抓取器
├── routes/              → 路由处理模块（9 个 .ts）
└── lib/
    ├── paths.js         → 路径单点计算（故意留 JS，不转 TS）
    └── http-fetch.ts    → 共享 HTTP 请求层
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
async function handleAction(req: IncomingMessage, res: ServerResponse) {
  try {
    const { id } = new URL(req.url || '', 'http://localhost').searchParams; // GET 参数
    const body = await parseBody(req); // POST body
    const data = await doWork(id, body);
    respondJson(res, 200, data);
  } catch (err) {
    respondError(res, 500, (err as Error).message);
  }
}
module.exports = { handleAction };
```

### 规则

| 规则 | 说明 |
|------|------|
| 每个 handler 必须 try/catch | 未捕获的 rejection → process.on('unhandledRejection') 兜底，但不应依赖 |
| 用 `respondJson` / `respondError` / `respondFile` | 统一响应格式 |
| 路由不直接调 scrapers | scrapers 只通过 `bangumi-sync.ts` 或 `routes/library.ts` 调用 |
| 路由不直接写文件 | 写操作委托给 `db.ts` 的方法 |
| 查询参数用 URL 编码 | 路径参数先 `encodeURIComponent` 再拼入 URL |
| 文件名：kebab-case | `db-manager.js` 而非 `dbManager.js` |

## DB 层约定（db.ts）

### 细粒度写入原则

**只写实际修改的表**，禁止无差别调全量 `saveData()`：

```js
// ✅ 正确
db.saveLibrary(library);          // 只写 Anime 表
db.updateEpisodesWatched(...);    // 只写 Episode.progress
db.saveMemories(memories);        // 只写 Memory 表
db.updateMyItemStatus(id, 'completed'); // 只写 MyList.status

// ❌ 错误
db.saveData(library, null, myList, memories); // 全量写，nodemon 误触发重启
```

### 生命周期

```
db.loadData() → 读 SQLite 初始化
  └─ anime, myList, episodes, memories, config, scannedTree

写入路径 (任一):
  db.saveLibrary(library)          → anime + episodes
  db.saveMemories(memories)        → memories
  db.savePlaySessions(sessions)    → playSessions（mpv 启动/关闭/出错）
  db.updateEpisodeProgress(...)    → 单集进度
  db.updateEpisodesWatched(...)    → 批量标记已看
  db.updateMyItemStatus(id, s)    → myList 状态
  db.updateMyListItem(id, item)   → myList 条目
  db.deletePlaySession(id)        → 删除会话
  db.saveScannedTree(tree)        → JSON 文件同步写入
```

### better-sqlite3 注意事项

- `server/db.ts` 用 better-sqlite3 原生 SQL，单例 `Database`（PRAGMA `foreign_keys=ON` / WAL / busy_timeout）
- schema 变更：改 `db.ts` 的 INIT_SQL + 迁移，`npm run db:migrate` 触发 `ensureSchema()` 版本化迁移（写 MigrationLog 表，v2_merge_wishlist 已在案）
- **布尔陷阱**：SQLite 布尔存 0/1，读回后需 `!!` 强转（downloaded/watched），否则透传给前端会挂 `if (a.downloaded)` 和 `watched === true` 断言
- **undefined 字段陷阱**：动态 SET 前必须过滤 `undefined` 键，否则 `SET x = undefined` 直接报错（ORM 会忽略 undefined，原生 SQL 层不会）
- 连接串固定 `file:./anime.db`

## Scanner 约定

- `parseFolderName(name)` — 纯函数，从文件夹名提取 `{ title, year, season, bangumiId, anilistId, label }`
- `extractBgmId(name)` — 提取 `[bgmN]` 格式的数字 ID，`String(bangumiId)` 为主键
- `findVideos(dir)` — 递归查找视频文件（mp4/mkv/avi/mov/wmv）
- `scanMediaDirFlat(dir)` — 扫描返回扁平 leaf 数组（含 `parentChain`）
- 手动导入项使用 `parsedTitle + Season` 作 ID

### isExtraVideo 判断

视频文件是否"额外内容"（NCED/OVA/PV 等），基于文件名模式匹配。

## mpv-ipc 约定

- `activePlays` Map（内存）追踪当前播放会话
- `--start` 改为 IPC seek（connect 后 seek，不污染队列）
- 进度由 mpv IPC 实时推送 `time-pos` 更新，不做定时轮询
- mpv 关闭时发 `final: true` 标记，触发一次性落盘 + Map 清理
- 播放路径编码：`escAttr` → HTML `dataset` → JSON.parse 全链路

## Thumbnail 约定

- `thumbnail-queue.ts`：队列 + 去重 + 限并发（默认 2）
- 依赖 ffmpeg：dev 模式用仓库内置 `scripts/ffmpeg-upx.exe`（Windows），打包模式用 `sidecar-modules/ffmpeg.exe`，均无需系统安装 ffmpeg；仅当两者缺失时才回落系统 PATH
- 生成缓存到 `thumbs/` 目录
- ffmpeg 命令：`ffmpeg -ss {time} -i {video} -vframes 1 -vf scale=320:-1 {output}`
- 首次请求可能延迟（同步等待生成）

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

`server/config.json`（基于 `config.example.json` 复制）：

```json
{
  "mediaDir": "",
  "playerMode": "mpv",
  "mpvPath": "mpv",
  "theme": "default",
  "themeMode": "dark",
  "autoMarkWatched": true,
  "uiScale": 1.25
}
```

## 错误处理链

```
route handler try/catch
  → respondError(res, code, message)
  → logger.error('[TAG]', err)
  └─ 未捕获 → process.on('unhandledRejection') → process.exit(1)
```

恢复：重启 sidecar（Rust 监控线程自动检测退出后关闭 Tauri 窗口）。
