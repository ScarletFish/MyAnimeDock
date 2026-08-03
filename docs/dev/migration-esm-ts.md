# 迁移计划：后端 ESM + TypeScript 化（TS→CJS 产物路线）

> 状态：⚠️ 已规划，待实施（Phase 1 未启动）
> 日期：2026-08-03
> 研究来源：oracle 架构评审（ora-1，已实查 27 个 server JS 文件 + 构建链）+ librarian 打包方案研究（lib-1，yao-pkg ESM/TS 支持 + node:sqlite 现状核实）
> 前置文档：`migration-drop-prisma.md`（已完成，本计划的前置条件）

## 1. 背景与动机

**决策链**：Prisma 弃用已完成（`feat/drop-prisma` 合并到 master），WASM 动态 import 与 pkg 快照的兼容性障碍已消除。当前后端为 27 个 CommonJS 文件、零类型系统。用户希望评估"是否可以正常迁移 ESM 和 TS"。

librarian + oracle 独立研究共同结论：**可以迁移，但必须走"源码 TS → 编译 CJS 产物"路线，不要做"运行时 ESM"**。原因：

| 维度 | TS→CJS（推荐） | ESM 运行时（否决） |
|------|----------------|-------------------|
| 类型安全/现代语法 | ✅ 完整获得 | ✅ 完整获得 |
| pkg 打包链 | 一行不动（产物仍是 CJS） | 🔴 需 `pkg --sea`，动态 import/TLA/reexport 有限制 |
| __dirname 替换 | 无需处理（CJS 产物里依然有效） | 🟡 生产 5 处 + 测试 6 处，改错静默写错目录 |
| NODE_PATH hack | 现状即可 | 🔴 纯 CJS 机制，ESM 下被忽略，必须替换 |
| 风险 | 零 ESM 兼容问题 | = 把 Prisma 7 时代的打包问题原样请回来 |

**一句话**：TS 化拿到类型安全与现代语法的全部价值，打包链一行不用动；ESM 运行时对 pkg-bundled Tauri sidecar 的收益（TLA/tree-shaking/共享模块）目前全部为零。

## 2. 现状基线（ora-1 实查核实）

- 生产文件 **27 个**，总量约 3000-4000 行，按依赖倒序逐个转可行
- `require()` 调用 **135 处**，平均每文件 5 处
- **动态 require 仅 1 处**（db.js L17 `require(path.join(sidecarDir, 'better-sqlite3'))`）——ESM 化唯一需要 createRequire 的点
- `__dirname` 真实代码位：**4 个生产文件共 5 处**（db.js / config.js×2 / utils.js / db-manager.js）+ 3 个测试文件 6 处
- 测试：13 个文件，node:test，CJS 运行
- `NODE_PATH` + `Module._initPaths` hack：仅 db.js L15-16，纯 CJS 机制
- 依赖：root devDeps 含 `@yao-pkg/pkg` v6.22.0；server deps 只剩 3 个纯 JS 依赖 + better-sqlite3
- 构建链：`pkg . --target node22-win-x64` → src-tauri/server-x86_64-pc-windows-msvc.exe + copy-sidecar-deps.js（sidecar-modules 含 better-sqlite3 + ffmpeg-upx.exe）
- 无 tsconfig、无类型系统

## 3. 方案决策

**选"源码 TS → 编译 CJS 产物"（Strategy A）**，理由：
1. `@yao-pkg/pkg` 不支持 TS 输入（scripts 必须已是转译后的合法 JS）；ESM 输出传统模式有限制（动态 import/TLA/reexport 会失败）、`--sea` 模式才干净但需逐项实测
2. CJS 构建产物完全没有这些坑，2026 年仍是 pkg 生态最主流稳妥做法
3. 产物仍是 CJS → `__dirname`、NODE_PATH、sidecar 加载、build:server 全部无感
4. 可增量推进：逐文件转 .ts，每步测试 + 冒烟，随时可回滚（删 tsconfig 即复原）

**已否决**：ESM 运行时（Phase 4，仅当出现硬需求——TLA/bun 迁移/浏览器共享代码——再立项评估）。

**顺带评估（远期可选，不混入本期）**：Node 22.5+ 内置 `node:sqlite` 与 better-sqlite3 几乎同构，但 Node 22 下仍 experimental（会打 warning），建议 Node 26 稳定后再评估用它消灭最后一个原生依赖——那是比"ESM 运行时"价值更高的简化方向。

## 4. 迁移步骤（5 阶段，逐阶段可提交）

### Phase 0 — pkg ESM 可行性 spike（0.5-1 天，可选）
用 esbuild 打一个"ESM 入口 + createRequire 加载 better-sqlite3"的最小 bundle 进 `pkg --target node22-win-x64` 跑起来。
- **退出条件**：产出书面 verdict。预期结论是"pkg ESM 输出不可靠"——让团队对 ESM 运行时死心，把精力锁死在 Strategy A。

### Phase 1 — 工具骨架，零源码改动（半天）
1. 装 typescript，建 `tsconfig.json`：`module: commonjs`、`target: es2022`、`allowJs: true`、`checkJs: true`、`strict: false`（Phase 3 再开）、`outDir: dist/`、`rootDir: .`
2. 加 `npm run typecheck` = `tsc --noEmit`，对现存 27 个 JS 建立基线错误清单（预期一堆 any——用逐文件 `// @ts-nocheck` 压制，不是修）
3. 加 `build:ts`（如 `tsc`）并把 `build:server` 改为 `tsc && pkg dist/server.js ...`（pkg 的 `scripts` glob 改 `dist/**/*.js`）
4. `dev:server:watch` 的 nodemon 改 watch `dist/` + `tsc -w`
- **退出条件**：① `typecheck` 全绿（含压制策略文档）② `npm test` 全绿 ③ `npm run build:server` 产出 exe 且冒烟通过。此时**一行业务代码没动**。

### Phase 2 — 依赖倒序逐文件转换（3-5 天）
转换顺序（叶子先转，consumer 后转）：
```
lib/config.js → lib/logger.js → lib/utils.js → lib/http-fetch.js
  → players/*、scrapers/*、scanner.js、mpv-ipc.js、thumbnail-queue.js
  → routes/*（9 个）
  → db.js、bangumi-sync.js
  → server.js（最后，入口）
```
- 每文件：`require` → `import`、`module.exports` → `export`、给导出函数加最小签名类型。**`__dirname` 完全不动**（CJS 产物里依然有效）
- 产出布局：`tsc` 输出到 `dist/`，consumer 的 require 路径在转换其依赖时顺带更新
- **退出条件（每文件）**：`typecheck` 绿 + 全量测试绿 + 攒 5-8 个文件做一次 exe 冒烟验证

### Phase 3 — 类型质量（1-2 天）
- 开 `strict: true`，逐个清 any
- **最高价值目标**：`makeState()` 的 state 对象（server.js L300）定义成 `ServerState` 接口——9 个 routes 全依赖它，一旦定型，routes 的 strict 化全部解锁
- db.js 的行类型（`AnimeRow`/`EpisodeRow` 等）——数据库 schema 已稳定，值得固化
- **退出条件**：strict 全绿 + 测试全绿

### Phase 4 — ESM 运行时（可选，另行立项，本期不做）
仅当出现硬需求（TLA、bun 迁移、浏览器共享代码）才做。内容见 §6 风险表 R1-R3。

## 5. 已消除 vs 仍在的障碍

**已消除（Prisma 移除 + ffmpeg-static 移除的直接红利）**：
- ✅ WASM query compiler + 运行时 `dynamic import()` → pkg 崩溃（头号障碍，彻底消失）
- ✅ `@prisma/*` 依赖、generated client、`build:prisma` 的 esbuild + fix 脚本、sidecar @prisma 复制段
- ✅ ffmpeg-static 依赖 → 内置 `scripts/ffmpeg-upx.exe`
- ✅ root devDeps 里的 prisma/esbuild 残留
- ✅ 动态 require 从 2 处降到 **1 处**（仅 db.js L17）

**仍在的障碍（全部可控，且大多只在 ESM 化时触发）**：
- ⚠️ better-sqlite3 原生模块的 pkg 运行时解析（唯一原生依赖，已收敛到 1 个动态 require）
- ⚠️ `NODE_PATH` + `Module._initPaths` hack（db.js L15-16，CJS-only，ESM 化时必须替换）
- ⚠️ pkg 快照限制（dynamic import 仍被禁、ESM 输出不可靠）——**永久约束，策略围绕它设计**
- ⚠️ `__dirname` 7 文件 13 处（仅当 ESM 化）
- ⚠️ node:test CJS 测试运行器
- ⚠️ 0 类型系统（绿地从零开始）

## 6. 风险表

| # | 障碍 | 严重度 | 具体内容 | 缓解 |
|---|------|--------|----------|------|
| R1 | pkg 不支持 ESM 输出 | 🔴 致命（若走 ESM） | pkg 快照机制 + 动态 import 崩溃 = Prisma 7 时期踩过的坑 | **不产出 ESM**。TS→CJS。若未来被迫 ESM：esbuild 打包成单文件 CJS 再进 pkg |
| R2 | NODE_PATH/_initPaths 是纯 CJS 机制 | 🔴 致命（若走 ESM） | db.js L15-16 靠它解析 sidecar 传递依赖；ESM 完全忽略 NODE_PATH | CJS 产物：现状即可。ESM：`createRequire(path.join(sidecarDir,'index.js'))` 锚定 sidecar 目录 |
| R3 | __dirname 替换面 | 🟡 中（仅 ESM） | 生产 5 处定义 DATA_DIR/ASSET_DIR/ffmpeg 路径/DB 路径——转错一个就静默写错目录；dist/ 布局改变相对路径语义 | 抽 `lib/paths.js` 单点计算；用 bootLog 做迁移回归验证。**CJS 产物下风险为 0** |
| R4 | better-sqlite3 ESM 加载 | 🟡 中（仅 ESM） | 裸 import 在 Node ESM 下可用，但 pkg sidecar 场景必须走 R2 的 createRequire | Phase 0 spike 一并验证 |
| R5 | node:test 在 TS 下的形态 | 🟡 中 | 选项 A（推荐）：测试保持 CJS `.test.js`，`require('../dist/db.js')`——零迁移 | 选 A。vitest 是重写，明确排除 |
| R6 | Tauri sidecar 构建链 | 🟢 低 | CJS 产物下完全不变。仅两个小项：pkg `scripts` glob 改 `dist/**/*.js`；nodemon 改 watch `dist/` + `tsc -w` | 低风险，随手处理 |
| R7 | 无类型存量 TS 化 | 🟡 中（工作量） | 27 文件 135 require，量级是"天"不是"周"。最大陷阱是 state 对象贯穿 9 个 routes | 见 Phase 3：先定型 ServerState；可用 checkJs 对不打算转的稳定文件只检查不转 |
| R8 | db.js 现存小瑕疵（迁移时顺手修） | 🟢 低 | ① better-sqlite3 加载只查 `exeDir/sidecar-modules`（L14），而 ffmpeg 用五路径 nodeModulesCandidates（L59-65）——不一致，Tauri MSI 安装下 DB 模块可能找不到 ② server/package.json L9 `build` 脚本还写 node18（stale） | 转换 db.js 时把两个机制合并成同一个路径解析函数 |

## 7. 诚实建议

1. **现在可以迁移**，按 Strategy A（TS→CJS），第一阶段的边界设为"tsconfig + checkJs 基线 + 零业务代码改动"。
2. **不建议等**：越晚 TS 化，`state` 对象和 db 行类型这些跨文件契约越固化，未来转换成本越高。现在 schema 和路由表都刚稳定，是动手的最佳时点。
3. **不建议做**（除非出现硬需求）：Phase 4 的 ESM 运行时——对 pkg-bundled Tauri sidecar，收益目前全部为零，代价是重新面对 R1-R3。
4. Phase 1 是纯增量：不碰一行业务代码，先建立 typecheck 基线 + 验证 dist/ 布局的打包链，随时可回滚（删 tsconfig 即复原）。

## 8. 参考来源

- yao-pkg ESM 指南：https://yao-pkg.github.io/pkg/guide/esm
- yao-pkg SEA 模式：https://yao-pkg.github.io/pkg/guide/sea-mode
- yao-pkg 原生模块：https://yao-pkg.github.io/pkg/guide/native-addons
- yao-pkg Configuration（scripts 必须已转译）：https://yao-pkg.github.io/pkg/guide/configuration
- Node.js SQLite 文档（v22 experimental / v26 stable）：https://nodejs.org/api/sqlite.html
- nexe 社区建议（esbuild 转 CJS 再进 pkg）：https://github.com/nexe/nexe/issues/815

## 9. 执行记录

- 2026-08-03：方案文档创建（研究来源 ora-1 + lib-1）。
- 2026-08-03：**Phase 1 完成 + logger.js 转 TS**（fix-1）。tsconfig（module commonjs / allowJs / checkJs / strict:false / outDir dist）建立；`typecheck`/`build:ts` 脚本加入；`build:server` 改 `tsc && pkg dist/server.js`；`dev:server:watch` 改 `tsc -w` + nodemon watch `server/dist/`；26 个存量 JS 加 `// @ts-nocheck` 压制基线；`logger.js`→`logger.ts`（Logger 接口 + `as const` 级别）。**关键偏差**：因 Node CJS 不解析 `.ts`，加了 `server/logger.js` shim（`module.exports = require('./dist/logger.js')`）转发源/测试的 `require('./logger')`，tsconfig exclude 该 shim 防覆盖编译产物；`test`/`test:routes` 先跑 `tsc`。`dev:server`/`db:migrate` 补 `build:ts` 前置。验证：typecheck 0 error、232 测试全绿、dist 27 产物、pkg 打包 exe 143MB + sidecar 完整、exe 冒烟监听 3456 通过。**遗留**：shim 是 Phase 1 过渡，后续文件转 .ts 后测试需迁到 dist 执行。
