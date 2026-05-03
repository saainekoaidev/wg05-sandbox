-- US-033 / ADR 0008: Station.code を廃止し、StationLine.code に移行する。
-- SQLite は DROP COLUMN を限定的にしかサポートしないため、Station テーブルを再構築する。

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- 1) Station テーブルから code カラムを削除 (再構築)
CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kana" TEXT NOT NULL,
    "sourceUri" TEXT,
    "importedAt" DATETIME
);
INSERT INTO "new_Station" ("id", "importedAt", "kana", "name", "sourceUri")
    SELECT "id", "importedAt", "kana", "name", "sourceUri" FROM "Station";
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";
CREATE INDEX "Station_name_idx" ON "Station"("name");

-- 2) StationLine テーブルに code カラムを追加 (NOT NULL DEFAULT '')
CREATE TABLE "new_StationLine" (
    "stationId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    PRIMARY KEY ("stationId", "lineId"),
    CONSTRAINT "StationLine_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StationLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StationLine" ("stationId", "lineId")
    SELECT "stationId", "lineId" FROM "StationLine";
DROP TABLE "StationLine";
ALTER TABLE "new_StationLine" RENAME TO "StationLine";
CREATE INDEX "StationLine_lineId_idx" ON "StationLine"("lineId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
