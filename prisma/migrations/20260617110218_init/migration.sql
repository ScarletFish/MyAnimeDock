-- CreateTable
CREATE TABLE "Anime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderPath" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "season" INTEGER,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloaded" BOOLEAN NOT NULL DEFAULT true,
    "bangumiId" INTEGER,
    "bangumiTitle" TEXT,
    "bangumiTitleJp" TEXT,
    "summary" TEXT,
    "coverUrl" TEXT,
    "localCover" TEXT,
    "rating" REAL,
    "source" TEXT,
    "pinyinTitle" TEXT,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "duration" INTEGER,
    "watched" BOOLEAN NOT NULL DEFAULT false,
    "progress" REAL NOT NULL DEFAULT 0,
    "watchedAt" DATETIME,
    CONSTRAINT "Episode_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animeId" TEXT NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "clockTime" INTEGER NOT NULL DEFAULT 0,
    "progressStart" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PlaySession_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bangumiId" INTEGER,
    "bangumiTitle" TEXT,
    "rating" REAL,
    "thoughts" TEXT,
    "notes" TEXT,
    "watchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coverLocal" TEXT,
    CONSTRAINT "Memory_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScannedTree" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'current',
    "data" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Config" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "data" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MigrationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Anime_folderPath_key" ON "Anime"("folderPath");

-- CreateIndex
CREATE UNIQUE INDEX "Anime_bangumiId_key" ON "Anime"("bangumiId");

-- CreateIndex
CREATE INDEX "Anime_bangumiId_idx" ON "Anime"("bangumiId");

-- CreateIndex
CREATE INDEX "Anime_title_idx" ON "Anime"("title");

-- CreateIndex
CREATE INDEX "Anime_pinyinTitle_idx" ON "Anime"("pinyinTitle");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_filePath_key" ON "Episode"("filePath");

-- CreateIndex
CREATE INDEX "Episode_animeId_idx" ON "Episode"("animeId");

-- CreateIndex
CREATE INDEX "Episode_filePath_idx" ON "Episode"("filePath");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_animeId_number_key" ON "Episode"("animeId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PlaySession_sessionId_key" ON "PlaySession"("sessionId");

-- CreateIndex
CREATE INDEX "PlaySession_animeId_idx" ON "PlaySession"("animeId");

-- CreateIndex
CREATE INDEX "PlaySession_sessionId_idx" ON "PlaySession"("sessionId");

-- CreateIndex
CREATE INDEX "PlaySession_startTime_idx" ON "PlaySession"("startTime");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_animeId_key" ON "Memory"("animeId");

-- CreateIndex
CREATE INDEX "Memory_animeId_idx" ON "Memory"("animeId");

-- CreateIndex
CREATE INDEX "Memory_watchedAt_idx" ON "Memory"("watchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationLog_version_key" ON "MigrationLog"("version");
