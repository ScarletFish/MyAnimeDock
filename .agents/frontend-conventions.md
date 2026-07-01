# MyAnimeDocker Frontend 编码约定

Vanilla JS SPA，无构建步骤，无框架。

---

## 1. 文件组织

```
public/
├── index.html          # 入口：加载所有 CSS + JS
├── styles.css          # 设计 token + 全局基础样式（目标 ~1,000 行）
├── css/
│   ├── components/     # 组件级 CSS（card、modal、toast、nav...）
│   └── views/          # 视图级 CSS（discovery、library、mylist、detail）
├── vendor/gsap/        # GSAP 库（从 node_modules 拷贝）
└── js/
    ├── ui.js           # 共享渲染层：renderAnimeCard()、renderModal()、escHtml() 等
    ├── api.js          # fetch 封装（API.get / API.post / API.del）
    ├── app.js          # 路由、主题、AppState、toast、设置页
    ├── discovery.js    # 发现/扫描视图
    ├── library.js      # 资料库视图
    ├── detail.js       # 详情视图（含 GSAP 动画）
    ├── detail-hero.js  # （可选拆分）GSAP Flip 封面动画
    ├── mylist.js       # MyList 视图
    ├── metamatch.js    # 批量元数据匹配工作台
    └── memory.js       # 观看记录归档
```

## 2. 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 变量/函数 | `camelCase` | `renderLibrary()`, `libraryData` |
| 全局常量 | `UPPER_SNAKE_CASE` | `GRID_BASE_SIZE`, `MAX_GRID_HEIGHT` |
| CSS 类名 | `kebab-case` | `.anime-card`, `.mylist-badge` |
| CSS 自定义属性 | `--kebab-case` | `--space-4`, `--radius-md` |
| HTML `data-*` 属性 | `camelCase` | `data-userToggled`, `data-theme` |
| 文件名 | `kebab-case` | `detail-heatmap.js` |

## 3. 渲染原则

### 3.1 优先使用 `ui.js` 的共享渲染函数

```js
// ✅ 正确：使用共享组件
import { renderAnimeCard } from './ui.js';
grid.innerHTML = items.map(item => renderAnimeCard(item, 'library')).join('');

// ❌ 避免：在视图中重复构造卡片 HTML
grid.innerHTML = items.map(item => `
  <div class="anime-card" onclick="...">
    ...
  </div>
`).join('');
```

### 3.2 渲染函数命名

- `renderXxx()` — 渲染主视图/模块（如 `renderLibrary()`）
- `renderXxxCard()` — 渲染单张卡片（如 `renderAnimeCard()`）
- `renderXxxList()` — 渲染列表
- `buildXxxHtml()` — 构建复杂 HTML 片段，不直接操作 DOM

### 3.3 XSS 防护

**所有用户数据必须转义。** 使用 `ui.js` 中的 `escHtml()` / `escAttr()`：

```js
// ✅ 正确
`<h3>${escHtml(anime.title)}</h3>`
`<img alt="${escAttr(anime.title)}">`

// ❌ 错误：直接插值用户数据
`<h3>${anime.title}</h3>`
```

规则：
- **文本内容**（`innerHTML` / 模板字符串中的文本）→ `escHtml()`
- **HTML 属性值**（`alt="..."`、`data-id="..."`）→ `escAttr()`
- **URL**（`src="..."`）→ 确保不含 `javascript:` 协议，用 `escAttr()` 包裹

### 3.4 DOM 操作

```js
// ✅ 正确：批量设置 innerHTML（主渲染路径）
grid.innerHTML = html;

// ✅ 正确：极少数动态交互用 createElement
const badge = document.createElement('span');
badge.className = 'mylist-badge';
badge.textContent = '已看完';

// ❌ 避免：频繁单节点 innerHTML 操作
el.innerHTML = '<span class="badge">新</span>';
```

## 4. 事件处理

### 4.1 主交互使用 `onclick` 属性

与项目现有模式一致。按钮、卡片点击等**用户可见的交互**使用 `onclick`：

```js
`<button onclick="handleAction('${id}')">操作</button>`
`<div class="anime-card" onclick="navigateToDetail('${id}', this)">`
```

### 4.2 复杂交互使用 `addEventListener`

以下场景必须用 `addEventListener`：

- 动态渲染的列表项（如热力图的每个方格）
- 键盘事件（`keydown`、`keyup`）
- 窗口/滚动事件（`resize`、`scroll`）
- GSAP ScrollTrigger 或类似动画回调

```js
// ✅ 正确：动态渲染元素用 addEventListener
grid.addEventListener('click', (e) => {
  const card = e.target.closest('.anime-card');
  if (card) handleCardClick(card.dataset.id);
});
```

### 4.3 事件委托优先

对于列表/网格等同类元素集合，优先在父容器上使用事件委托：

```js
// ✅ 正确：事件委托
grid.addEventListener('click', (e) => {
  const btn = e.target.closest('.card-more-btn');
  if (btn) toggleStatusPopover(e, btn.dataset.id);
});

// ❌ 避免：每个元素绑定独立事件
items.forEach(item => {
  btn.onclick = () => handleClick(item.id);
});
```

## 5. 状态管理

### 5.1 统一通过 `AppState` 读写

`AppState` 定义在 `app.js` 中，各文件通过它读取/写入跨视图状态：

```js
// app.js
const AppState = {
  library: { data: [], filter: '', sort: 'default' },
  discovery: { data: [], filterMode: 'all', checked: null },
  detail: { anime: null, isArchive: false, isWishlist: false },
  mylist: { data: [], status: 'watching' },
  ui: { theme: 'default', themeMode: 'dark', scale: 1 }
};
```

### 5.2 文件级私有变量

**视图内部状态**（如滚动位置、定时器句柄）仍可作为文件级变量存在：

```js
// library.js — 正确：视图私有状态
let libraryScrollTop = 0;
let cardScrollTrigger = null;
```

### 5.3 跨文件通信

使用 `CustomEvent` 而非直接调用对方函数：

```js
// 发送
document.dispatchEvent(new CustomEvent('animeimported', { detail: { id } }));

// 接收
document.addEventListener('animeimported', (e) => {
  refreshLibrary(e.detail.id);
});
```

## 6. CSS 约定

### 6.1 使用设计 Token

**禁止直接使用 magic number。** 一律使用 `--space-*`、`--radius-*`、`--color-*` 等 CSS 变量：

```css
/* ✅ 正确 */
.card { padding: var(--space-4); border-radius: var(--radius-md); }

/* ❌ 错误：硬编码值 */
.card { padding: 16px; border-radius: 8px; }
```

可用 token 参考 `styles.css` 的 `:root` 定义。

### 6.2 缩放兼容

**所有 font-size 和间距必须乘以 `--scale`。** 通过 token 系统自动继承：

```css
/* ✅ 正确（通过 token 自动缩放） */
.title { font-size: calc(1.25rem * var(--scale)); }
.card { padding: var(--space-4); }

/* ❌ 错误：没有缩放 */
.title { font-size: 20px; }
```

例外（不缩放的值）：`z-index`、`opacity`、无单位 `line-height`、`vw`/`vh`/`%`、`deg`、`s`/`ms`。

### 6.3 新样式文件位置

| 范围 | 位置 |
|------|------|
| 全局 token + 基础 | `styles.css` |
| 组件级（card/modal/toast） | `css/components/*.css` |
| 视图级（discovery/library） | `css/views/*.css` |
| 主题（dock 选择器） | `css/themes/*.css` |

### 6.4 主题兼容

```css
/* 所有颜色值通过 CSS 变量引用，不写死色值 */
.card { background: var(--bg-card); color: var(--fg-primary); }
```

## 7. GSAP 约定

- 所有 GSAP 动画统一在 `detail.js`（及可选的 `detail-hero.js`）中
- 使用 `gsap.registerPlugin(Flip)` — 已注册
- `onComplete` 回调中不删除 `detail-enter-active` class（由 `resetDetailEnter()` 在下次导航时清理）
- GSAP 操作 DOM 时，不使用 `loading="lazy"` 或 `decoding="async"` 在动画封面上（会导致闪白）

## 8. 注释格式

```js
// 单行注释：解释为什么这样做，而非做了什么
function renderLibrary() {
  // 只显示 "当前观看" 状态的条目作为主视图
  let filtered = libraryData.filter(a => a.myListStatus === 'watching');
```

```js
/* ─── 分区标题 ─── */
// 用于文件内的功能分区
```

## 9. 错误处理

所有 `async` 函数必须有 `try/catch`：

```js
async function loadLibrary() {
  try {
    libraryData = await API.get('/api/library');
    renderLibrary();
  } catch (e) {
    if (window.location.origin !== 'http://localhost:3456') return; // Tauri 静默
    showToast('加载失败: ' + e.message);
  }
}
```

## 10. 代码审查 checklist

每次提交前，对照以下清单：

- [ ] 所有用户数据已用 `escHtml()` / `escAttr()` 转义
- [ ] 没有硬编码色值、间距、圆角（已使用 CSS token）
- [ ] 新 CSS 放在正确模块文件，而非全部塞入 `styles.css`
- [ ] `async` 函数有 `try/catch`
- [ ] 动画封面没有 `loading="lazy"` 或 `decoding="async"`
- [ ] 复用场景优先使用 `ui.js` 的共享函数
- [ ] 没有遗留的 `console.log()` 调试语句
