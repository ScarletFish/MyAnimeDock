# Vite + Tailwind 迁移计划

## 背景

~7900 行手写 CSS（5 个文件），30 个 JS 全局变量，无构建工具。
随项目增长，样式一致性和开发效率持续下降。

## 实际目标

- **Vite** ✅ — 开发 HMR, 生产构建压缩
- **ESM** ❌ — 放弃；100+ 全局函数跨模块调用，迁移风险 > 收益
- **Tailwind** ⏳ — CSS 变量桥接 → 组件级替换手写 CSS
- 项目结构 `frontend/src/` 统一源码目录 ✅

## 文件结构（当前）

```
frontend/src/css/
├── styles.css            ← 入口 @import + @theme（57 行）
├── tokens.css            ← :root 变量定义（522 行）
├── base.css              ← 基础样式、动画、响应式、减少动效（332 行）
├── components/
│   ├── buttons.css       ← @utility btn 体系
│   ├── forms.css         ← checkbox/toggle/输入框/滑块/步进器
│   ├── badges.css        ← rating-badge/season-badge
│   ├── dropdowns.css     ← sort-dropdown/context-menu/status-dropdown
│   ├── modals.css        ← 模态框系统
│   ├── toast.css         ← @utility toast + @keyframes
│   ├── theme-controls.css← 主题选择器/dock/缩放指示器
│   ├── card-grid.css     ← 卡片网格/状态弹出/仪表盘布局
│   └── discovery.css     ← @utility 发现页组件
├── layouts/
│   ├── titlebar.css      ← 标题栏 + 全局搜索
│   └── sidebar.css       ← 侧栏 + tooltip
├── views/
│   ├── mylist.css        ← MyList + wishlist
│   ├── archive.css       ← 归档杂志视图
│   ├── metamatch.css     ← MetaMatch + 同步日志
│   ├── dashboard.css     ← 仪表盘 + 继续观看
│   ├── detail-layout.css ← 详情页布局/导航/封面/信息
│   ├── detail-episodes.css← 详情页剧集列表
│   ├── detail-characters.css← 详情页角色/声优
│   ├── detail-banner.css ← 详情页横幅/关联/推荐
│   ├── stats.css         ← 统计页
│   ├── onboarding.css    ← 欢迎页
│   └── keyboard.css      ← 快捷键帮助
└── light.css             ← raw（保留不动）
```

## CSS 分层策略

```
styles.css（入口）
├── @import "tailwindcss/theme"
├── @import "tailwindcss/utilities"
├── @theme（Tailwind token 桥接）
├── tokens.css          → :root 设计变量
├── base.css            → 全局基础样式
├── layouts/            → 页面布局骨架
├── components/         → 组件样式（目标：全 @utility）
└── views/              → 视图专属组件
```

### 为何合并又拆分

- **合**：老 `components.css` 通过 `<link>` 后加载覆盖 `@utility`，只能合并到 styles.css 保证唯一来源
- **拆**：用 CSS `@import` 替代多个 `<link>`，Vite 在 dev 模式独立 HRM，build 自动合并
- Vite 处理 `@import` 到子文件，不产生级联冲突

### 设计 Token 体系

| Token | 值（--scale=1 时） | 说明 |
|-------|-------------------|------|
| `--text-sm` | 0.938rem | 原 `0.75rem × 1.25`，1.25 基线算进值 |
| `--text-base` | 1.016rem | 原 `0.8125rem × 1.25` |
| `--space-1` | 0.313rem | 原 `0.25rem × 1.25` |
| `--space-2` | 0.625rem | 原 `0.5rem × 1.25` |
| `--radius-sm` | 0.375rem | 未乘 1.25（保持小圆角） |
| `--radius-lg` | 1rem | 未乘 1.25 |

所有间距/字号 token **已把 1.25 基线乘进值**，`--scale` 现在真实反映缩放倍数（1.0 = 100%）。

## 组件迁移策略

**核心问题**：`<link>` 加载顺序 `styles.css` → `components.css` → ...
导致老 CSS 规则在浏览器中覆盖 `styles.css` 中定义的 `@utility`。
（已解决：`components.css` 已清空，改用 `@import` 子文件）

**方案**：每个组件子文件中，原始 CSS → `@utility` 转换。对每个组件：

1. 打开对应 `components/*.css` 文件
2. 将原始类定义（`.btn`, `.modal` 等）改写为 `@utility`（混合 `@apply` + 原生 CSS）
3. 删除对应的原始类规则（同一文件内）
4. 验证该组件在所有视图中样式无损
5. 构建确认无报错
6. 提交

```
例：components/buttons.css

// 之前
.btn { ... }
.btn-primary { ... }

// 之后
@utility btn {
  @apply inline-flex items-center gap-2 ...;
  padding: 8px 18px;
  font-size: var(--text-base);
}
@utility btn-primary {
  @apply ...;
}
```

这样 `@utility` 就成了唯一来源，没有级联冲突。

## 迁移阶段

### Step 0 — 基础搭建 ✅ Done

`@tailwindcss/vite` 集成、`@theme` 桥接（颜色/间距/圆角/字体/字重/阴影）。

### Step 1 — 组件迁移（当前阶段）

迁移顺序（复杂度递增，每步可独立验证，已完成的不再重做）：

| # | 组件 | 文件 | 状态 |
|---|------|------|------|
| 1 | 按钮系统 | `components/buttons.css` | ✅ @utility |
| 2 | Toast 通知 | `components/toast.css` | ✅ @utility |
| 3 | 发现页组件 | `components/discovery.css` | ✅ @utility |
| 4 | 弹窗/模态框 | `components/modals.css` | ✅ @utility |
| 5 | 表单/输入 | `components/forms.css` | ✅ @utility（toggle/stepper/date）|
| 6 | 选择器/下拉 | `components/dropdowns.css` | ✅ @utility（sort-dropdown/context-menu）|
| 7 | 主题控制 | `components/theme-controls.css` | — 保留 raw（混合场景，100行） |
| 8 | 卡片/网格 | `components/card-grid.css` | ✅ @utility（grid-container/anime-card）|
| 9 | Badges/标签 | `components/badges.css` | ✅ @utility（rating-badge/season-badge）|
| 10 | 侧栏/导航 | `layouts/sidebar.css` | — 保留 raw（shell 布局） |
| 11 | 标题栏 | `layouts/titlebar.css` | — 保留 raw（shell 布局） |
| 12 | 详情页 | `views/detail-*.css` | ✅ 拆为 4 子文件 |
| 13 | 页面布局 | `views/mylist|archive|metamatch|dashboard.css` | ✅ 拆为 4 子文件 |

每个组件的操作模式：

```
1. 打开对应子文件，理解完整样式
2. 将老规则改为 @utility 定义
    @utility btn {
      @apply inline-flex items-center gap-2 ...;  /* Tailwind 部分 */
      padding: 8px 18px;                           /* 自定义值用原生 CSS */
      font-size: var(--text-base);                 /* 用 token 不用 calc */
    }
3. 删除对应的老规则
4. 肉眼检查该组件在每个页面的表现
5. 构建确认无报错（npm run dev:server:watch 或 Vite HMR）
6. 提交
```

### Step 2 — 视图 inline style 替换 ✅ Done

将 JS 模板字符串和 HTML 中的 `style="..."` 布局属性转为 Tailwind utilities。
已完成全部可转换项（~20 处），剩余的均为动态/功能性 style（display:none 等）。

### Step 3 — CSS 清理 ✅ Done

完成清理：
- **`components.css`** — 孤儿文件已删除（原 import 已移除）
- **`checkbox-label`** — 未使用的 legacy checkbox 样式已删除
- **其他死代码** — 迁移过程中同步清理

每迁移一个组件，对应的老 CSS 即被删除。
最终保留：`light.css` 主题覆盖 + `@keyframes` 动画 + 伪元素 + shell 布局 + 无法用 utility 表达的复杂规则。

## 开发工作流（迁移后）

```
写新 UI 组件：
1. 直接写 class="text-sm px-4 py-2 rounded-lg ..."
2. 如果模式可复用 → 在对应 components/*.css 加 @utility

改旧样式：
1. 找到对应子文件（按钮 → components/buttons.css）
2. 改 @utility 内部样式
3. Vite HMR 即时生效，无需刷新
```

### Vite 开发优势

| 场景 | 之前（3718 行一个文件） | 之后（拆分子文件） |
|------|------------------------|-------------------|
| 改按钮 | 搜 `.btn` 在大文件里翻 | `components/buttons.css` |
| 改主题色 | 同上 | `tokens.css` |
| Vite HMR | 整个 CSS 重载 | 只重载改到的文件 |
| 加新组件 | 找位置插入 | 新增文件 + `styles.css` 加一行 `@import` |

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
| 文件拆分 | Vite `@import` 替代 `<link>`，dev 独立 HRM，build 合并 |

## 当前进度

| 项目 | 状态 |
|------|------|
| Vite 构建 | ✅ |
| @theme 桥接 | ✅ |
| 设计 Token 体系（--text-*/--space-* 1.25 基线修正） | ✅ |
| 文件拆分（styles.css → 子目录结构） | ✅ |
| inline style 替换 | ✅ |
| Step 1 按钮 → @utility | ✅ |
| Step 1 Toast → @utility | ✅ |
| Step 1 发现页 → @utility | ✅ |
| Step 1 Modal → @utility | ✅ |
| Step 1 Forms → @utility | ✅ |
| Step 1 Dropdowns → @utility | ✅ |
| Step 1 Card-grid → @utility | ✅ |
| Step 1 Badges → @utility | ✅ |
| Step 1 theme-controls/sidebar/titlebar | — 保留 raw（shell/混合布局） |
| Step 1 detail.css | ✅ 拆为 4 子文件 |
| Step 1 views.css | ✅ 拆为 4 子文件 |
| Step 3 CSS 清理 | ✅ 已删除 `views.css` + `detail.css`（src） + `checkbox-label` + `components.css` orphan |
| 构建输出 | 176.95 KB（原 ~190 KB，-13 KB） |
