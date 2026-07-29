---
name: feature-dev
description: Guide a feature implementation through a structured seven-phase workflow with deep codebase understanding, clarifying questions, parallel architecture design, and quality review. Use this skill when the user asks to build a new feature, add functionality, or wants a methodical approach to implementation rather than diving straight to code.
license: MIT (ported from anthropics/claude-code/plugins/feature-dev)
---

# Feature Development

Help a developer implement a new feature systematically. Understand the codebase deeply, identify and ask about underspecified details, design elegant architectures, then implement.

## Core principles

- **Ask clarifying questions** — Identify ambiguities, edge cases, and underspecified behaviors. Ask specific, concrete questions rather than making assumptions. Wait for user answers before proceeding.
- **Understand before acting** — Read and comprehend existing code patterns first.
- **Read files identified by sub-tasks** — When dispatching code-explorer sub-tasks, ask them to return lists of the most important files to read. After they complete, read those files yourself to build detailed context.
- **Simple and elegant** — Prioritize readable, maintainable, architecturally sound code.
- **Track progress** — Use a todo list throughout.

## Working discipline

These bias toward caution over speed — use judgment on trivial tasks.

- **Think before acting** — state assumptions; if the request has more than one reading, surface them instead of silently choosing; if a simpler path exists, say so.
- **Simplicity first** — the minimum that solves the problem; no speculative features, abstractions, configurability, or handling of impossible cases.
- **Surgical changes** — touch only what the task needs; do not refactor or restyle adjacent code; match existing style; clean up only the orphans your change created, and mention unrelated dead code rather than deleting it.
- **Goal-driven** — turn the task into a concrete success check and iterate until it passes.

## Phase 1: Discovery

Goal: Understand what needs to be built.

1. Create a todo list covering all seven phases.
2. **使用需求模板**：要求用户填写 `REQUIREMENTS-TEMPLATE.md`（同目录），或协助填写。模板包含：
   - 一句话描述
   - 解决什么问题
   - 验收标准（至少 3 条可测试标准）
   - 边界情况清单
   - 影响范围
   - 非目标
3. 如果用户已提供清晰需求，直接确认模板内容；如果模糊，先协助填写模板再继续。
4. Summarize your understanding and confirm with the user before proceeding.

## Phase 2: Codebase exploration

Goal: Understand relevant existing code at both high and low levels.

1. Dispatch 2–3 `code-explorer` sub-tasks in parallel. Each should:
   - Trace through the code comprehensively, focusing on abstractions, architecture, and control flow.
   - Target a different aspect (similar features, high-level architecture, UX, extension points).
   - Return a list of 5–10 key files to read.
2. After they return, read every file they identified to build deep understanding.
3. Present a comprehensive summary of findings and patterns to the user.

## Phase 3: Clarifying questions

Goal: Fill gaps and resolve ambiguities before designing.

**This is one of the most important phases. Do not skip. Do not short-circuit.**

1. Review the codebase findings and the original feature request.
2. Identify underspecified aspects. **必须覆盖以下四类**，缺一不可：
   - **边界情况**（空状态、极端数据、网络错误、并发/竞态）
   - **错误处理**（失败时行为、用户可见的反馈）
   - **设计偏好**（交互方式、视觉方向、技术选型）
   - **Scope 边界**（做哪些、明确不做哪些）
3. **一次性提交所有问题**：用 `question` 工具组织为清晰的列表，不可逐个零散提问后自行推进。
4. **Wait for answers** before moving to architecture.
5. 用户回复后仍有未覆盖项的，**必须追加提问**，不得"差不多就行了"。

### 禁默认通过

- ❌ 用户说"whatever you think is best" → **不得视同确认**。必须把你的推荐打包成 proposal，用 `question` 工具提交二选一（推荐方案 A / 可选方案 B），获得用户明确选择后才算确认
- ❌ 用户说"简单做就行" / "你决定" → 同上处理
- ❌ 只问了 1-2 个简单问题就继续 → 不满足四类覆盖要求
- ❌ 用陈述句替代 `question` 工具做确认

### 最少提问数参考

- 小功能（单文件改动）：至少 3-5 个问题，覆盖边界+错误+scope
- 中等功能（跨 2-3 文件）：至少 5-8 个问题，覆盖全部四类
- 大功能（新模块/跨系统）：至少 8+ 个问题，全部四类深度覆盖

## Phase 4: Architecture design

Goal: Design multiple implementation approaches with different trade-offs.

1. Dispatch 2–3 `code-architect` sub-tasks in parallel, each with a different focus:
   - **Minimal changes** — smallest diff, maximum reuse of existing code.
   - **Clean architecture** — maintainability, elegant abstractions.
   - **Pragmatic balance** — speed plus quality.
2. Review all approaches and form an opinion on which fits best for this task. Consider scope (small fix vs. large feature), urgency, complexity, and team context.
3. Present to the user: a brief summary of each approach, a trade-offs comparison, your recommendation with reasoning, and concrete differences in implementation.
4. **Ask the user which approach they prefer.**

## Phase 5: Implementation

Goal: Build the feature.

**Do not start without explicit user approval.**

1. Wait for approval.
2. Re-read all relevant files identified earlier.
3. Implement following the chosen architecture.
4. Strictly follow codebase conventions (naming, style, error-handling patterns).
5. **同步写测试（TDD 强制化）**：
   - 后端模块：使用 `node scripts/generate-tests.js <module>` 生成测试骨架
   - 前端纯函数：在 `public/__tests__/` 添加单元测试
   - 每完成一个功能点，立即运行测试确认通过
6. Update todos as you progress.

## Phase 6: Quality review

Goal: Ensure the code is simple, DRY, elegant, readable, and correct.

1. **运行所有测试**：
   - 后端测试：`cd server && npm test`
   - 前端单元测试：`npm run test:frontend`
   - 确认所有测试通过
2. **回归测试**：
   - 如果修改了 scanner/scrapers/db，运行快照测试确认输出未变
   - 如果修改了前端 UI，运行 `npm run test:e2e` 验证关键流程
3. Dispatch 3 `code-reviewer` sub-tasks in parallel, each with a different focus:
   - Simplicity / DRY / elegance
   - Bugs / functional correctness
   - Project conventions and abstractions
4. Consolidate findings and rank issues by severity.
5. Present findings to the user and ask what they want to do (fix now, fix later, proceed as-is).
6. Address issues based on their decision.

## Phase 7: Summary

Goal: Document what was accomplished.

1. Mark all todos complete.
2. Summarize:
   - What was built
   - Key decisions made
   - Files modified
   - Suggested next steps
