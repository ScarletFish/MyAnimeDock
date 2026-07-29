# MyAnimeDock

Vanilla JS SPA + Node.js HTTP server + Tauri v2 desktop shell. 自托管动漫媒体库管理器。

## Workflow

完整流程见 `docs/dev/workflow.md`（6 阶段）。**禁止跳过阶段直接写代码**。

方向判断 → 前置研究 → 需求确认 → 实现 → 测试 → 审查+报告

| 场景 | 行为 |
|------|------|
| 需求不明确 | `skill("req-implement-test")` |
| **定位文件/文件结构** | **读 `docs/file-structure.md`** |
| 数据流/API/模型 | 读 `docs/data-flow.md` 选子文件 |
| 探索代码路径 | 读 `docs/code-explorer.md` |
| 新功能设计 | `skill("code-architect")` |
| 代码审查（仅非平凡） | `skill("code-reviewer")` |
| 安全审查（外部输入） | `skill("security-review")` |
| 测试编写 | 读 `docs/dev/testing.md` |

## Commands

```bash
npm run dev:server:watch   # 开发后端 (nodemon)
npm run dev:frontend       # 开发前端 (Vite HMR)
npm run dev:tauri          # 全开 (server + Vite + Tauri 窗口)
npm run dev                # server + Vite (无 Tauri)
npm run build:frontend     # 构建前端到 dist/（改 CSS/JS 后必须）
npm run build              # MSI/NSIS 安装包
npm run check:rust         # Rust 类型检查 (~20s)
npm run prisma:migrate     # DB 迁移
npm run prisma:generate    # 重生成 Prisma
cd server && npm test      # 测试
```

## Gotchas

- **DATA_DIR**: dev=`server/`, pkg=`%APPDATA%/MyAnimeDock`
- **动漫 ID**: `String(bangumiId)` 主键；手动导入 `parsedTitle + Season`
- **播放器**: 仅 mpv（`--input-ipc-server` IPC）
- **自动标记前集**必须 `db.updateEpisodesWatched()` 落盘
- **window.close() 无效**: 需 Rust `window.close()` 或 `__TAURI__` IPC
- **缩略图**: 依赖 ffmpeg PATH，首次延迟
- **封面路径**: `localCover` 绝对路径，迁移 DATA_DIR 后可能不存在
- **无认证**: `/api/quit` 局域网可关服
- **CSS *禁止* `zoom`**: 用 `--scale` calc（详见 `docs/dev/frontend.md`）
- **`node --check` 必须**: Vite `concatJsPlugin` 跳过语法校验，改任意 `.js` 后必须 `node --check frontend/src/js/xxx.js`
- **构建前端**: 改 `frontend/src/` 下 JS/CSS 后需 `npm run build:frontend` 更新 `frontend/dist/`（服务器生产模式从 `dist/` 读）
- **CSS 子文件结构**: 勿改 `styles.css`（仅入口）；视图样式放 `views/*.css`，小组件用 `@utility` 放 `patterns.css`，主题特有放 `layouts/` 和 `components/`
- **Grid 列公式**: 在 `library.js` 的 `GRID_CARD_MIN`/`GRID_CARD_MAX`，不通过 CSS utility 控制
- **mpv-status**: 不轮询 — `EventSource` 监听 `/api/events/mpv-status`，DB 落盘仅 `final` 事件

## 验证层级

| 层级 | 耗时 | 命令 | 场景 |
|------|------|------|------|
| 0 | ~20s | `npm run check:rust` | Rust 类型 |
| 1 | 秒级 | `npm run dev:server:watch` | JS 改动 |
| 2 | ~1min | + `npm run dev:tauri` | Rust 改动 |
| 3 | ~5min | `npm run build` | 打包 |

> 后端/前端/测试规范见 `docs/dev/{backend,frontend,testing}.md`
