/*
  Warnings:

  - You are about to drop the `Wishlist` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "Wishlist_bangumiId_idx";

-- DropIndex
DROP INDEX "Wishlist_bangumiId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Wishlist";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MyList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animeId" TEXT,
    "bangumiId" INTEGER,
    "title" TEXT NOT NULL DEFAULT '',
    "bangumiTitle" TEXT,
    "coverUrl" TEXT,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'watching',
    "rating" REAL,
    "thoughts" TEXT,
    "notes" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "progress" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MyList_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MyList" ("animeId", "createdAt", "id", "notes", "rating", "status", "thoughts", "updatedAt") SELECT "animeId", "createdAt", "id", "notes", "rating", "status", "thoughts", "updatedAt" FROM "MyList";
DROP TABLE "MyList";
ALTER TABLE "new_MyList" RENAME TO "MyList";
CREATE UNIQUE INDEX "MyList_animeId_key" ON "MyList"("animeId");
CREATE INDEX "MyList_animeId_idx" ON "MyList"("animeId");
CREATE INDEX "MyList_bangumiId_idx" ON "MyList"("bangumiId");
CREATE INDEX "MyList_status_idx" ON "MyList"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
