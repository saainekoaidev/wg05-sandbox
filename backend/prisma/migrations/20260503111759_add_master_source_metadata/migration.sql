-- AlterTable
ALTER TABLE "Line" ADD COLUMN "importedAt" DATETIME;
ALTER TABLE "Line" ADD COLUMN "sourceUri" TEXT;

-- AlterTable
ALTER TABLE "Station" ADD COLUMN "importedAt" DATETIME;
ALTER TABLE "Station" ADD COLUMN "sourceUri" TEXT;
