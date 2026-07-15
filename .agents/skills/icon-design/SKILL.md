---
name: icon-design
description: |
  AI图标设计与生成工具。支持单个图标生成、整套图标集生成、App启动图标设计，以及通过网站URL或截图扫描提取设计风格后生成风格统一的图标。
  适用场景：网站UI、移动App、桌面软件、SaaS产品、电商、社交、游戏等多场景图标设计。
  核心能力：
  - 单个图标生成（+icon）
  - 整套图标集生成（+iconset）
  - App启动图标生成（+appicon）
  - 网站风格扫描与图标生成（+iconscan）
  - 风格模板浏览（+iconstyle）
  所有图标输出透明背景的SVG+PNG双格式，可选生成React/Vue前端组件代码。
  当用户提到：图标设计、icon设计、生成图标、icon set、图标集、App图标、应用图标、网站图标、UI图标、扫描网站风格生成图标、图标风格统一、icon组件代码 时触发此skill。
---

# Icon Design Skill

> ⚠️ **重要声明**
> 
> 1. **版权风险**：AI生成的图标可能与现有设计存在相似性，商用前请进行版权审查，确保不侵犯第三方知识产权。
> 2. **风格扫描限制**：网站风格扫描基于视觉分析，结果仅供参考，建议用户确认后再生成。
> 3. **输出质量**：复杂图标可能需要人工精修，建议将生成结果作为设计起点而非最终稿。

## 快速开始

### 命令路由

| 命令 | 用途 | 工作流 |
|------|------|--------|
| `+icon [名称]` | 生成单个图标 | 交互式选择风格 → 生成PNG+SVG |
| `+iconset [列表]` | 生成整套图标 | 确定统一风格 → 批量生成 → 输出组件代码 |
| `+appicon [名称]` | 生成App启动图标 | 收集需求 → 生成多平台尺寸 |
| `+iconscan [URL/图片]` | 扫描风格+生成图标 | 分析网站/图片 → 生成风格报告 → 确认后生成 |
| `+iconstyle` | 浏览风格模板 | 展示8套预置风格模板 |

若用户未使用命令但意图明确，自动匹配最合适的命令。

## 核心工作流

### 单个图标生成 (+icon)

1. **收集需求**（使用AskUserQuestion）：
   - 图标名称/含义（必填）
   - 应用场景（网站/App/软件/通用）
   - 风格偏好（参考 [style-templates.md](references/style-templates.md)）
   - 色系偏好（参考 [color-templates.md](references/color-templates.md)）
   - 尺寸需求（默认24px）

2. **确定风格参数**：
   - 图标类型（线性/面性/线面结合/渐变/3D等）
   - 线宽、圆角、色彩方案
   - 质感类型（扁平/轻质感/拟物）

3. **生成图标**：
   - 使用GenerateImage生成PNG图标
   - Prompt必须包含：`transparent background, icon design, [风格参数], [尺寸]px`
   - 同时生成SVG代码（参考 [svg-examples.md](references/svg-examples.md)）

4. **输出交付物**：
   - PNG文件（透明背景，保存到/workspace）
   - SVG文件（保存到/workspace）
   - 可选：React/Vue组件代码（使用 [Icon.tsx](assets/Icon.tsx) / [Icon.vue](assets/Icon.vue) 模板）

### 整套图标生成 (+iconset)

1. **收集图标列表**：用户提供或推荐场景图标（参考 [scene-templates.md](references/scene-templates.md)）
2. **确定统一风格**：整套图标必须使用完全一致的风格参数
3. **逐个生成**：按统一风格逐个生成每个图标（参考 [prompt-guide.md](references/prompt-guide.md) 的一致性规则）
4. **一致性检查**：确保所有图标的线宽、圆角、色彩、质感一致
5. **输出交付物**：
   - 所有PNG文件（透明背景）
   - 所有SVG文件
   - 设计规范摘要文档
   - 可选：React/Vue Icon组件代码

### App启动图标生成 (+appicon)

1. **收集需求**：App名称、行业、品牌色、风格偏好
2. **生成多尺寸**：1024x1024（主尺寸）+ 各平台所需尺寸
3. **输出交付物**：
   - 1024x1024 主图标（PNG透明背景）
   - iOS尺寸集：180/120/167/152/76等
   - Android尺寸集：512/192/144/96/72/48等
   - 各尺寸SVG源文件

### 风格扫描与生成 (+iconscan)

1. **获取目标**：
   - URL方式：使用browser工具访问网站，截图分析
   - 图片方式：读取用户上传的截图

2. **风格分析**（参考 [style-analysis.md](references/style-analysis.md)）：
   - 色彩提取：主色、辅助色、强调色
   - 线条分析：线宽、圆角、断点风格
   - 形状分析：几何/有机/圆润/方正
   - 质感分析：扁平/渐变/阴影/毛玻璃
   - 整体调性：专业/活泼/高端/亲和

3. **生成风格报告**：展示提取的参数，请用户确认

4. **基于风格生成图标**：确认后按提取的风格参数生成图标

## 资源引用指南

| 资源文件 | 用途 | 何时加载 |
|---------|------|---------|
| [style-templates.md](references/style-templates.md) | 8套预置风格模板详情 | 用户询问风格选项或需要风格参考时 |
| [color-templates.md](references/color-templates.md) | 6套预置色系模板 | 用户选择色系或需要配色建议时 |
| [scene-templates.md](references/scene-templates.md) | 7大场景图标推荐列表 | 整套图标生成时推荐场景图标 |
| [style-analysis.md](references/style-analysis.md) | 风格扫描分析维度 | 执行+iconscan命令时 |
| [prompt-guide.md](references/prompt-guide.md) | Prompt工程指南和一致性规则 | 生成图标时参考Prompt结构 |
| [svg-examples.md](references/svg-examples.md) | SVG代码规范和示例 | 生成SVG代码时参考 |
| [Icon.tsx](assets/Icon.tsx) | React组件模板 | 用户需要React代码时 |
| [Icon.vue](assets/Icon.vue) | Vue组件模板 | 用户需要Vue代码时 |

## 快速参考

### 8套风格模板

| 编号 | 风格名 | 适用场景 |
|------|--------|---------|
| S1 | 现代极简 | SaaS、B端、专业工具 |
| S2 | 活力渐变 | 社交、娱乐、教育 |
| S3 | 毛玻璃新拟态 | iOS风格、现代UI |
| S4 | 3D立体 | 创意产品、游戏、营销 |
| S5 | 手绘插画风 | 儿童、生活方式、创意品牌 |
| S6 | 线性描边 | 通用UI、图标系统、技术文档 |
| S7 | 双色双调 | 现代Web、仪表板 |
| S8 | 像素复古 | 游戏、复古主题 |

### 6套色系模板

| 编号 | 色系名 | 主色 |
|------|--------|------|
| C1 | 科技蓝 | #2563EB |
| C2 | 自然绿 | #16A34A |
| C3 | 活力橙 | #EA580C |
| C4 | 高端紫 | #7C3AED |
| C5 | 暗夜模式 | #F8FAFC (light on dark) |
| C6 | 功能色系 | 红/绿/蓝/黄 |

## 输出规范

### 文件格式
- **SVG**：矢量格式，viewBox="0 0 24 24"，fill="currentColor"
- **PNG**：透明背景，默认24px，支持1x/2x/3x
- **组件代码**：React .tsx 或 Vue .vue 格式

### SVG代码规范
- 使用简洁的path数据
- 合理使用circle、rect、polygon等基础图形
- 不设置固定width/height（保持可缩放）
- fill使用currentColor（方便通过CSS控制颜色）

## 设计原则

1. **清晰可辨**：小尺寸下依然清晰可识别
2. **简洁有力**：去除非必要细节，做减法
3. **风格统一**：整套图标线宽、圆角、色彩、质感完全一致
4. **语义明确**：一眼理解图标含义，遵循通用图标语义
5. **视觉平衡**：图标在画布中视觉重量均衡
6. **透明背景**：所有输出必须是透明背景
7. **像素对齐**：边缘对齐像素网格，避免模糊
