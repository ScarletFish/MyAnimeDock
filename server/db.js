// server/db.js — Prisma/SQLite 数据层封装
// 提供 loadData() / syncToSqlite() / shutdown()
// 统一转换 SQLite 规范化表 ↔ server.js 传统 JSON 格式
// 允许渐进式迁移：JSON 文件作为运行时缓存兼备份，SQLite 作为持久化目标

const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

// 数据目录：pkg 模式在 %APPDATA%/com.myanimedocker.app（可写），开发模式在项目根
const DATA_DIR = process.pkg
  ? path.join(process.env.APPDATA || process.env.HOME || '.', 'com.myanimedocker.app')
  : path.join(__dirname, '..');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[DB] Created data directory: ${DATA_DIR}`);
}

// 开发模式：DB 在 prisma/anime.db（迁移已有）
// 生产模式：DB 在 %APPDATA%/com.myanimedocker.app/anime.db（可写）
const DB_PATH = process.pkg
  ? `file:${path.join(DATA_DIR, 'anime.db')}`
  : `file:${path.join(DATA_DIR, 'prisma', 'anime.db')}`;

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
      console.log(`[DB] Prisma engine: ${prismaEngine}`);
    } else {
      console.warn('[DB] Prisma engine not found — SQLite will be unavailable');
    }
    
    // 配置 NODE_PATH 让 require() 能找到 Prisma 等模块
    const existingPath = process.env.NODE_PATH || '';
    const sep = existingPath ? ';' : '';
    process.env.NODE_PATH = existingPath + sep + nodeModulesDir;
    require('module').Module._initPaths();
    console.log(`[DB] Added NODE_PATH: ${nodeModulesDir}`);
    
    // ffmpeg 二进制路径（ffmpeg-static 检查 FFMPEG_BIN 环境变量）
    const ffmpegBin = path.join(nodeModulesDir, 'ffmpeg.exe');
    if (fs.existsSync(ffmpegBin)) {
      process.env.FFMPEG_BIN = ffmpegBin;
      console.log(`[DB] FFMPEG_BIN: ${ffmpegBin}`);
    }
  } else {
    console.warn('[DB] Native modules directory not found alongside exe');
  }
}

// ─── 首次启动自动建表 SQL ───
// 首次启动时 anime.db 不存在，PrismaClient 连接后自动创建空文件，
// 但不会创建表。以下 SQL 在首次启动时自建制表（CREATE TABLE IF NOT EXISTS）。
const INIT_SQL = [
  `CREATE TABLE IF NOT EXISTS "Anime" ("id" TEXT NOT NULL PRIMARY KEY, "folderPath" TEXT NOT NULL, "folderName" TEXT NOT NULL, "title" TEXT NOT NULL, "season" INTEGER, "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "downloaded" BOOLEAN NOT NULL DEFAULT true, "bangumiId" INTEGER, "bangumiTitle" TEXT, "bangumiTitleJp" TEXT, "summary" TEXT, "coverUrl" TEXT, "localCover" TEXT, "rating" REAL, "source" TEXT, "pinyinTitle" TEXT, "metadata" TEXT)`,
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
  `CREATE TABLE IF NOT EXISTS "Memory" ("id" TEXT NOT NULL PRIMARY KEY, "animeId" TEXT NOT NULL REFERENCES "Anime"("id") ON DELETE CASCADE, "title" TEXT NOT NULL, "bangumiId" INTEGER, "bangumiTitle" TEXT, "rating" REAL, "thoughts" TEXT, "notes" TEXT, "watchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "coverLocal" TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Memory_animeId_key" ON "Memory"("animeId")`,
  `CREATE INDEX IF NOT EXISTS "Memory_animeId_idx" ON "Memory"("animeId")`,
  `CREATE INDEX IF NOT EXISTS "Memory_watchedAt_idx" ON "Memory"("watchedAt")`,
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
 * 首次启动时自动创建表结构。
 * 使用临时 PrismaClient 连接执行 DDL，断开后主连接重新创建时
 * 会正确读取完整 schema。避免了同一连接中 DDL 后 schema 缓存未刷新的问题。
 */
async function ensureSchema() {
  // 检查 DB 文件是否存在
  const dbFile = DB_PATH.replace(/^file:/, '');
  if (!fs.existsSync(dbFile)) {
    // DB 文件不存在——由 PrismaClient 自己创建，但表需要自动建
    console.log('[DB] Database file not found, will be created on first connect');
  }

  let tempClient = null;
  try {
    tempClient = new PrismaClient({ datasources: { db: { url: DB_PATH } } });
    await tempClient.$connect();
    const rows = await tempClient.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='Anime'`
    );
    if (rows.length === 0) {
      console.log('[DB] Initializing database schema...');
      for (const sql of INIT_SQL) {
        await tempClient.$executeRawUnsafe(sql);
      }
      console.log('[DB] Database schema initialized.');
    }
    await tempClient.$disconnect();
  } catch (e) {
    console.warn('[DB] Schema init skipped:', e.message);
  } finally {
    if (tempClient) {
      try { await tempClient.$disconnect(); } catch (_) {}
    }
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

function memoryToLegacy(m) {
  return {
    animeId: m.animeId,
    title: m.title,
    bangumiId: m.bangumiId,
    bangumiTitle: m.bangumiTitle,
    rating: m.rating,
    thoughts: m.thoughts || '',
    notes: m.notes || '',
    watchedAt: m.watchedAt.toISOString(),
    coverLocal: m.coverLocal,
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

    const [animeList, memories, playSessions, scannedTreeRecord] = await Promise.all([
      p.anime.findMany({ include: { episodes: { orderBy: { number: 'asc' } } } }),
      p.memory.findMany({ orderBy: { watchedAt: 'desc' } }),
      p.playSession.findMany(),
      p.scannedTree.findUnique({ where: { id: 'current' } }),
    ]);

    return {
      discovered: [],
      library: animeList.map(animeToLegacy),
      memories: memories.map(memoryToLegacy),
      playSessions: playSessions.map(sessionToLegacy),
      scannedTree: scannedTreeRecord ? JSON.parse(scannedTreeRecord.data) : [],
    };
  } catch (e) {
    console.error('[DB] Failed to load from SQLite:', e.message);
    return null;
  }
}

// ─── Save ───

// 将完整 data 对象同步到 SQLite。
// 使用事务确保一致性，upsert 避免主键冲突。
async function syncToSqlite(data) {
  if (!data) return;
  const p = getPrisma();

  try {
    await p.$transaction(async (tx) => {
      // ── Library / Anime ──
      const existingIds = new Set(
        (await tx.anime.findMany({ select: { id: true } })).map(a => a.id)
      );
      const currentIds = new Set(data.library.map(a => a.id));

      // 删除已被移除的 anime
      for (const id of existingIds) {
        if (!currentIds.has(id)) {
          await tx.anime.delete({ where: { id } });
        }
      }

      // Upsert anime + episodes
      for (const a of data.library) {
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
          rating: a.rating,
          source: a.source,
          pinyinTitle: a.pinyinTitle,
        };

        await tx.anime.upsert({
          where: { id: a.id },
          create: { id: a.id, ...animeData },
          update: animeData,
        });

        // Episodes：全量替换（删除已有 → 重新插入）
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

      // ── Memories ──
      await tx.memory.deleteMany();
      if (data.memories && data.memories.length > 0) {
        await tx.memory.createMany({
          data: data.memories.map(m => ({
            animeId: m.animeId,
            title: m.title,
            bangumiId: m.bangumiId,
            bangumiTitle: m.bangumiTitle,
            rating: m.rating,
            thoughts: m.thoughts || '',
            notes: m.notes || '',
            watchedAt: new Date(m.watchedAt),
            coverLocal: m.coverLocal,
          })),
        });
      }

      // ── Play Sessions ──
      const existingSessions = await tx.playSession.findMany({ select: { sessionId: true } });
      const existingSessionIds = new Set(existingSessions.map(s => s.sessionId));
      const currentSessionIds = new Set((data.playSessions || []).map(s => s.sessionId));

      // 删除已移除的 session
      for (const sid of existingSessionIds) {
        if (!currentSessionIds.has(sid)) {
          await tx.playSession.delete({ where: { sessionId: sid } });
        }
      }

      // Upsert 变更/新增的 session
      for (const s of data.playSessions || []) {
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

      // ── ScannedTree ──
      if (data.scannedTree !== undefined) {
        await tx.scannedTree.upsert({
          where: { id: 'current' },
          create: { id: 'current', data: JSON.stringify(data.scannedTree) },
          update: { data: JSON.stringify(data.scannedTree) },
        });
      }
    });

    console.log(`[DB] Synced to SQLite: ${data.library.length} anime`);
  } catch (e) {
    console.error('[DB] SQLite sync error:', e.message);
  }
}

module.exports = { loadData, syncToSqlite, shutdown, getPrisma };
