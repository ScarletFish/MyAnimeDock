// server/db.ts — SQLite 数据层封装（单存储，better-sqlite3 原生 SQL）
// SQLite 是 library / playSessions 唯一持久化目标
// scannedTree 和 config 由 server.js 独立管理 JSON 文件
// 提供 loadData() / saveAll() / shutdown()

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { PROJECT_ROOT } from './lib/paths';
import { Logger } from './logger';
import type { AppData } from './types';

// better-sqlite3 是原生模块：dev 模式直接 require；pkg 快照无法内嵌 .node，
// 必须从 exe 旁的 sidecar-modules 运行时加载（动态 require + NODE_PATH，
// 使 better-sqlite3 内部的 bindings/file-uri-to-path 也能解析）。
let Database: any;
if (process.pkg) {
  const sidecarDir = path.join(path.dirname(process.execPath), 'sidecar-modules');
  process.env.NODE_PATH = sidecarDir + path.delimiter + (process.env.NODE_PATH || '');
  require('module').Module._initPaths();
  Database = require(path.join(sidecarDir, 'better-sqlite3'));
} else {
  Database = require('better-sqlite3');
}
const logger: Logger = require('./logger').child('[DB]');

// 数据目录：pkg 模式在 %APPDATA%/MyAnimeDock（可写），开发模式在项目根
const DATA_DIR = process.pkg
  ? path.join(process.env.APPDATA || process.env.HOME || '.', 'MyAnimeDock')
  : PROJECT_ROOT;

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  logger.info(`Created data directory: ${DATA_DIR}`);
}

// 开发模式：DB 在 data/anime.db（迁移已有）
// 生产模式：DB 在 %APPDATA%/MyAnimeDock/anime.db（可写）
const DB_PATH = process.pkg
  ? path.join(DATA_DIR, 'anime.db')
  : path.join(DATA_DIR, 'data', 'anime.db');
// 用于文件存在性检查（pkg 模式下 DB 直接在 DATA_DIR，dev 模式在 data/ 子目录）
const DB_FILE = process.pkg
  ? path.join(DATA_DIR, 'anime.db')
  : path.join(DATA_DIR, 'data', 'anime.db');

// ─── pkg 模式：原生模块路径修复 ───
// pkg 无法打包 .node 原生模块，需要从外部 node_modules/ 加载。
// copy-sidecar-deps.js 在构建时复制这些模块到 src-tauri/sidecar-modules/。
// Tauri 安装后这些文件在 resources/ 子目录下，而非 exe 同级。
// 此代码搜索多个候选路径确保找到原生模块。
// 注：better-sqlite3 是原生 .node 模块，pkg 快照无法内联，需运行时 require。
//     PRISMA_QUERY_ENGINE_LIBRARY / NODE_PATH / Module._initPaths hack 已随
//     Prisma 弃用而删除；FFMPEG_BIN 逻辑保留。

let nodeModulesDir: string | null = null;

if (process.pkg) {
  const exeDir = path.dirname(process.execPath);

  // 候选路径：exe同级 → Tauri资源目录（resources/ 子目录）
  const nodeModulesCandidates = [
    path.join(exeDir, 'sidecar-modules'),                 // 开发/独立部署
    path.join(exeDir, 'resources', 'sidecar-modules'),    // Tauri MSI安装
    path.join(exeDir, 'resources'),                       // Tauri 打包：resources/* 直接展开
    path.join(exeDir, 'node_modules'),                    // 旧路径回退
    path.join(exeDir, 'resources', 'node_modules'),       // 旧路径回退
  ];

  for (const dir of nodeModulesCandidates) {
    if (fs.existsSync(dir)) {
      nodeModulesDir = dir;
      break;
    }
  }

  if (nodeModulesDir) {
    // ffmpeg 二进制路径（utils.js 优先读取 FFMPEG_BIN 环境变量）
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
// 首次启动时 anime.db 不存在，连接后自动创建空文件，
// 但不会创建表。以下 SQL 在首次启动时自建制表（CREATE TABLE IF NOT EXISTS）。
const INIT_SQL = [
  `CREATE TABLE IF NOT EXISTS "Anime" ("id" TEXT NOT NULL PRIMARY KEY, "folderPath" TEXT NOT NULL, "folderName" TEXT NOT NULL, "title" TEXT NOT NULL, "season" INTEGER, "importedAt" DATETIME NOT NULL DEFAULT (unixepoch() * 1000), "downloaded" BOOLEAN NOT NULL DEFAULT true, "bangumiId" INTEGER, "bangumiTitle" TEXT, "bangumiTitleJp" TEXT, "summary" TEXT, "coverUrl" TEXT, "localCover" TEXT, "rating" REAL, "source" TEXT, "pinyinTitle" TEXT, "matchedSeason" INTEGER, "metadata" TEXT, "anilistId" INTEGER, "anilistBanner" TEXT, "anilistCover" TEXT, "anilistTitleEn" TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Anime_bangumiId_key" ON "Anime"("bangumiId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Anime_anilistId_key" ON "Anime"("anilistId")`,
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
  `CREATE TABLE IF NOT EXISTS "MyList" ("id" TEXT NOT NULL PRIMARY KEY, "animeId" TEXT REFERENCES "Anime"("id") ON DELETE CASCADE, "bangumiId" INTEGER, "title" TEXT NOT NULL DEFAULT '', "bangumiTitle" TEXT, "coverUrl" TEXT, "summary" TEXT, "status" TEXT NOT NULL DEFAULT 'watching', "rating" REAL, "thoughts" TEXT, "notes" TEXT, "startedAt" DATETIME, "completedAt" DATETIME, "progress" INTEGER, "createdAt" DATETIME NOT NULL DEFAULT (unixepoch() * 1000), "updatedAt" DATETIME NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MyList_animeId_key" ON "MyList"("animeId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MyList_bangumiId_key" ON "MyList"("bangumiId")`,
  `CREATE INDEX IF NOT EXISTS "MyList_animeId_idx" ON "MyList"("animeId")`,
  `CREATE INDEX IF NOT EXISTS "MyList_bangumiId_idx" ON "MyList"("bangumiId")`,
  `CREATE INDEX IF NOT EXISTS "MyList_status_idx" ON "MyList"("status")`,
  `CREATE TABLE IF NOT EXISTS "ScannedTree" ("id" TEXT NOT NULL PRIMARY KEY DEFAULT 'current', "data" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "Config" ("id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton', "data" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "MigrationLog" ("id" TEXT NOT NULL PRIMARY KEY, "version" TEXT NOT NULL, "appliedAt" DATETIME NOT NULL DEFAULT (unixepoch() * 1000), "description" TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MigrationLog_version_key" ON "MigrationLog"("version")`,
];

// ─── 单例数据库连接 ───
let db: any = null;

function getDb(): any {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    // 🔴 必写：否则 ON DELETE CASCADE 级联删除静默失效
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// ─── 版本化迁移函数表 ───
// "schema sync"（ensureSchema 的 CREATE TABLE IF NOT EXISTS + ALTER 补列循环）是基线，
// 幂等且已被测试覆盖，不在此表登记。此表仅登记需显式数据/结构变更的版本。
// 每个版本 `up(db)` 内自行完成变更；MigrationLog 记录已应用版本，重复启动天然跳过。
// 注意：`up` 中禁用 VACUUM（better-sqlite3 不允许在事务内 VACUUM；此处也不包事务）。
const MIGRATIONS: any[] = [
  {
    version: 'v2_merge_wishlist',
    description: 'Merge Wishlist into MyList — nullable animeId + bangumiId fields',
    up(d: any) {
      // 检查旧表是否仍有 NOT NULL 约束
      const colInfo = d.prepare(`SELECT name, "notnull" FROM pragma_table_info('MyList')`).all();
      const animeIdCol = colInfo.find((c: any) => c.name === 'animeId');
      if (animeIdCol && animeIdCol.notnull === 1) {
        logger.info('[Migration v2] Merging Wishlist into MyList — recreating table...');
        d.exec(`PRAGMA foreign_keys=OFF`);

        // 删除旧索引
        d.exec(`DROP INDEX IF EXISTS "MyList_animeId_key"`);
        d.exec(`DROP INDEX IF EXISTS "MyList_animeId_idx"`);
        d.exec(`DROP INDEX IF EXISTS "MyList_status_idx"`);

        // 创建新表（animeId 可空，含 bangumiId/元数据字段）
        d.exec(`
          CREATE TABLE IF NOT EXISTS "MyList_v2" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "animeId" TEXT REFERENCES "Anime"("id") ON DELETE CASCADE,
            "bangumiId" INTEGER,
            "title" TEXT NOT NULL DEFAULT '',
            "bangumiTitle" TEXT,
            "coverUrl" TEXT,
            "summary" TEXT,
            "status" TEXT NOT NULL DEFAULT 'watching',
            "rating" REAL,
            "thoughts" TEXT,
            "notes" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT (unixepoch() * 1000),
            "updatedAt" DATETIME NOT NULL
          )
        `);

        // 复制旧 MyList 数据
        d.exec(`
          INSERT INTO "MyList_v2" ("id", "animeId", "status", "rating", "thoughts", "notes", "createdAt", "updatedAt")
          SELECT "id", "animeId", "status", "rating", "thoughts", "notes", "createdAt", "updatedAt" FROM "MyList"
        `);

        // 迁移 Wishlist 数据到 MyList
        const hasWishlist = d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='Wishlist'`).all();
        if (hasWishlist.length > 0) {
          d.exec(`
            INSERT INTO "MyList_v2" ("id", "bangumiId", "title", "bangumiTitle", "coverUrl", "summary", "rating", "status", "createdAt", "updatedAt")
            SELECT "id", "bangumiId", "title", "bangumiTitle", "coverUrl", "summary", "rating", 'wish', "addedAt", "addedAt" FROM "Wishlist"
          `);
          d.exec(`DROP TABLE IF EXISTS "Wishlist"`);
        }

        // 切换表
        d.exec(`DROP TABLE IF EXISTS "MyList"`);
        d.exec(`ALTER TABLE "MyList_v2" RENAME TO "MyList"`);

        // 重建索引
        d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "MyList_animeId_key" ON "MyList"("animeId")`);
        d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "MyList_bangumiId_key" ON "MyList"("bangumiId")`);
        d.exec(`CREATE INDEX IF NOT EXISTS "MyList_animeId_idx" ON "MyList"("animeId")`);
        d.exec(`CREATE INDEX IF NOT EXISTS "MyList_bangumiId_idx" ON "MyList"("bangumiId")`);
        d.exec(`CREATE INDEX IF NOT EXISTS "MyList_status_idx" ON "MyList"("status")`);

        d.exec(`PRAGMA foreign_keys=ON`);
        logger.info('[Migration v2] Wishlist merged into MyList');
      } else {
        // 表已使用新 schema，但可能仍有遗留 Wishlist 表
        d.exec(`DROP TABLE IF EXISTS "Wishlist"`);
      }
    },
  },
  {
    version: 'v3_uuid_anime_ids',
    description: 'Unify Anime primary keys to UUID; drop folderPath unique index',
    up(d: any) {
      // 读取所有现有 Anime 行，建立 oldId → newUuid 映射
      const rows = d.prepare(`SELECT id FROM Anime`).all();
      const idMap = new Map<string, string>();
      for (const r of rows) {
        idMap.set(r.id, crypto.randomUUID());
      }
      if (idMap.size === 0) {
        // 空库：仅清理遗留索引
        d.exec(`DROP INDEX IF EXISTS "Anime_folderPath_key"`);
        logger.info('[Migration v3] No anime rows, removed folderPath unique index');
        return;
      }
      logger.info(`[Migration v3] Converting ${idMap.size} anime ids to UUID...`);
      d.exec(`PRAGMA foreign_keys=OFF`);

      // 1. 重写子表外键引用：Episode / PlaySession / MyList 的 animeId
      for (const [oldId, newId] of idMap) {
        d.prepare(`UPDATE "Episode" SET "animeId" = ? WHERE "animeId" = ?`).run(newId, oldId);
        d.prepare(`UPDATE "PlaySession" SET "animeId" = ? WHERE "animeId" = ?`).run(newId, oldId);
        d.prepare(`UPDATE "MyList" SET "animeId" = ? WHERE "animeId" = ?`).run(newId, oldId);
        // MyList.id 在库条目中 == animeId（insertMyListRow 用 id: animeId），一并改写
        d.prepare(`UPDATE "MyList" SET "id" = ? WHERE "id" = ? AND "animeId" = ?`).run(newId, oldId, oldId);
        // Episode.id 格式为 `${animeId}-${number}`，同步改写为新 UUID 前缀
        d.prepare(`UPDATE "Episode" SET "id" = ? || '-' || "number" WHERE "animeId" = ?`).run(newId, newId);
      }

      // 2. 重写 Anime 主键本身
      for (const [oldId, newId] of idMap) {
        d.prepare(`UPDATE "Anime" SET "id" = ? WHERE "id" = ?`).run(newId, oldId);
      }

      // 3. 移除 folderPath 唯一索引（解耦关键）
      d.exec(`DROP INDEX IF EXISTS "Anime_folderPath_key"`);

      d.exec(`PRAGMA foreign_keys=ON`);
      logger.info('[Migration v3] Anime ids converted to UUID, folderPath unique index dropped');
    },
  },
];

// 运行未应用的版本化迁移，并把应用过的版本写入 MigrationLog。
// 结束后幂等清理遗留 Wishlist 表（即使已迁移也执行，确保无残留）。
function runMigrations() {
  const d = getDb();
  const applied = new Set(
    d.prepare(`SELECT version FROM MigrationLog`).all().map((r: any) => r.version)
  );
  for (const mig of MIGRATIONS) {
    if (applied.has(mig.version)) continue;
    logger.info(`[Migration] ${mig.version}: ${mig.description}`);
    mig.up(d);
    d.prepare(`INSERT INTO MigrationLog (id, version, description, appliedAt) VALUES (?, ?, ?, ?)`)
      .run(mig.version, mig.version, mig.description, Date.now());
  }
  // 幂等：无论是否已迁移，都确保遗留 Wishlist 表被清理
  d.exec(`DROP TABLE IF EXISTS "Wishlist"`);
}

/**
 * 首次启动时自动创建表结构（CREATE TABLE IF NOT EXISTS）。
 * 对已有表检查缺少的列（如通过迁移添加的列），自动 ALTER TABLE 补充。
 * 不依赖 Prisma 迁移历史，适用于 pkg 生产环境。
 * 保持 async 签名以兼容原调用方（内部为同步执行）。
 */
async function ensureSchema() {
  if (!fs.existsSync(DB_FILE)) {
    logger.info('Database file not found, creating new database...');
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, '');
    logger.info('Database file created, initializing schema...');
  }

  try {
    const d = getDb();

    // 1. 获取已有表名
    const existingTables = d.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    const tableNames = new Set(existingTables.map((r: any) => r.name));

    if (tableNames.size === 0) {
      // 全新数据库 — 全量建表
      logger.info('Initializing database schema (fresh)...');
      for (const sql of INIT_SQL) {
        d.exec(sql);
      }
      logger.info('Database schema initialized.');
      return;
    }

    // 2. 已有表：先 CREATE TABLE IF NOT EXISTS（新增表），再检查缺少的列
    for (const sql of INIT_SQL) {
      d.exec(sql);
    }

    // 3. 对每个预定义表，检查并补充缺少的列
    const tableDefs: { name: string; columns: { name: string; def: string }[] }[] = INIT_SQL
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
        }).filter((c): c is { name: string; def: string } => c !== null);
        return { name: tableName, columns };
      }).filter((t): t is { name: string; columns: { name: string; def: string }[] } => t !== null);

    for (const table of tableDefs) {
      // 仅处理存在于 sqlite_master 中的表（跳过 CREATE TABLE IF NOT EXISTS 已处理的）
      if (!tableNames.has(table.name)) continue;

      // 获取已有列名
      const colInfo = d.prepare(`SELECT name FROM pragma_table_info('${table.name}')`).all();
      const existingCols = new Set(colInfo.map((c: any) => c.name.toLowerCase()));

      for (const col of table.columns) {
        if (existingCols.has(col.name.toLowerCase())) continue;

        // 列缺少 → ALTER TABLE ADD COLUMN
        logger.info(`Adding missing column: ${table.name}.${col.name}`);
        d.exec(`ALTER TABLE "${table.name}" ADD COLUMN ${col.def}`);
      }
    }

    // ─── 版本化迁移 ───
    // "schema sync"（上方 CREATE TABLE + ALTER 补列循环）是基线，幂等且已被测试覆盖；
    // MIGRATIONS 表仅登记需显式数据/结构变更的版本，只跑 MigrationLog 未记录过的。
    await runMigrations();

    logger.info('Database schema verified/updated.');
  } catch (e: any) {
    logger.warn('Schema init skipped:', e.message);
  }
}

async function shutdown() {
  if (db) {
    db.close();
    db = null;
  }
}

// ─── Legacy format converters ───

function animeToLegacy(a: any) {
  // Restore extra fields from metadata JSON (characters, persons, tags, etc.)
  let metadataExtra: any = {};
  if (a.metadata) {
    try {
      metadataExtra = JSON.parse(a.metadata);
    } catch (e: any) {
      logger.warn('Failed to parse anime metadata JSON:', e.message);
    }
  }

  return {
    id: a.id,
    folderPath: a.folderPath,
    folderName: a.folderName,
    title: a.title,
    season: a.season,
    importedAt: new Date(a.importedAt).toISOString(),
    // 🔴 downloaded 存 0/1，必须强转布尔（否则前端 if(a.downloaded) 挂）
    downloaded: !!a.downloaded,
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
    anilistId: a.anilistId,
    anilistBanner: a.anilistBanner,
    anilistCover: a.anilistCover,
    anilistTitleEn: a.anilistTitleEn,
    // Spread persisted extras (characters, persons, tags, date, platform,
    // ratingRank, ratingTotal, infobox, collection, eps, totalEpisodes, specialSuffix)
    ...metadataExtra,
    episodes: (a.episodes || []).map((e: any) => ({
      number: e.number,
      filePath: e.filePath,
      fileName: e.fileName,
      fileSize: Number(e.fileSize),
      duration: e.duration,
      watched: !!e.watched,
      progress: e.progress,
    })),
  };
}

function myListToLegacy(m: any) {
  return {
    id: m.id,
    animeId: m.animeId,
    bangumiId: m.bangumiId,
    title: m.title || '',
    bangumiTitle: m.bangumiTitle,
    coverUrl: m.coverUrl,
    summary: m.summary,
    status: m.status,
    rating: m.rating,
    thoughts: m.thoughts || '',
    notes: m.notes || '',
    progress: m.progress,
    startedAt: m.startedAt ? new Date(m.startedAt).toISOString() : null,
    completedAt: m.completedAt ? new Date(m.completedAt).toISOString() : null,
    createdAt: new Date(m.createdAt).toISOString(),
    updatedAt: new Date(m.updatedAt).toISOString(),
  };
}

function sessionToLegacy(s: any) {
  return {
    animeId: s.animeId,
    episodeNumber: s.episodeNumber,
    sessionId: s.sessionId,
    startTime: new Date(s.startTime).toISOString(),
    endTime: s.endTime ? new Date(s.endTime).toISOString() : null,
    duration: s.duration,
    clockTime: s.clockTime,
    progressStart: s.progressStart,
  };
}

// ─── MyList 行读写辅助 ───

const MYLIST_COLS = ['id', 'animeId', 'bangumiId', 'title', 'bangumiTitle', 'coverUrl', 'summary', 'status', 'rating', 'thoughts', 'notes', 'startedAt', 'completedAt', 'progress', 'createdAt', 'updatedAt'];

function genId(): string {
  // 模拟 Prisma cuid 的本地生成（无外部依赖）：时间戳 + 随机片段
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

function insertMyListRow(d: any, data: any) {
  const now = Date.now();
  const params: any = {};
  for (const c of MYLIST_COLS) {
    params[c] = (data[c] !== undefined) ? data[c] : null;
  }
  if (params.id === null) params.id = genId();
  params.createdAt = data.createdAt !== undefined ? data.createdAt : now;
  params.updatedAt = now;
  const colList = MYLIST_COLS.map(c => `"${c}"`).join(', ');
  const valList = MYLIST_COLS.map(c => `@${c}`).join(', ');
  d.prepare(`INSERT INTO MyList (${colList}) VALUES (${valList})`).run(params);
}

function updateMyListRow(d: any, id: any, data: any) {
  const params = { ...data, id, updatedAt: Date.now() };
  const setList = Object.keys(data).map(c => `"${c}" = @${c}`).join(', ');
  d.prepare(`UPDATE MyList SET ${setList}, "updatedAt" = @updatedAt WHERE "id" = @id`).run(params);
}

function upsertMyListByAnimeId(d: any, animeId: any, data: any) {
  const now = Date.now();
  const existing = d.prepare(`SELECT id FROM MyList WHERE animeId = ?`).get(animeId);
  if (existing) {
    updateMyListRow(d, existing.id, data);
  } else {
    insertMyListRow(d, { id: animeId, animeId, ...data, createdAt: now });
  }
}

// ─── Load ───

// 从 SQLite 加载全部数据，返回传统 JSON 格式。
// 若 SQLite 不可用（首次运行/DB 不存在）返回 null，调用者应回退到 JSON 文件。
async function loadData(): Promise<AppData | null> {
  try {
    ensureSchema();
    const d = getDb();

    const animeRows = d.prepare(`SELECT * FROM Anime ORDER BY importedAt ASC`).all();
    const episodeRows = d.prepare(`SELECT * FROM Episode ORDER BY number ASC`).all();
    const myListRows = d.prepare(`SELECT * FROM MyList ORDER BY createdAt DESC`).all();
    const playSessionRows = d.prepare(`SELECT * FROM PlaySession`).all();
    const scannedRow = d.prepare(`SELECT * FROM ScannedTree WHERE id = 'current'`).get();

    // include episodes → 二次查询按 animeId 分组，episodes 已按 number 升序
    const epByAnime: any = new Map();
    for (const e of episodeRows) {
      if (!epByAnime.has(e.animeId)) epByAnime.set(e.animeId, []);
      epByAnime.get(e.animeId).push(e);
    }

    return {
      discovered: [],
      library: animeRows.map((a: any) => animeToLegacy({ ...a, episodes: epByAnime.get(a.id) || [] })),
      myList: myListRows.map(myListToLegacy),
      playSessions: playSessionRows.map(sessionToLegacy),
      scannedTree: scannedRow ? JSON.parse(scannedRow.data) : [],
    };
  } catch (e: any) {
    logger.error('Failed to load from SQLite:', e.message);
    return null;
  }
}

// ─── Save ───

// ─── Save (SQLite 批量全同步，library/playSessions) ───
// scannedTree 由 server.js 独立写入 JSON 文件
async function saveAll(data: any) {
  if (!data) return;
  await Promise.all([
    saveLibrary(data),
    saveMyList(data),
    savePlaySessions(data),
  ]);
}

function upsertAnime(d: any, id: any, data: any) {
  const params: any = { id };
  const cols: any[] = [];
  for (const c of Object.keys(data)) {
    if (data[c] !== undefined) { cols.push(c); params[c] = data[c]; }
  }
  if (cols.length === 0) return;
  const colList = ['id', ...cols].map(c => `"${c}"`).join(', ');
  const valList = ['@id', ...cols.map(c => `@${c}`)].join(', ');
  const updList = cols.map(c => `"${c}" = excluded."${c}"`).join(', ');
  d.prepare(`INSERT INTO Anime (${colList}) VALUES (${valList}) ON CONFLICT("id") DO UPDATE SET ${updList}`).run(params);
}

async function saveLibrary(data: any, changedIds: any = null) {
  if (!data) return;
  try {
    const d = getDb();
    const txn = d.transaction((dataInner: any, changedIdsInner: any) => {
      const existingIds = new Set(
        d.prepare(`SELECT id FROM Anime`).all().map((a: any) => a.id)
      );
      const currentIds = new Set(dataInner.library.map((a: any) => a.id));

      for (const id of existingIds) {
        if (!currentIds.has(id)) {
          // FK ON DELETE CASCADE 会连带清 Episode/PlaySession/MyList
          d.prepare(`DELETE FROM Anime WHERE id = ?`).run(id);
        }
      }

      // If changedIds provided, only upsert those items (still handle deletions above)
      const toProcess = changedIdsInner
        ? dataInner.library.filter((a: any) => changedIdsInner.has(a.id))
        : dataInner.library;

      const insEpisode = d.prepare(
        `INSERT INTO Episode (id, animeId, number, filePath, fileName, fileSize, duration, watched, progress, watchedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const delEpisodes = d.prepare(`DELETE FROM Episode WHERE animeId = ?`);

      for (const a of toProcess) {
        let ratingVal = a.rating;
        if (ratingVal != null && typeof ratingVal !== 'number') {
          ratingVal = parseFloat(ratingVal);
          if (isNaN(ratingVal)) ratingVal = null;
        }

        // Collect extra fields (no dedicated column) into metadata JSON
        const EXTRA_FIELDS = [
          'characters', 'persons', 'tags', 'date', 'platform',
          'ratingRank', 'ratingTotal', 'infobox', 'collection',
          'eps', 'totalEpisodes', 'specialSuffix',
        ];
        const extraFields: any = {};
        for (const key of EXTRA_FIELDS) {
          if (a[key] !== undefined) extraFields[key] = a[key];
        }
        const metadataStr = Object.keys(extraFields).length > 0
          ? JSON.stringify(extraFields)
          : a.metadata || null; // preserve existing metadata if no new extras

        const animeData: any = {
          folderPath: a.folderPath,
          folderName: a.folderName,
          title: a.title,
          season: a.season,
          importedAt: new Date(a.importedAt).getTime(),
          downloaded: a.downloaded ? 1 : 0,
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
          anilistId: a.anilistId != null && a.anilistId !== -1 ? a.anilistId : null,
          anilistBanner: a.anilistBanner ?? null,
          anilistCover: a.anilistCover ?? null,
          anilistTitleEn: a.anilistTitleEn ?? null,
        };

        // Check bangumiId uniqueness — skip if another anime already owns it
        if (a.bangumiId) {
          const existing = d.prepare(`SELECT id FROM Anime WHERE bangumiId = ? AND id != ?`).get(a.bangumiId, a.id);
          if (existing) {
            logger.warn(`bangumiId ${a.bangumiId} already owned by ${existing.id}, skipping ${a.id}`);
            continue;
          }
        }

        // Check anilistId uniqueness — current record wins, clear old owner
        if (animeData.anilistId) {
          const existingAnilist = d.prepare(`SELECT id FROM Anime WHERE anilistId = ? AND id != ?`).get(animeData.anilistId, a.id);
          if (existingAnilist) {
            logger.warn(`anilistId ${animeData.anilistId} already owned by ${existingAnilist.id}, clearing old owner`);
            d.prepare(`UPDATE Anime SET anilistId = NULL, anilistBanner = NULL, anilistCover = NULL, anilistTitleEn = NULL WHERE id = ?`).run(existingAnilist.id);
          }
        }

        upsertAnime(d, a.id, animeData);

        if (a.episodes && a.episodes.length > 0) {
          delEpisodes.run(a.id);
          for (const e of a.episodes) {
            insEpisode.run(
              `${a.id}-${e.number}`,
              a.id,
              e.number,
              e.filePath,
              e.fileName,
              Number(e.fileSize || 0),
              e.duration ?? null,
              e.watched ? 1 : 0,
              e.progress ?? 0,
              null
            );
          }
        }
      }
    });

    txn(data, changedIds);
    const savedCount = changedIds ? changedIds.size : data.library.length;
    logger.info(`Synced library: ${savedCount} anime${changedIds ? ` (incremental, ${data.library.length} total)` : ''}`);
  } catch (e: any) {
    logger.error('SQLite library save error:', e.message);
    throw e;
  }
}

// ─── MyList (统一表：library 条目 + wish 条目) ───
// animeId 有值 = 本地有文件的条目，bangumiId 有值 = 来自 Bangumi 的 wish 条目
async function saveMyList(data: any) {
  if (!data) return;
  try {
    const d = getDb();
    const txn = d.transaction((dataInner: any) => {
      const existing = d.prepare(`SELECT id, animeId, bangumiId, status FROM MyList`).all();
      const existingByAnimeId: Map<any, any> = new Map(existing.filter((x: any) => x.animeId).map((x: any) => [x.animeId, x]));
      const existingByBgmId: Map<any, any> = new Map(existing.filter((x: any) => x.bangumiId && !x.animeId).map((x: any) => [String(x.bangumiId), x]));
      const existingById: Map<any, any> = new Map(existing.map((x: any) => [x.id, x]));

      const incomingAnimeIds = new Set((dataInner.myList || []).filter((x: any) => x.animeId).map((x: any) => x.animeId));
      const incomingBgmIds = new Set((dataInner.myList || []).filter((x: any) => !x.animeId && x.bangumiId).map((x: any) => String(x.bangumiId)));

      const delStmt = d.prepare(`DELETE FROM MyList WHERE id = ?`);

      // Delete removed animeId-based items
      for (const [animeId, record] of existingByAnimeId) {
        if (!incomingAnimeIds.has(animeId)) {
          delStmt.run(record.id);
        }
      }

      // Delete removed bangumiId-based items
      for (const [bgmId, record] of existingByBgmId) {
        if (!incomingBgmIds.has(bgmId)) {
          delStmt.run(record.id);
        }
      }

      // Upsert incoming items
      for (const item of dataInner.myList || []) {
        // Preserve existing DB status when incoming item has no explicit status
        let resolvedStatus = item.status;
        if (!resolvedStatus) {
          const existingRecord = item.animeId
            ? existingByAnimeId.get(item.animeId)
            : item.bangumiId ? existingByBgmId.get(String(item.bangumiId)) : null;
          resolvedStatus = existingRecord ? existingRecord.status : 'wish';
        }
        const commonData: any = {
          status: resolvedStatus,
          rating: item.rating ?? null,
          thoughts: item.thoughts || '',
          notes: item.notes || '',
          progress: item.progress !== undefined ? item.progress : null,
          startedAt: item.startedAt ? new Date(item.startedAt).getTime() : null,
          completedAt: item.completedAt ? new Date(item.completedAt).getTime() : null,
          title: item.title || '',
          bangumiTitle: item.bangumiTitle || null,
          coverUrl: item.coverUrl || null,
          summary: item.summary || null,
        };

        if (item.animeId) {
          // Library-linked item — upsert by animeId
          const existingRow = d.prepare(`SELECT id FROM MyList WHERE animeId = ?`).get(item.animeId);
          if (existingRow) {
            updateMyListRow(d, existingRow.id, { ...commonData, bangumiId: item.bangumiId || null });
          } else {
            insertMyListRow(d, { id: item.animeId, animeId: item.animeId, bangumiId: item.bangumiId || null, ...commonData });
          }
        } else if (item.bangumiId) {
          // Wish-only item — lookup by bangumiId
          const existingRow = d.prepare(`SELECT id FROM MyList WHERE bangumiId = ? AND animeId IS NULL`).get(item.bangumiId);
          if (existingRow) {
            updateMyListRow(d, existingRow.id, { ...commonData });
          } else {
            insertMyListRow(d, { animeId: null, bangumiId: item.bangumiId, ...commonData });
          }
        }
      }
    });

    txn(data);
    logger.info(`Synced MyList: ${(data.myList || []).length} items`);
  } catch (e: any) {
    logger.error('SQLite myList save error:', e.message);
    throw e;
  }
}

// ─── 精细化更新：单条 MyList 状态（仅限 library 条目） ───
async function updateMyItemStatus(animeId: any, status: any) {
  try {
    const d = getDb();
    upsertMyListByAnimeId(d, animeId, { status });
    logger.info(`Updated MyList status: ${animeId} → ${status}`);
  } catch (e: any) {
    logger.error('MyList status update error:', e.message);
  }
}

async function savePlaySessions(data: any) {
  if (!data) return;
  try {
    const d = getDb();
    const txn = d.transaction((dataInner: any) => {
      // Query valid anime IDs from DB (not data.library) to avoid deleting
      // sessions for existing anime when memory state is stale
      const validRows = d.prepare(`SELECT id FROM Anime`).all();
      const validIds = new Set(validRows.map((a: any) => a.id));
      if (validIds.size > 0) {
        // 守卫空数组：validIds 非空才拼 NOT IN
        const ids = Array.from(validIds);
        const ph = ids.map(() => '?').join(',');
        d.prepare(`DELETE FROM PlaySession WHERE animeId NOT IN (${ph})`).run(...ids);
      } else {
        d.prepare(`DELETE FROM PlaySession`).run();
      }

      const validSessions = (dataInner.playSessions || []).filter((s: any) => validIds.has(s.animeId));
      const upsertStmt = d.prepare(
        `INSERT INTO PlaySession (id, animeId, episodeNumber, sessionId, startTime, endTime, duration, clockTime, progressStart) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT("sessionId") DO UPDATE SET endTime = excluded.endTime, duration = excluded.duration, clockTime = excluded.clockTime`
      );
      for (const s of validSessions) {
        upsertStmt.run(
          s.sessionId,
          s.animeId,
          s.episodeNumber,
          s.sessionId,
          new Date(s.startTime).getTime(),
          s.endTime ? new Date(s.endTime).getTime() : null,
          s.duration,
          s.clockTime,
          s.progressStart
        );
      }
    });

    txn(data);
  } catch (e: any) {
    logger.error('SQLite playSessions save error:', e.message);
    throw e;
  }
}

// ─── 精细化更新：mpv 每 10s 进度 ───

async function updateEpisodeProgress(animeId: any, epNumber: any, fields: any): Promise<boolean> {
  try {
    const d = getDb();
    const data: any = {};
    if (fields.progress !== undefined) data.progress = fields.progress;
    if (fields.duration !== undefined) data.duration = fields.duration;
    if (fields.watched !== undefined) data.watched = fields.watched ? 1 : 0;
    if (Object.keys(data).length === 0) return true;
    const setList = Object.keys(data).map(c => `"${c}" = @${c}`).join(', ');
    d.prepare(`UPDATE Episode SET ${setList} WHERE "animeId" = @animeId AND "number" = @number`)
      .run({ ...data, animeId, number: epNumber });
    return true;
  } catch (e: any) {
    logger.error('Episode progress update error:', e.message);
    return false;
  }
}

async function updatePlaySession(sessionId: any, fields: any): Promise<boolean> {
  try {
    if (!sessionId) return true;
    const d = getDb();
    const data: any = {};
    if (fields.endTime !== undefined) data.endTime = new Date(fields.endTime).getTime();
    if (fields.duration !== undefined) data.duration = fields.duration;
    if (fields.clockTime !== undefined) data.clockTime = fields.clockTime;
    if (Object.keys(data).length === 0) return true;
    const setList = Object.keys(data).map(c => `"${c}" = @${c}`).join(', ');
    d.prepare(`UPDATE PlaySession SET ${setList} WHERE "sessionId" = @sessionId`)
      .run({ ...data, sessionId });
    return true;
  } catch (e: any) {
    logger.error('PlaySession update error:', e.message);
    return false;
  }
}

async function updateAnime(id: any, fields: any): Promise<boolean> {
  try {
    if (!id || !fields || Object.keys(fields).length === 0) return true;
    const d = getDb();
    // 动态 SET 过滤 undefined（Prisma 忽略 undefined，原生层必须自己过滤）
    const data: any = {};
    for (const k of Object.keys(fields)) {
      if (fields[k] !== undefined) data[k] = fields[k];
    }
    if (Object.keys(data).length === 0) return true;
    const setList = Object.keys(data).map(c => `"${c}" = @${c}`).join(', ');
    d.prepare(`UPDATE Anime SET ${setList} WHERE "id" = @id`).run({ ...data, id });
    return true;
  } catch (e: any) {
    logger.error('Anime update error:', e.message);
    return false;
  }
}

async function deletePlaySession(sessionId: any): Promise<boolean> {
  try {
    if (!sessionId) return true;
    const d = getDb();
    d.prepare(`DELETE FROM PlaySession WHERE sessionId = ?`).run(sessionId);
    return true;
  } catch (e: any) {
    logger.error('PlaySession delete error:', e.message);
    return false;
  }
}

async function updateEpisodesWatched(animeId: any, episodeNumbers: any[]): Promise<boolean> {
  try {
    if (!episodeNumbers.length) return true;
    const d = getDb();
    const ph = episodeNumbers.map(() => '?').join(',');
    d.prepare(`UPDATE Episode SET watched = 1 WHERE "animeId" = ? AND "number" IN (${ph})`).run(animeId, ...episodeNumbers);
    return true;
  } catch (e: any) {
    logger.error('Episodes watched batch update error:', e.message);
    return false;
  }
}

async function updateMyListItem(animeId: any, fields: any): Promise<boolean> {
  try {
    const d = getDb();
    const data: any = {};
    if (fields.status !== undefined) data.status = fields.status;
    if (fields.rating !== undefined) data.rating = fields.rating;
    if (fields.thoughts !== undefined) data.thoughts = fields.thoughts;
    if (fields.notes !== undefined) data.notes = fields.notes;
    if (fields.progress !== undefined) data.progress = fields.progress;
    if (fields.startedAt !== undefined) data.startedAt = fields.startedAt ? new Date(fields.startedAt).getTime() : null;
    if (fields.completedAt !== undefined) data.completedAt = fields.completedAt ? new Date(fields.completedAt).getTime() : null;
    if (Object.keys(data).length === 0) return true;
    upsertMyListByAnimeId(d, animeId, data);
    logger.info(`Updated MyList item: ${animeId}`);
    return true;
  } catch (e: any) {
    logger.error('MyList item update error:', e.message);
    return false;
  }
}

// ─── 管理操作：clear-sessions / vacuum / reset ───
// 供 db-manager.js 使用（替代原 getPrisma() 的 deleteMany / $executeRawUnsafe）。

// 清空 PlaySession（等价原 getPrisma().playSession.deleteMany()）
async function clearSessions() {
  const d = getDb();
  d.prepare(`DELETE FROM PlaySession`).run();
}

// SQLite VACUUM 优化。
// better-sqlite3 的 VACUUM 不能在事务内执行，此函数不入事务、直接执行。
async function vacuum() {
  const d = getDb();
  d.exec('VACUUM');
}

// 重置：清空 4 张表（PlaySession / Episode / Anime / MyList）。
// 等价原 getPrisma() 的 playSession/episode/anime/myList.deleteMany()。
// 依赖 PRAGMA foreign_keys=ON，Anime 删除会级联清理关联 Episode/PlaySession/MyList。
async function reset() {
  const d = getDb();
  d.prepare(`DELETE FROM PlaySession`).run();
  d.prepare(`DELETE FROM Episode`).run();
  d.prepare(`DELETE FROM Anime`).run();
  d.prepare(`DELETE FROM MyList`).run();
}

export {
  loadData,
  saveAll,
  saveLibrary,
  saveMyList,
  updateMyItemStatus,
  updateMyListItem,
  savePlaySessions,
  updateEpisodeProgress,
  updateEpisodesWatched,
  updatePlaySession,
  updateAnime,
  deletePlaySession,
  shutdown,
  ensureSchema,
  clearSessions,
  vacuum,
  reset,
};
