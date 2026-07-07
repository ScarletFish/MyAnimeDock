---
name: req-implement-test
description: Requirements elicitation workflow. Use structured questioning to extract complete requirements before implementation — covering data sources, edge cases, acceptance criteria, and non-goals. Activate when the user gives a vague or partial feature request.
---

# 需求规范化工作流

在写代码前强制想清楚，减少返工。

## 核心理念

```
用户模糊需求 → 结构化提问 → 完整需求表 → 用户确认 → 实现
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

用表格形式呈现所有细节：

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

把表格列出来后，用 question 工具让用户确认：

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

## Phase 1: 实现

用户确认需求后，按常规流程实现：
- 编写代码
- 运行 `cd server && npm test` 确认数据持久化测试通过
- 验证功能符合验收标准

---

## 与 feature-dev skill 的关系

本 skill 是 `feature-dev` 的**补充**，不是替代。

| 方面 | feature-dev | req-implement-test |
|------|-------------|-------------------|
| 重点 | 架构设计、代码探索 | 需求规范化 |
| 阶段 | 7 个阶段 | 2 个阶段 |
| 使用时机 | 新功能开发 | 任何开发任务 |

**推荐组合使用**：
1. 用 `req-implement-test` 先厘清需求（Phase 0）
2. 用 `feature-dev` 做架构设计和实现（Phase 1-7）
