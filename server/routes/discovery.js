// server/routes/discovery.js — 浏览、扫描、导入、元数据匹配
const path = require('path');
const fs = require('fs');
const { jsonResp, readBody } = require('../lib/utils');
const { saveScannedTree, DATA_DIR } = require('../lib/config');
const { syncAnilist } = require('../scrapers');

module.exports = {
  async handleBrowse(req, res, state) {
    const { data, config, logger } = state;
    if (!config.mediaDir) {
      jsonResp(res, 200, { tree: [], mediaDir: '' });
      return;
    }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const showExcluded = params.get('showExcluded') === 'true';
    try {
      let tree = JSON.parse(JSON.stringify(data.scannedTree || []));
      // Migrate old tree format
      if (tree.some(n => n.type === 'branch')) {
        const flatten = (nodes) => {
          const result = [];
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
      const libraryPaths = new Set(data.library.map(a => a.folderPath));
      for (const n of tree) {
        if (n.type === 'leaf') {
          n.alreadyImported = libraryPaths.has(n.path);
          if (n.excluded === undefined) n.excluded = false;
          if (n.bangumiMatched === undefined) n.bangumiMatched = false;
        }
      }
      const filteredTree = showExcluded ? tree : tree.filter(n => !n.excluded);
      jsonResp(res, 200, { tree: filteredTree, mediaDir: config.mediaDir });
    } catch (e) {
      jsonResp(res, 500, { error: e.message });
    }
  },

  async handleScan(req, res, state) {
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
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    try {
      const { scanTopDir } = require('../scanner');
      const entries = await fs.promises.readdir(config.mediaDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && e.name !== 'covers');
      const total = dirs.length;
      const tree = [];
      const libraryPaths = new Set(data.library.map(a => a.folderPath));
      const existingNodes = new Map((data.scannedTree || []).map(n => [n.path, n]));
      for (let i = 0; i < dirs.length; i++) {
        const entry = dirs[i];
        send({ type: 'progress', current: i + 1, total, folder: entry.name });
        const node = await scanTopDir(config.mediaDir, entry.name);
        if (node) {
          (function flatten(n) {
            if (n.type === 'leaf') {
              n.alreadyImported = libraryPaths.has(n.path);
              const existing = existingNodes.get(n.path);
              if (existing) {
                n.excluded = existing.excluded || false;
                n.bangumiMatched = existing.bangumiMatched || false;
                // 扫描从文件夹名提取的 [bgmN] 优先于缓存值
                if (n.bangumiId == null) n.bangumiId = existing.bangumiId;
                n.bangumiTitle = existing.bangumiTitle;
                n.bangumiTitleJp = existing.bangumiTitleJp;
                n.summary = existing.summary;
                n.coverUrl = existing.coverUrl;
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
    } catch (e) {
      send({ type: 'error', message: e.message });
    }
    res.end();
  },

  async handleImport(req, res, state) {
    const { data, config, db, bangumiSync, logger, pendingNotifications } = state;
    try {
      const body = await readBody(req);
      const { items } = JSON.parse(body);
      if (!Array.isArray(items) || items.length === 0) {
        jsonResp(res, 400, { error: 'items array is required' });
        return;
      }
      const { findVideos, isExtraVideo } = require('../scanner');
      const imported = [];
      for (const item of items) {
        const { folderPath, folderName, parsedTitle, parsedSeason, specialSuffix } = item;
        if (!folderPath || !folderName) continue;
        const videos = await findVideos(folderPath);
        const episodeFiles = videos.filter(v => !isExtraVideo(v.name));
        const scannedNode = data.scannedTree.find(n => n.path === folderPath);
        const existing = data.library.find(a => a.folderPath === folderPath);
        if (existing) {
          if (existing.downloaded !== false) continue;
          existing.downloaded = true;
          existing.importedAt = new Date().toISOString();
          existing.episodes = episodeFiles.map((v, i) => ({
            number: i + 1, filePath: v.path, fileName: v.name, fileSize: v.size,
            duration: null, watched: false, progress: 0,
          }));
          imported.push(existing.id);
          if (scannedNode) scannedNode.excluded = false;
          continue;
        }
        const anime = {
          id: parsedTitle + (parsedSeason ? `-Season ${parsedSeason}` : ''),
          folderPath, folderName, title: parsedTitle,
          season: parsedSeason || null, specialSuffix: specialSuffix || null,
          importedAt: new Date().toISOString(), downloaded: true,
          anilistId: scannedNode?.anilistId || null,
          bangumiId: scannedNode?.bangumiId || null,
          bangumiTitle: scannedNode?.bangumiTitle || null,
          bangumiTitleJp: scannedNode?.bangumiTitleJp || null,
          summary: scannedNode?.summary || null,
          coverUrl: scannedNode?.coverUrl || null,
          localCover: scannedNode?.localCover || null,
          rating: scannedNode?.rating || null,
          tags: scannedNode?.tags || [],
          episodes: episodeFiles.map((v, i) => ({
            number: i + 1, filePath: v.path, fileName: v.name, fileSize: v.size,
            duration: null, watched: false, progress: 0,
          })),
        };
        data.library.push(anime);
        imported.push(anime.id);
        if (!data.myList) data.myList = [];
        if (!data.myList.find(m => m.animeId === anime.id)) {
          data.myList.push({ animeId: anime.id, status: 'wish', rating: null, thoughts: '', notes: '' });
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
      // 先存初始数据（暂无封面的条目）
      await db.saveLibrary(data);
      await db.saveMyList(data);
      await saveScannedTree(data.scannedTree);
      jsonResp(res, 200, { ok: true, imported });
      // 后台拉取 AniList banner（不影响封面显示）
      const bannerDir = path.join(DATA_DIR, 'banners');
      const coverDir = path.join(DATA_DIR, 'covers');
      imported.forEach(id => {
        const anime = data.library.find(a => a.id === id);
        if (anime) {
          state.thumbnailQueue?.enqueue(anime);
        }
        if (anime && anime.bangumiId) {
          syncAnilist(anime, config, bannerDir, coverDir)
            .then(() => db.saveLibrary(data))
            .catch(e => logger.warn(`AniList sync failed for ${id}: ${e.message}`));
        }
      });
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },

  async handleDiscoveryUnlink(req, res, state) {
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
        scannedNode.coverUrl = null;
        scannedNode.localCover = null;
        scannedNode.rating = null;
        scannedNode.metadataSource = null;
      }
      await saveScannedTree(data.scannedTree);
      await db.saveLibrary(data);
      await db.saveMyList(data);
      jsonResp(res, 200, { ok: true });
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },

  async handleDiscoveryExclude(req, res, state) {
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
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },

  async handleDiscoveryInclude(req, res, state) {
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
    } catch (e) {
      jsonResp(res, 400, { error: 'Invalid request body' });
    }
  },
};
