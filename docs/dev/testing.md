# 测试规范 — Testing

## 运行命令

```bash
cd server && npm test                     # 全量（368 tests, ~13s）
cd server && npm run test:routes          # Route 测试（135 tests, ~2s）
cd server && node --test                  # 同 npm test
cd server && node --test __tests__/xx.test.js  # 单文件
cd server && node --test __tests__/routes/*.test.js  # 全 route
cd server && node --test --watch          # 监听模式
```

## 测试文件

| 文件 | 测试数 | 覆盖模块 | 运行时机 |
|------|--------|----------|----------|
| `__tests__/db.test.js` | 35 | `loadData`, `saveLibrary`, `saveMyList`, `updateEpisodesWatched`, `saveAll`, `updateMyItemStatus`, `updateMyListItem`, `updatePlaySession`, `deletePlaySession`, `ensureSchema`, bangumiId/anilistId 唯一性, 全生命周期 | 数据持久化改动时 |
| `__tests__/scanner.test.js` | 64 | `parseFolderName`(21), `isExtraVideo`(16), `extractBgmId`(7), `findVideos`(5), `hasDirectVideos`(5), `buildLeaf` via `scanMediaDirFlat`(5), `scanMediaDirFlat`(5), `scanMediaDir`(1) | scanner 改动时 |
| `__tests__/scrapers.test.js` | 65 | `normalizeTitle`, `sorensenDice`, `toHiragana`, `pickBestBySimilarity`, `extractRomajiTitle`, `parseFolderName` 真实数据集(15), `resolveAnilistId`(mock + real API), `ensureMetadata`/`ensureMetadataBatch`(mock) | 匹配逻辑改动时 |
| `__tests__/playback-encoding.test.js` | 44 | 播放路径编码、`escAttr` → HTML → `dataset` → JSON 全链路 | 播放路径改动时 |

详细测试模式惯例、已知行为记录、命名约定见 `docs/testing.md`（原测试指南）。

## 运行策略

| 范围 | 命令 | 耗时 | 场景 |
|------|------|------|------|
| 匹配逻辑 | `node --test __tests__/scrapers.test.js` | ~135ms | 改 scrapers/index.ts、anilist.ts |
| scanner | `node --test __tests__/scanner.test.js` | 秒级 | 改 scanner.ts |
| 数据持久化 | `node --test __tests__/db.test.js` | 秒级 | 改 db.ts |
| 播放路径 | `node --test __tests__/playback-encoding.test.js` | 秒级 | 改播放相关 |
| 全量 | `cd server && npm test` | ~30s | 大改后/不确定影响范围时 |

## 修 Bug 流程

> 完整调试流程见 `docs/dev/workflow.md` 路径 A。以下是测试编写相关部分。

1. **先写复现测试** — 确认测试以红态失败（仅后端 bug，前端除外）
2. **改代码** — 修到测试通过
3. **确认无回归** — 跑相关测试文件全绿
4. **提交**

```js
// 示例：写复现测试
describe('bug: xxx', () => {
  it('should correctly handle edge case', () => {
    const result = parseFolderName('Bakemonogatari [bgm123]');
    assert.strictEqual(result.title, 'Bakemonogatari');
    assert.strictEqual(result.bangumiId, '123');
  });
});
```

## 新增测试规则

### 数据持久化功能

测试必须覆盖"修改 → `loadData()` 重载 → 验证"路径，只测内存状态不够：

```js
// db.ts 测试模式
const db = require('../db'); // in-memory SQLite
// 修改
db.saveLibrary(newLibrary);
// 重载验证
const loaded = db.loadData();
assert.strictEqual(loaded.library.length, expected);
```

### Scanner 类型功能

按 `scanner.test.js` 模式：纯函数单元测试 + 文件系统集成测试 + 已知行为记录。

纯函数可以直接测试：

```js
assert.deepStrictEqual(parseFolderName('[bgm5] Title (2024)'), {
  title: 'Title', year: 2024, season: null,
  bangumiId: '5', anilistId: null, label: null
});
```

### Route Handler 测试

`__tests__/routes/` 目录按 route 文件一对一测试 handler 的 status code 和 body shape。

| 文件 | 测试数 | 覆盖 Handler | mock 策略 |
|------|--------|-------------|-----------|
| `mylist.test.js` | 15 | 6/7 | 仅 state mock |
| `config.test.js` | 14 | 4/4 | 仅 state mock |
| `stats.test.js` | 23 | 7/7 | 仅 state mock |
| `db-manager.test.js` | 15 | 6/8 | state.db mock + fs monkey-patch; 跳过二进制流/文件读取 |
| `discovery.test.js` | 23 | 5/6 | state mock + require.cache mock for scanner; 跳过 SSE |
| `library.test.js` | 9 | 3/5 | state mock; 跳过 SSE/AniList |
| `bangumi.test.js` | 18 | 8/9 | require.cache mock for scrapers + scanner |
| `playback.test.js` | 18 | 4/4 | require.cache mock for mpv-ipc + ffmpeg error path |
| **合计** | **135** | **43/50** | **86% handler 覆盖** |

### Mock-http 模式

`__tests__/helpers/mock-http.js` 提供三个工厂：

```js
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');

const req  = mockReq({ url: '/api/xxx', method: 'POST', body: '{"key":"val"}' });
const res  = mockRes();
const state = mockState({ data: { library: [...] }, db: { saveLibrary: async () => {} } });

handler(req, res, state);  // sync
await handler(req, res, state);  // async

assert.strictEqual(res._status, 200);
assert.strictEqual(res._body.ok, true);
```

- `res._status` — HTTP 状态码
- `res._body` — JSON 解析后的 body
- `res._headers` — response headers
- `mockState(overrides)` — 深度合并默认 state（包含 data/config/db/logger/activePlays/bangumiSync）

### 当前限制

- `handleDbBackup` / `handleDbBackupAll` 使用 `fs.createReadStream.pipe(res)` 二进制流或读真实文件，跳过程序测试
- Route 测试写入真实磁盘（`saveConfig`、`saveScannedTree`），需注意测试顺序不干扰 DB 测试
- 涉及 `child_process.spawn` 等 destructured 内置模块的 handler 无法直接 mock（需用 ffmpeg error path 或 real spawn 测试）
- `handleBangumiAuthCallback` 涉及 OAuth redirect + HTML 渲染，跳过单元测试
- `handleScan` / `handleLibrarySyncStream` SSE-heavy，手动测试更高效

## Mock 原则

- scrapers API 调用用 sinon stub，不真正请求外部 API
- 但在 `resolveAnilistId` 中使用真实 API 调用也允许（标记 `@slow`）
- 文件系统操作（scanner）用真实临时目录
- 对于 route 测试：`state.db` 方法用 mock async 函数，不连真实 SQLite

## 数据层测试环境

测试使用独立的 in-memory SQLite 数据库，不污染 `anime.db`。`db.test.js` 中：

```js
beforeEach(() => {
  // 创建新的 better-sqlite3 内存数据库
  db.init({ databaseUrl: 'file:./test.db' });
});

afterEach(() => {
  db.close();
  fs.unlinkSync('./test.db');
});
```

> **DATA_DIR 隔离**：`__tests__/setup.js` 把 `DATA_DIR` 指向临时目录（`lib/config.ts` 支持 `DATA_DIR` 环境变量覆盖），避免跑测试覆盖真实 `data/config.json` / `anime.db`。

## 已知限制

- 前端测试用 **vitest**（`frontend/vitest.config.js`，node 环境，include `src/**/*.test.js`）
- 运行：`cd frontend && npm test`（vitest run）
- 现有测试：`frontend/src/lib/sync-stream.test.js`（SSE 同步流模块，mock EventSource 覆盖 done/cancel/timeout/finish 幂等/handler）
- 前端纯 UI 组件（Svelte）目前无测试；纯 JS 逻辑模块（lib/ 下无 DOM 依赖的）可加 vitest 测试
- 纯 UI 文案/样式改动不需要跑测试
- 如果改动完全不涉及数据层，选跑关联测试即可
- 测试环境 Windows（CI 未配置）
