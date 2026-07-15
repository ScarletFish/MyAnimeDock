#!/usr/bin/env python3
"""
SVG转PNG工具 - 将SVG图标转换为多尺寸PNG

依赖:
    pip install cairosvg pillow

用法:
    python svg_to_png.py --input icon.svg --sizes 24,48,96 --output ./icons
    python svg_to_png.py --input ./svgs/ --sizes 16,24,32,48,64,96,128 --output ./pngs
"""

import argparse
import os
import sys
from pathlib import Path

try:
    import cairosvg
    from PIL import Image
except ImportError:
    print("错误: 缺少依赖库", file=sys.stderr)
    print("请安装: pip install cairosvg pillow", file=sys.stderr)
    sys.exit(1)


def convert_single(svg_path: str, output_dir: str, sizes: list):
    """转换单个SVG文件"""
    svg_file = Path(svg_path)
    if not svg_file.exists():
        print(f"错误: 文件不存在 {svg_path}", file=sys.stderr)
        return False
    
    base_name = svg_file.stem
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"\n转换: {svg_file.name}")
    
    for size in sizes:
        # 生成PNG
        png_path = os.path.join(output_dir, f"{base_name}-{size}.png")
        
        try:
            cairosvg.svg2png(
                url=str(svg_file),
                write_to=png_path,
                output_width=size,
                output_height=size,
            )
            print(f"  ✓ {size}x{size} -> {png_path}")
        except Exception as e:
            print(f"  ✗ {size}x{size} 失败: {e}", file=sys.stderr)
            return False
    
    return True


def convert_directory(input_dir: str, output_dir: str, sizes: list):
    """批量转换目录中的SVG文件"""
    input_path = Path(input_dir)
    svg_files = list(input_path.glob("*.svg"))
    
    if not svg_files:
        print(f"警告: 在 {input_dir} 中未找到SVG文件")
        return
    
    print(f"找到 {len(svg_files)} 个SVG文件")
    
    success_count = 0
    for svg_file in svg_files:
        # 为每个SVG创建子目录
        sub_output_dir = os.path.join(output_dir, svg_file.stem)
        if convert_single(str(svg_file), sub_output_dir, sizes):
            success_count += 1
    
    print(f"\n✅ 成功转换 {success_count}/{len(svg_files)} 个文件")


def main():
    parser = argparse.ArgumentParser(description="SVG转PNG工具")
    parser.add_argument("--input", "-i", required=True, help="输入SVG文件或目录")
    parser.add_argument("--output", "-o", default="./png-output", help="输出目录 (默认: ./png-output)")
    parser.add_argument("--sizes", "-s", default="24,48,96", help="尺寸列表，逗号分隔 (默认: 24,48,96)")
    parser.add_argument("--ios", action="store_true", help="使用iOS标准尺寸: 20,29,40,60,76,83.5,1024")
    parser.add_argument("--android", action="store_true", help="使用Android标准尺寸: 48,72,96,144,192,512")
    
    args = parser.parse_args()
    
    # 确定尺寸列表
    if args.ios:
        sizes = [20, 29, 40, 60, 76, 83, 1024]
    elif args.android:
        sizes = [48, 72, 96, 144, 192, 512]
    else:
        sizes = [int(s.strip()) for s in args.sizes.split(",")]
    
    print(f"目标尺寸: {sizes}")
    
    # 判断输入是文件还是目录
    input_path = Path(args.input)
    
    if input_path.is_file():
        if input_path.suffix.lower() != ".svg":
            print("错误: 输入文件必须是SVG格式", file=sys.stderr)
            sys.exit(1)
        convert_single(str(input_path), args.output, sizes)
    elif input_path.is_dir():
        convert_directory(str(input_path), args.output, sizes)
    else:
        print(f"错误: 输入路径不存在 {args.input}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
