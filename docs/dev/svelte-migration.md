# Svelte 迁移计划（MyAnimeDock 前端）

> 状态：**已确认执行**（2026-08-13）
> 决策：**直接全量迁 Vite + Svelte**，先建 Toast/Modal 组件，跑起来后慢慢修 bug。
> 本文档是迁移执行的唯一参照，防止执行偏差。

## 1. 背景与决策

- 前端现状：vanilla JS 全局函数模式（28 文件，~9000 行），自定义 concat 插件打包，无 ES 模块。
- 痛点：**组件全手写、无组件系统**，新增 UI 无从下手。
- 决策：迁移到 **Svelte 5**（无虚拟 DOM → GSAP 无冲突；体积小 → 适合 Tauri；语法简洁 → 迁移成本低；组件模型 → 解决手写组件痛点）。
- 策略：**直接全量迁 Vite + ES module + Svelte**，不做「concat 与 Svelte 共存」的渐进过渡（用户明确选择，接受后续修 bug）。

## 2. 调研结论（2026-08，@librarian）

| 项 | 结论 |
|----|------|
| GSAP 集成 | 无虚拟 DOM，天然无冲突；用 `gsap.context()` + `onMount` 返回 cleanup，官方标准做法 |
| Svelte 5 状态 | 已稳定（5.56.x），runes 默认，旧语法未废弃可混用 |
| 渐进迁移 | `mount()` 可挂到现有 DOM，官方支持；但本计划走全量 |
| melt-ui | Svelte 生态最成熟 headless 库；日期选择器质量高；**无拖拽/虚拟滚动核心**，需社区库 |
| Tauri v2 | 适配成熟；**推荐纯 Svelte（无 SvelteKit）**，SPA + 自定义路由 |
| 生态 | 文档好、社区活跃；规模远小于 React，冷门问题资料少（主要风险） |

## 3. 目标架构

```
frontend/
├── index.html          # 单一入口，Vite 注入
├── vite.config.js      # Vite + @sveltejs/vite-plugin-svelte（移除 concat 插件）
├── src/
│   ├── main.js         # Svelte 入口，mount(App)
│   ├── App.svelte      # 根组件（视图路由/布局）
│   ├── lib/            # 可复用逻辑（api/state/utils/i18n）
│   ├── components/     # 通用组件（Toast/Modal/Dropdown/Card...）
│   └── views/          # 视图组件（Discovery/Library/Detail/MyList/Stats/Settings...）
```

## 4. 分阶段执行

### Phase 0 — 构建系统地基
- [x] 安装 `svelte` + `@sveltejs/vite-plugin-svelte`
- [x] 建 `src/main.js` + `src/App.svelte` 入口
- [x] 改 `vite.config.js`：加 Svelte 插件，**移除 concat 插件**
- [x] 改 `index.html`：移除 28 个 script 标签，留单一入口
- [x] 处理内联 onclick（`onclick="showView(...)"` 等）→ 事件监听或组件内处理
- [x] 验证：`npm run check:frontend` 通过，dev server 能跑

### Phase 1 — 组件库骨架（用户指定先行）
- [x] Toast 组件（`components/Toast.svelte`，替换 `toast.js` 的 showToast/dismissToast）
- [x] Modal 组件（`components/Modal.svelte`，替换 `ui.js` 的 openModal + `app.js` 的 showConfirm）
- [x] Dropdown 组件（改用 **bits-ui `Select`**，替换 `components.js` 的 createDropdown；Mylist/LocalAnimeSection/StatusModal 已用）
- [x] Card 组件（`components/AnimeCard.svelte`，替换 `ui.js` 的 renderAnimeCard）
- [x] 复杂组件用 **bits-ui** 拿逻辑（状态下拉等；日期用三段式 + 校验，未引入完整日历）
- [x] 验证：组件在 App 中可用，样式与现有 CSS 一致

> **决策修正（2026-08-14）**：headless 库从 melt-ui 改为 **bits-ui**（`^2.18.1`，Svelte 5 官方推荐）。StatusModal 组件库（状态下拉/评分 stepper/进度/日期三段式）已完成，`enrichAnime` 统一三接口预填数据。

### Phase 2 — 视图渐进迁移
- [x] 按依赖顺序逐视图转 Svelte：settings → discovery → library → detail → mylist → stats
- [x] 每个视图：HTML 模板 → Svelte 组件，全局函数 → 组件方法/模块导入
- [x] 每迁移一个视图跑 `npm run check:frontend` 验证

### Phase 3 — 清理
- [x] 删除 concat 插件相关代码
- [x] 删除已迁移的旧 vanilla JS 文件
- [x] 内联 onclick 全部清理
- [x] 全量 `npm run check:frontend` + `npm run typecheck`（后端不受影响）

## 5. 关键技术决策

### 5.1 GSAP
- 用 `gsap.context()` + `onMount` 返回 cleanup（`return () => ctx.revert()`）。
- ripple、主题过渡动画迁移成本低；简单过渡可用 Svelte 内置 `transition:`。

### 5.2 d3 图表
- d3 框架无关，Svelte 中直接可用（无虚拟 DOM 冲突）。
- 封装为 Svelte 组件（`onMount` 里初始化，`$effect` 响应数据变化）。

### 5.3 i18next
- 现有 i18next 可继续用，用 Svelte store 或 `$effect` 包装 `t()`。
- 或评估 `svelte-i18n`，但优先保留 i18next 减少改动。

### 5.4 内联 onclick（最大坑）
- index.html 大量 `onclick="showView(...)"` 依赖全局函数。
- 迁移后这些函数不再全局 → 改为组件内事件处理或 `addEventListener`。
- 这是全量迁移的主要工作量之一。

### 5.5 状态管理
- 现有 `state.js` 全局状态 → Svelte 5 runes（`$state`）或 Svelte store。
- 跨视图共享状态用 store。

### 5.6 构建
- 纯 Svelte（无 SvelteKit），SPA 模式。
- Tauri `frontendDist` 指向 `frontend/dist`（Vite build 输出）。

## 6. 验证层级

| 阶段 | 命令 | 通过标准 |
|------|------|---------|
| 前端改动 | `npm run check:frontend` | JS 语法 + CSS token + dist 构建成功 |
| 后端（不受影响） | `npm run typecheck` | 0 错误 |
| 运行 | `npm run dev` | dev server 正常，视图可交互 |

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 全量迁移 bug 多 | 分阶段执行，每阶段验证；用户接受慢慢修 |
| 内联 onclick 工作量大 | Phase 0 集中处理，一次性清理 |
| 生态规模小（冷门问题） | 优先用官方文档 + melt-ui；复杂组件用社区库 |
| d3/i18next 集成 | 先验证再全面铺开 |
| 迁移期间功能回归 | 每视图迁移后跑 check:frontend + 手动验证 |

## 8. 完成标准

- [x] concat 插件移除，Vite + Svelte 构建正常
- [x] Toast/Modal/Dropdown/Card 为 Svelte 组件
- [x] 所有视图为 Svelte 组件
- [x] 旧 vanilla JS 文件删除
- [x] `npm run check:frontend` 全绿
- [x] 功能与迁移前一致（GSAP/d3/i18next/播放/同步均正常）
