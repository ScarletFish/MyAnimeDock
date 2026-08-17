// server/routes/discovery.ts — 浏览、扫描、导入、元数据匹配
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { jsonResp, readBody, getFfmpegPath } from '../lib/utils';
import { saveScannedTree, DATA_DIR } from '../lib/config';
import type { ServerState, ScanNode } from '../types';

type State = ServerState;

/** 时长探测缓存：filePath -> 秒，避免重复探测 */
const _durCache = new Map<string, number>();

/** 探测视频时长（秒）。失败返回 null。结果缓存避免重复探测。 */
function _probeDuration(filePath: string): Promise<number | null> {
  const cached = _durCache.get(filePath);
  if (cached !== undefined) return Promise.resolve(cached);
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ff = spawn(ffmpegPath, ['-i', filePath, '-loglevel', 'error']);
    let stderr = '';
    let done = false;
    ff.stderr.on('data', (d) => { stderr += d.toString(); });
    const finish = () => {
      if (done) return; done = true;
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) {
        const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        _durCache.set(filePath, secs);
        resolve(secs);
      } else {
        resolve(null);
      }
    };
    ff.on('close', finish);
    ff.on('error', () => { if (!done) { done = true; resolve(null); } });
    setTimeout(() => { if (!done) { done = true; ff.kill(); resolve(null); } }, 10000);
  });
}

/** 批量探测剧集时长并写回 ep.duration（并发 4）。探测失败保持 null，不阻塞导入。 */
async function _probeEpisodes(episodes: Array<{ filePath: string; duration: number | null }>): Promise<void> {
  const CONCURRENCY = 4;
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, episodes.length) }, async () => {
    while (idx < episodes.length) {
      const ep = episodes[idx++];
      if (ep.duration && ep.duration > 0) continue;
      const dur = await _probeDuration(ep.filePath);
      if (dur && dur > 0) ep.duration = dur;
    }
  });
  await Promise.all(workers);
}

async function handleBrowse(req: any, res: any, state: State) {
    const { data, config, logger } = state;
    if (!config.mediaDir) {
      jsonResp(res, 200, { tree: [], mediaDir: '' });
      return;
    }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const showExcluded = params.get('showExcluded') === 'true';
    try {
      let tree: ScanNode[] = JSON.parse(JSON.stringify(data.scannedTree || [])) as ScanNode[];
      // Migrate old tree format
      if (tree.some((n) => n.type === 'branch')) {
        const flatten = (nodes: ScanNode[]): ScanNode[] => {
          const result: ScanNode[] = [];
          for (const n of nodes) {
            if (n.type === 'leaf') result.push(n);
            else if (n.type === 'branch' && n.children) result.push(...flatten(n.children));
          }
          return result;
        };
        tree = flatten(tree);
        data.scannedTree = tree;
        await saveScannedTree(data.scannedTree);
      }
      for (const n of tree) {
        if (n.type === 'leaf' && n.parsedSeason === 1) n.parsedSeason = null;
      }
      const libraryBgmIds = new Set(data.library.filter(a => a.bangumiId).map(a => a.bangumiId));
      const libraryPaths = new Set(data.library.map(a => a.folderPath));
      for (const n of tree) {
        if (n.type === 'leaf') {
          // 匹配优先级：bangumiId（内容身份）→ folderPath 兜底（手动条目无 bangumiId）
          n.alreadyImported = (n.bangumiId != null && libraryBgmIds.has(n.bangumiId)) || libraryPaths.has(n.path);
          if (n.excluded === undefined) n.excluded = false;
          if (n.bangumiMatched === undefined) n.bangumiMatched = false;
        }
      }
      const filteredTree = showExcluded ? tree : tree.filter(n => !n.excluded);
      jsonResp(res, 200, { tree: filteredTree, mediaDir: config.mediaDir });
    } catch (e: any) {
      jsonResp(res, 500, { error: e.message });
    }
  }

  async function handleScan(req: any, res: any, state: State) {
    const { data, config, logger, pendingNotifications } = state;
    if (!config.mediaDir) {
      jsonResp(res, 400, { error: 'Media directory not configured' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const send = (obj: any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    try {
      const { scanTopDir } = require('../scanner') as any;
      const entries = await fs.promises.readdir(config.mediaDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && e.name !== 'covers');
      const total = dirs.length;
      const tree = [];
      const libraryBgmIds = new Set(data.library.filter(a => a.bangumiId).map(a => a.bangumiId));
      const libraryPaths = new Set(data.library.map(a => a.folderPath));
      const existingNodes = new Map<string, ScanNode>((data.scannedTree || []).map(n => [n.path, n] as [string, ScanNode]));
      for (let i = 0; i < dirs.length; i++) {
        const entry = dirs[i];
        send({ type: 'progress', current: i + 1, total, folder: entry.name });
        const node = await scanTopDir(config.mediaDir, entry.name);
        if (node) {
          (function flatten(n: ScanNode) {
            if (n.type === 'leaf') {
              // 匹配优先级：bangumiId（内容身份）→ folderPath 兜底（手动条目无 bangumiId）
              n.alreadyImported = (n.bangumiId != null && libraryBgmIds.has(n.bangumiId)) || libraryPaths.has(n.path);
              const existing = existingNodes.get(n.path);
              if (existing) {
                n.excluded = existing.excluded || false;
                n.bangumiMatched = existing.bangumiMatched || false;
                // 扫描从文件夹名提取的 [bgmN] 优先于缓存值
                if (n.bangumiId == null) n.bangumiId = existing.bangumiId;
                n.bangumiTitle = existing.bangumiTitle;
                n.bangumiTitleJp = existing.bangumiTitleJp;
                n.summary = existing.summary;
                n.localCover = existing.localCover;
                n.rating = existing.rating;
              } else {
                n.excluded = false;
                n.bangumiMatched = false;
              }
              tree.push(n);
            } else if (n.type === 'branch' && n.children) {
              n.children.forEach(flatten);
            }
          })(node);
        }
      }
      data.scannedTree = tree;
      await saveScannedTree(data.scannedTree);
      send({ type: 'done', tree });
    } catch (e: any) {
      send({ type: 'error', message: e.message });
    }
    res.end();
  }

  async function handleImport(req: any, res: any, state: State) {
    const { data, config, db, bangumiSync, logger, pendingNotifications } = state;
    try {
      const body = await readBody(req);
      const { items } = JSON.parse(body);
      if (!Array.isArray(items) || items.length === 0) {
        jsonResp(res, 400, { error: 'items array is required' });
        return;
      }
      const { findVideos, isExtraVideo } = require('../scanner') as any;
      const imported = [];
      const allEpisodes: Array<{ filePath: string; duration: number | null }> = [];
      for (const item of items) {
        const { folderPath, folderName, parsedTitle, parsedSeason, specialSuffix } = item;
        if (!folderPath || !folderName) continue;
        const videos = await findVideos(folderPath);
        const episodeFiles = videos.filter((v: any) => !isExtraVideo(v.name));
        const scannedNode = data.scannedTree.find(n => n.path === folderPath);
        // 匹配优先级：bangumiId（内容身份）→ folderPath 兜底（手动条目无 bangumiId）
        const existing = scannedNode?.bangumiId
          ? (data.library.find(a => a.bangumiId === scannedNode.bangumiId) || data.library.find(a => a.folderPath === folderPath))
          : data.library.find(a => a.folderPath === folderPath);
        if (existing) {
          if (existing.downloaded !== false) continue;
          existing.downloaded = true;
          existing.importedAt = new Date().toISOString();
          existing.folderPath = folderPath;
          existing.folderName = folderName;
          existing.episodes = episodeFiles.map((v: any, i: any) => ({
            number: i + 1, filePath: v.path, fileName: v.name, fileSize: v.size,
            duration: null, watched: false, progress: 0,
          }));
          allEpisodes.push(...existing.episodes);
          imported.push(existing.id);
          if (scannedNode) scannedNode.excluded = false;
          continue;
        }
        const anime: any = {
          id: crypto.randomUUID(),
          folderPath, folderName, title: parsedTitle,
          season: parsedSeason || null, specialSuffix: specialSuffix || null,
          importedAt: new Date().toISOString(), downloaded: true,
          anilistId: scannedNode?.anilistId || null,
          bangumiId: scannedNode?.bangumiId || null,
          bangumiTitle: scannedNode?.bangumiTitle || null,
          bangumiTitleJp: scannedNode?.bangumiTitleJp || null,
          summary: scannedNode?.summary || null,
          localCover: scannedNode?.localCover || null,
          rating: scannedNode?.rating || null,
          tags: scannedNode?.tags || [],
          episodes: episodeFiles.map((v: any, i: any) => ({
            number: i + 1, filePath: v.path, fileName: v.name, fileSize: v.size,
            duration: null, watched: false, progress: 0,
          })),
        };
        allEpisodes.push(...anime.episodes);
        data.library.push(anime);
        imported.push(anime.id);
        if (!data.myList) data.myList = [];
        if (!data.myList.find(m => m.animeId === anime.id)) {
          data.myList.push({ animeId: anime.id, status: 'wish', rating: null, thoughts: '', notes: '' } as any);
        }
        if (anime.bangumiId) {
          const wishIdx = data.myList.findIndex(m => !m.animeId && m.bangumiId === anime.bangumiId);
          if (wishIdx !== -1) data.myList.splice(wishIdx, 1);
        }
        if (scannedNode) scannedNode.excluded = false;
        if (anime.bangumiId) {
          bangumiSync.pushStatusChange(anime.id, data);
        }
      }
      // 批量探测剧集时长并写回 ep.duration（落盘前完成）
      await _probeEpisodes(allEpisodes);
      // 先存初始数据（暂无封面的条目）
      await db.saveLibrary(data, new Set(imported));
      await db.saveMyList(data);
      await saveScannedTree(data.scannedTree);
      jsonResp(res, 200, { ok: true, imported });
      // 后台生成缩略图（不影响封面显示）
      imported.forEach((id: any) => {
        const anime = data.library.find(a => a.id === id);
        if (anime) {
          state.thumbnailQueue?.enqueue(anime);
        }
      });
    } catch (e: any) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  }

  async function handleDiscoveryUnlink(req: any, res: any, state: State) {
    const { data, db } = state;
    try {
      const body = await readBody(req);
      const { path: folderPath } = JSON.parse(body);
      if (!folderPath) { jsonResp(res, 400, { error: 'path is required' }); return; }
      const idx = data.library.findIndex(a => a.folderPath === folderPath);
      if (idx === -1) { jsonResp(res, 404, { error: 'Anime not found in library' }); return; }
      const removed = data.library.splice(idx, 1)[0];
      if (data.myList) {
        const myIdx = data.myList.findIndex(m => m.animeId === removed.id);
        if (myIdx !== -1) data.myList.splice(myIdx, 1);
      }
      const scannedNode = data.scannedTree && data.scannedTree.find(n => n.path === folderPath);
      if (scannedNode) {
        scannedNode.alreadyImported = false;
        scannedNode.bangumiMatched = false;
        scannedNode.bangumiId = null;
        scannedNode.bangumiTitle = null;
        scannedNode.bangumiTitleJp = null;
        scannedNode.bangumiTitleEn = null;
        scannedNode.summary = null;
        scannedNode.localCover = null;
        scannedNode.rating = null;
        scannedNode.metadataSource = null;
      }
      await saveScannedTree(data.scannedTree);
      await db.saveLibrary(data, new Set());
      await db.saveMyList(data);
      jsonResp(res, 200, { ok: true });
    } catch (e: any) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  }

  async function handleDiscoveryExclude(req: any, res: any, state: State) {
    const { data } = state;
    try {
      const body = await readBody(req);
      const { path: folderPath } = JSON.parse(body);
      if (!folderPath) { jsonResp(res, 400, { error: 'path is required' }); return; }
      const node = data.scannedTree.find(n => n.path === folderPath);
      if (!node) { jsonResp(res, 404, { error: 'Node not found in scanned tree' }); return; }
      node.excluded = true;
      await saveScannedTree(data.scannedTree);
      jsonResp(res, 200, { ok: true });
    } catch (e: any) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  }

  async function handleDiscoveryInclude(req: any, res: any, state: State) {
    const { data } = state;
    try {
      const body = await readBody(req);
      const { path: folderPath } = JSON.parse(body);
      if (!folderPath) { jsonResp(res, 400, { error: 'path is required' }); return; }
      const node = data.scannedTree.find(n => n.path === folderPath);
      if (!node) { jsonResp(res, 404, { error: 'Node not found in scanned tree' }); return; }
      node.excluded = false;
      await saveScannedTree(data.scannedTree);
      jsonResp(res, 200, { ok: true });
    } catch (e: any) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  }

export {
    handleBrowse,
    handleScan,
    handleImport,
    handleDiscoveryUnlink,
    handleDiscoveryExclude,
    handleDiscoveryInclude,
};
