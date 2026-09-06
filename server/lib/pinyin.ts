// server/lib/pinyin.ts — pinyinTitle 计算单点（落库 / 改名共用）
// 收敛原因：pinyinTitle 已有 DB 列与索引，列表读取（buildListItems）纯读列，不重算。
// 只在两处计算：saveLibrary 落库（空值）、元数据同步改名后。
import { pinyin } from 'pinyin-pro';

export function computePinyinTitle(name: string): string {
  if (!name) return '';
  try {
    return pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('');
  } catch {
    return '';
  }
}