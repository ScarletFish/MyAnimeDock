-- DropIndex
DROP INDEX "Anime_bangumiId_key";

-- AlterTable
ALTER TABLE "Anime" ADD COLUMN "matchedSeason" INTEGER;
ALTER TABLE "Anime" ADD COLUMN "totalSeasons" INTEGER;
