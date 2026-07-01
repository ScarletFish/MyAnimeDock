# MyAnimeDocker Frontend 规范化路线图

## 背景

前端现状：3,837 行 JS（8 个文件）+ 5,390 行 CSS（1 个文件）。
Vanilla JS SPA，无框架、无构建步骤。项目核心理念不改变。

---

## 执行原则

1. **增量进行** — 每次修改一个视图时顺便迁移，不搞大爆炸重构
2. **每阶段可独立交付** — 每个 Phase 完成后可正常工作，不依赖后续阶段
3. **修改前先通读** — 涉及已有代码时，先用 `skill("code-explorer")` 理解执行路径
4. **质量门禁** — 每个 Phase 完成后使用对应 skill 审查：
   - `skill("code-reviewer")` — 代码质量
   - `skill("web-design-guidelines")` — 可访问性（Phase 2 起）
5. **用户批准进入下一 Phase**

---

## Phase 0 — 共享渲染层（`ui.js`）

**投入**: 低（半日） | **效果**: 消除 3 份卡片重复代码

### 目标

创建 `public/js/ui.js`，抽取当前散落的重复代码：

| 函数 | 替代内容 | 来源 |
|------|----------|------|
| `renderAnimeCard(anime, mode)` | library/discovery/mylist 三份卡片模板 | `library.js:149-175` |
| `renderGrayCover()` | 多处内联的灰色占位 SVG | `library.js:162` |
| `escHtml(str)` / `escAttr(str)` | 各文件中的重复辅义函数 | 集中到一处 |

### 步骤

1. 创建 `public/js/ui.js`，实现以上函数
2. 修改 `public/index.html` 添加 `<script src="js/ui.js">`（在其它 JS 之前）
3. 修改 `library.js` 使用 `renderAnimeCard()` → 测试
4. 修改 `discovery.js` 使用 `renderAnimeCard()` → 测试
5. 修改 `mylist.js` 使用 `renderAnimeCard()` → 测试
6. (可选) 抽取 `renderModal()` — 如果当前有模态框修改需求

---

## Phase 1 — CSS 模块化拆分

**投入**: 中（1-2 天） | **效果**: 样式可维护性提升

### 目标

将 `styles.css`（5,390 行）拆分为：

```
styles.css             → 设计 token + 全局基础（~800 行）
css/components/        → 组件级样式
  card.css             →   anime-card, overlay, badge 等
  modal.css            →   弹窗相关
  toast.css            →   toast 通知
  nav.css              →   侧边栏导航
  detail.css           →   详情页组件（episode-grid, heatmap, stats）
css/views/             → 视图级样式
  discovery.css
  library.css
  mylist.css
  memory.css
  metamatch.css
```

### 步骤

1. 创建 `public/css/` 目录及子目录
2. 逐个阶段移动：先移动独立性强的新组件 CSS
3. 每次只动一部分，改完立即 F5 验证
4. 每个移动完成后 grep 确认无遗漏引用
5. 最后清理 `styles.css` 中未使用的 token（如 `--space-16`）

---

## Phase 2 — 状态层统一

**投入**: 低（半日） | **效果**: 跨文件状态可追踪

### 目标

在 `app.js` 中建立统一 `AppState` 对象，替代各文件的独立全局变量。

### 步骤

1. 在 `app.js` 中创建 `AppState` 对象（现有雏形增强）
2. 逐步迁移各文件使用 `AppState.xxx.data` 而非独立变量
3. 加 `CustomEvent` 事件总线用于跨文件通信

---

## Phase 3 — Modal 组件化

**投入**: 低（半日） | **效果**: 弹窗体验统一

### 步骤

1. 抽取 `renderModal(id, title, content, actions)` 到 `ui.js`
2. 改造 `#syncModal`、`#memoryModal`、设置弹窗为统一模板
3. 统一关闭行为（点击遮罩层关闭 + ✕ 按钮 + Escape 键）

---

## Phase 4 — detail.js 可选拆分

**投入**: 中（1 天） | **效果**: 单文件从 1,194 行缩减

### 目标（可选，遇到 detail 修改时做）

```
detail.js       → 主渲染 + 导航（~400 行）
detail-hero.js  → GSAP Flip 封面动画（~250 行）
detail-heatmap.js → 剧集热力图（~200 行）
detail-stats.js → Canvas 观看统计（~200 行）
```

### 条件

- **仅在**有 detail.js 修改需求时执行
- 拆分后确保 GSAP `registerPlugin(Flip)` 仍只注册一次

---

## Phase 5 — 持续质量门禁

**投入**: 持续 | **效果**: 长期代码质量

### 流程

```
修改代码 → F5 验证 → skill("code-reviewer") → skill("web-design-guidelines") → commit
```

### 本地 skill 使用场景

| 场景 | skill | 执行时机 |
|------|-------|----------|
| 可访问性审计 | `web-design-guidelines` | 新视图/组件完成后 |
| 代码审查 | `code-reviewer` | 每次阶段性提交前 |
| UI 视觉打磨 | `frontend-design` | 用户要求提升设计品质时 |
| CSS token 合规 | 手动 grep | 每次 CSS 修改后 |

---

## 优先级汇总

```
优先级  阶段          预估时间     独立交付？
─────────────────────────────────────────────
P0     Phase 0        ~4 小时      ✅ 是（一创建就能用）
P0     Phase 1        ~8 小时      ✅ 是（每次拆分后都可正常浏览）
P1     Phase 2        ~4 小时      ✅ 是（渐进替换，不阻塞其他功能）
P2     Phase 3        ~4 小时      ⚠️ 依赖 Phase 0（ui.js）
P3     Phase 4        ~8 小时      ✅ 是（本质只是文件拆分）
持续    Phase 5        —           ✅ 是（可随时开始/暂停）
```

---

## 执行记录

### Phase 0 ✅
- [x] 创建 `public/js/ui.js` (renderAnimeCard, escHtml/escAttr, renderGrayCover, STATUS_LABELS, openModal/closeModal)
- [x] 更新 `index.html` 加载 ui.js
- [x] library.js → 使用 `renderAnimeCard()`
- [x] discovery.js → 跳过（列表布局不适用）
- [x] mylist.js → 使用 `renderAnimeCard()`
- [x] app.js 清理重复 escHtml/escAttr/path

### Phase 1 ✅
- [x] 创建 `public/css/` — components.css, detail.css, views.css, light.css
- [x] styles.css 浓缩为 881 行（token + 全局基础 + 主题）
- [x] components.css (1,282 行)：按钮/卡片/模态框/设置/etc
- [x] detail.css (1,046 行)：导航/封底/信息面板/热力图/统计
- [x] views.css (1,821 行)：各视图独立样式
- [x] light.css (320 行)：浅色模式覆写
- [x] 清理 8 个未使用 token

### Phase 2 ✅
- [x] 创建 `public/js/state.js` — AppState 类 (get/set/on + CustomEvent)
- [x] memory.js 消除 4 个隐式全局变量
- [x] app.js goBack() 迁移到 AppState
- [x] mylist.js detailSourceView → AppState
- [x] detail.js 添加 AppState.on() 订阅同步
- [x] index.html 添加 state.js 加载

### Phase 3 ✅
- [x] ui.js 中实现 openModal()/closeModal() + 事件委派初始化
- [x] 改造 4 个弹窗：memory editor, sync modal, settings, metamatch
- [x] 移除 inline overlay onclick
- [x] 统一关闭行为：遮罩层 + ✕ + Escape

### Phase 4 ✅
- [x] 创建 detail-stats.js (renderEpisodeHeatmap, renderWatchStats)
- [x] 创建 detail-nav.js (initDetailNav, goPrev/goNext, slideToAnime)
- [x] detail.js 从 1,346 → 822 行
- [x] index.html 添加新 script 标签
