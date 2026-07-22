# MyAnimeDock

Vanilla JS SPA + Node.js HTTP server + Tauri v2 desktop shell. 自托管动漫媒体库管理器。

## Workflow

完整流程见 `docs/dev/workflow.md`（6 阶段）。**禁止跳过阶段直接写代码**。

方向判断 → 前置研究 → 需求确认 → 实现 → 测试 → 审查+报告

| 场景 | 行为 |
|------|------|
| 需求不明确 | `skill("req-implement-test")` |
| 数据流/API/模型 | 读 `docs/data-flow.md` 选子文件 |
| 探索代码路径 | 读 `docs/code-explorer.md` |
| 新功能设计 | `skill("code-architect")` |
| 代码审查（仅非平凡） | `skill("code-reviewer")` |
| 安全审查（外部输入） | `skill("security-review")` |
| 测试编写 | 读 `docs/dev/testing.md` |

## Commands

```bash
npm run dev:server:watch   # 开发 (nodemon)
npm run dev:tauri          # Tauri 窗口 (先跑 server)
npm run dev                # 全开
npm run build              # MSI/NSIS 安装包
npm run check:rust         # Rust 类型检查 (~20s)
npm run prisma:migrate     # DB 迁移
npm run prisma:generate    # 重生成 Prisma
cd server && npm test      # 222 tests
```

## Gotchas

- **DATA_DIR**: dev=`server/`, pkg=`%APPDATA%/MyAnimeDock`
- **动漫 ID**: `String(bangumiId)` 主键；手动导入 `parsedTitle + Season`
- **播放器**: 仅 mpv（`--input-ipc-server` IPC）
- **自动标记前集**必须 `db.updateEpisodesWatched()` 落盘
- **window.close() 无效**: 需 Rust `window.close()` 或 `__TAURI__` IPC
- **Tauri 开发**: sidecar 不自动启动，手动先跑 server
- **缩略图**: 依赖 ffmpeg PATH，首次延迟
- **封面路径**: `localCover` 绝对路径，迁移 DATA_DIR 后可能不存在
- **无认证**: `/api/quit` 局域网可关服
- **CSS *禁止* `zoom`**: 用 `--scale` calc（详见 `docs/dev/frontend.md`）

## 验证层级

| 层级 | 耗时 | 命令 | 场景 |
|------|------|------|------|
| 0 | ~20s | `npm run check:rust` | Rust 类型 |
| 1 | 秒级 | `npm run dev:server:watch` | JS 改动 |
| 2 | ~1min | + `npm run dev:tauri` | Rust 改动 |
| 3 | ~5min | `npm run build` | 打包 |

> 后端/前端/测试规范见 `docs/dev/{backend,frontend,testing}.md`
