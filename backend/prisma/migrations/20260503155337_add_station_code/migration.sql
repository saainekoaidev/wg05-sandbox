-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kana" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "sourceUri" TEXT,
    "importedAt" DATETIME
);
INSERT INTO "new_Station" ("id", "importedAt", "kana", "name", "sourceUri") SELECT "id", "importedAt", "kana", "name", "sourceUri" FROM "Station";
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";
CREATE INDEX "Station_name_idx" ON "Station"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
