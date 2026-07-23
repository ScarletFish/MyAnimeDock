# Vite + Tailwind 迁移计划（回顾版）

## 背景

7125 行手写 CSS, 30 个 JS 全局变量, 无构建工具。随项目增长，样式一致性和开发效率持续下降。
当前阶段 (功能基本完成) 是框架化的最佳窗口。

## 实际目标

- **Vite** ✅ — 开发 HMR, 生产构建压缩
- **ESM** ❌ — 放弃；100+ 全局函数跨模块调用，迁移 ESM 需要改 100+ 文件，风险 > 收益
- **Tailwind** ⏳ — 待实施，不受 ESM 影响
- 项目结构从仓库根目录散放 → `frontend/src/` 统一源码目录 ✅

## 两阶段计划（修正）

### Phase 1 — Vite + 目录迁移 ✅ 已完成

**目标**：HMR 跑起来、JS 保持全局 script 标签、CSS 原封不动

```
Step 1.1  手动搭建 Vite 配置（不用 npm create vite 模板）
          只取 vite.config.js + package.json scripts

Step 1.2  迁移目录结构
          public/js/*.js    →  frontend/src/js/
          public/css/*.css  →  frontend/src/css/
          public/index.html →  frontend/index.html（改 script/link 路径）

Step 1.3  ESM 评估 → 放弃
          原因：30 个 JS 文件通过 100+ 全局函数互相调用（跨模块引用），
          每个都需要加 export + 改所有调用处。单文件构建的收益 < 回归风险。
          结论：保留 <script> 标签加载。Vite 按原样复制到 dist/。

Step 1.4  npm run dev
          Vite dev server   → localhost:3456（代理 /api → 3457）
          后端 server       → localhost:3457（自动降级端口）
          npm run build:frontend → frontend/dist/ (JS 267KB, CSS 201KB)

Step 1.5  Tauri 配置修正
          devUrl: localhost:5173 → localhost:3456
          生产静态路径: ASSET_DIR/public/ → ASSET_DIR/frontend/dist/
```

**关键决策**：放弃 ESM。全局 `<script>` 标签 + Vite 复制模式可行，
等将来有需要时再考虑单文件构建。

**耗时**：约 2 天（含多次 bug 修复）

---

### Phase 2 — Tailwind v4 迁移

**目标**：Tailwind v4 逐步替换手写 CSS，保留 8+ 主题系统和 `light.css` 覆盖

**策略**：CSS 变量驱动主题 → `@theme` 桥接到 Tailwind utilities → 混合 `@utility`（组件）+ inline utilities（布局）

```
架构决策：

  版本: Tailwind v4（CSS-first，无 tailwind.config.js）
  插件: @tailwindcss/vite（代替 PostCSS，省一个配置文件）
  主题: A 方案 — @theme 映射 CSS 变量，8+ 主题通过 data-theme 级联自动工作
  Preflight: 关闭，保留自定义 reset（user-select: none 等桌面端行为）
  组件策略: 混合 — @utility 定义复杂组件（btn/card/modal），
            内联 utilities 用于布局（flex/grid/padding/margin）
  light.css: 保留，Tailwind 无等效的多主题覆盖机制
```

#### Step 0 — 基础搭建

```shell
cd frontend && npm install tailwindcss @tailwindcss/vite
```

在 `vite.config.js` 加插件（不需要 postcss.config.js / tailwind.config.js）：

```js
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tailwindcss(), concatJsPlugin()],
  // ...
});
```

在 `styles.css` 最顶部注入 Tailwind + @theme 桥接：

```css
@import "tailwindcss/theme";   /* 只取主题变量和 utilities，跳过 preflight */
@import "tailwindcss/utilities";

/* 保留手写 reset（* { margin:0; padding:0; box-sizing:border-box; user-select:none }）
   如愿意可改 @import "tailwindcss" 让 preflight 接管 */

@theme {
  --color-surface-deep: var(--bg-deep);
  --color-surface: var(--bg-base);
  --color-surface-elevated: var(--bg-elevated);
  --color-surface-raised: var(--bg-surface);
  --color-card: var(--bg-card);

  --color-content: var(--fg-primary);
  --color-content-secondary: var(--fg-secondary);
  --color-content-muted: var(--fg-muted);

  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
  --color-accent-secondary: var(--accent-secondary);

  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-error: var(--error);
  --color-info: var(--info);

  --color-border: var(--border);
  --color-border-hover: var(--border-hover);
}
```

现在 `bg-surface`、`text-content`、`border-border`、`bg-accent/20` 等 utility 可用。
`data-theme` 切换时 CSS 变量变化 → Tailwind utility 自动跟随，无需 `dark:` 前缀。

验证：`cd frontend && npx vite`，无构建错误即可。

#### Step 1 — Component Utilities

用 `@utility` 保持现有 HTML class 名称不变，内部 `@apply` 映射到 Tailwind。
这样 JS 模板字符串中的 `class="btn btn-primary"` 不必改动。

```css
/* ── 按钮系统 ── */
@utility btn {
  @apply inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium
         transition-all duration-fast ease-out cursor-pointer select-none;
}
@utility btn-primary {
  @apply btn bg-accent text-white border-transparent;
  @apply hover:bg-accent/90 active:bg-accent/80;
}
@utility btn-ghost {
  @apply btn bg-transparent text-content-secondary border-border/10;
  @apply hover:bg-surface-elevated hover:text-content;
}
@utility btn-danger {
  @apply btn bg-error/10 text-error border-error/20;
  @apply hover:bg-error/20;
}
@utility btn-sm   { @apply h-8 px-3 text-xs; }
@utility btn-icon  { @apply btn h-9 w-9 p-0; }

/* ── 卡片系统 ── */
@utility anime-card {
  @apply rounded-lg overflow-hidden cursor-pointer transition-all duration-fast ease-out
         bg-card border border-border/0 hover:border-accent/20 hover:shadow-md;
}
@utility anime-card-cover  { @apply w-full aspect-[3/4] object-cover; }
@utility anime-card-title  { @apply text-sm font-semibold text-content truncate; }
@utility anime-card-sub    { @apply text-xs text-content-muted; }

/* ── 模态框 ── */
@utility modal {
  @apply fixed inset-0 z-50 flex items-center justify-center;
}
@utility modal-content {
  @apply bg-surface-raised rounded-xl shadow-lg border border-border/10
         max-w-lg w-full max-h-[85vh] overflow-y-auto;
}

/* ── Toast ── */
@utility toast {
  @apply fixed bottom-6 right-6 z-[9999] flex items-start gap-3
         bg-surface-elevated/95 backdrop-blur-md rounded-lg shadow-lg
         border border-border/10 px-5 py-4 min-w-[300px] max-w-[420px];
}

/* 其他共享组件按需添加 */
```

每加一个 utility 后验证一个使用它的页面。

#### Step 2 — 视图 HTML 迁移（逐 view）

替换 JS 模板字符串中的内联布局样式（`style="..."` → Tailwind class）。
**组件 class 不必动**（已在 Step 1 由 `@utility` 接管）。

迁移顺序（复杂度递增）：

| 优先级 | View | 文件 | 策略 |
|--------|------|------|------|
| 🥇 | Settings/DB | `app.js` | 排练，最小可验证 |
| 🥈 | 详情页·info bar | `detail.js` | 最常用，独立 |
| 🥉 | 详情页·episode cards | `detail-stats.js` | 配合 info bar |
| 4 | 发现页 | `discovery.js` | 复杂结构 |
| 5 | 媒体库 | `library.js` | 网格+排序 |
| 6 | 我的列表 | `mylist.js` | |
| 7 | 仪表盘/stats | `stats.js`, `app.js` | |
| 8 | 共享组件 | `components.js` | 排序下拉等 |

每个 view 的操作模式：

```
1. 打开对应的 JS 文件
2. 找到模板字符串 HTML 片段
3. 布局类（flex/grid/padding/margin）→ Tailwind inline utilities
   `'<div style="display:flex;gap:8px">'` → `'<div class="flex gap-2">'`
4. 组件类（btn/card/modal）→ 保持原样（已在 Step 1 定义 @utility）
   `'<button class="btn btn-primary">'` → 不变
5. 条件 class → 保持 JS 逻辑，class 名不变
   `class="btn${active ? ' btn-primary' : ''}"` → 不变
6. 每段替换后肉眼验证样式无损
```

#### Step 3 — CSS 清理

1. 搜索 CSS 文件中已被 `@utility` 覆盖的规则，逐条删除
2. 每删一批跑 `npx vite build` 确保无 class 丢失
3. 最终保留：主题 CSS 变量 + `light.css` 覆盖 + `@keyframes` 动画 + 伪元素
4. 跑 `npm run build` 验证最终产物

---

### Phase 3 — 收尾检测 ✅ 合并到 Phase 2 Step 3

已合并到 Step 3（删除旧规则 + build 验证）。不再单独列一个阶段。

---

## 为什么是 Tailwind v4 不是 v3/UnoCSS

- **Tailwind v4**: CSS-first 配置（`@theme`），`@tailwindcss/vite` 免 PostCSS，
  `@custom-variant` 支持多主题，比 v3 更适合我们的场景
- **CSS 变量桥接**: `@theme { --color-xxx: var(--xxx); }` 直接引用现有变量，
  8+ 主题通过 `data-theme` 级联无缝工作，不需要 `dark:` 前缀
- **放弃 UnoCSS**: 单维护者项目，Tailwind 的生态/文档/长期维护更可靠

## 时间估算

| Phase | 内容 | 预计 |
|-------|------|------|
| 1 | Vite + 目录迁移 | ~2 天 |
| 2 | Tailwind v4 迁移 | 6-10 小时 |
|   Step 0 | 基础搭建 | 30 min |
|   Step 1 | Component utilities | 1-2 hr |
|   Step 2 | 视图迁移（8 views） | 4-6 hr |
|   Step 3 | CSS 清理 | 1 hr |
