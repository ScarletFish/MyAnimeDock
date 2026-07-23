# Vite + Tailwind 迁移计划

## 背景

~7900 行手写 CSS（5 个文件），30 个 JS 全局变量，无构建工具。
随项目增长，样式一致性和开发效率持续下降。

## 实际目标

- **Vite** ✅ — 开发 HMR, 生产构建压缩
- **ESM** ❌ — 放弃；100+ 全局函数跨模块调用，迁移风险 > 收益
- **Tailwind** ⏳ — CSS 变量桥接 → 组件级替换手写 CSS
- 项目结构 `frontend/src/` 统一源码目录 ✅

## 架构现状

```
styles.css      48 KB / 1866 行  ← @theme + reset + CSS 变量 + base
components.css  46 KB / 2019 行  ← 按钮、弹窗、卡片、表单、toast...
detail.css      26 KB / 1129 行  ← 详情页专用
views.css       58 KB / 2485 行  ← 发现、列表、统计、metamatch
light.css       20 KB / 436 行   ← 浅色主题覆盖（保留不动）
```

CSS 变量已全部桥接到 `@theme`，Tailwind 编译通过，`data-theme` 切换自动跟随。

## 组件迁移策略（已修正）

**核心问题**：`<link>` 加载顺序 `styles.css` → `components.css` → ... 
导致老 CSS 规则在浏览器中覆盖 `styles.css` 中定义的 `@utility`。

**方案**：逐个组件迁移。对每个组件：

1. 在 `styles.css` 中写 `@utility` 定义（可混合 `@apply` + 原生 CSS）
2. **从 `components.css` 中删除**对应的老 CSS 规则
3. 验证该组件在所有视图中样式无损
4. 提交

这样 `@utility` 就成了唯一来源，没有级联冲突。

## Phase 2 — Tailwind v4 迁移

### Step 0 — 基础搭建 ✅ Done

`@tailwindcss/vite` 集成、`@theme` 桥接（颜色/间距/圆角/字体/字重/阴影）。

### Step 1 — 组件迁移（当前阶段）

迁移顺序（复杂度递增，每步可独立验证）：

| # | 组件 | 文件 | 规则数 | 覆盖范围 |
|---|------|------|--------|----------|
| 1 | 按钮系统 | `components.css:1-83` | ~80行 | 全站 |
| 2 | 弹窗/模态框 | `components.css` | | 全站 |
| 3 | Toast 通知 | | | |
| 4 | 表单/输入/标签 | | | |
| 5 | 卡片/网格 | | | |
| 6 | 侧栏/导航 | | | |
| 7 | 发现页组件 | `components.css` + `views.css` | | |
| 8 | 详情页组件 | `detail.css` | | |
| 9 | 统计页组件 | `views.css` | | |
| 10 | MetaMatch | `views.css` | | |

每个组件的操作模式：

```
1. 读取老 CSS 规则（.btn, .modal 等），理解完整样式
2. 在 styles.css @theme 后写 @utility 定义
   @utility btn {
     @apply inline-flex items-center gap-2 ...;  /* Tailwind 部分 */
     padding: 8px 18px;                           /* 自定义值用原生 CSS */
     font-size: calc(0.8125rem * var(--scale));
   }
3. 从 components.css 中删除对应的老规则
4. 肉眼检查该组件在每个页面的表现
5. 构建确认无报错（npm run build 或 Vite HMR）
6. 提交
```

### Step 2 — 视图 inline style 替换 ✅ Done

将 JS 模板字符串和 HTML 中的 `style="..."` 布局属性转为 Tailwind utilities。
已完成全部可转换项（~20 处），剩余的均为动态/功能性 style（display:none 等）。

### Step 3 — CSS 清理

随 Step 1 自然完成——每迁移一个组件，对应的老 CSS 即被删除。
最终保留：`light.css` 主题覆盖 + `@keyframes` 动画 + 伪元素 + 无法用 utility 表达的复杂规则。

## 架构决策

| 决策 | 结论 |
|------|------|
| Tailwind 版本 | v4（CSS-first，无 config 文件） |
| 插件 | `@tailwindcss/vite`（免 PostCSS） |
| 主题 | `@theme` 映射 CSS 变量 → data-theme 级联自动工作 |
| Preflight | 关闭，保留手写 reset（user-select:none 桌面行为） |
| 组件策略 | `@utility` + 逐组件删除老 CSS（解决级联冲突） |
| light.css | 保留，Tailwind 无等效的多主题覆盖机制 |
| ESM | 放弃，保留 `<script>` 全局标签加载 |

## 当前进度

| 项目 | 状态 |
|------|------|
| Vite 构建 | ✅ |
| @theme 桥接 | ✅ |
| inline style 替换 | ✅ |
| Step 1 按钮迁移 | ⬅️ 进行中 |
| Step 1 剩余组件 | ⏳ |
| Step 3 CSS 清理 | ⏳ 随 Step 1 自然完成 |
