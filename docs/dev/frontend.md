# 前端开发规范 — Frontend

## ⚠️ 必读（写 CSS/UI 前必须看）

### 现有组件

| 场景 | 使用 | 定义文件 |
|------|------|----------|
| 按钮 | `.btn` / `.btn-primary` / `.btn-danger` / `.btn-outline` | `frontend/src/css/components/buttons.css` |
| 标签/角标 | `.badge` | `frontend/src/css/components/badges.css` |
| 卡片布局 | `.anime-card` | `frontend/src/css/components/card-grid.css` |
| 水平分页滚动 | `.hscroll-section` + `.hscroll-card` | `frontend/src/css/components/patterns.css` |
| 下拉框 | `.sort-dropdown`（复杂下拉用 bits-ui `Select`） | `frontend/src/css/components/dropdowns.css` |
| 模态框 | `.modal-overlay` + `.modal-panel` | `frontend/src/css/components/modals.css` |
| 输入框/搜索 | `.search-input` / `.filter-input` / `.select-native` | `frontend/src/css/components/forms.css` |
| 开关 | `.toggle-switch` + `.toggle-slider` | `frontend/src/css/components/forms.css` |
| 单选胶囊组 | `.seg-radio-group` + `.seg-radio-item`（原生 radio，`:has(:checked)` 高亮） | `frontend/src/css/components/forms.css` |
| Toast 提示 | `.toast` + `.toast-visible` | `frontend/src/css/components/toast.css` |
| 加载中 | `.loading-spinner` | `frontend/src/css/components/patterns.css` |
| 分页 | `.pagination` | `frontend/src/css/components/patterns.css` |
| 标签组 | `.tags-field` | `frontend/src/css/components/patterns.css` |
| 发现页 | `.discovery-*` | `frontend/src/css/components/discovery.css` |
| 主题选择器 | `.theme-dock` | `frontend/src/css/components/theme-controls.css` |

> 更多组件见对应 `.css` 文件。**写新 UI 前先查这些有没有现成的。**
>
> 下拉框注意：**复杂交互下拉（排序、筛选、日期选择等）用 bits-ui `Select` 组件**，不再用 `createDropdown()` 工厂。`.sort-dropdown` 样式类仍保留，供简单场景或自定义下拉复用。

### 水平分页滚动（hscroll）

用于横向滚动 + 分页圆点指示器的场景（剧集列表、关联作品、推荐等）。

**新增步骤：**

1. **HTML** — 用标准结构，设 `--cols` 控制每页列数：
```html
<div class="hscroll-section" style="--cols:4">
  <div class="hscroll-header section-header">
    <span class="section-title">模块标题</span>
  </div>
  <div class="hscroll-container">
    <div class="my-card">卡片1</div>
    <div class="my-card">卡片2</div>
  </div>
</div>
```

2. **CSS** — 卡片用 `@apply hscroll-card`：
```css
.my-card {
  @apply hscroll-card;
  /* 按需加其他样式 */
}
```

3. **断点** — 在 view CSS 中用唯一选择器设置：
```css
@media (max-width: 1400px) {
  [data-section="my-module"] { --cols: 2; }
}
```

**注意事项：**
- `--cols` 默认4，可通过 `style="--cols:N"` 或 CSS 覆盖
- `--gap` 默认 `var(--space-4)`，可按需覆盖
- media query 选择器必须唯一（用 `[data-section="xxx"]` 或 ID），避免影响其他 hscroll section
- 圆点指示器由 `initScrollDots()`（`frontend/src/lib/scroll-dots.js`）在 Svelte 组件 `onMount` 中初始化，无需手动调用
- 卡片宽度从 `--cols` 自动计算，无需手写 `calc()`

### Token 引用规则

所有新增 CSS 必须用 `var(--xxx)` token，**禁止写死值**：

| CSS 属性 | 必须用 | 严禁写死 |
|----------|--------|----------|
| `padding` / `gap` / `margin` | `var(--space-*)` | `px` |
| `color` / `background` / `border-color` | `var(--bg-*)` / `var(--fg-*)` / `var(--accent-*)` | `#xxx` / `rgba()` |
| `border-radius` | `var(--radius-*)` | `px`（`50%`/`9999px` 除外） |
| `font-size` | `var(--text-*)` | `px` / `rem` |
| `font-weight` | `var(--fw-*)` | `400` / `600` / `700` |
| `box-shadow` | `var(--shadow-*)` | 自定义阴影 |

> 例外：`opacity`、`z-index`、`line-height` 等无法抽象的属性可用原始值。

### "先找后写"三步协议

```
写一个 CSS class 前先回答：
① 现有组件库有没有这个样式？→ 有就用，不写新 class
② 没有组件，有无 token 可用？→ 用 var(--xxx) 组合
③ 都不够且有必要抽象新组件？→ 放到正确文件，不新建 .css 文件
```

### 自动检查

```bash
npm run check:frontend   # 一键：node --check 全部 JS + check:css --strict + build:frontend
npm run check:css        # 仅扫描 views/ + layouts/ 的 token 合规性（check:frontend 已包含）
```

> ⚠️ 每次新增/修改前端 JS/CSS 后必须跑 `npm run check:frontend`（内含全部检查并重建 dist/），确认通过后才算完成。

---

## 架构概要

**Svelte 5 + Vite + Tailwind CSS v4 + bits-ui** 的 SPA。GSAP 作为唯一动画库。

前端已从 vanilla JS 全量迁移到 Svelte 5：视图、通用组件、交互逻辑均为 Svelte 组件，模块用 ES import 组织，由 Vite 打包为 ES module。

### 构建方式

Vite 打包 ES module，`index.html` 提供三个挂载点（`#app` / `#chrome` / `#sidebar`），`src/main.js` 用 Svelte 5 的 `mount()` 分别挂载 App / Chrome / Sidebar。

```
npm run dev              # Vite localhost:3456 + 后端 3457
npm run build:frontend   # 输出到 frontend/dist/
```

### 加载顺序

`src/main.js` 是**唯一入口**，模块用 ES import 组织，无严格 script 顺序依赖。`main.js` 负责：

- `initI18n()` — 必须在其他模块使用 `t()` 之前调用
- `mount(App, #app)` / `mount(Chrome, #chrome)` / `mount(Sidebar, #sidebar)`
- `bindDom()` — 替换 `[data-i18n]` / `[data-i18n-attr]`
- 启动初始化：`loadTheme` / `loadReduceMotion` / `applyZoom` / `showView('library')` / `startGlobalMpvStatus`

## i18n 文案规范（必读）

项目已引入 **i18next**（固定 `zh-CN`，当前不切语言）集中管理所有用户可见文案。
**所有前端字符串必须走 i18n，禁止在 JS/HTML 里硬编码中文文案。**

### 涉及文件

| 文件 | 作用 |
|------|------|
| `frontend/src/lib/i18n-zh.js` | **唯一文案字典**（`I18N_ZH`）。新增/修改文案只改这里 |
| `frontend/src/lib/i18n.js` | 初始化 i18next，暴露全局 `t()`，绑定 `[data-i18n]` / `[data-i18n-attr]` |
| `frontend/public/vendor/i18next/i18next.min.js` | i18next UMD 库（全局 `i18next`） |

### 三种写法

**① JS 动态文本** — 用 `t('ns.key', { var: value })`：

```js
// ✅ 正确
showToast(t('discovery.importedCount', { count: result.imported.length }), 'success');
el.textContent = t('detail.episodeCountTotal', { localCount: 5, totalCount: 12 });

// ❌ 错误 — 硬编码
showToast('成功导入 ' + result.imported.length + ' 个条目', 'success');
```

**② 静态 HTML 文本节点** — 用 `data-i18n="ns.key"`：

```html
<span data-i18n="common.back">返回</span>
<h1 data-i18n="library.title">动漫库</h1>
```

**③ HTML 属性（tooltip/title/placeholder/aria-label）** — 用 `data-i18n-attr`，格式 `ns.key:attr1,attr2`：

```html
<button data-tooltip="最小化" data-i18n-attr="nav.minimize:data-tooltip"></button>
<input placeholder="搜索…" data-i18n-attr="nav.searchPlaceholder:placeholder">
```

> 属性缺省列表：`data-tooltip, title, aria-label, placeholder`。`i18n.js` 的 `bindDom()` 在挂载后统一替换，动态插入的节点需要手动调 `t()`。

### key 组织

- 命名空间按模块划分：`common / nav / kbd / settings / app / ui / library / mylist / discovery / search / onboarding / detail / stats / metamatch`
- 格式：`模块.含义`（全小写下划线，如 `discovery.importedCount`）
- 插值用 `{{var}}` 语法：`'detail.episodeCountTotal': '{{localCount}} / {{totalCount}}集'`

### 修改文案流程

1. 只改 `frontend/src/lib/i18n-zh.js` 里对应 key 的值（或新增 key 并替换硬编码处）
2. `npm run check:frontend`（一键：语法检查 + CSS 合规 + 重建 dist/）

### 注意

- **动漫元数据（简介 `summary`、标题等来自 Bangumi API 的数据）不是 UI 文案，不走 i18n**，改 i18n 映射不会影响它们
- i18next 默认转义已关闭（`interpolation.escapeValue: false`），因为项目已有 `escHtml()`/`escAttr()`。**翻译值若含用户/外部数据仍须自行转义**

## 核心模式

### API 调用

```js
// api.js 封装
const data = await API.get('/api/library');
const result = await API.post('/api/mylist/update', { id, status });
await API.del('/api/play-session/123');
```

返回格式统一：`{ ok: true/false, data, error }`。

### XSS 防护

**所有用户数据必须用 `escHtml()` / `escAttr()` 包裹：**

```js
// ✅ 正确
element.innerHTML = `<span>${escHtml(title)}</span>`;
element.setAttribute('data-value', escAttr(userInput));

// ❌ 错误 — 直接拼接用户数据
element.innerHTML = `<span>${title}</span>`;
```

> **Svelte 默认转义**：Svelte 模板插值 `{title}` 默认转义，无需手动 `escHtml()`。仅当用 `{@html ...}` 渲染外部/用户数据时才需自行转义（项目已无独立 `escHtml`/`escAttr` 工具函数）。

### 视图切换

`showView()` 现在在 `frontend/src/lib/router.js`（不是 app.js）。它是**协调器**，不再直接操作 DOM 显隐：

- 保存 library/mylist 滚动位置
- 更新 sidebar active 状态
- 同步各视图的 Svelte store（`discoveryOpen` / `libraryOpen` / `statsOpen` / `mylistOpen` / `detailOpen`）
- 视图可见性由 store 驱动，各 Svelte 视图监听自己的 store 决定渲染

```js
// router.js — showView()
export function showView(view) {
  // 保存滚动、更新 sidebar active、设置 currentView
  // 同步 Svelte 视图 store
  discoveryOpen.set(view === 'discovery');
  libraryOpen.set(view === 'library');
  statsOpen.set(view === 'stats');
  mylistOpen.set(view === 'mylist');
  detailOpen.set(view === 'detail');
}
```

### UI 组件

通用组件是 **Svelte 组件**（`frontend/src/components/`）：`Toast` / `Modal` / `ConfirmDialog` / `ContextMenu` / `ThemeDock` / `KbdHelp` 等。复杂交互组件用 **bits-ui**（`Select` 下拉、日期选择等）。

不再有 `createDropdown()` / `createFilterBar()` 工厂函数。

### 数据状态管理

- `frontend/src/lib/state.js` — `AppState`（`get`/`set`/`on`，通过 `CustomEvent('statechange')` 通知），用于跨模块的轻量共享数据
- `frontend/src/lib/ui-state.js` — Svelte `writable` store，用于跨组件响应式共享：`libraryData` / `mylistData` / `pendingAutoPlay` / `pendingFinishAnimeId`

```js
// ui-state.js
export const libraryData = writable([]);
export const mylistData = writable([]);
export const pendingAutoPlay = writable(null);
export const pendingFinishAnimeId = writable(null);
```

### 搜索

前端搜索逻辑在 Svelte 视图（`Library.svelte`）中，匹配字段：`title` / `bangumiTitle` / `pinyinTitle`。

`pinyinTitle` 由后端 library 路由计算（pinyin-pro，去声调）。

## CSS 缩放标准

**禁止使用 CSS `zoom`**（导致 GSAP Flip 断裂、fixed 元素错位）。

使用 CSS 自定义属性 `--scale` 实现 UI 缩放：

```css
:root { --scale: 1; }

/* font-size — 必须用 calc(Xrem * var(--scale)) */
font-size: calc(0.8125rem * var(--scale));

/* 容器 max-width */
max-width: calc(75rem * var(--scale));

/* grid gap / clamp */
gap: calc(clamp(1.5rem, 3vw, 3rem) * var(--scale));

/* 间距 — 使用 --space-* 变量 */
padding: var(--space-4);

/* 固定覆盖层 — 禁用缩放 */
.theme-dock { --scale: 1; }
```

`applyZoom(scale)` 在 `frontend/src/lib/theme.js`，设置 `:root` 的 `--scale` 属性。gridZoom 独立控制（50%-200%，`localStorage` 持久化）。

## 动画约定

### GSAP

GSAP 已注册全局 `gsap.registerPlugin(Flip)`，引用自 `frontend/public/vendor/gsap/`。

在 Svelte 组件中用 `gsap.context()` + `onMount`，并在卸载时返回 `() => ctx.revert()` 清理：

```svelte
<script>
  import { onMount } from 'svelte';
  import gsap from 'gsap';

  let ctx;
  onMount(() => {
    ctx = gsap.context(() => {
      // 封面切换动画
      animateHeroCoverFlip(oldCover, newCover);
      // 内部创建 position:fixed overlay → Flip.getState() → DOM 变化
      // → Flip.from(state, { absolute: true })
    });
    return () => ctx.revert();
  });
</script>
```

### 封面加载

**详情页封面不能加 `decoding="async"`**：

```html
<!-- ✅ 正确 — 必须 eager -->
<img src="..." decoding="async">

<!-- ✅ 正确 -->
<img src="..." decoding="sync" alt="">
```

必须 `eager` 加载，否则 GSAP Flip 动画完成时封面尚未解码，露出空白框架闪白。

### 操作 DOM 前检查元素存在

```js
// ✅ 正确 — 非当前视图时 getElementById 返回 null
const el = document.getElementById('detail-info');
if (el) { /* 更新 */ }
```

## 响应式

网格自适应列宽由 `frontend/src/lib/grid.js` 的 `GRID_CARD_MIN=200` / `GRID_CARD_MAX=277` 控制，用 `calcGridCols(scale)` 计算：

```js
// grid.js
export const GRID_CARD_MIN = 200;
export const GRID_CARD_MAX = 277;

export function calcGridCols(scale) {
  return `repeat(auto-fit, minmax(${Math.round(200 * scale)}px, ${Math.round(277 * scale)}px))`;
}
```

实际渲染尺寸 = `GRID_CARD_MIN/MAX × --scale`。gap = `clamp(0.85rem, 1.2vw, 1.25rem)`。

## 主题

6 种色彩主题（default/amber/ocean/sakura/emerald/violet）+ 独立 dark/light 模式。底部 dock 选择器（`ThemeDock.svelte`）即时切换生效。

## 调试系统

`frontend/src/lib/debug.js` — 前端诊断，F12 启用：

```js
__debug.toggle()              // 启用/关闭（localStorage 持久化）
__debug.log(tag, ...args)     // 带标签的 console.log
__debug.snapshot(label)       // view, scrollTop, scrollHeight 快照
```

遇到滚动/视图切换/数据不一致 → 先开日志复现。

## 局部刷新

Svelte 响应式自动处理视图更新：数据变化通过 store / `$state` 自动更新视图，**无需手动 innerHTML**。

```svelte
<!-- ✅ 正确 — 数据变化自动更新列表 -->
{#each $libraryData as item}
  <AnimeCard {item} />
{/each}
```

不要手动操作 DOM 重建视图（会导致搜索框失焦、排序状态丢失）。

## Svelte 5 组件开发约定

- **组件**放 `frontend/src/components/`（通用组件）与 `frontend/src/components/detail/`、`frontend/src/components/chrome/`、`frontend/src/components/metamatch/`（按域分子目录）
- **视图**放 `frontend/src/views/`（`Library.svelte` / `Mylist.svelte` / `Detail.svelte` / `Discovery.svelte` / `Stats.svelte` / `Settings.svelte` / `MetaMatch.svelte`）
- **可复用逻辑**放 `frontend/src/lib/`（`router.js` / `ui-state.js` / `grid.js` / `theme.js` / `i18n.js` / `scroll-dots.js` 等）
- **样式**用 CSS 文件（`styles.css` 入口 + `views/` / `components/` / `layouts/` 子文件），组件内 `<style>` 尽量少用，优先用全局 CSS 类
- 组件内 `<style>` 仅用于组件私有、无法用全局类表达的样式；可复用的样式抽象到对应全局 CSS 文件

## 设计 Token 参考

所有 UI 代码必须使用 CSS 自定义属性（定义在 `frontend/src/css/tokens.css`），**不许写死值**。

### 颜色

```css
/* 背景层级 */
--bg-deep: #050505;       /* 最深背景 — 页面外围 */
--bg-base: #0f0f0f;       /* 页面主背景 */
--bg-surface: #161616;    /* 卡片/面板背景（与 bg-card 同色） */
--bg-elevated: #1e1e1e;   /* 提升卡片 — 详情页模块、下拉框、模态框 */

/* 文字 */
--fg-primary: #e0dbd4;    /* 主文字（标题、正文） */
--fg-secondary: #9c9187;  /* 次要文字（label、副标题） */
--fg-muted: #8a7a70;      /* 弱化文字（占位、描述） */

/* 主题强调色 */
--accent: #e13a5a;        /* 主强调色 */
--accent-soft: #ff6b8a;   /* 悬浮态 accent */
--accent-gradient: linear-gradient(135deg, #e13a5a, #ff2d55);
--accent-rgb: 225, 58, 90;/* 用于 rgba(var(--accent-rgb), alpha) */

/* 语义色 */
--success: #22c55e;       /* 已观看、播放中 */
--warning: #f59e0b;       /* 待处理 */
--error: #ef4444;          /* 错误、删除、危险操作 */
--info: #a78bfa;           /* 信息标签 */

/* 边框 */
--border: rgba(225, 58, 90, 0.08);        /* 默认边框 */
--border-hover: rgba(225, 58, 90, 0.16);  /* 悬浮态边框 */

/* 玻璃效果 */
--glass-bg: rgba(18, 18, 18, 0.82);       /* 毛玻璃背景色 */
--glass-blur: blur(24px);                 /* 毛玻璃模糊量 */

/* 阴影 */
--shadow-sm: 0 2px 8px rgba(0,0,0,0.5);   /* 小卡片阴影 */
--shadow-md: 0 4px 24px rgba(0,0,0,0.6);  /* 模态框/下拉框阴影 */
--shadow-lg: 0 8px 48px rgba(0,0,0,0.7);  /* 大浮层阴影 */
```

### 间距

所有间距由 `--scale` 缩放，必须用 `var(--space-*)`，不许写 `px`/`rem`：

```css
--space-1: calc(0.25rem * var(--scale));   /* 4px  @scale=1 */
--space-2: calc(0.50rem * var(--scale));   /* 8px */
--space-3: calc(0.75rem * var(--scale));   /* 12px */
--space-4: calc(1.00rem * var(--scale));   /* 16px */
--space-5: calc(1.25rem * var(--scale));   /* 20px */
--space-6: calc(1.50rem * var(--scale));   /* 24px */
--space-8: calc(2.00rem * var(--scale));   /* 32px */
--space-10: calc(2.50rem * var(--scale));  /* 40px */
--space-12: calc(3.00rem * var(--scale));  /* 48px */
```

### 圆角

```css
--radius-sm: calc(0.375rem * var(--scale));  /* 6px  — 按钮、输入框 */
--radius-md: calc(0.625rem * var(--scale));  /* 10px — 下拉框、提示框 */
--radius-lg: calc(1.00rem * var(--scale));   /* 16px — 卡片、模块面板 */
--radius-xl: calc(1.50rem * var(--scale));   /* 24px — 大模态框、首屏 hero */
```

### 字体

```css
--font-display: 'Playfair Display', serif;  /* 大标题/展示 */
--font-body: 'DM Sans', sans-serif;          /* 正文/说明 */
--font-mono: 'JetBrains Mono', monospace;    /* 代码/数字 */
--fw-normal: 400;
--fw-medium: 500;     /* 按钮文字、标签 */
--fw-semibold: 600;   /* 标题、重点按钮 */
--fw-bold: 700;
--fw-extrabold: 800;
```

### 动效

```css
--duration-fast: 180ms;                       /* hover、颜色切换 */
--duration-normal: 300ms;                     /* 面板展开、淡入淡出 */
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);  /* 通用减速曲线 */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* 弹性效果 */
```

## 新增 UI 组件检查清单

> ⚠️ 写 CSS/UI 前**必须先看**本文档顶部的 [必读章节](#%EF%B8%8F-必读写-cssui-前必须看)。以下清单是补充检查项。

- [ ] 用现有 Svelte 组件、bits-ui 组件，还是新建组件？
  - 有现成组件 → 复用。没有 → 新建 Svelte 组件，考虑是否可抽象到 `components/`
- [ ] 外部输入是否 escHtml/escAttr？
- [ ] 所有文案是否走 i18n？（JS 用 `t('ns.key')`，HTML 用 `data-i18n` / `data-i18n-attr`，禁止硬编码中文）
- [ ] 缩放是否用 `--scale` calc？
- [ ] DOM 操作前是否检查元素存在？
- [ ] 用 Svelte 响应式，避免手动 DOM 操作？—— 数据变化通过 store / `$state` 自动更新，不手动 innerHTML
- [ ] 是否有动画？是否用 GSAP？—— 在 `onMount` 中用 `gsap.context()`，返回 `() => ctx.revert()` 清理
- [ ] 响应式：1000px 以下不崩、1920px 以上不太空？
  - 确认 `min-width` / `max-width` / `auto-fill` 行为合理
- [ ] 颜色/间距/圆角/阴影/字号是否完全使用 `var(--xxx)` token？—— 跑 `npm run check:frontend` 验证

---

## 视觉一致性 — 详情页模块

**新详情页 section 必须复用现有模块的视觉结构，不得重写一套样式。**

```css
/* ✅ 正确 — 匹配 .detail-characters 的卡片框 */
#detailNewSection {
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  padding: 1.25rem 1.5rem;
}
/* section header 用 .detail-section-header + h3 / .detail-section-title */
```

标题用 `.detail-section-header` + `<h3>` 体系（flex 行，标题左，操作右）。
卡片/内容区的 gap、padding、font-size 从已有同类模块取，不猜值。