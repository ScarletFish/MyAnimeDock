# 前端开发规范 — Frontend

## 架构概要

无构建 vanilla HTML/CSS/JS SPA。GSAP 作为唯一动画库。

### 加载顺序（严格依赖）

```
state.js → debug.js → ui.js → api.js → components.js
    → discovery.js → library.js → detail-stats.js
    → detail-nav.js → detail.js → mylist.js → metamatch.js
    → stats.js → titlebar.js → app.js → search.js
    → onboarding.js → keyboard.js
```

`index.html` 中 `<script>` 标签顺序必须与此一致。打破依赖可能导致 `undefined` 引用。

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
