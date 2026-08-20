// ─── Tag 工具层（tag-utils.js）────────────────────────────
// 统一 tag 系统三处消费点（详情页展示 / 数据统计 / tag 搜索）的过滤与中文映射。
// 单一来源：剧透过滤统一用 isGeneralSpoiler，中文名映射统一走 ANILIST_TAG_DATA。
import { ANILIST_TAG_DATA } from './tag-data.js';

// 过滤剧透 tag（isGeneralSpoiler），返回原始 tag 对象数组
export function filterTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => t && t.name && !t.isGeneralSpoiler);
}

// 映射 tag 中文名（无映射回退英文原始名）
export function tagZh(name) {
  const d = ANILIST_TAG_DATA[name];
  return (d && d.zh) || name;
}

// 展开 tag 的可搜索字段（英文原始名 + 中文名），供搜索匹配
export function tagSearchFields(tags) {
  return filterTags(tags).flatMap((t) => {
    const zh = tagZh(t.name);
    return zh !== t.name ? [t.name, zh] : [t.name];
  });
}