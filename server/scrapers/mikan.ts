// server/scrapers/mikan.ts — 蜜柑计划抓取器
import { fetchWithTimeout, USER_AGENT } from '../lib/http-fetch';
import { Logger } from '../logger';
import type { MikanBangumi, MikanSubgroupWithResources, MikanBangumiDetail } from '../types';

const logger: Logger = require('../logger').child('[MIKAN]');

const MIKAN_FALLBACK = 'https://mikanani.me';

/**
 * 解码HTML实体（如 &#x55B5; → 喵, &amp; → &）
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
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
    // 封面在附近: <img data-src="/images/Bangumi/xxx.jpg" ...>
    const bangumiRegex = /<a\s+href="(\/Home\/Bangumi\/\d+)"[^>]*class="an-text"[^>]*title="([^"]*)"[^>]*>[^<]*<\/a>/g;
    let bangumiMatch;
    
    while ((bangumiMatch = bangumiRegex.exec(dayHtml)) !== null) {
      // 向前找封面图
      const beforeHtml = dayHtml.slice(Math.max(0, bangumiMatch.index - 500), bangumiMatch.index);
      const coverMatch = beforeHtml.match(/data-src="([^"]*\/images\/Bangumi\/[^"]*)"/);
      const cover = coverMatch ? coverMatch[1] : '';
      
      bangumiList.push({
        name: decodeHtmlEntities(bangumiMatch[2]),
        detailUrl: bangumiMatch[1],
        cover,
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
function parseSubgroups(html: string): Array<{ id: number; name: string }> {
  const subgroups: Array<{ id: number; name: string }> = [];
  // 匹配: <a class="subgroup-name subgroup-370" data-anchor="#370">LoliHouse</a>
  const regex = /class="subgroup-name subgroup-(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const id = parseInt(match[1], 10);
    const name = decodeHtmlEntities(match[2].replace(/<[^>]*>/g, '').trim());
    subgroups.push({ id, name });
  }
  return subgroups;
}

/**
 * 从详情页HTML中提取字幕组资源
 * HTML结构: 每个字幕组有一个 <div class="subgroup-scroll-top-{id}"> 到 <div class="subgroup-scroll-end-{id}"> 的区间
 * 资源在区间内的 <tr> 中
 */
function parseDetailPage(html: string): Array<{
  name: string;
  size: string;
  date: string;
  downloadUrl: string;
  type: 'magnet' | 'torrent';
  subgroupName: string;
  subgroupIdx: number;
}> {
  const resources: Array<{
    name: string;
    size: string;
    date: string;
    downloadUrl: string;
    type: 'magnet' | 'torrent';
    subgroupName: string;
    subgroupIdx: number;
  }> = [];
  
  // 先提取字幕组信息
  const subgroups = parseSubgroups(html);
  
  // 按字幕组分段提取资源
  // 每个字幕组的区间: <div class="subgroup-scroll-top-{id}"> ... <div class="subgroup-scroll-end-{id}">
  for (let i = 0; i < subgroups.length; i++) {
    const sg = subgroups[i];
    const startMarker = `subgroup-scroll-top-${sg.id}`;
    const endMarker = `subgroup-scroll-end-${sg.id}`;
    
    const startIdx = html.indexOf(startMarker);
    const endIdx = html.indexOf(endMarker);
    
    if (startIdx === -1 || endIdx === -1) continue;
    
    const sectionHtml = html.slice(startIdx, endIdx);
    
    // 在该区间内匹配 <tr> 行
    const rowRegex = /<tr>\s*<td>([\s\S]*?)<\/tr>/g;
    let rowMatch;
    
    while ((rowMatch = rowRegex.exec(sectionHtml)) !== null) {
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
      
      // td[0]: 资源名链接
      // td[1]: 文件大小
      // td[2]: 日期
      
      const name = tdContents[0] ? decodeHtmlEntities(tdContents[0].replace(/<[^>]*>/g, '').replace(/\[复制磁连\]/g, '').trim()) : '';
      const size = tdContents[1] ? tdContents[1].trim() : '';
      const date = tdContents[2] ? tdContents[2].trim() : '';
      
      // 提取 torrent 链接
      const torrentMatch = rowHtml.match(/href="(\/Download\/[^"]*\.torrent)"/);
      
      resources.push({
        name,
        size,
        date,
        downloadUrl: torrentMatch ? `https://mikanime.tv${torrentMatch[1]}` : magnet,
        type: torrentMatch ? 'torrent' : 'magnet',
        subgroupName: sg.name,
        subgroupIdx: i,
      });
    }
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
 * 通过 AJAX 接口获取字幕组的完整资源列表
 * Mikan 初始页只显示15条，需要调用 ExpandEpisodeTable 获取全部
 */
async function fetchFullEpisodeList(
  bangumiId: string,
  subgroupId: number,
  mirror: string
): Promise<Array<{ name: string; size: string; date: string; downloadUrl: string; type: 'magnet' | 'torrent' }>> {
  const path = `/Home/ExpandEpisodeTable?bangumiId=${bangumiId}&subtitleGroupId=${subgroupId}&take=9999`;
  
  let html = '';
  const urls = [`${mirror}${path}`, `${MIKAN_FALLBACK}${path}`];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': USER_AGENT },
      }, 15000);
      if (res.ok) {
        html = await res.text();
        break;
      }
    } catch {
      // try next url
    }
  }
  
  if (!html) return [];
  
  const resources: Array<{ name: string; size: string; date: string; downloadUrl: string; type: 'magnet' | 'torrent' }> = [];
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    
    const magnetMatch = rowHtml.match(/data-magnet="([^"]+)"/);
    if (!magnetMatch) continue;
    
    const magnet = magnetMatch[1].replace(/&amp;/g, '&');
    
    const tdContents: string[] = [];
    const tdRegex = /<td>([\s\S]*?)<\/td>/g;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      tdContents.push(tdMatch[1]);
    }
    
    // AJAX response: td[0]=checkbox, td[1]=name, td[2]=size, td[3]=date, td[4]=download, td[5]=play
    const nameHtml = tdContents[1] || '';
    const nameMatch = nameHtml.match(/<a[^>]*>([^<]+)<\/a>/);
    const name = nameMatch ? decodeHtmlEntities(nameMatch[1].trim()) : '';
    
    const size = (tdContents[2] || '').replace(/<[^>]*>/g, '').trim();
    const date = (tdContents[3] || '').replace(/<[^>]*>/g, '').trim();
    
    const torrentMatch = rowHtml.match(/href="(\/Download\/[^"]*\.torrent)"/);
    
    resources.push({
      name,
      size,
      date,
      downloadUrl: torrentMatch ? `https://mikanime.tv${torrentMatch[1]}` : magnet,
      type: torrentMatch ? 'torrent' : 'magnet',
    });
  }
  
  return resources;
}

/**
 * 获取番剧详情页的字幕组资源（初始页，每个字幕组最多15条，快速）
 */
export async function getBangumiResources(detailUrl: string, mirror: string): Promise<MikanBangumiDetail> {
  const html = await fetchWithFallback(detailUrl, mirror);
  
  // 提取 bangumiId（从 URL /Home/Bangumi/3941 或 /RSS?bangumiId=3941）
  const bangumiIdMatch = detailUrl.match(/bangumiId=(\d+)/) || detailUrl.match(/\/Bangumi\/(\d+)/);
  const bangumiId = bangumiIdMatch ? bangumiIdMatch[1] : '';
  
  // 提取 Bangumi ID（从 bgm.tv/subject/xxx 链接）
  const bgmLinkMatch = html.match(/bgm\.tv\/subject\/(\d+)/);
  const bgmId = bgmLinkMatch ? bgmLinkMatch[1] : '';
  
  // 提取番名（从 <title> 或 og:title）
  const titleMatch = html.match(/<title>([^<]*)<\/title>/) || html.match(/property="og:title"[^>]*content="([^"]*)"/);
  const name = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/ - Mikan Project$/, '').replace(/^Mikan Project - /, '').trim()) : '';
  
  // 提取封面
  const cover = parseCover(html);
  
  // 提取字幕组
  const subgroupsRaw = parseSubgroups(html);
  
  // 从详情页 HTML 提取初始资源（每个字幕组最多15条，无需 AJAX，快速）
  const initialResources = parseDetailPage(html);
  const initialBySubgroupIdx = new Map<number, Array<{ name: string; size: string; date: string; downloadUrl: string; type: 'magnet' | 'torrent' }>>();
  for (const r of initialResources) {
    const list = initialBySubgroupIdx.get(r.subgroupIdx) || [];
    list.push({ name: r.name, size: r.size, date: r.date, downloadUrl: r.downloadUrl, type: r.type });
    initialBySubgroupIdx.set(r.subgroupIdx, list);
  }
  
  // 构建返回结构：字幕组包含各自资源
  const subgroups: MikanSubgroupWithResources[] = subgroupsRaw.map((sg, idx) => {
    const resources = (initialBySubgroupIdx.get(idx) || []).map(r => ({
      name: r.name,
      size: r.size,
      date: r.date,
      downloadUrl: r.downloadUrl,
      type: r.type,
    }));
    logger.info(`[MIKAN] Subgroup "${sg.name}": ${resources.length} resources (initial)`);
    return {
      id: sg.id,
      name: sg.name,
      rssUrl: `/RSS/Bangumi?bangumiId=${bangumiId}&subgroupid=${sg.id}`,
      resources,
    };
  });
  
  return { name, cover, bgmId, subgroups };
}

/**
 * 获取指定字幕组的完整资源列表（通过 AJAX，慢但全）
 */
export async function getSubgroupFullResources(
  detailUrl: string,
  subgroupId: number,
  mirror: string
): Promise<Array<{ name: string; size: string; date: string; downloadUrl: string; type: 'magnet' | 'torrent' }>> {
  const html = await fetchWithFallback(detailUrl, mirror);
  const bangumiIdMatch = detailUrl.match(/bangumiId=(\d+)/) || detailUrl.match(/\/Bangumi\/(\d+)/);
  const bangumiId = bangumiIdMatch ? bangumiIdMatch[1] : '';
  if (!bangumiId) return [];
  return fetchFullEpisodeList(bangumiId, subgroupId, mirror);
}

export default {
  getWeeklyBangumi,
  getSeasonBangumi,
  getBangumiResources,
  getSubgroupFullResources,
};
