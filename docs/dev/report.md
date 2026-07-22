# 变更报告格式 — Report

功能开发/修 bug 完成后，作为阶段 5 的输出。格式清晰固定，便于后续 review 和 changelog 生成。

## 报告模板

```markdown
## 变更总结

### 动机
[一句话说明为什么做这个改动]

### 改动范围
- **文件**：N 个（X backend + Y frontend）
- **新增**：+XXX 行
- **删除**：-XXX 行
- **核心逻辑**：[摘要描述改动内容]

### 文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `server/routes/xxx.js` | 新增/修改/删除 | [简要说明] |
| `public/js/xxx.js` | 修改 | [简要说明] |

### 测试结果
- `node --test __tests__/xxx.test.js` — N/N pass（xxx ms）
- `cd server && npm test` — N/N pass（xxx ms，如跑了全量）

### 文档更新
- [ ] `docs/data-flow.md` — API/数据模型变更时更新
- [ ] `docs/code-explorer.md` — scanner/架构变更时更新
- [ ] `docs/dev/workflow.md` — 流程变更时更新
- [ ] 其他：[说明]

### 待解决问题
[如有遗留事项、已知限制、后续优化方向]

### 回归验证
- [ ] 服务器启动正常
- [ ] 库加载正常
- [ ] 搜索/筛选正常
- [ ] 播放正常
- [ ] 元数据同步正常（如相关）
```

## 填写指南

### 改动范围行数

```bash
git diff --stat
# 或对 unstaged:
git diff --stat HEAD
```

### 文件说明

每行一个文件，只说"做了什么"：

```
| `server/db.js` | 修改 | 新增 batchUpdateEpisodesWatched() 批量标记观看 |
```

### 测试结果截取

```
Test files: 1 passed, 1 total
Tests: 25 passed, 25 total
```

### 文档更新

只勾选实际更新的文档。没有就不勾。

### 待解决问题

只在确实有遗留问题时写。例如：

```
- 批量标记时缺少 loading indicator，下次迭代补
- edge case：空库标记全量时的性能未验证
```

### 回归验证

至少勾选与改动关联的项。小改动可以只勾 1-2 项。

## 适用场景

- 任何按完整工作流完成的功能开发或 bug 修复
- 纯代码库清理（删死代码、重构）可以简化为文件清单 + 测试结果
- 纯文档更新不需要此报告
