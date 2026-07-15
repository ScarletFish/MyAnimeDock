#!/usr/bin/env python3
"""
整套图标生成脚本 - 批量生成风格统一的图标配置

用法:
    python create_icon_set.py --names home,search,profile --style S1 --color C1 --output ./icons
    python create_icon_set.py --scene ecommerce-tab --style S6 --color C1
"""

import argparse
import json
import os
import sys

# 场景预设
SCENE_PRESETS = {
    "ecommerce-tab": ["home", "category", "cart", "message", "profile"],
    "ecommerce-quick": ["flash-sale", "coupon", "points", "group-buy", "new-arrival", "live", "recharge", "member"],
    "social-tab": ["home", "discover", "publish", "message", "profile"],
    "saas-sidebar": ["dashboard", "projects", "tasks", "team", "calendar", "docs", "reports", "settings"],
    "finance-tab": ["home", "assets", "market", "trade", "profile"],
    "health-tab": ["home", "sport", "discover", "data", "profile"],
    "education-tab": ["home", "courses", "learn", "message", "profile"],
    "universal-nav": ["back", "home", "menu", "close", "more"],
    "universal-action": ["search", "filter", "sort", "edit", "delete", "save", "share"],
}


def generate_icon_config(name: str, style: str, color: str, size: int = 24) -> dict:
    """生成单个图标的配置"""
    return {
        "name": name,
        "style": style,
        "color": color,
        "size": size,
        "filename": f"icon-{name.lower().replace(' ', '-')}",
    }


def create_icon_set(names: list, style: str, color: str, size: int = 24) -> list:
    """创建整套图标配置"""
    return [generate_icon_config(name, style, color, size) for name in names]


def save_config(config: list, output_dir: str):
    """保存配置到文件"""
    os.makedirs(output_dir, exist_ok=True)
    
    # 保存JSON配置
    config_path = os.path.join(output_dir, "icon-set-config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    
    # 生成Markdown清单
    md_path = os.path.join(output_dir, "icon-set-list.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# 图标集配置\n\n")
        f.write(f"**风格**: {config[0]['style']}\n\n")
        f.write(f"**色系**: {config[0]['color']}\n\n")
        f.write(f"**尺寸**: {config[0]['size']}px\n\n")
        f.write("## 图标列表\n\n")
        f.write("| 序号 | 名称 | 文件名 |\n")
        f.write("|------|------|--------|\n")
        for i, icon in enumerate(config, 1):
            f.write(f"| {i} | {icon['name']} | {icon['filename']} |\n")
    
    return config_path, md_path


def main():
    parser = argparse.ArgumentParser(description="创建整套图标配置")
    parser.add_argument("--names", "-n", help="图标名称列表，逗号分隔，如 'home,search,profile'")
    parser.add_argument("--scene", "-s", help=f"使用预设场景: {', '.join(SCENE_PRESETS.keys())}")
    parser.add_argument("--style", default="S6", help="风格代码 (默认: S6)")
    parser.add_argument("--color", default="C1", help="色系代码或色值 (默认: C1)")
    parser.add_argument("--size", type=int, default=24, help="图标尺寸 (默认: 24)")
    parser.add_argument("--output", "-o", default="./icon-set", help="输出目录 (默认: ./icon-set)")
    parser.add_argument("--list-scenes", action="store_true", help="列出所有可用场景")
    
    args = parser.parse_args()
    
    if args.list_scenes:
        print("可用场景预设:")
        for scene, icons in SCENE_PRESETS.items():
            print(f"\n  {scene}:")
            for icon in icons:
                print(f"    - {icon}")
        return
    
    # 确定图标列表
    if args.scene:
        if args.scene not in SCENE_PRESETS:
            print(f"错误: 未知场景 '{args.scene}'", file=sys.stderr)
            print(f"可用场景: {', '.join(SCENE_PRESETS.keys())}", file=sys.stderr)
            sys.exit(1)
        names = SCENE_PRESETS[args.scene]
    elif args.names:
        names = [n.strip() for n in args.names.split(",")]
    else:
        print("错误: 请提供 --names 或 --scene 参数", file=sys.stderr)
        parser.print_help()
        sys.exit(1)
    
    # 生成配置
    config = create_icon_set(names, args.style, args.color, args.size)
    
    # 保存配置
    config_path, md_path = save_config(config, args.output)
    
    print(f"\n✅ 已生成 {len(config)} 个图标的配置")
    print(f"📁 配置文件: {config_path}")
    print(f"📋 图标清单: {md_path}")
    print(f"\n图标列表:")
    for i, icon in enumerate(config, 1):
        print(f"  {i}. {icon['name']} ({icon['filename']}.svg/png)")
    print()


if __name__ == "__main__":
    main()
