// server/db.js — Prisma/SQLite 数据层封装（单存储）
// SQLite 是 library / memories / playSessions 唯一持久化目标
// scannedTree 和 config 由 server.js 独立管理 JSON 文件
// 提供 loadData() / saveAll() / shutdown()

const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const logger = require('./logger').child('[DB]');

// 数据目录：pkg 模式在 %APPDATA%/com.myanimedocker.app（可写），开发模式在项目根
const DATA_DIR = process.pkg
  ? path.join(process.env.APPDATA || process.env.HOME || '.', 'com.myanimedocker.app')
  : path.join(__dirname, '..');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  logger.info(`Created data directory: ${DATA_DIR}`);
}

// 开发模式：DB 在 prisma/anime.db（迁移已有）
// 生产模式：DB 在 %APPDATA%/com.myanimedocker.app/anime.db（可写）
// 使用绝对路径 + 正斜杠，因为 Prisma 将相对路径解析为相对 schema 目录
const DB_PATH = process.pkg
  ? `file:${path.join(DATA_DIR, 'anime.db').replace(/\\/g, '/')}`
  : `file:${path.join(DATA_DIR, 'prisma', 'anime.db').replace(/\\/g, '/')}`;
// 用于文件存在性检查（pkg 模式下 DB 直接在 DATA_DIR，dev 模式在 prisma/ 子目录）
const DB_FILE = process.pkg
  ? path.join(DATA_DIR, 'anime.db')
  : path.join(DATA_DIR, 'prisma', 'anime.db');

// ─── pkg 模式：原生模块路径修复 ───
// pkg 无法打包 .node 原生模块，需要从外部 node_modules/ 加载。
// copy-sidecar-deps.js 在构建时复制这些模块到 src-tauri/node_modules/。
// Tauri 安装后这些文件在 resources/ 子目录下，而非 exe 同级。
// 此代码搜索多个候选路径确保找到引擎和原生模块。

if (process.pkg) {
  const exeDir = path.dirname(process.execPath);
  
  // 候选路径：exe同级 → Tauri资源目录（resources/ 子目录）
  // Tauri MSI/NSIS 将 bundled resources 放在 resources/ 子目录
  const nodeModulesCandidates = [
    path.join(exeDir, 'sidecar-modules'),                 // 开发/独立部署
    path.join(exeDir, 'resources', 'sidecar-modules'),    // Tauri MSI安装
    path.join(exeDir, 'resources'),                       // Tauri 打包：resources/* 直接展开
    path.join(exeDir, 'node_modules'),                    // 旧路径回退
    path.join(exeDir, 'resources', 'node_modules'),       // 旧路径回退
  ];
  
  let nodeModulesDir = null;
  for (const dir of nodeModulesCandidates) {
    if (fs.existsSync(dir)) {
      nodeModulesDir = dir;
      break;
    }
  }
  
  if (nodeModulesDir) {
    // Prisma 查询引擎路径（Tauri resources glob 不匹配 . 开头路径，使用 prisma-engine/）
    const prismaEngine = path.join(nodeModulesDir, 'prisma-engine', 'query_engine-windows.dll.node');
      if (fs.existsSync(prismaEngine)) {
        process.env.PRISMA_QUERY_ENGINE_LIBRARY = prismaEngine;
        logger.info(`Prisma engine: ${prismaEngine}`);
      } else {
        logger.warn('Prisma engine not found — SQLite will be unavailable');
      }
    
    // 配置 NODE_PATH 让 require() 能找到 Prisma 等模块
    const existingPath = process.env.NODE_PATH || '';
    const sep = existingPath ? ';' : '';
    process.env.NODE_PATH = existingPath + sep + nodeModulesDir;
    require('module').Module._initPaths();
    logger.info(`Added NODE_PATH: ${nodeModulesDir}`);
    
    // ffmpeg 二进制路径（ffmpeg-static 检查 FFMPEG_BIN 环境变量）
    const ffmpegBin = path.join(nodeModulesDir, 'ffmpeg.exe');
    if (fs.existsSync(ffmpegBin)) {
      process.env.FFMPEG_BIN = ffmpegBin;
      logger.info(`FFMPEG_BIN: ${ffmpegBin}`);
    }
  } else {
    logger.warn('Native modules directory not found alongside exe');
  }
}

// ─── 首次启动自动建表 SQL ───
// 首次启动时 anime.db 不存在，PrismaClient 连接后自动创建空文件，
// 但不会创建表。以下 SQL 在首次启动时自建制表（CREATE TABLE IF NOT EXISTS）。
const INIT_SQL = [
  `CREATE TABLE IF NOT EXISTS "Anime" ("id" TEXT NOT NULL PRIMARY KEY, "folderPath" TEXT NOT NULL, "folderName" TEXT NOT NULL, "title" TEXT NOT NULL, "season" INTEGER, "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "downloaded" BOOLEAN NOT NULL DEFAULT true, "bangumiId" INTEGER, "bangumiTitle" TEXT, "bangumiTitleJp" TEXT, "summary" TEXT, "coverUrl" TEXT, "localCover" TEXT, "rating" REAL, "source" TEXT, "pinyinTitle" TEXT, "matchedSeason" INTEGER, "totalSeasons" INTEGER, "metadata" TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Anime_folderPath_key" ON "Anime"("folderPath")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Anime_bangumiId_key" ON "Anime"("bangumiId")`,
  `CREATE INDEX IF NOT EXISTS "Anime_bangumiId_idx" ON "Anime"("bangumiId")`,
  `CREATE INDEX IF NOT EXISTS "Anime_title_idx" ON "Anime"("title")`,
  `CREATE INDEX IF NOT EXISTS "Anime_pinyinTitle_idx" ON "Anime"("pinyinTitle")`,
  `CREATE TABLE IF NOT EXISTS "Episode" ("id" TEXT NOT NULL PRIMARY KEY, "animeId" TEXT NOT NULL REFERENCES "Anime"("id") ON DELETE CASCADE, "number" INTEGER NOT NULL, "filePath" TEXT NOT NULL, "fileName" TEXT NOT NULL, "fileSize" BIGINT NOT NULL, "duration" INTEGER, "watched" BOOLEAN NOT NULL DEFAULT false, "progress" REAL NOT NULL DEFAULT 0, "watchedAt" DATETIME)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Episode_filePath_key" ON "Episode"("filePath")`,
  `CREATE INDEX IF NOT EXISTS "Episode_animeId_idx" ON "Episode"("animeId")`,
  `CREATE INDEX IF NOT EXISTS "Episode_filePath_idx" ON "Episode"("filePath")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Episode_animeId_number_key" ON "Episode"("animeId", "number")`,
  `CREATE TABLE IF NOT EXISTS "PlaySession" ("id" TEXT NOT NULL PRIMARY KEY, "animeId" TEXT NOT NULL REFERENCES "Anime"("id") ON DELETE CASCADE, "episodeNumber" INTEGER NOT NULL, "sessionId" TEXT NOT NULL, "startTime" DATETIME NOT NULL, "endTime" DATETIME, "duration" INTEGER NOT NULL DEFAULT 0, "clockTime" INTEGER NOT NULL DEFAULT 0, "progressStart" INTEGER NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PlaySession_sessionId_key" ON "PlaySession"("sessionId")`,
  `CREATE INDEX IF NOT EXISTS "PlaySession_animeId_idx" ON "PlaySession"("animeId")`,
  `CREATE INDEX IF NOT EXISTS "PlaySession_sessionId_idx" ON "PlaySession"("sessionId")`,
  `CREATE INDEX IF NOT EXISTS "PlaySession_startTime_idx" ON "PlaySession"("startTime")`,
  `CREATE TABLE IF NOT EXISTS "MyList" ("id" TEXT NOT NULL PRIMARY KEY, "animeId" TEXT NOT NULL REFERENCES "Anime"("id") ON DELETE CASCADE, "status" TEXT NOT NULL DEFAULT 'watching', "rating" REAL, "thoughts" TEXT, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MyList_animeId_key" ON "MyList"("animeId")`,
  `CREATE INDEX IF NOT EXISTS "MyList_animeId_idx" ON "MyList"("animeId")`,
  `CREATE INDEX IF NOT EXISTS "MyList_status_idx" ON "MyList"("status")`,
  `CREATE TABLE IF NOT EXISTS "Wishlist" ("id" TEXT NOT NULL PRIMARY KEY, "bangumiId" INTEGER NOT NULL, "title" TEXT NOT NULL, "bangumiTitle" TEXT, "coverUrl" TEXT, "summary" TEXT, "rating" REAL, "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Wishlist_bangumiId_key" ON "Wishlist"("bangumiId")`,
  `CREATE INDEX IF NOT EXISTS "Wishlist_bangumiId_idx" ON "Wishlist"("bangumiId")`,
  `CREATE TABLE IF NOT EXISTS "ScannedTree" ("id" TEXT NOT NULL PRIMARY KEY DEFAULT 'current', "data" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "Config" ("id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton', "data" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "MigrationLog" ("id" TEXT NOT NULL PRIMARY KEY, "version" TEXT NOT NULL, "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "description" TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MigrationLog_version_key" ON "MigrationLog"("version")`,
];

let prisma = null;

function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: { db: { url: DB_PATH } },
    });
  }
  return prisma;
}

/**
 * 首次启动时自动创建表结构（CREATE TABLE IF NOT EXISTS）。
 * 对已有表检查缺少的列（如通过 Prisma 迁移添加的列），自动 ALTER TABLE 补充。
 * 不依赖 Prisma 迁移历史，适用于 pkg 生产环境。
 */
async function ensureSchema() {
  if (!fs.existsSync(DB_FILE)) {
    logger.info('Database file not found, will be created on first connect');
    return;
  }

  try {
    const p = getPrisma();

    // 1. 获取已有表名
    const existingTables = await p.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table'`
    );
    const tableNames = new Set(existingTables.map(r => r.name));

    if (tableNames.size === 0) {
      // 全新数据库 — 全量建表
      logger.info('Initializing database schema (fresh)...');
      for (const sql of INIT_SQL) {
        await p.$executeRawUnsafe(sql);
      }
      logger.info('Database schema initialized.');
      return;
    }

    // 2. 已有表：先 CREATE TABLE IF NOT EXISTS（新增表），再检查缺少的列
    for (const sql of INIT_SQL) {
      await p.$executeRawUnsafe(sql);
    }

    // 3. 对每个预定义表，检查并补充缺少的列
    const tableDefs = INIT_SQL
      .filter(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS'))
      .map(sql => {
        const m = sql.match(/CREATE TABLE IF NOT EXISTS "(\w+)"\s*\(([\s\S]+)\)/);
        if (!m) return null;
        const tableName = m[1];
        // 解析列定义：每列格式  "colName" TYPE ...
        const colDefs = m[2].split(',').map(s => s.trim()).filter(Boolean);
        const columns = colDefs.map(s => {
          const cm = s.match(/^"(\w+)"/);
          return cm ? { name: cm[1], def: s } : null;
        }).filter(Boolean);
        return { name: tableName, columns };
      }).filter(Boolean);

    for (const table of tableDefs) {
      // 仅处理存在于 sqlite_master 中的表（跳过 CREATE TABLE IF NOT EXISTS 已处理的）
      if (!tableNames.has(table.name)) continue;

      // 获取已有列名
      const colInfo = await p.$queryRawUnsafe(
        `SELECT name FROM pragma_table_info('${table.name}')`
      );
      const existingCols = new Set(colInfo.map(c => c.name.toLowerCase()));

      for (const col of table.columns) {
        if (existingCols.has(col.name.toLowerCase())) continue;

        // 列缺少 → ALTER TABLE ADD COLUMN
        logger.info(`Adding missing column: ${table.name}.${col.name}`);
        await p.$executeRawUnsafe(
          `ALTER TABLE "${table.name}" ADD COLUMN ${col.def}`
        );
      }
    }

    logger.info('Database schema verified/updated.');
  } catch (e) {
    logger.warn('Schema init skipped:', e.message);
  }
}

async function shutdown() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

// ─── Legacy format converters ───

function animeToLegacy(a) {
  // Restore extra fields from metadata JSON (characters, persons, tags, etc.)
  let metadataExtra = {};
  if (a.metadata) {
    try {
      metadataExtra = JSON.parse(a.metadata);
    } catch (e) {
      logger.warn('Failed to parse anime metadata JSON:', e.message);
    }
  }

  return {
    id: a.id,
    folderPath: a.folderPath,
    folderName: a.folderName,
    title: a.title,
    season: a.season,
    importedAt: a.importedAt.toISOString(),
    downloaded: a.downloaded,
    bangumiId: a.bangumiId,
    bangumiTitle: a.bangumiTitle,
    bangumiTitleJp: a.bangumiTitleJp,
    summary: a.summary,
    coverUrl: a.coverUrl,
    localCover: a.localCover,
    rating: a.rating,
    source: a.source,
    pinyinTitle: a.pinyinTitle,
    matchedSeason: a.matchedSeason,
    totalSeasons: a.totalSeasons,
    // Spread persisted extras (characters, persons, tags, date, platform,
    // ratingRank, ratingTotal, infobox, collection, eps, totalEpisodes, specialSuffix)
    ...metadataExtra,
    episodes: (a.episodes || []).map(e => ({
      number: e.number,
      filePath: e.filePath,
      fileName: e.fileName,
      fileSize: Number(e.fileSize),
      duration: e.duration,
      watched: e.watched,
      progress: e.progress,
    })),
  };
}

function myListToLegacy(m) {
  return {
    animeId: m.animeId,
    status: m.status,
    rating: m.rating,
    thoughts: m.thoughts || '',
    notes: m.notes || '',
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function wishlistToLegacy(w) {
  return {
    id: w.id,
    bangumiId: w.bangumiId,
    title: w.title,
    bangumiTitle: w.bangumiTitle,
    coverUrl: w.coverUrl,
    summary: w.summary,
    rating: w.rating,
    addedAt: w.addedAt.toISOString(),
  };
}

// Backward compat: convert MyList to old Memory shape for legacy endpoints
function myListToMemoryLegacy(m, anime) {
  return {
    animeId: m.animeId,
    title: anime ? anime.title : m.animeId,
    bangumiId: anime ? anime.bangumiId : null,
    bangumiTitle: anime ? anime.bangumiTitle : null,
    rating: m.rating,
    thoughts: m.thoughts || '',
    notes: m.notes || '',
    watchedAt: m.createdAt.toISOString(),
    coverLocal: anime ? anime.localCover : null,
  };
}

function sessionToLegacy(s) {
  return {
    animeId: s.animeId,
    episodeNumber: s.episodeNumber,
    sessionId: s.sessionId,
    startTime: s.startTime.toISOString(),
    endTime: s.endTime ? s.endTime.toISOString() : null,
    duration: s.duration,
    clockTime: s.clockTime,
    progressStart: s.progressStart,
  };
}

// ─── Load ───

// 从 SQLite 加载全部数据，返回传统 JSON 格式。
// 若 SQLite 不可用（首次运行/DB 不存在）返回 null，调用者应回退到 JSON 文件。
async function loadData() {
  try {
    // 使用独立连接确保表存在（DDL 与主连接隔离）
    await ensureSchema();
    const p = getPrisma();

    const [animeList, myList, wishlist, playSessions, scannedTreeRecord] = await Promise.all([
      p.anime.findMany({ orderBy: { importedAt: 'asc' }, include: { episodes: { orderBy: { number: 'asc' } } } }),
      p.myList.findMany({ orderBy: { createdAt: 'desc' } }),
      p.wishlist.findMany({ orderBy: { addedAt: 'desc' } }),
      p.playSession.findMany(),
      p.scannedTree.findUnique({ where: { id: 'current' } }),
    ]);

    // Build legacy memories from MyList for backward compat
    const animeMap = new Map(animeList.map(a => [a.id, a]));
    const memoriesLegacy = myList.map(m => {
      const anime = animeMap.get(m.animeId);
      return myListToMemoryLegacy(m, anime);
    });

    return {
      discovered: [],
      library: animeList.map(animeToLegacy),
      myList: myList.map(myListToLegacy),
      wishlist: wishlist.map(wishlistToLegacy),
      // Backward compat: memories computed from MyList
      memories: memoriesLegacy,
      playSessions: playSessions.map(sessionToLegacy),
      scannedTree: scannedTreeRecord ? JSON.parse(scannedTreeRecord.data) : [],
    };
  } catch (e) {
    logger.error('Failed to load from SQLite:', e.message);
    return null;
  }
}

// ─── Save ───

// ─── Save (SQLite 批量全同步，library/memories/playSessions) ───
// scannedTree 由 server.js 独立写入 JSON 文件
async function saveAll(data) {
  if (!data) return;
  await Promise.all([
    saveLibrary(data),
    saveMyList(data),
    saveWishlist(data),
    savePlaySessions(data),
  ]);
}

async function saveLibrary(data) {
  if (!data) return;
  const p = getPrisma();
  try {
    await p.$transaction(async (tx) => {
      const existingIds = new Set(
        (await tx.anime.findMany({ select: { id: true } })).map(a => a.id)
      );
      const currentIds = new Set(data.library.map(a => a.id));

      for (const id of existingIds) {
        if (!currentIds.has(id)) {
          await tx.anime.delete({ where: { id } });
        }
      }

      for (const a of data.library) {
        let ratingVal = a.rating;
        if (ratingVal != null && typeof ratingVal !== 'number') {
          ratingVal = parseFloat(ratingVal);
          if (isNaN(ratingVal)) ratingVal = null;
        }

        // Collect extra fields (no dedicated Prisma column) into metadata JSON
        const EXTRA_FIELDS = [
          'characters', 'persons', 'tags', 'date', 'platform',
          'ratingRank', 'ratingTotal', 'infobox', 'collection',
          'eps', 'totalEpisodes', 'specialSuffix',
        ];
        const extraFields = {};
        for (const key of EXTRA_FIELDS) {
          if (a[key] !== undefined) extraFields[key] = a[key];
        }
        const metadataStr = Object.keys(extraFields).length > 0
          ? JSON.stringify(extraFields)
          : a.metadata || null; // preserve existing metadata if no new extras

        const animeData = {
          folderPath: a.folderPath,
          folderName: a.folderName,
          title: a.title,
          season: a.season,
          importedAt: new Date(a.importedAt),
          downloaded: a.downloaded,
          bangumiId: a.bangumiId,
          bangumiTitle: a.bangumiTitle,
          bangumiTitleJp: a.bangumiTitleJp,
          summary: a.summary,
          coverUrl: a.coverUrl,
          localCover: a.localCover,
          rating: ratingVal,
          source: a.source,
          pinyinTitle: a.pinyinTitle,
          metadata: metadataStr,
          matchedSeason: a.matchedSeason ?? null,
          totalSeasons: a.totalSeasons ?? null,
        };

        // Check bangumiId uniqueness — skip if another anime already owns it
        if (a.bangumiId) {
          const existing = await tx.anime.findFirst({
            where: { bangumiId: a.bangumiId, NOT: { id: a.id } },
            select: { id: true },
          });
          if (existing) {
            logger.warn(`bangumiId ${a.bangumiId} already owned by ${existing.id}, skipping ${a.id}`);
            continue;
          }
        }

        await tx.anime.upsert({
          where: { id: a.id },
          create: { id: a.id, ...animeData },
          update: animeData,
        });

        if (a.episodes && a.episodes.length > 0) {
          await tx.episode.deleteMany({ where: { animeId: a.id } });
          await tx.episode.createMany({
            data: a.episodes.map(e => ({
              animeId: a.id,
              number: e.number,
              filePath: e.filePath,
              fileName: e.fileName,
              fileSize: BigInt(e.fileSize || 0),
              duration: e.duration,
              watched: e.watched,
              progress: e.progress,
            })),
          });
        }
      }
    }, { timeout: 15000 });
    logger.info(`Synced library: ${data.library.length} anime`);
  } catch (e) {
    logger.error('SQLite library save error:', e.message);
    throw e;
  }
}

// ─── MyList (替代旧 Memories) ───
// 使用 upsert 逐条写入，不做 deleteMany，不会丢弃无 Anime 记录的条目
async function saveMyList(data) {
  if (!data) return;
  const p = getPrisma();
  try {
    await p.$transaction(async (tx) => {
      const existing = await tx.myList.findMany({ select: { animeId: true } });
      const existingSet = new Set(existing.map(x => x.animeId));
      const incomingSet = new Set((data.myList || []).map(x => x.animeId));

      // Delete removed items
      for (const animeId of existingSet) {
        if (!incomingSet.has(animeId)) {
          await tx.myList.deleteMany({ where: { animeId } });
        }
      }

      // Upsert incoming items
      for (const item of data.myList || []) {
        await tx.myList.upsert({
          where: { animeId: item.animeId },
          create: {
            animeId: item.animeId,
            status: item.status || 'watching',
            rating: item.rating,
            thoughts: item.thoughts || '',
            notes: item.notes || '',
          },
          update: {
            status: item.status,
            rating: item.rating,
            thoughts: item.thoughts || '',
            notes: item.notes || '',
          },
        });
      }
    }, { timeout: 15000 });
    logger.info(`Synced MyList: ${(data.myList || []).length} items`);
  } catch (e) {
    logger.error('SQLite myList save error:', e.message);
    throw e;
  }
}

// ─── Wishlist ───
async function saveWishlist(data) {
  if (!data) return;
  const p = getPrisma();
  try {
    await p.$transaction(async (tx) => {
      const existing = await tx.wishlist.findMany({ select: { id: true } });
      const existingSet = new Set(existing.map(x => x.id));
      const incomingSet = new Set((data.wishlist || []).map(x => x.id));

      for (const id of existingSet) {
        if (!incomingSet.has(id)) {
          await tx.wishlist.delete({ where: { id } });
        }
      }

      for (const item of data.wishlist || []) {
        await tx.wishlist.upsert({
          where: { id: item.id },
          create: {
            id: item.id,
            bangumiId: item.bangumiId,
            title: item.title,
            bangumiTitle: item.bangumiTitle,
            coverUrl: item.coverUrl,
            summary: item.summary,
            rating: item.rating,
          },
          update: {
            title: item.title,
            bangumiTitle: item.bangumiTitle,
            coverUrl: item.coverUrl,
            summary: item.summary,
            rating: item.rating,
          },
        });
      }
    }, { timeout: 15000 });
    logger.info(`Synced Wishlist: ${(data.wishlist || []).length} items`);
  } catch (e) {
    logger.error('SQLite wishlist save error:', e.message);
    throw e;
  }
}

// ─── 精细化更新：单条 MyList 状态 ───
async function updateMyItemStatus(animeId, status) {
  try {
    const p = getPrisma();
    await p.myList.upsert({
      where: { animeId },
      create: { animeId, status },
      update: { status },
    });
    logger.info(`Updated MyList status: ${animeId} → ${status}`);
  } catch (e) {
    logger.error('MyList status update error:', e.message);
  }
}

// ─── 旧 saveMemories 兼容包装 ───
async function saveMemories(data) {
  if (!data) return;
  // 旧 memories 格式转为 myList 格式后写入
  const legacyMemories = (data.memories || []).filter(m => m.animeId);
  if (legacyMemories.length > 0) {
    data.myList = data.myList || [];
    for (const m of legacyMemories) {
      const existing = data.myList.find(x => x.animeId === m.animeId);
      if (!existing) {
        data.myList.push({
          animeId: m.animeId,
          status: 'completed',
          rating: m.rating,
          thoughts: m.thoughts || '',
          notes: m.notes || '',
        });
      }
    }
  }
  return saveMyList(data);
}

async function savePlaySessions(data) {
  if (!data) return;
  const p = getPrisma();
  try {
    await p.$transaction(async (tx) => {
      const currentIds = new Set(data.library.map(a => a.id));
      if (currentIds.size > 0) {
        await tx.playSession.deleteMany({
          where: { animeId: { notIn: Array.from(currentIds) } },
        });
      } else {
        await tx.playSession.deleteMany();
      }

      const validSessions = (data.playSessions || []).filter(s => currentIds.has(s.animeId));
      for (const s of validSessions) {
        await tx.playSession.upsert({
          where: { sessionId: s.sessionId },
          create: {
            animeId: s.animeId,
            episodeNumber: s.episodeNumber,
            sessionId: s.sessionId,
            startTime: new Date(s.startTime),
            endTime: s.endTime ? new Date(s.endTime) : null,
            duration: s.duration,
            clockTime: s.clockTime,
            progressStart: s.progressStart,
          },
          update: {
            endTime: s.endTime ? new Date(s.endTime) : null,
            duration: s.duration,
            clockTime: s.clockTime,
          },
        });
      }
    }, { timeout: 15000 });
  } catch (e) {
    logger.error('SQLite playSessions save error:', e.message);
    throw e;
  }
}

// ─── 精细化更新：mpv 每 10s 进度 ───

async function updateEpisodeProgress(animeId, epNumber, fields) {
  try {
    const p = getPrisma();
    const data = {};
    if (fields.progress !== undefined) data.progress = fields.progress;
    if (fields.duration !== undefined) data.duration = fields.duration;
    if (fields.watched !== undefined) data.watched = fields.watched;
    if (Object.keys(data).length === 0) return;
    await p.episode.updateMany({
      where: { animeId, number: epNumber },
      data,
    });
  } catch (e) {
    logger.error('Episode progress update error:', e.message);
  }
}

async function updatePlaySession(sessionId, fields) {
  try {
    if (!sessionId) return;
    const p = getPrisma();
    const data = {};
    if (fields.endTime !== undefined) data.endTime = new Date(fields.endTime);
    if (fields.duration !== undefined) data.duration = fields.duration;
    if (fields.clockTime !== undefined) data.clockTime = fields.clockTime;
    if (Object.keys(data).length === 0) return;
    await p.playSession.updateMany({
      where: { sessionId },
      data,
    });
  } catch (e) {
    logger.error('PlaySession update error:', e.message);
  }
}

async function deletePlaySession(sessionId) {
  try {
    if (!sessionId) return;
    const p = getPrisma();
    await p.playSession.deleteMany({ where: { sessionId } });
  } catch (e) {
    logger.error('PlaySession delete error:', e.message);
  }
}

module.exports = { loadData, saveAll, saveLibrary, saveMyList, saveMemories, saveWishlist, updateMyItemStatus, savePlaySessions, updateEpisodeProgress, updatePlaySession, deletePlaySession, shutdown, getPrisma, ensureSchema };
