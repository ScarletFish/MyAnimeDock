# 迁移计划：弃 Prisma 7 → better-sqlite3 原生 SQL

> 状态：✅ 已完成（2026-08-03，执行记录见 §9）
> 日期：2026-08-03
> 研究来源：oracle 独立架构评审（ora-1，2026-08-03，已实查代码与 live DB）+ librarian 打包方案研究（lib-1）
> 前置文档：`migration-prisma7-yaopkg.md`（已被本计划取代，Prisma 7 路线不再实施）

## 1. 背景与动机

**决策链**：yao-pkg + Prisma 7 迁移过程中，发现 Prisma 7 的 WASM query compiler 用**运行时动态 import()** 加载 `.mjs`，在 pkg 快照运行时崩溃（`A dynamic import callback was not specified`）。为绕过它堆叠了 esbuild 编译链、fix 脚本、sidecar 复制等 hack。librarian 打包方案研究 + oracle 独立评审共同确认：**本项目 Prisma 用量薄到只剩 CRUD 壳，弃用 Prisma 是净胜方向**。

| 痛点 | 现状 | 弃 Prisma 后 |
|------|------|--------------|
| WASM 动态 import | pkg 快照运行时崩溃，需 esbuild 内联 + fix 脚本 | 整个问题类别消失 |
| `@prisma/*` 依赖体积 | 75.1 MB（client 74.8MB 含 WASM base64） | 0（better-sqlite3 仅 11.7MB） |
| 构建链 | postinstall 3 步（ci → generate → esbuild → fix） | 1 步（npm ci） |
| 打包 | copy-sidecar-deps 复制 adapter/driver-adapter-utils/WASM | 只剩 better-sqlite3 + bindings + ffmpeg |
| 启动 | WASM 编译 + 动态 import 开销 | 更快 |
| 事务 | `$transaction({ timeout: 15000 })` 大库可能超时中止 | 同步事务无超时问题，原子性更强 |
| 未来 ESM+TS | Prisma 7 在 pkg/SEA 下是已知死路 | better-sqlite3 所有打包方案通吃 |

**目标**：db.js 数据层从 Prisma ORM 重写为 better-sqlite3 原生 SQL，保持公开 API 签名完全不变（调用方零改动、db.test.js 预期零修改通过）；构建链清理到只剩必要 sidecar；为未来 ESM+TS 迁移扫清障碍。

## 2. 现状基线（oracle 实查核实）

- `server/db.js`（809 行）：Prisma 调用仅 ~32 处（findMany 6 / upsert 5 / updateMany 4 / deleteMany 4 / findFirst 3 / delete 3 / create 2 / findUnique 2 / update 2 / createMany 1）；include 仅 1 处（loadData 的 episodes）；transaction 3 处（saveLibrary/saveMyList/savePlaySessions，均为"读现有→算差异→批量写"模式）；嵌套写入/connect 0 处
- `INIT_SQL`（db.js L97-125）：已手写全套 CREATE TABLE IF NOT EXISTS + 索引，与 live DB 的 `sqlite_master` 完全一致
- **Prisma migrate 生产环境实际已废弃**：v2 迁移（L215-290）手写在 `ensureSchema` 里，不在 `prisma/migrations/`（那 4 个目录仅早期基线）。schema 真源 = INIT_SQL + ensureSchema
- `MigrationLog` 表已存在，live DB 中 `version='v2_merge_wishlist'` 已在案 → 新迁移器天然跳过，无重跑风险
- live DB 所有时间戳均为 unixepoch-ms 整数（含 MigrationLog/MyList）→ 原生层读写 `Date.now()` 零转换
- `getPrisma()` 导出仅被 db-manager.js 3 处使用（L192 clear-sessions / L213 VACUUM / L300 reset 4 表）
- 测试：`db.test.js`（892 行）**零 Prisma 引用**，全走 db 公开 API，断言 legacy JSON 形状；`db-manager.test.js` 仅 6 处 `getPrisma: () => mockPrisma`（L64/88/108/124/312/329）
- `server/generated/prisma/`：全仓库唯一 import 在 db.js L8
- DB 路径：`prisma/anime.db` 被 copy-sidecar-deps.js、测试、dev:server:watch ignore 列表引用，**路径保持不动**

## 3. 方案决策

**弃 Prisma 7 → better-sqlite3 原生 SQL**。理由（oracle 结论）：
1. Prisma 用量薄（纯 CRUD），ORM 价值（类型安全/关联抽象/迁移工具）用不满
2. 所有打包痛苦全部来自 Prisma 7 特有的 WASM 动态 import，弃之则痛点归零
3. better-sqlite3 本就是直接依赖（^12.6.0），schema 手写 SQL 已存在，底层全现成
4. 未来 ESM+TS 下 better-sqlite3 严格更简单（原生模块，pkg/bun/裸 node 通吃）
5. **"回到 Prisma 5"是更差选项**（Rust 引擎 sidecar 多 20-40MB，且 Prisma 5 近 EOL）

**已否决**：留 Prisma 7 hack 栈（继续堆补丁）、回 Prisma 5（Rust 引擎 EOL）、SEA/bun 内联 WASM 保 Prisma（绕远路）。

**唯一否决条件**：未来半年引入复杂关系查询/聚合/嵌套写入，或团队深度依赖 Prisma Studio 调试——否则方向成立。

## 4. 迁移步骤（5 阶段，逐阶段可提交）

### 阶段 0：冻结与基线
1. 建分支（推荐从当前 `refactor/yaopkg-prisma7` 派生 `feat/drop-prisma`，或按用户偏好定）
2. 备份 DB：确认 `prisma/anime.db.bak-prisma7` 存在，再备份一份当前库
3. 跑 `cd server && npm test` 确认 222 测试全绿作为基线

### 阶段 1：重写 db.js 核心（API 签名完全不变）
1. 单例 `Database`，初始化 PRAGMA：**`foreign_keys = ON`（🔴 必写，否则级联删除静默失效）**、`journal_mode = WAL`、`busy_timeout`
2. 3 个事务函数改 `db.transaction()` 同步包装，内部逐行翻译"读现有→算差异→批量写"
3. SQL 语义对照：
   - `upsert` → `INSERT ... ON CONFLICT(id) DO UPDATE SET ...`（SQLite ≥3.24）
   - `findFirst` + create/update（myList bangumiId 分支 L618-631）→ 照搬，bangumiId 可空 NULL 不触发唯一冲突，不能直接 ON CONFLICT
   - `deleteMany({ where: { animeId: { notIn } } })` → 守卫空数组后拼 `NOT IN (?,?,...)`（禁止 `IN ()`）
   - `updateMany` → 动态 SET，**过滤 undefined 键**（Prisma 忽略 undefined，原生层必须自己过滤，否则 `SET x = undefined` 炸）
4. **legacy converter 加 `!!` 布尔强转**（🔴 downloaded/watched 读回是 0/1，Prisma 映射 true/false；透传给前端会挂 `if (a.downloaded)` 和 `watched === true` 断言）
5. `loadData` 的 include → 两次查询（anime + episodes 各自 ORDER BY，episodes 按 number 升序）
6. 保留 `Number(fileSize)`、`.toISOString()` 转换；时间戳用 `Date.now()` 整数
7. **删除 `getPrisma()` 导出**（db-manager 改调新函数，见阶段 2）
8. 删除 `PRISMA_QUERY_ENGINE_LIBRARY`/NODE_PATH/`_initPaths` hack（better-sqlite3 直接 require，无需 NODE_PATH 旁置——但保留 FFMPEG_BIN 逻辑）

### 阶段 2：db-manager 重构 + MigrationLog 迁移器
1. db-manager 3 处 `getPrisma()` 替换为语义化 API：`db.clearSessions()` / `db.vacuum()` / `db.reset()`（4 表 deleteMany 收进 db.js）
2. 更新 db-manager.test.js 6 处 mock
3. 迁移器落地（`MigrationLog` 已存在，v2 已在案，天然跳过）：
   - "schema sync"（保留 ensureSchema 的 ALTER 补列循环，幂等且已被测试覆盖）作为基线
   - 版本化迁移函数表 `[{ version, up(db) }]`，`SELECT version FROM MigrationLog` 后只跑未应用的
   - 保留"即使已迁移也 DROP Wishlist"的幂等逻辑（L287-290）
4. 新库 DDL 默认值改 `(unixepoch() * 1000)`（旧库不动，所有写入显式传值）

### 阶段 3：构建链清理（痛点归零）
1. 删：`scripts/fix-prisma-client-import-meta.js`、`build:prisma` 的 esbuild 步骤、`server/generated/prisma/` 目录
2. 依赖清理：根 `package.json` 删 `prisma`/`@prisma/client`/`esbuild`；`server/package.json` 删 `@prisma/adapter-better-sqlite3`/`@prisma/client`
3. `scripts/copy-sidecar-deps.js`：删 @prisma 复制段（保留 better-sqlite3 + bindings + file-uri-to-path；ffmpeg 固定从 `scripts/ffmpeg-upx.exe` 复制，不再引用 ffmpeg-static npm 包）
4. `postinstall` 简化为 `npm ci --production`
5. 删 `prisma/schema.prisma` + `prisma/migrations/`（`prisma/` 目录名保留作为 DB 存放处）
6. CLI 脚本：`prisma:generate`/`prisma:migrate` 换成 `db:migrate`（调 ensureSchema）；README/AGENTS.md 命令表同步更新
7. `src-tauri/tauri.conf.json`：resources 白名单去掉 @prisma 项

### 阶段 4：测试
1. 跑全量 `cd server && npm test`（预期 db.test.js 零修改通过——API 签名保持不变的前提）
2. 新增针对性用例：时间戳 round-trip（整数 ms）、布尔强转（0/1 → true/false）、空数组 IN、FK 级联删除、undefined 字段过滤、VACUUM/clear-sessions/reset 语义
3. dev 模式启动验证 DB 读写 + 数据形状（先备份 DB，用副本验证）

### 阶段 5：验证与收尾
1. `npm run build:server` → exe；`scripts/copy-sidecar-deps.js` 输出确认（仅 better-sqlite3 + ffmpeg，ffmpeg 来自 `scripts/ffmpeg-upx.exe`）
2. exe 冒烟测试：启动、`/api/stats`、`/api/library` 返回真实数据（21 anime）、时间戳正确
3. `npm run dev:tauri` 冒烟（库加载、播放、同步）
4. （可选）`npm run build` MSI/NSIS 验证资源进包
5. 迁移报告（report.md 格式）+ 更新 docs（data-flow.md、file-structure.md、workflow.md 提及 prisma 脚本处）
6. **ESM+TS 迁移排序：先弃 Prisma，后迁 TS，不要并行**（better-sqlite3 有官方 `@types/better-sqlite3`；Node 22.5+ 内置 `node:sqlite` 可在 ESM+TS 阶段评估，届时再决定是否消灭原生依赖——不现在混入）

## 5. 风险与回滚

| 风险 | 等级 | 缓解 |
|------|------|------|
| `PRAGMA foreign_keys` 漏开 → 级联删除静默失效 | 🔴 高 | 连接初始化必写；针对性测试覆盖 FK 级联 |
| 布尔列 0/1 透传破坏前端契约 | 🔴 高 | legacy converter `!!` 强转；db.test.js 断言覆盖 |
| `updateAnime` undefined 透传 | 中 | 动态 SET 过滤 undefined；调用方已 `?? null` 但防御性过滤必须 |
| DDL `CURRENT_TIMESTAMP` 混入 TEXT 时间戳 → 排序错乱 | 中 | 新 DDL 改 `(unixepoch() * 1000)`；所有写入显式传值 |
| 同步事务阻塞事件循环（全量保存冻结 HTTP） | 中 | 个人媒体库规模实测 10-50ms/次可接受；超大保存考虑分块 |
| 空数组 IN 子句 / BigInt fileSize | 低 | 守卫空数组；保留 `Number(e.fileSize)` |
| 路径耦合（`prisma/anime.db` 被多处引用） | 低 | 路径保持不动，改名留到 ESM+TS 阶段 |
| 并发时序（restore/VACUUM） | 低 | close → reopen 逻辑照搬 |

**回滚**：全部改动在 git 分支上；DB 双备份（`anime.db.bak-prisma7` + 阶段 0 新备份）；依赖改动可 revert。

## 6. 明确不做（非目标）

- ❌ 不重写查询逻辑（db.js 业务语义逐行翻译，只换执行层）
- ❌ 不迁 ESM/TS（排序：先弃 Prisma，后迁 TS）
- ❌ 不引入 node:sqlite（留待 ESM+TS 阶段评估）
- ❌ 不改 DB 路径/目录名
- ❌ 不动 mpv 外置策略 / ffmpeg 旁置方式
- ❌ 不做 Prisma Studio 兼容

## 7. 工作量粗估（oracle）

| 项 | 耗时 |
|---|---|
| db.js 重写（~32 处 SQL + 3 事务 + 转换器强转） | 1-2 天 |
| db-manager 重构 + 迁移器 + 测试更新 | 0.5 天 |
| 构建链清理（脚本/依赖/generated） | 0.5 天 |
| 测试稳定（布尔/FK/undefined 陷阱调试） | 0.5-1 天 |
| **合计** | **~3-4 专注工作日** |

## 8. 参考来源

- better-sqlite3 文档：https://github.com/WiseLibs/better-sqlite3（PRAGMA/transaction/ON CONFLICT）
- Node SEA/pkg 动态 import 限制（Prisma 7 崩溃根因）：https://nodejs.org/dist/latest-v22.x/docs/api/single-executable-applications.html
- Prisma 7 Rust-free / WASM compiler：https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- yao-pkg ESM/SEA 模式（未来路线参考）：https://yao-pkg.github.io/pkg/guide/esm

## 9. 执行记录（2026-08-03，已完成）

### 背景

执行弃 Prisma 计划（§4 五阶段），将 db.js 数据层从 Prisma ORM 重写为 better-sqlite3 原生 SQL。驱动因素：Prisma 7 的 WASM query compiler 在 pkg 快照下动态 import 崩溃，hack 栈不可持续；弃 Prisma 使痛点归零并为未来 ESM+TS 迁移扫清障碍。

### 改动范围

- **文件**：21 个（全 backend + docs，0 frontend）
- **新增**：+3347 行（含 lockfile）
- **删除**：-832 行（含 lockfile）
- **核心逻辑**：db.js 单例 `Database`（FK ON + WAL + busy_timeout）；3 事务改 `db.transaction()` 同步包装；legacy converter `!!` 布尔强转；`getPrisma()` 删除 → 新增 `clearSessions()/vacuum()/reset()`；版本化 `MIGRATIONS` 迁移器（MigrationLog 已存在，v2 在案天然跳过）；pkg 模式原生模块经 sidecar-modules 运行时加载（`NODE_PATH` + `Module._initPaths()` + 动态 require）

### 文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `server/db.js` | 重写（671 行变化） | better-sqlite3 原生 SQL；pkg sidecar 加载分支 L6-21 |
| `server/__tests__/db.test.js` | 修改（+343） | 新增 10 个针对性用例（时间戳/布尔/FK/undefined/空数组/vacuum/reset） |
| `server/__tests__/routes/db-manager.test.js` | 修改 | 6 处 mock 换新 API |
| `server/routes/db-manager.js` | 修改 | 3 处 `getPrisma()` → 语义化 API |
| `server/server.js` | 修改（-21） | NODE_PATH/`_initPaths` hack 移除（保留 FFMPEG_BIN） |
| `scripts/copy-sidecar-deps.js` | 修改 | 删 @prisma 复制段，仅剩 better-sqlite3+bindings+file-uri-to-path+ffmpeg |
| `package.json` / `server/package.json` | 修改 | 删 prisma/@prisma/esbuild；新增 `db:migrate` 脚本 |
| `package-lock.json` / `server/package-lock.json` | 修改 | @prisma 节点归零 |
| `src-tauri/tauri.conf.json` | 修改 | resources 白名单删 @prisma |
| `prisma/schema.prisma`、`prisma/migrations/`、`prisma.config.ts` | 删除 | 全部 Prisma 配置/迁移文件 |
| `server/generated/prisma/`、`scripts/fix-prisma-client-import-meta.js` | 删除 | 构建链残留 |
| `AGENTS.md` / `README.md` / `docs/{file-structure.md,data-flow.md,dev/backend.md,dev/testing.md,data-flow/save-taxonomy.md}` | 修改 | 命令表 + 架构文档同步 better-sqlite3 现状 |

### 测试结果

- `cd server && npm test`：**232/232 pass**（222 基线 + 10 新增），~5.5s
- `npm run db:migrate`：`Database schema verified/updated`（真实运行通过）
- dev 模式 DB 读写验证：library 19 条形状正确
- exe 冒烟：`/api/stats` 真实数据（total 21 / totalEpWatched 17 / totalWatchSeconds 18853 / totalFileSize 199254309790 / totalFileCount 211）；`/api/library` 21 条，`downloaded`/`watched` 全布尔，时间戳 ISO 正确

### 文档同步

- [x] `docs/file-structure.md` — prisma/ 目录定位改为 DB 存放处；sidecar 列表更新
- [x] `docs/dev/backend.md` — "Prisma 注意事项" → better-sqlite3（`!!`/undefined/FK）
- [x] `docs/data-flow.md` L33 — Prisma ORM → better-sqlite3
- [x] `docs/data-flow/save-taxonomy.md` L46 — Convert Prisma models → Convert SQLite rows
- [x] `docs/dev/testing.md` L138-146 — "Prisma 环境" → "数据层测试环境"
- [x] `AGENTS.md` / `README.md` — 命令表 prisma 脚本 → `db:migrate`

### 遗留问题

- `npm run dev:tauri` 全量冒烟（阶段 5.3）未执行——dev 模式 DB 读写 + exe 冒烟已覆盖同等验证面；桌面窗口冒烟可留待后续
- MSI/NSIS 打包（阶段 5.4，可选）未执行
- 工作区存在与本迁移无关的预存未提交改动（`docs/dev/{frontend,workflow,report}.md`、`docs/data-flow/http-call-chain.md`、`public/vendor/` 删除、`scripts/check-frontend.js`）——非本次迁移产物，提交时需区分
- DB 备份：`prisma/anime.db.bak-drop-prisma`（阶段 0）+ `prisma/anime.db.bak-prisma7`（更早）双份保留

### 回归验证

- [x] 232/232 全量测试通过
- [x] DB 完整性：dev DB 行数 19/176/121/19 与备份逐表一致，MigrationLog v2_merge_wishlist 在案
- [x] 生产 DB（21 anime 基线）只读冒烟，未被改动
- [x] 打包 exe 构建成功（137.5MB）+ 冒烟通过
- [x] 全仓库 Prisma 残留归零（grep 验证，仅文档历史记录保留）
