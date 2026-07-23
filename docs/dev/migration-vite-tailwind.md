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

### Phase 2 — Tailwind 迁移

**目标**：模板字符串 class 逐步替换，CSS 文件逐步缩减

```
Step 2.1  安装 Tailwind + PostCSS
          配置 tailwind.config.js（主题色映射到 CSS 变量）

Step 2.2  逐视图替换 class
          从 detail.css 开始（999 行，最小，练习）
            替换示例：
              anime-card-cover  →  w-full aspect-[3/4] object-cover rounded
              anime-card-title  →  text-sm font-semibold text-zinc-200 truncate
          依次：detail → components → mylist → discovery → dashboard

Step 2.3  删除已迁移视图的 CSS
          每个视图替换完后，删掉对应的 CSS 规则
          用 npm run build 检查没有 class 丢失

Step 2.4  收尾
          删掉 public/css/ 目录（或移到备份）
          只剩一个 style.css（~200 行，放动画/复杂布局）
```

**可停点** ✅ 已获得：utility-first、CSS 量降到最低、一致性锁死

**预计**：8-12 小时（逐视图）

---

### Phase 3 — 收尾检测

```
Step 3.1  所有视图过一遍，截图对比迁移前后
Step 3.2  npm run build → 产物大小确认（预期 JS ~50KB, CSS ~15KB）
Step 3.3  更新 Tauri 配置指向新构建路径
Step 3.4  提交，删旧分支
```

---

## 为什么是 Tailwind 不是 UnoCSS

- UnoCSS 能直接吃现有 CSS 变量，迁移初期省事
- 但单维护者项目，Tailwind 的生态文档 / 社区资源 / 长期维护性更可靠
- 颜色通过 `bg-[var(--bg-elevated)]` 语法引用 CSS 变量，12 套主题完全不变

## 阶段间时间

| Phase | 内容 | 预计 |
|-------|------|------|
| 1 | Vite + ESM | 3-5 小时 |
| 2 | Tailwind 替换 | 8-12 小时 |
| 3 | 收尾 | 1 小时 |
