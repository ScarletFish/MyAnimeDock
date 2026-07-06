# 功能开发检查清单

每个功能开发必须过的检查清单。确保质量和效率的平衡。

---

## 开始前

- [ ] 理解用户意图，补充具体细节
- [ ] **列出完整需求确认表**（表格形式）
- [ ] **使用 question 工具让用户确认和补充**（必须！）
- [ ] 根据反馈调整后再次确认
- [ ] **用户最终确认后才开始实现**
- [ ] 验收标准已明确（至少 3 条可测试标准）
- [ ] 边界情况已列出
- [ ] 影响范围已评估

## 实现中

### 后端开发
- [ ] 使用 `node scripts/generate-tests.js <module>` 生成测试骨架
- [ ] 核心测试用例已实现
- [ ] 每个 commit 都通过 pre-commit 检查

### 前端开发
- [ ] 纯函数提取到 `public/js/utils.js`（如适用）
- [ ] 在 `public/__tests__/` 添加单元测试
- [ ] 每个 commit 都通过 pre-commit 检查

## 完成后

### 测试验证
- [ ] 后端测试通过：`cd server && npm test`
- [ ] 前端单元测试通过：`npm run test:frontend`
- [ ] E2E 测试通过（如适用）：`npm run test:e2e`
- [ ] 快照测试通过（如修改了核心模块）

### 代码质量
- [ ] 所有验收标准已通过
- [ ] 无新增 lint 警告
- [ ] 代码符合项目规范（命名、缩进、错误处理）
- [ ] 无安全漏洞（XSS、注入等）

### 文档更新
- [ ] AGENTS.md 已更新（如有新命令/端点/架构变更）
- [ ] 需求模板中的验收标准已全部打勾

---

## 快速命令参考

```bash
# 后端测试
cd server && npm test

# 前端单元测试
npm run test:frontend

# E2E 测试
npm run test:e2e

# 生成测试骨架
node scripts/generate-tests.js server/scanner.js

# 更新快照
set UPDATE_SNAPSHOTS=1 && cd server && node --test __tests__/*.test.js

# Pre-commit 检查（自动运行，无需手动执行）
git commit  # 会自动触发 lint-staged
```

---

## 时间估算

| 阶段 | 估算时间 | 说明 |
|------|----------|------|
| 需求模板 | 5-10 分钟 | 填写模板，明确边界 |
| 代码探索 | 10-15 分钟 | 使用 code-explorer skill |
| 架构设计 | 10-15 分钟 | 使用 code-architect skill |
| 实现 + 测试 | 30-60 分钟 | 根据复杂度而定 |
| 质量审查 | 10-15 分钟 | 使用 code-reviewer skill |
| **总计** | **65-115 分钟** | 一个中等复杂度功能 |

---

## 常见问题

### Q: 需求模板太长，可以简化吗？
A: 对于简单 bug 修复，只需填写"一句话描述"和"验收标准"。对于新功能，建议完整填写。

### Q: 每次都要运行所有测试吗？
A: 不必。根据修改范围选择：
- 修改 server/*.js → 运行 `cd server && npm test`
- 修改 public/*.js → 运行 `npm run test:frontend`
- 修改核心模块 → 运行快照测试
- 修改 UI → 运行 E2E 测试

### Q: Pre-commit hook 太慢怎么办？
A: lint-staged 只检查暂存文件，通常 <5 秒。如果仍然太慢，可以临时跳过：
```bash
git commit --no-verify  # 不推荐，仅紧急情况
```

### Q: 测试失败了怎么办？
A: 
1. 查看错误信息，定位问题
2. 修复代码或更新测试预期
3. 重新运行测试确认通过
4. 如果是快照测试，使用 `UPDATE_SNAPSHOTS=1` 更新基准
