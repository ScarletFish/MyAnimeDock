# 前端开发规范 — Frontend

## 架构概要

Vite 构建 + 全局 `<script>` 标签（非 ESM）的 vanilla HTML/CSS/JS SPA。
GSAP 作为唯一动画库。

### 构建方式

Vite 在 **复制模式**（`build.rollupOptions.input` 只处理入口，JS 非 module 不打包）下工作：
`index.html` 里 19 个 `<script>` 标签被 Vite 按原样复制到 `dist/`，不做 tree-shaking 或 scope 隔离。
这样避免了 100+ 全局函数跨模块调用的 ESM 迁移风险。

```
npm run dev              # Vite localhost:3456 + 后端 3457
npm run build:frontend   # 输出到 frontend/dist/
```

### 加载顺序（严格依赖）

```
state.js → debug.js → ui.js → api.js → components.js
    → discovery.js → library.js → detail-stats.js
    → detail-nav.js → detail.js → mylist.js → metamatch.js
    → stats.js → titlebar.js → app.js → search.js
    → onboarding.js → keyboard.js
```

`frontend/index.html` 中 `<script>` 标签顺序必须与此一致。打破依赖可能导致 `undefined` 引用。

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

`escHtml` / `escAttr` 定义在 `utils.js`，`module.exports` guard 仅 Node.js 测试环境生效。

### 视图切换

CSS `hidden` class toggle，无客户端路由器：

```js
// app.js — showView()
function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');
  // 维护当前视图状态
  currentView = view;
  // 自动恢复滚动位置
  restoreScroll(view);
}
```

### UI 组件工厂

优先用工厂，避免重复写 toggle/render/click-outside：

```js
// components.js
createDropdown({ containerId, options, storageKey, onSelect });
createFilterBar({ container, options, initial, onChange });
```

### 数据状态管理

`state.js` 维护全局 UI 状态，视图切换时不重建父容器：

- `currentView` — 当前视图名
- `libraryScrollPositions` — 各视图滚动位置
- `searchQuery` — 搜索查询
- `filterState` — 筛选器状态

恢复搜索/筛选状态：状态保存在 state + localStorage，视图切换时按需恢复。

### 搜索

- 前端搜索库列表（不调 API）
- 匹配字段：`title` / `bangumiTitle` / `pinyinTitle`
- `pinyinTitle` 由 server.js 返回（去声调）

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

`applyZoom(scale)` 在 `app.js:173`，设置 `:root` 的 `--scale` 属性。gridZoom 独立控制（50%-200%，`localStorage` 持久化）。

## 动画约定

### GSAP

GSAP 已注册全局 `gsap.registerPlugin(Flip)`，引用自 `public/vendor/gsap/`。

```js
// 封面切换动画
animateHeroCoverFlip(oldCover, newCover);
// 内部创建 position:fixed overlay → Flip.getState() → DOM 变化
// → Flip.from(state, { absolute: true })
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

网格自适应列宽：

```css
grid-template-columns: repeat(auto-fill, minmax(size, 1fr));
```

`GRID_CARD_BASE = 180`（`library.js`），实际渲染尺寸 = `180 × gridZoom × --scale`。gap = `clamp(0.85rem, 1.2vw, 1.25rem)`。

## 主题

6 种色彩主题（default/amber/ocean/sakura/emerald/violet）+ 独立 dark/light 模式。底部 dock 选择器即时切换生效。

## 调试系统

`public/js/debug.js` — 前端诊断，F12 启用：

```js
__debug.toggle()              // 启用/关闭（localStorage 持久化）
__debug.log(tag, ...args)     // 带标签的 console.log
__debug.snapshot(label)       // view, scrollTop, scrollHeight 快照
```

遇到滚动/视图切换/数据不一致 → 先开日志复现。

## 局部刷新

只更新内容区域，不重建父容器：

```js
// ✅ 正确 — 只更新列表容器
document.getElementById('library-grid').innerHTML = renderGrid(items);

// ❌ 错误 — 重建整个视图导致搜索框失焦、排序状态丢失
document.getElementById('view-library').innerHTML = renderFullLibrary(items);
```

## 设计 Token 参考

所有 UI 代码必须使用 CSS 自定义属性（定义在 `public/styles.css:4-76`），**不许写死值**。

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

### 组件类名参考

这些组件定义在 `public/css/components.css`，写新 UI 时优先使用，不要重写：

| 场景 | 类名 | 说明 |
|------|------|------|
| 按钮 | `.btn` | 默认透明边框按钮 |
| 按钮—主操作 | `.btn-primary` | accent 渐变填充 |
| 按钮—危险 | `.btn-danger` | 红色边框 + 红色文字 |
| 按钮—轮廓 | `.btn-outline` | accent 色边框 + 文字 |
| 下拉框 | `.sort-dropdown` | 自定义下拉选择器 |
| 输入框 | `.search-input` / `.filter-input` | 搜索/筛选输入框 |
| 模态框 | `.modal-overlay` + `.modal-panel` | 全屏半透明遮罩 + 居中面板 |
| 选择框 | `.select-native` | 原生 `<select>` 样式重置 |
| 标签 | `.badge` | 角标/状态标签 |
| 分页 | `.pagination` | 底部页码 |
| 加载中 | `.loading-spinner` | loading 旋转动画 |
| toast | `.toast` + `.toast-visible` | 底部提示消息 |
| 标签组 | `.tags-field` | 标签列表（动画入场） |

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

## 新增 UI 组件检查清单

- [ ] 用工厂函数（`createDropdown` / `createFilterBar`）还是自己写？
  - 有现有工厂 → 用工厂。没有 → 自己写，考虑是否可以抽象成新的工厂
- [ ] 外部输入是否 escHtml/escAttr？
- [ ] 缩放是否用 `--scale` calc？
- [ ] DOM 操作前是否检查元素存在？
- [ ] 局部刷新还是重建？—— 重建仅当视图结构变化时（新增/删除区块），否则局部刷新
- [ ] 是否有动画？是否用 GSAP？
- [ ] 响应式：1000px 以下不崩、1920px 以上不太空？
  - 确认 `min-width` / `max-width` / `auto-fill` 行为合理
- [ ] 颜色/间距/圆角/阴影是否用了 `var(--xxx)` token，没写死值？
  - 背景 → `var(--bg-*)`，文字 → `var(--fg-*)`，边框 → `var(--border)`
  - 圆角 → `var(--radius-*)`，间距 → `var(--space-*)`，阴影 → `var(--shadow-*)`
  - 语义色（成功/错误等）→ `var(--success)` / `var(--error)` / `var(--warning)`
