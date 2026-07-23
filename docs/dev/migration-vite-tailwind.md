# Vite + ESM + Tailwind 迁移计划

## 背景

7125 行手写 CSS, 30 个 JS 全局变量, 无构建工具。随项目增长，样式一致性和开发效率持续下降。
当前阶段 (功能基本完成) 是框架化的最佳窗口。

## 目标

- **Vite** — 开发 HMR, 生产构建压缩
- **ESM** — import/export 替代全局变量 + script 顺序锁
- **Tailwind** — utility-first 消除样式不一致，CSS 从 7125 行降到 ~15KB
- 项目结构从仓库根目录散放 → `frontend/src/` 统一源码目录

## 三阶段计划

### Phase 1 — Vite + ESM

**目标**：HMR 跑起来、JS 模块化、CSS 原封不动

```
Step 1.1  npm create vite frontend --template vanilla
          只取骨架配置，不删现有文件

Step 1.2  迁移目录结构
          public/js/*.js    →  frontend/src/
          public/css/*.css  →  frontend/src/css/
          public/index.html →  frontend/index.html（改 script/link 路径）

Step 1.3  JS → ESM 转换
          给每个 .js 文件加 export
          在 main.js 里 import 所有模块
          理顺可能的循环依赖
          删除 index.html 里 30 个 <script>，只剩 1 个

Step 1.4  验证 HMR
          npm run dev 跑起来，改一行代码看自动刷新

Step 1.5  build 验证
          npm run build → dist/ 输出
          Tauri 指向 dist/ 作为前端资源
```

**可停点** ✅ 已获得：HMR、模块化、单文件构建

**预计**：3-5 小时

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
