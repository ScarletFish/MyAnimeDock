// server/scrapers/mikan.ts — 蜜柑计划抓取器
import { fetchWithTimeout, USER_AGENT } from '../lib/http-fetch';
import { Logger } from '../logger';
import type { MikanBangumi, MikanSubtitleGroup, MikanSubtitleGroupInfo, MikanBangumiDetail } from '../types';

const logger: Logger = require('../logger').child('[MIKAN]');

const MIKAN_FALLBACK = 'https://mikanani.me';

/**
 * 解码HTML实体（如 &#x55B5; → 喵）
 */
function decodeHtmlEntities(str: string): string {
  return str.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * 从HTML中提取番剧列表
 * 解析 data-dayofweek 分组和番剧名字
 */
function parseWeeklyBangumi(html: string): Map<number, MikanBangumi[]> {
  const result = new Map<number, MikanBangumi[]>();
  
  // 匹配 data-dayofweek="N" 分组
  const dayOfWeekRegex = /data-dayofweek="(\d+)"[^>]*>([\s\S]*?)(?=<div[^>]*data-dayofweek|$)/g;
  let dayMatch;
  
  while ((dayMatch = dayOfWeekRegex.exec(html)) !== null) {
    const dayOfWeek = parseInt(dayMatch[1], 10);
    const dayHtml = dayMatch[2];
    
    // 提取该分组下的番剧
    const bangumiList: MikanBangumi[] = [];
    
    // 匹配 <a> 标签中的番剧信息
    // 格式: <a href="/Home/Bangumi/3941" target="_blank" class="an-text" title="番剧名">番剧名</a>
    const bangumiRegex = /<a\s+href="(\/Home\/Bangumi\/\d+)"[^>]*class="an-text"[^>]*title="([^"]*)"[^>]*>[^<]*<\/a>/g;
    let bangumiMatch;
    
    while ((bangumiMatch = bangumiRegex.exec(dayHtml)) !== null) {
      bangumiList.push({
        name: decodeHtmlEntities(bangumiMatch[2]),
        detailUrl: bangumiMatch[1],
      });
    }
    
    if (bangumiList.length > 0) {
      result.set(dayOfWeek, bangumiList);
    }
  }
  
  return result;
}

/**
 * 从详情页HTML中提取字幕组信息（id, name, rssUrl）
 */
function parseSubgroups(html: string): MikanSubtitleGroupInfo[] {
  const subgroups: MikanSubtitleGroupInfo[] = [];
  // 匹配: <a class="subgroup-name subgroup-370" data-anchor="#370">LoliHouse</a>
  // 和: <a href="/RSS/Bangumi?bangumiId=3941&subgroupid=370" class="mikan-rss"
  const regex = /class="subgroup-name subgroup-(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const id = parseInt(match[1], 10);
    const name = decodeHtmlEntities(match[2].replace(/<[^>]*>/g, '').trim());
    const rssUrl = `/RSS/Bangumi?bangumiId=0&subgroupid=${id}`; // bangumiId 由调用方替换
    subgroups.push({ id, name, rssUrl });
  }
  return subgroups;
}

/**
 * 从详情页HTML中提取字幕组资源
 * 实际结构: <tr> 包含 <input data-magnet="...">, 资源名在第二个 <td> 的 <a> 文本中
 */
function parseDetailPage(html: string): MikanSubtitleGroup[] {
  const resources: MikanSubtitleGroup[] = [];
  
  // 先提取字幕组信息
  const subgroups = parseSubgroups(html);
  const subgroupMap = new Map<number, MikanSubtitleGroupInfo>();
  for (const sg of subgroups) {
    subgroupMap.set(sg.id, sg);
  }
  
  // 匹配每个 <tr> 行
  const rowRegex = /<tr>\s*<td>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    
    // 提取磁力链接（从 input 的 data-magnet 属性）
    const magnetMatch = rowHtml.match(/data-magnet="([^"]+)"/);
    if (!magnetMatch) continue;
    
    // 解码HTML实体（&amp; → &）
    const magnet = magnetMatch[1].replace(/&amp;/g, '&');
    
    // 提取所有 td 内容
    const tdContents: string[] = [];
    const tdRegex = /<td>([\s\S]*?)<\/td>/g;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      tdContents.push(tdMatch[1]);
    }
    
    // td[0]: 资源名链接 (包含 <a class="magnet-link-wrap">)
    // td[1]: 文件大小
    // td[2]: 日期
    // td[3]: 下载链接
    // td[4]: 播放链接
    
    const name = tdContents[0] ? decodeHtmlEntities(tdContents[0].replace(/<[^>]*>/g, '').replace(/\[复制磁连\]/g, '').trim()) : '';
    const size = tdContents[1] ? tdContents[1].trim() : '';
    const date = tdContents[2] ? tdContents[2].trim() : '';
    
    // 提取 torrent 链接
    const torrentMatch = rowHtml.match(/href="(\/Download\/[^"]*\.torrent)"/);
    
    // 根据资源名匹配字幕组（如 [喵萌奶茶屋] 开头 → 找到对应 subgroup）
    let subgroupName = '';
    let subgroupRss = '';
    for (const sg of subgroups) {
      if (name.includes(sg.name) || name.includes(`[${sg.name}]`)) {
        subgroupName = sg.name;
        subgroupRss = sg.rssUrl;
        break;
      }
    }
    
    resources.push({
      name,
      size,
      date,
      downloadUrl: torrentMatch ? `https://mikanime.tv${torrentMatch[1]}` : magnet,
      type: torrentMatch ? 'torrent' : 'magnet',
      subgroupName,
      subgroupRss,
    });
  }
  
  return resources;
}

/**
 * 发起请求，支持备用域名
 */
async function fetchWithFallback(path: string, mirror: string): Promise<string> {
  const urls = [
    `${mirror}${path}`,
    `${MIKAN_FALLBACK}${path}`,
  ];
  
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': USER_AGENT },
      }, 10000);
      
      if (res.ok) {
        return await res.text();
      }
      logger.warn(`Mikan fetch failed (${res.status}): ${url}`);
    } catch (e: any) {
      logger.warn(`Mikan fetch error: ${url} - ${e.message}`);
    }
  }
  
  throw new Error('Failed to fetch from Mikan');
}

/**
 * 获取一周内更新的番剧列表
 */
export async function getWeeklyBangumi(mirror: string): Promise<Map<number, MikanBangumi[]>> {
  const html = await fetchWithFallback('/', mirror);
  return parseWeeklyBangumi(html);
}

/**
 * 获取指定季度的番剧列表
 * @param year 年份，如 2026
 * @param season 季度：春/夏/秋/冬
 */
export async function getSeasonBangumi(year: number, season: string, mirror: string): Promise<Map<number, MikanBangumi[]>> {
  // 蜜柑计划季度筛选通过JavaScript参数实现
  // 需要模拟AJAX请求或解析页面中的数据
  const html = await fetchWithFallback('/', mirror);
  
  // TODO: 实现季度筛选逻辑
  // 目前先返回一周新番
  logger.warn('Season filter not yet implemented, returning weekly bangumi');
  return parseWeeklyBangumi(html);
}

/**
 * 从详情页HTML中提取封面图
 */
function parseCover(html: string): string {
  // 匹配 /images/Bangumi/xxx.jpg
  const match = html.match(/src="(\/images\/Bangumi\/[^"]*\.(?:jpg|png|webp)[^"]*)"/);
  return match ? `https://mikanime.tv${match[1]}` : '';
}

/**
 * 获取番剧详情页的字幕组资源
 */
export async function getBangumiResources(detailUrl: string, mirror: string): Promise<MikanBangumiDetail> {
  const html = await fetchWithFallback(detailUrl, mirror);
  
  // 提取 bangumiId（从 URL /Home/Bangumi/3941 或 /RSS?bangumiId=3941）
  const bangumiIdMatch = detailUrl.match(/bangumiId=(\d+)/) || detailUrl.match(/\/Bangumi\/(\d+)/);
  const bangumiId = bangumiIdMatch ? bangumiIdMatch[1] : '';
  
  // 提取番名（从 <title> 或 og:title）
  const titleMatch = html.match(/<title>([^<]*)<\/title>/) || html.match(/property="og:title"[^>]*content="([^"]*)"/);
  const name = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/ - Mikan Project$/, '').replace(/^Mikan Project - /, '').trim()) : '';
  
  // 提取封面
  const cover = parseCover(html);
  
  // 提取字幕组
  const subgroups = parseSubgroups(html).map(sg => ({
    ...sg,
    rssUrl: `/RSS/Bangumi?bangumiId=${bangumiId}&subgroupid=${sg.id}`,
  }));
  
  // 提取资源
  const resources = parseDetailPage(html).map(r => ({
    ...r,
    subgroupRss: (r.subgroupRss || '').replace(/bangumiId=\d+/, `bangumiId=${bangumiId}`),
  }));
  
  return { name, cover, subgroups, resources };
}

export default {
  getWeeklyBangumi,
  getSeasonBangumi,
  getBangumiResources,
};
