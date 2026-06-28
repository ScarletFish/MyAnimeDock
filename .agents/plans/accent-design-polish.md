# Accent & Design Polish Plan

## 目标
提高强调色在各组件中的存在感，提升整体 UI 设计质感，修复主题变量硬编码残留。

## 阶段

### Phase 1 — 硬编码清理（P0）
**投入**: 低 | **效果**: 主题一致性

- 将所有 `rgba(225, 58, 90, ...)` 硬编码替换为 `--accent-glow`（带对应透明度）
- 将所有 `#fff` 在彩色背景上的硬编码替换为 `--fg-primary`
- 将 `#a855f7` 等硬编码替换为 `--accent-secondary`
- 涉及文件: `public/styles.css`

### Phase 2 — 导航 & 滚动条强调色（P1）
**投入**: 低 | **效果**: 导航反馈感 + 细节质感

- 侧边栏 nav-btn hover 时 SVG 图标颜色变为 `var(--accent)`
- 滚动条 thumb 背景改为 `var(--accent)` 带透明度
- 涉及文件: `public/styles.css`

### Phase 3 — 卡片 & 进度条增强（P2）
**投入**: 中 | **效果**: 卡片层次感 + 进度视觉

- anime-card 底部加 2px `--accent-gradient` 细线（类似 settings-tab::after）
- episode-progress-fill 使用 `--accent-gradient` 渐变填充
- 涉及文件: `public/styles.css`

### Phase 4 — 空状态 & 详情页氛围（P3）
**投入**: 中 | **效果**: 体验完整度 + 沉浸感

- 空状态（搜索无结果等）加淡色强调色图标或渐变边框
- 详情页 hero 封面底部加 `--accent-glow` 径向渐变光晕
- 涉及文件: `public/styles.css`, `public/js/library.js`, `public/js/detail.js`

### Phase 5 — 模态框 & 标题装饰（P3）
**投入**: 低 | **效果**: 界面精致度

- modal h2 加 `--accent` 左边框或下划线指示器
- 全局标题 `letter-spacing: -0.02em` 微调
- 涉及文件: `public/styles.css`

---

## 执行规则

1. 每个 Phase 完成后汇报: "根据本地计划，已完成 Phase X 的 xx 内容"
2. 每个 Phase 完成后提交 git commit
3. 用户批准后再进入下一 Phase
4. 如用户要求调整方向，更新本计划文件后再执行
