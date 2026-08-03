// @ts-nocheck
// server/routes/db-manager.js — 数据库管理：信息、备份、恢复、清除、重置、优化
const path = require('path');
const fs = require('fs');
const { jsonResp, readBody } = require('../lib/utils');
const { DATA_DIR, CONFIG_PATH, SCANNED_TREE_PATH } = require('../lib/config');

// 推导 DB 文件路径（与 db.js 的 DATA_DIR 计算逻辑保持一致）
// db.js: __dirname=server/ → path.join(__dirname,'..')=项目根目录 → DB=项目根目录/prisma/anime.db
// 本文件: __dirname=server/routes/ → path.join(__dirname,'..','..')=项目根目录
const APP_ROOT = process.pkg
  ? (process.env.APPDATA || process.env.HOME || '.')
  : path.join(__dirname, '..', '..');
const DB_FILE = process.pkg
  ? path.join(APP_ROOT, 'MyAnimeDock', 'anime.db')
  : path.join(APP_ROOT, 'prisma', 'anime.db');

// 缓存目录
const CACHE_DIRS = {
  thumbs: path.join(DATA_DIR, 'thumbs'),
  covers: path.join(DATA_DIR, 'covers'),
  banners: path.join(DATA_DIR, 'banners'),
};

function dirSize(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return { size: 0, files: 0 };
    let size = 0, files = 0;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fp = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        try { size += fs.statSync(fp).size; files++; } catch (_) {}
      } else if (entry.isDirectory() && entry.name !== '.resized') {
        // 递归计算子目录
        const sub = dirSize(fp);
        size += sub.size; files += sub.files;
      }
    }
    return { size, files };
  } catch (_) {
    return { size: 0, files: 0 };
  }
}

module.exports = {

  // GET /api/db/info — 数据库状态信息
  async handleDbInfo(req, res, state) {
    const { data } = state;
    const info = {
      dbPath: DB_FILE,
      dbExists: fs.existsSync(DB_FILE),
      dbSize: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0,
      configSize: fs.existsSync(CONFIG_PATH) ? fs.statSync(CONFIG_PATH).size : 0,
      scannedTreeSize: fs.existsSync(SCANNED_TREE_PATH) ? fs.statSync(SCANNED_TREE_PATH).size : 0,
      counts: {
        anime: data?.library?.length || 0,
        episodes: (data?.library || []).reduce((sum, a) => sum + (a.episodes?.length || 0), 0),
        playSessions: data?.playSessions?.length || 0,
        myList: data?.myList?.length || 0,
      },
      dataDir: DATA_DIR,
      cache: {
        thumbs: { ...dirSize(CACHE_DIRS.thumbs), path: CACHE_DIRS.thumbs },
        covers: { ...dirSize(CACHE_DIRS.covers), path: CACHE_DIRS.covers },
        banners: { ...dirSize(CACHE_DIRS.banners), path: CACHE_DIRS.banners },
      },
    };
    jsonResp(res, 200, info);
  },

  // GET /api/db/backup — 下载数据库文件
  handleDbBackup(req, res) {
    if (!fs.existsSync(DB_FILE)) {
      jsonResp(res, 404, { error: '数据库文件不存在' });
      return;
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `myanimedock-backup-${dateStr}.db`;
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': fs.statSync(DB_FILE).size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(DB_FILE).pipe(res);
  },

  // POST /api/db/backup/download-all — 打包下载全部数据文件（DB + config + scanned-tree）
  async handleDbBackupAll(req, res) {
    // 收集所有需要打包的文件
    const files = [];
    if (fs.existsSync(DB_FILE)) {
      files.push({ path: DB_FILE, name: 'anime.db' });
    }
    if (fs.existsSync(CONFIG_PATH)) {
      files.push({ path: CONFIG_PATH, name: 'config.json' });
    }
    if (fs.existsSync(SCANNED_TREE_PATH)) {
      files.push({ path: SCANNED_TREE_PATH, name: 'scanned-tree.json' });
    }
    if (files.length === 0) {
      jsonResp(res, 404, { error: '没有可备份的数据文件' });
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `myanimedock-full-backup-${dateStr}.zip`;

    // 用 Node.js 原生 zlib 生成 zip（仅含单个文件的简单 zip，无目录结构）
    // 对于多文件，用 tar 方式更简便：直接读取所有文件内容拼成 JSON
    // 更实用的做法：直接返回一个 JSON 包含所有文件内容的 base64
    // 但最简单用户体验：逐个下载，或打包成 tar
    
    // 使用最简单方式：返回一个 JSON 清单，前端逐个下载
    // 或使用流式 zip (archiver 依赖不在项目中)
    // 改用 JSON bundle 方案：所有文件打包成一个 JSON 文件
    try {
      const bundle = {};
      for (const f of files) {
        bundle[f.name] = fs.readFileSync(f.path).toString('base64');
      }
      const json = JSON.stringify(bundle);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${fileName.replace('.zip', '.json')}"`,
        'Content-Length': Buffer.byteLength(json),
      });
      res.end(json);
    } catch (e) {
      jsonResp(res, 500, { error: '打包失败: ' + e.message });
    }
  },

  // POST /api/db/restore — 恢复数据库（上传 .db 文件，base64 编码）
  async handleDbRestore(req, res, state) {
    try {
      const body = await readBody(req);
      const { file } = JSON.parse(body);
      if (!file) {
        jsonResp(res, 400, { error: '请选择要恢复的备份文件' });
        return;
      }

      // 确保备份目录存在
      const backupDir = path.join(DATA_DIR, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      // 先备份当前 DB（以防恢复失败）
      if (fs.existsSync(DB_FILE)) {
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
        const autoBackupPath = path.join(backupDir, `pre-restore-${dateStr}.db`);
        fs.copyFileSync(DB_FILE, autoBackupPath);
      }

      // 解码并写入临时文件
      const buffer = Buffer.from(file, 'base64');
      const tempPath = path.join(backupDir, 'restore-temp.db');
      fs.writeFileSync(tempPath, buffer);

      // 验证：尝试用 SQLite 头检查（SQLite 格式以 "SQLite format 3\0" 开头）
      const header = buffer.slice(0, 16).toString('utf8');
      if (!header.startsWith('SQLite format 3')) {
        fs.unlinkSync(tempPath);
        jsonResp(res, 400, { error: '文件不是有效的 SQLite 数据库' });
        return;
      }

      // 关闭当前 Prisma 连接
      await state.db.shutdown();

      // 替换数据库文件
      fs.copyFileSync(tempPath, DB_FILE);
      fs.unlinkSync(tempPath);

      // 重新初始化数据
      await state.db.ensureSchema();
      const newData = await state.db.loadData();
      if (newData) {
        Object.assign(state.data, newData);
      }

      jsonResp(res, 200, { ok: true, message: '数据库恢复成功' });
    } catch (e) {
      jsonResp(res, 500, { error: '恢复失败: ' + e.message });
    }
  },

  // POST /api/db/clear-sessions — 清除播放记录
  async handleDbClearSessions(req, res, state) {
    try {
      const body = await readBody(req);
      await state.db.clearSessions();

      // 重新加载数据
      const newData = await state.db.loadData();
      if (newData) {
        // 合并：保留 library/myList，只替换 playSessions
        state.data.playSessions = newData.playSessions || [];
      } else {
        state.data.playSessions = [];
      }

      jsonResp(res, 200, { ok: true, message: '播放记录已清除' });
    } catch (e) {
      jsonResp(res, 500, { error: '清除失败: ' + e.message });
    }
  },

  // POST /api/db/vacuum — SQLite VACUUM 优化
  async handleDbVacuum(req, res, state) {
    try {
      // VACUUM 不能在事务中执行，db.vacuum() 内部直接执行（better-sqlite3）
      await state.db.vacuum();
      
      const newSize = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0;
      jsonResp(res, 200, { ok: true, message: '数据库优化完成', dbSize: newSize });
    } catch (e) {
      jsonResp(res, 500, { error: 'VACUUM 失败: ' + e.message });
    }
  },

  // POST /api/db/clear-cache — 清除缓存文件（封面/缩略图/横幅）
  async handleDbClearCache(req, res, state) {
    try {
      const body = await readBody(req);
      const { target } = JSON.parse(body || '{}');
      const targets = target ? [target] : ['thumbs', 'covers', 'banners'];
      const results = {};
      for (const t of targets) {
        const dir = CACHE_DIRS[t];
        if (!dir || !fs.existsSync(dir)) {
          results[t] = { ok: true, cleared: 0, size: 0 };
          continue;
        }
        let cleared = 0, freed = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, entry.name);
          try {
            if (entry.isFile()) {
              freed += fs.statSync(fp).size;
              fs.unlinkSync(fp);
              cleared++;
            } else if (entry.isDirectory()) {
              // 递归删除子目录（如 .resized）
              const sub = fs.readdirSync(fp);
              for (const f of sub) {
                const sfp = path.join(fp, f);
                try {
                  freed += fs.statSync(sfp).size;
                  fs.unlinkSync(sfp);
                  cleared++;
                } catch (_) {}
              }
              try { fs.rmdirSync(fp); } catch (_) {}
            }
          } catch (_) {}
        }
        results[t] = { ok: true, cleared, size: freed };
      }
      // 清横幅缓存后，同步清掉 DB 里指向已删文件的本地路径引用（置 null），
      // 解锁懒加载重下（library.js handleGetAnime 的 syncAnilistDetail / backfill）
      if (targets.includes('banners') && state?.data?.library) {
        const clearedIds = new Set();
        for (const a of state.data.library) {
          if (a.anilistBanner && a.anilistBanner !== '__none__' && !a.anilistBanner.startsWith('http')) {
            a.anilistBanner = null;
            clearedIds.add(a.id);
          }
        }
        if (clearedIds.size > 0 && state.db?.saveLibrary) {
          await state.db.saveLibrary(state.data, clearedIds);
        }
        results.banners = { ...(results.banners || {}), refsCleared: clearedIds.size };
      }

      jsonResp(res, 200, { ok: true, results });
    } catch (e) {
      jsonResp(res, 500, { error: '清除缓存失败: ' + e.message });
    }
  },

  // POST /api/db/reset — 重置数据库（清空所有数据）
  async handleDbReset(req, res, state) {
    try {
      const { db, data, logger } = state;

      // 1. 备份当前 DB 到 backups/
      const backupDir = path.join(DATA_DIR, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `pre-reset-${dateStr}.db`);
      if (fs.existsSync(DB_FILE)) {
        fs.copyFileSync(DB_FILE, backupPath);
        logger.info(`Auto-backup before reset: ${backupPath}`);
      }

      // 2. 清空所有表（db.reset() 内部清空 PlaySession/Episode/Anime/MyList）
      await db.reset();

      // 3. 重置内存数据
      data.library = [];
      data.myList = [];
      data.playSessions = [];

      jsonResp(res, 200, {
        ok: true,
        message: '数据库已重置，原数据已备份到: ' + backupPath,
        backupPath,
        counts: { anime: 0, myList: 0, playSessions: 0 },
      });
    } catch (e) {
      jsonResp(res, 500, { error: '重置失败: ' + e.message });
    }
  },
};
