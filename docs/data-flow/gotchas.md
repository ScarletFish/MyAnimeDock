# Gotchas

拆分散到各子文件后的跨领域陷阱。每类陷阱见对应子文件的 `Gotchas` 节。

| 陷阱 | 涉及领域 | 详见 |
|------|---------|------|
| `process.exit(0)` 跳过 `server.close()` | 退出行为 | `AGENTS.md` Gotchas |
| 封面路径迁移后不存在 | Covers | `startup-config.md` |
| Bangumi API fetch 在 pkg 中需 polyfill | Metadata | `import-metadata.md` |
| CSS `--scale` 禁止 `zoom` | UI | `docs/dev/frontend.md` |
| anilistId 唯一性冲突处理 | DB | `save-taxonomy.md` |
| AniList 搜索前 toHiragana() 归一化 | Sync | `import-metadata.md` |
| SSE-only MetaMatch（无 batch fallback） | Sync | `docs/data-flow.md` hub |
| mpv error 传播用 Promise 2s timeout | Playback | `play-sessions.md` |
| Data/nodemon 忽略路径 | Dev | `docs/dev/backend.md` |
| 单实例保护必须 Cargo 依赖 + main.rs plugin 注册 | Desktop | `src-tauri/src/main.rs` |
| 前端 origin 检测必须 `startsWith('http')` 而非硬编码端口 | Frontend | `frontend/src/js/*.js` |
| `core.json` remote URLs 必须通配端口（`localhost:*`） | Desktop | `src-tauri/capabilities/core.json` |
