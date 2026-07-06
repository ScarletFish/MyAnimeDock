---
name: req-implement-test
description: Complete requirements-implementation-testing workflow. Streamlines feature development with structured templates, automated test generation, regression testing, and quality gates. Use when the user wants to build a feature methodically, needs to improve development efficiency, or asks about the project's development workflow.
---

# Requirements → Implementation → Testing Workflow

一套完整的需求-实现-测试流程，解决需求模糊、边界遗漏、测试效率低的问题。

## 核心理念

```
需求模板（想清楚）→ TDD 实现（边写边测）→ 回归测试（自动验证）
```

---

## Phase 0: 需求规范化

**目标**：在写代码前强制想清楚，减少返工。

### 重要原则

用户提出的需求往往是**模糊的**（如"加个图表"、"优化一下性能"）。AI 需要：
1. 理解用户的意图
2. 补充具体细节
3. **列出表格让用户确认**后再执行

### 必须执行的步骤

**Step 1: 理解意图**

从用户的模糊需求中提取核心意图，补充具体细节。

**Step 2: 列出完整需求确认表**

用表格形式呈现所有细节，然后通过 question 工具让用户逐项确认和补充：

```markdown
| 项目 | 我的理解 |
|------|----------|
| 功能描述 | xxx |
| 数据来源 | xxx |
| 展示形式 | xxx |
| 边界情况 | xxx |
| 验收标准 | xxx |
| 影响范围 | xxx |
| 非目标 | xxx |
```

**Step 3: 使用 question 工具交互确认**

把表格列出来后，用 question 工具让用户：
1. 确认每项是否正确
2. 补充遗漏的细节
3. 修改不满意的地方

```js
question({
  questions: [
    {
      question: "以上是我理解的需求，有什么需要改动的吗？",
      header: "需求确认",
      options: [
        { label: "没问题，开始实现", description: "确认所有细节正确" },
        { label: "需要修改", description: "告诉我哪里要改" }
      ]
    }
  ]
})
```

**Step 4: 根据用户反馈调整**

用户补充或修改后，更新表格，再次确认。

**Step 5: 执行**

用户最终确认后，再开始实现。

### 示例

用户说："在统计页面加个图表"

AI 应该：

**1. 列出完整表格**

> 理解你想在统计页面新增一个图表。我理解的是：
>
> | 项目 | 我的理解 |
> |------|----------|
> | 图表类型 | 南丁格尔玫瑰图（花瓣大小表示数量） |
> | 数据维度 | 按季度分组（春/夏/秋/冬） |
> | 数据来源 | Bangumi 元数据的首播日期 |
> | 展示位置 | 词云下方，独立卡片 |
> | 空数据处理 | 显示"暂无数据"占位 |
> | 验收标准 | 1. 正确分组 2. 主题适配 3. 响应式 |
> | 影响范围 | server.js, stats.js, index.html, styles.css |
> | 非目标 | 不做年份维度、不做交互筛选 |

**2. 用 question 工具确认**

```js
question({
  questions: [
    {
      question: "以上是我理解的需求，有什么需要改动的吗？",
      header: "需求确认",
      options: [
        { label: "没问题，开始实现", description: "所有细节都正确" },
        { label: "需要修改", description: "告诉我哪里要改" }
      ]
    }
  ]
})
```

**3. 根据反馈调整**

用户说"改成按年份分组" → 更新表格 → 再次确认

**4. 最终确认后执行**

### 不要做的事

- ❌ 用户说"加个图表"就直接开始写代码
- ❌ 自己决定所有细节不问用户
- ❌ 假设用户的需求意图

### 要做的事

- ✅ 先理解意图，补充细节
- ✅ 列出表格让用户确认
- ✅ 等用户说"可以"再执行

---

## Phase 1: 实现 + 同步测试（TDD 强制化）

**目标**：边写代码边写测试，确保每个功能点都有测试覆盖。

### 后端模块

1. **生成测试骨架**
   ```bash
   node scripts/generate-tests.js server/<module>.js
   ```

2. **审核生成的测试** — 补充具体业务数据

3. **实现功能代码**

4. **运行测试确认通过**
   ```bash
   cd server && npm test
   ```

### 前端模块

1. **提取纯函数** — 如果有可测试的纯逻辑，提取到 `public/js/utils.js`

2. **添加单元测试** — 在 `public/__tests__/` 创建测试文件

3. **运行前端测试**
   ```bash
   npm run test:frontend
   ```

### 边界情况处理

每个函数必须测试：
- 空字符串 `''`
- `null` / `undefined`
- 正常输入
- 错误路径（异常、null 返回）

---

## Phase 2: 回归测试

**目标**：确保改动没有破坏现有功能。

### 快照测试

对于核心模块（scanner、scrapers、db），使用快照测试：

```js
const { assertSnapshot } = require('./helpers/snapshot');

assertSnapshot(result, 'scanner/extractBgmId-valid.json');
```

更新快照：
```bash
set UPDATE_SNAPSHOTS=1 && cd server && node --test __tests__/*.test.js
```

### E2E 测试

对于 UI 改动，运行 E2E 测试：

```bash
npm run test:e2e
```

测试文件在 `e2e/` 目录，覆盖：
- 页面加载
- 导航切换
- 主题切换
- 设置保存

### 视觉回归

对于样式改动，运行视觉测试：

```bash
npm run test:e2e -- e2e/visual.spec.js
```

更新基准截图：
```bash
npm run test:e2e -- e2e/visual.spec.js --update-snapshots
```

---

## Phase 3: 质量审查

**目标**：确保代码质量。

### 运行所有测试

```bash
# 后端
cd server && npm test

# 前端
npm run test:frontend

# E2E（如适用）
npm run test:e2e
```

### 代码审查

使用 `code-reviewer` skill 检查：
- 简洁性 / DRY
- 功能正确性
- 项目规范

---

## 工具和命令速查

| 命令 | 用途 |
|------|------|
| `node scripts/generate-tests.js <module>` | 生成测试骨架 |
| `cd server && npm test` | 运行后端测试 |
| `npm run test:frontend` | 运行前端单元测试 |
| `npm run test:frontend:watch` | 前端测试 watch 模式 |
| `npm run test:e2e` | 运行 E2E 测试 |
| `npm run test:e2e:ui` | E2E 测试 UI 模式 |
| `npm run test:e2e:debug` | E2E 测试调试模式 |
| `set UPDATE_SNAPSHOTS=1 && cd server && node --test __tests__/*.test.js` | 更新快照 |
| `npm run test:e2e -- e2e/visual.spec.js --update-snapshots` | 更新视觉基准 |

---

## 文件结构

```
.agents/skills/
├── feature-dev/
│   ├── SKILL.md                    # 原有 7 阶段流程
│   └── REQUIREMENTS-TEMPLATE.md    # 需求模板
├── test-generator/
│   └── SKILL.md                    # 测试生成指南
└── req-implement-test/
    └── SKILL.md                    # 本文件

scripts/
├── generate-tests.js               # 测试生成脚本
└── check-frontend-syntax.js        # 前端语法检查

public/
├── js/utils.js                     # 可测试的纯函数
└── __tests__/
    └── utils.test.js               # 前端单元测试

server/__tests__/
├── helpers/
│   └── snapshot.js                 # 快照测试工具
├── snapshots/                      # 快照文件
├── scanner.test.js                 # 后端测试
├── scrapers.test.js
├── db.test.js
└── snapshot-demo.test.js           # 快照测试示例

e2e/
├── app.spec.js                     # E2E 测试
└── visual.spec.js                  # 视觉回归测试
```

---

## 时间估算

| 阶段 | 简单任务 | 中等功能 | 复杂功能 |
|------|----------|----------|----------|
| 需求模板 | 2 分钟 | 5 分钟 | 10 分钟 |
| 实现 + 测试 | 15 分钟 | 30-60 分钟 | 2-4 小时 |
| 回归测试 | 1 分钟 | 2 分钟 | 5 分钟 |
| 质量审查 | 5 分钟 | 10 分钟 | 15 分钟 |
| **总计** | **~25 分钟** | **~1 小时** | **~5 小时** |

---

## 与 feature-dev skill 的关系

本 skill 是 `feature-dev` 的**补充**，不是替代。

| 方面 | feature-dev | req-implement-test |
|------|-------------|-------------------|
| 重点 | 架构设计、代码探索 | 需求规范化、测试自动化 |
| 阶段 | 7 个阶段 | 4 个阶段 |
| 使用时机 | 新功能开发 | 任何开发任务 |

**推荐组合使用**：
1. 用 `feature-dev` 做架构设计（Phase 1-4）
2. 用 `req-implement-test` 做实现和测试（Phase 5-7）
