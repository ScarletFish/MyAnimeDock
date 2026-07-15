# 色系模板库

## C1: 科技蓝 (Tech Blue)

```
主色:   #2563EB (Blue 600)
深色:   #1E40AF (Blue 800)
浅色:   #DBEAFE (Blue 100)
极浅:   #EFF6FF (Blue 50)
强调色: #06B6D4 (Cyan 500)
中性色: #1E293B (Slate 800)
```

**适用**: 科技公司、SaaS产品、开发者工具、云计算、AI产品
**语义**: 信任、专业、创新、稳定
**Prompt色系描述**: `tech blue color scheme, primary #2563EB, accent cyan #06B6D4, on dark slate #1E293B background`

---

## C2: 自然绿 (Nature Green)

```
主色:   #16A34A (Green 600)
深色:   #15803D (Green 700)
浅色:   #DCFCE7 (Green 100)
极浅:   #F0FDF4 (Green 50)
强调色: #84CC16 (Lime 500)
中性色: #365314 (Lime 900)
```

**适用**: 健康医疗、环保产品、教育学习、金融理财、农业食品
**语义**: 健康、成长、安全、可持续
**Prompt色系描述**: `nature green color scheme, primary #16A34A, accent lime #84CC16, fresh and organic feel`

---

## C3: 活力橙 (Energetic Orange)

```
主色:   #EA580C (Orange 600)
深色:   #C2410C (Orange 700)
浅色:   #FED7AA (Orange 200)
极浅:   #FFF7ED (Orange 50)
强调色: #F59E0B (Amber 500)
中性色: #7C2D12 (Orange 900)
```

**适用**: 电商购物、外卖配送、运动健身、社交娱乐、食品饮料
**语义**: 活力、热情、行动力、食欲
**Prompt色系描述**: `energetic orange color scheme, primary #EA580C, accent amber #F59E0B, warm and vibrant`

---

## C4: 高端紫 (Premium Purple)

```
主色:   #7C3AED (Violet 600)
深色:   #6D28D9 (Violet 700)
浅色:   #EDE9FE (Violet 100)
极浅:   #F5F3FF (Violet 50)
强调色: #EC4899 (Pink 500)
中性色: #4C1D95 (Violet 900)
```

**适用**: 创意设计、时尚美妆、音乐艺术、高端品牌、加密货币
**语义**: 高端、创意、神秘、个性
**Prompt色系描述**: `premium purple color scheme, primary #7C3AED, accent pink #EC4899, luxurious and creative`

---

## C5: 暗夜模式 (Dark Mode)

```
背景色: #0F172A (Slate 900)
卡片色: #1E293B (Slate 800)
边框色: #334155 (Slate 700)
主文字: #F8FAFC (Slate 50)
次文字: #94A3B8 (Slate 400)
强调色: #38BDF8 (Sky 400)
成功色: #4ADE80 (Green 400)
警告色: #FBBF24 (Amber 400)
错误色: #F87171 (Red 400)
```

**适用**: 暗色主题App、开发者工具、游戏、影音娱乐、夜间模式
**语义**: 沉浸、专注、护眼、科技感
**Prompt色系描述**: `dark mode color scheme, light icons on dark background #0F172A, accent sky blue #38BDF8, high contrast`

---

## C6: 功能色系 (Functional Colors)

```
成功/确认: #22C55E (Green 500)  浅底: #F0FDF4
错误/危险: #EF4444 (Red 500)    浅底: #FEF2F2
警告/注意: #EAB308 (Yellow 500)  浅底: #FEFCE8
信息/提示: #3B82F6 (Blue 500)    浅底: #EFF6FF
禁用/灰态: #9CA3AF (Gray 400)   浅底: #F9FAFB
主操作:   #2563EB (Blue 600)
次操作:   #6B7280 (Gray 500)
```

**适用**: 所有需要状态反馈的UI场景
**语义**: 通用功能色，用户直觉理解
**Prompt色系描述**: `functional UI color scheme, success green #22C55E, error red #EF4444, warning yellow #EAB308, info blue #3B82F6`

---

## 色系选择指南

| 行业/场景 | 推荐色系 | 原因 |
|-----------|---------|------|
| 科技/SaaS | C1 科技蓝 | 传递信任与创新 |
| 健康/教育 | C2 自然绿 | 传递成长与安全 |
| 电商/外卖 | C3 活力橙 | 激发行动与热情 |
| 时尚/创意 | C4 高端紫 | 传递个性与品质 |
| 开发者工具 | C5 暗夜模式 | 沉浸专注体验 |
| 通用系统 | C6 功能色系 | 覆盖所有状态反馈 |

## 自定义色系规则

当用户指定自定义颜色时：
1. 从主色推导完整色板（使用HSL色相旋转）
2. 确保主色与背景色对比度 ≥ 4.5:1
3. 生成3-5个层级：深色、主色、浅色、极浅、强调色
4. 验证色板在图标尺寸下的可辨识度
