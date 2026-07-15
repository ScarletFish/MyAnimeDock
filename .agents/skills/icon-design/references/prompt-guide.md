# Prompt工程指南

## 核心原则

1. **具体性驱动质量**: 越具体的描述，输出越精准
2. **一致性优先**: 整套图标使用完全相同的前缀风格描述
3. **负面提示**: 明确排除不需要的元素
4. **迭代优化**: 从简单开始，逐步细化

---

## Prompt结构

```
[风格前缀] icon of [图标名称], [尺寸]x[尺寸]px,
[色彩描述], [质感描述], [形状描述],
transparent background, [负面提示]
```

### 各部分说明

| 部分 | 必填 | 说明 |
|------|------|------|
| 风格前缀 | 是 | 定义整体视觉风格 |
| 图标名称 | 是 | 描述图标的具象含义 |
| 尺寸 | 是 | 像素尺寸 |
| 色彩描述 | 是 | 颜色方案 |
| 质感描述 | 否 | 阴影、渐变等效果 |
| 形状描述 | 否 | 几何、有机等 |
| 负面提示 | 推荐 | 排除不需要的元素 |

---

## 风格前缀速查

| 风格 | Prompt前缀 |
|------|-----------|
| 现代极简 | `minimalist line icon, thin 1.5px stroke, geometric, flat design, single color` |
| 活力渐变 | `vibrant gradient icon, colorful, rounded shapes, modern flat with gradient` |
| 毛玻璃 | `glassmorphism icon, frosted glass, soft shadows, translucent, rounded` |
| 3D立体 | `3D isometric icon, clay render, soft lighting, volumetric, rounded edges` |
| 手绘 | `hand-drawn icon, sketch style, organic uneven lines, warm illustration` |
| 线性描边 | `outline icon, consistent 2px stroke, geometric, clean vector, flat` |
| 双色双调 | `duotone icon, two-color scheme, high contrast, layered flat design` |
| 像素复古 | `pixel art icon, 8-bit retro style, limited color palette, blocky` |

---

## 通用负面提示

所有图标生成都应包含的负面提示：

```
no text, no watermark, no background, no border,
no realistic details, no photography, no 3D render (除非S4风格),
no gradient (除非S2/S3风格), no shadow (除非S3/S4风格)
```

---

## 整套图标一致性规则

### 规则1: 固定风格前缀
整套图标必须使用完全相同的风格前缀字符串。

### 规则2: 固定色彩方案
```
✅ 正确: 所有图标使用 "primary color #2563EB"
❌ 错误: 一个用 "blue"，一个用 "navy"
```

### 规则3: 固定视角
```
✅ 正确: 所有图标都是正面视角
❌ 错误: 一个正面，一个侧面
```

### 规则4: 固定细节密度
```
✅ 正确: 所有图标都是简约风格，3-5个元素
❌ 错误: 一个简单，一个复杂
```

### 规则5: 固定比例
```
✅ 正确: 所有图标在24x24画布中居中，占60-70%面积
❌ 错误: 一个占满画布，一个很小
```

---

## Prompt样例

### 单个图标样例

**需求**: 电商App的购物车图标，现代极简风，蓝色系

```
minimalist line icon of a shopping cart, 24x24px,
primary color #2563EB, thin 1.5px stroke, small rounded corners 2px,
geometric flat design, transparent background,
no text, no watermark, no background fill, no shadows
```

**需求**: 游戏App的宝箱图标，像素风

```
pixel art icon of a treasure chest, 24x24px,
8-bit retro style, limited palette with gold #F59E0B and brown #92400E,
blocky shapes, transparent background,
no text, no watermark, no smooth edges, no gradients
```

**需求**: 健康App的心率图标，活力渐变风

```
vibrant gradient icon of a heartbeat pulse, 24x24px,
gradient from red #EF4444 to pink #EC4899, rounded shapes,
modern flat design with smooth gradient, transparent background,
no text, no watermark, no realistic heart shape
```

### 整套图标样例（SaaS底部导航）

**统一的风格前缀**:
```
outline icon, consistent 2px stroke weight, uniform 2px rounded corners,
single color #2563EB, geometric flat design, clean vector
```

**首页**: `{前缀} of a house/home, 24x24px, transparent background, no text, no watermark`
**项目**: `{前缀} of a folder with document, 24x24px, transparent background, no text, no watermark`
**消息**: `{前缀} of a chat bubble, 24x24px, transparent background, no text, no watermark`
**设置**: `{前缀} of a gear/cog, 24x24px, transparent background, no text, no watermark`
**我的**: `{前缀} of a user silhouette, 24x24px, transparent background, no text, no watermark`

---

## 迭代优化策略

### 策略1: 从宽到窄
```
第1轮: "shopping cart icon" (太宽泛)
第2轮: "minimalist shopping cart icon, blue" (更好)
第3轮: "minimalist line icon of shopping cart, #2563EB, 1.5px stroke" (精准)
```

### 策略2: 单变量调整
```
不满意颜色 → 只改颜色参数
不满意风格 → 只改风格前缀
不满意细节 → 添加 "simplify" 或 "more detail"
```

### 策略3: 参考风格
```
"icon similar to Material Design style but with rounded corners"
"icon in the style of Apple SF Symbols but with gradient"
```
