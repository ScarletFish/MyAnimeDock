// server/lib/pinyin.ts — pinyinTitle 计算单点（落库 / 读取 / 改名共用）
// 收敛原因：pinyinTitle 已有 DB 列与索引，但旧实现每次 GET /api/library 全量重算。
// 现在只在三处计算：saveLibrary 落库（空值）、handleGetLibrary 懒计算（空值兜底）、元数据同步改名后。
import { pinyin } from 'pinyin-pro';

export function computePinyinTitle(name: string): string {
  if (!name) return '';
  try {
    return pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('');
  } catch {
    return '';
  }
}