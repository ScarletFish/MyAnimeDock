# 迁移计划：yao-pkg 打包 + Prisma 7

> 状态：已规划，待确认执行
> 日期：2026-08-03
> 研究来源：librarian 网络查证（lib-1 / lib-3，2026-08-03）+ 本地代码核对

## 1. 背景与动机

| 痛点 | 现状 | 风险 |
|------|------|------|
| vercel/pkg 停维护 | 2024-01 归档，ESM 支持损坏（#1291），`_initPaths` hack 依赖其 CJS 拦截层 | 打包工具无人维护，升级/修复无门 |
| Node 18 EOL | `pkg` target `node18-win-x64`（Node 18 已于 2025-04 EOL） | 安全/兼容风险，且 yao-pkg 已移除 node18 目标 |
| Prisma 5 Rust 引擎 | `query_engine-windows.dll.node` 无法静态打包，需 `PRISMA_QUERY_ENGINE_LIBRARY` + NODE_PATH + `_initPaths` 三段 hack | 打包链脆弱 |
| `tauri.conf.json` 手工白名单 | 4 个 `@prisma/*` 目录逐一列出（`debug`/`engines-version`/`get-platform`） | Prisma 内部依赖变更即静默破坏 |

**目标**：切换到活跃维护的 yao-pkg（node22 target）+ Prisma 7（无 Rust 引擎），消灭 90% 打包痛点；不转 ESM、不改业务逻辑、不动 JS 结构。

## 2. 现状基线（本地核对）

- 根 `package.json`：`"type": "commonjs"`，`@prisma/client@^5.22.0`，`build:server` = `cd server && pkg . --target node18-win-x64`
- `server/package.json`：`"type": "commonjs"`，`pkg` config 声明 scripts（scanner/mpv-controller/scrapers）
- **pkg@5.8.1 全局安装**（`npm ls -g pkg`），不在项目 devDependencies
- Node 本地 v22.20.0 ✓（满足 Prisma 7 的 Node 20.19+ 要求）
- `server/db.js`：唯一 `require('@prisma/client')` 处（:8）；`:33-86` 是 pkg 原生模块修复段（引擎 env + NODE_PATH + FFMPEG_BIN）
- `server/db.js` PrismaClient 初始化用 `datasources: { db: { url } }` 模式
- `prisma/schema.prisma`：`provider = "prisma-client-js"`，SQLite，无 enum，无 previewFeatures；4 个 migration
- `scripts/copy-sidecar-deps.js`：复制 prisma-engine/.node + @prisma/client + ffmpeg + 生成空 anime.db
- `src-tauri/tauri.conf.json`：externalBin `server`；resources 白名单（frontend/dist + 4 个 @prisma + ffmpeg.exe）
- anitomy 0.0.35 / pinyin 4.0.0：**纯 JS**（anitomy 是 TS 移植版，自带 `.mjs` 入口）→ 非打包痛点
- mpv：外部依赖（系统 PATH 或 `config.mpvPath`），不打包

## 3. 方案决策

**选 yao-pkg + Prisma 7 的理由**：
1. yao-pkg 与现状距离最短（CJS 快照架构兼容现有 hack、CLI 改名即用、Tauri 官方认可）
2. Prisma 7 恰好消灭 yao-pkg 也搞不定的部分（Rust 引擎动态加载是 hack 存在理由）
3. 两者互补后剩余旁置工作仅 ffmpeg（任何方案都绕不开）
4. 不引入新约束（SEA 的 bundle 要求 / bun、deno 的运行时替换都是倒退）

**已否决**：esbuild+SEA（Prisma 5 NAPI 引擎纯 SEA 下走不通）、bun（Prisma 5 官方不支持、`_initPaths` 失效）、deno（better-sqlite3 官方 won't fix）、boxednode/nexe（静态链接 addon 与 Prisma 动态加载不匹配）、纯裸 node.exe 分发（体积/路径坑最多）。

## 4. 迁移步骤

### 阶段 1：依赖升级

1. **根 `package.json`**
   - `@prisma/client`: `^5.22.0` → `^7.x`
   - `prisma`: `^5.22.0` → `^7.x`
   - 新增 devDependency `@yao-pkg/pkg`（替换全局 pkg）
2. **`server/package.json`**
   - `pkg.targets`：`node18-win-x64` → `node22-win-x64`
   - `pkg.scripts` 检查是否需要补 `lib/**/*.js`、`routes/**/*.js` 等
   - 新增 dependency `@prisma/adapter-better-sqlite3`
3. **全局 pkg 移除**（构建脚本改调用本地 yao-pkg，`pkg` → `yao-pkg` 或 npx）

### 阶段 2：Prisma 7 代码迁移

4. **`prisma/schema.prisma`**
   - `generator client { provider = "prisma-client" }`（改 provider + 必填 `output`）
   - `output` 指向 `../server/generated/prisma`（或等价路径，生成目录需 gitignore 决策）
   - `datasource.url` 移除（移到 `prisma.config.ts`）
   - 模型字段**零改动**
5. **新增 `prisma.config.ts`**（`defineConfig`，datasource url 放这里）
6. **`server/db.js`**
   - import：`require('@prisma/client')` → 生成目录路径
   - 初始化：改 `new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:' + DB_PATH }) })`
   - **SQLite timestamp 兼容**：传 `{ timestampFormat: 'unixepoch-ms' }`（已有数据是 unixepoch-ms，adapter 默认 ISO 8601，不传会读乱时间）
   - **删除** `PRISMA_QUERY_ENGINE_LIBRARY` hack 段（:62-68）
   - **保留** NODE_PATH + `_initPaths`（:70-75，better-sqlite3 仍需要）+ FFMPEG_BIN（:77-82）
7. **清理废弃环境变量**：`PRISMA_QUERY_ENGINE_LIBRARY` 等 v7 移除项
8. **`scripts/copy-sidecar-deps.js`**
   - prisma-engine/.node 复制段 → 改为 better-sqlite3 的 `.node` 处理（或确认 yao-pkg 自动解压）
   - @prisma/client 复制段 → 简化（生成目录走 pkg 静态打包？需验证）
9. **`src-tauri/tauri.conf.json`**：resources 白名单按新依赖结构调整
10. **CLI 脚本**：`npm run prisma:migrate`（`prisma migrate dev` 不再自动 generate，需核对）

### 阶段 3：验证

11. `npm install` + `prisma generate` → 生成目录产出
12. `cd server && npm test`（全量，重点 db.test.js）
13. dev 模式启动 server，验证 DB 读写 + timestamp 正确（**先备份现有 anime.db**）
14. `npm run build:server` → 产 exe；跑 `scripts/copy-sidecar-deps.js`
15. `npm run dev:tauri` 冒烟（库加载、播放、同步）
16. `npm run build`（MSI/NSIS，验证 sidecar-modules 资源进包）

## 5. 风险与回滚

| 风险 | 等级 | 缓解 |
|------|------|------|
| 已有 DB timestamp 读乱 | 高 | 备份 DB；adapter 传 `timestampFormat: 'unixepoch-ms'`；先在副本上验证 |
| better-sqlite3 `.node` 打包 | 中 | yao-pkg 原生模块自动解压机制；必要时保留 NODE_PATH 旁置 |
| 生成目录路径/打包集成 | 中 | 阶段 2 先验证 generate + dev 运行，再进打包 |
| prisma.config.ts 配置错误 | 低 | 官方 v7 升级指南对照 |
| 迁移中途依赖行为变化 | 低 | 每阶段独立验证，不一次全改 |

**回滚**：全部改动在 git 分支上进行；依赖改动可 revert；DB 先备份。

## 6. 明确不做（非目标）

- ❌ 不转 ESM（后端保持 CJS）
- ❌ 不改业务查询逻辑（800 行 db.js 查询零改动）
- ❌ 不换运行时（不迁 bun/deno）
- ❌ 不追 SEA 真单文件
- ❌ 不动 mpv 外置策略
- ❌ 不处理 ffmpeg 旁置之外的新工作

## 7. 参考来源

- Prisma 7 官方升级指南：https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- Prisma 7.0.0 发布公告：https://www.prisma.io/blog/announcing-prisma-orm-7-0-0
- Prisma SQLite（timestampFormat）：https://www.prisma.io/docs/orm/core-concepts/supported-databases/sqlite
- yao-pkg 迁移指南：https://yao-pkg.github.io/pkg/guide/migration
- yao-pkg ESM/原生模块：https://yao-pkg.github.io/pkg/guide/esm / native-addons
- Tauri Node sidecar：https://tauri.app/learn/sidecar-nodejs
