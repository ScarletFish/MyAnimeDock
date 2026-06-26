/*
  Warnings:

  - You are about to drop the `Memory` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Memory";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "MyList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'watching',
    "rating" REAL,
    "thoughts" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MyList_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Wishlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bangumiId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "bangumiTitle" TEXT,
    "coverUrl" TEXT,
    "summary" TEXT,
    "rating" REAL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MyList_animeId_key" ON "MyList"("animeId");

-- CreateIndex
CREATE INDEX "MyList_animeId_idx" ON "MyList"("animeId");

-- CreateIndex
CREATE INDEX "MyList_status_idx" ON "MyList"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Wishlist_bangumiId_key" ON "Wishlist"("bangumiId");

-- CreateIndex
CREATE INDEX "Wishlist_bangumiId_idx" ON "Wishlist"("bangumiId");
