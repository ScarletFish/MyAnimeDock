#!/usr/bin/env python3
"""
图标Prompt生成器 - 根据风格参数生成标准化的AI图像生成Prompt

用法:
    python generate_icon_prompt.py --name "shopping cart" --style S1 --color C1 --size 24
    python generate_icon_prompt.py --name "home" --style S6 --color "#FF0000" --size 32
"""

import argparse
import sys

# 风格模板定义
STYLE_TEMPLATES = {
    "S1": {
        "name": "现代极简",
        "prompt": "minimalist line icon, thin 1.5px stroke, geometric, flat design, single color",
    },
    "S2": {
        "name": "活力渐变",
        "prompt": "vibrant gradient icon, colorful, rounded shapes, modern flat with gradient",
    },
    "S3": {
        "name": "毛玻璃新拟态",
        "prompt": "glassmorphism icon, frosted glass, soft shadows, translucent, rounded",
    },
    "S4": {
        "name": "3D立体",
        "prompt": "3D isometric icon, clay render, soft lighting, volumetric, rounded edges",
    },
    "S5": {
        "name": "手绘插画风",
        "prompt": "hand-drawn icon, sketch style, organic uneven lines, warm illustration",
    },
    "S6": {
        "name": "线性描边",
        "prompt": "outline icon, consistent 2px stroke, geometric, clean vector, flat",
    },
    "S7": {
        "name": "双色双调",
        "prompt": "duotone icon, two-color scheme, high contrast, layered flat design",
    },
    "S8": {
        "name": "像素复古",
        "prompt": "pixel art icon, 8-bit retro style, limited color palette, blocky",
    },
}

# 色系模板定义
COLOR_TEMPLATES = {
    "C1": {"name": "科技蓝", "primary": "#2563EB", "desc": "tech blue"},
    "C2": {"name": "自然绿", "primary": "#16A34A", "desc": "nature green"},
    "C3": {"name": "活力橙", "primary": "#EA580C", "desc": "energetic orange"},
    "C4": {"name": "高端紫", "primary": "#7C3AED", "desc": "premium purple"},
    "C5": {"name": "暗夜模式", "primary": "#F8FAFC", "desc": "dark mode light"},
    "C6": {"name": "功能色系", "primary": "#2563EB", "desc": "functional UI"},
}

# 通用负面提示
NEGATIVE_PROMPT = "no text, no watermark, no background, no border, no realistic details, no photography, professional design"


def generate_prompt(icon_name: str, style_code: str, color_code: str, size: int = 24) -> str:
    """生成图标Prompt"""
    
    # 获取风格
    style = STYLE_TEMPLATES.get(style_code, STYLE_TEMPLATES["S6"])
    
    # 获取颜色
    if color_code.startswith("#"):
        color_desc = f"primary color {color_code}"
    else:
        color_template = COLOR_TEMPLATES.get(color_code, COLOR_TEMPLATES["C1"])
        color_desc = f"{color_template['desc']} color scheme, primary {color_template['primary']}"
    
    # 构建Prompt
    prompt = f"{style['prompt']} icon of {icon_name}, {size}x{size}px, {color_desc}, transparent background, {NEGATIVE_PROMPT}"
    
    return prompt


def main():
    parser = argparse.ArgumentParser(description="生成图标AI Prompt")
    parser.add_argument("--name", "-n", required=True, help="图标名称，如 'shopping cart'")
    parser.add_argument("--style", "-s", default="S6", help="风格代码: S1-S8 (默认: S6)")
    parser.add_argument("--color", "-c", default="C1", help="色系代码: C1-C6 或自定义色值如 #FF0000 (默认: C1)")
    parser.add_argument("--size", "-z", type=int, default=24, help="图标尺寸 (默认: 24)")
    parser.add_argument("--list-styles", action="store_true", help="列出所有可用风格")
    parser.add_argument("--list-colors", action="store_true", help="列出所有可用色系")
    
    args = parser.parse_args()
    
    if args.list_styles:
        print("可用风格模板:")
        for code, info in STYLE_TEMPLATES.items():
            print(f"  {code}: {info['name']}")
        return
    
    if args.list_colors:
        print("可用色系模板:")
        for code, info in COLOR_TEMPLATES.items():
            print(f"  {code}: {info['name']} ({info['primary']})")
        return
    
    # 验证风格代码
    if args.style not in STYLE_TEMPLATES and not args.style.startswith("#"):
        print(f"错误: 未知风格代码 '{args.style}'", file=sys.stderr)
        print(f"可用风格: {', '.join(STYLE_TEMPLATES.keys())}", file=sys.stderr)
        sys.exit(1)
    
    # 生成Prompt
    prompt = generate_prompt(args.name, args.style, args.color, args.size)
    
    print(f"\n图标: {args.name}")
    print(f"风格: {STYLE_TEMPLATES.get(args.style, {}).get('name', '自定义')}")
    print(f"色系: {COLOR_TEMPLATES.get(args.color, {}).get('name', args.color)}")
    print(f"尺寸: {args.size}px")
    print(f"\n{'='*60}")
    print("生成的Prompt:")
    print(f"{'='*60}")
    print(prompt)
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
