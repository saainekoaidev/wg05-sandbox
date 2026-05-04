-- US-049 / ADR 0019: 運営会社マスタの導入と Line / Station への operator FK 追加

-- 1) Operator テーブル新規作成
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Operator_name_key" ON "Operator"("name");

-- 2) 既存 Line.operator 文字列から Operator 6 社を seed する
-- ※ ADR 0019 §C の固定マッピングに従う
INSERT INTO "Operator" ("id", "name", "aliases", "createdAt", "updatedAt") VALUES
    ('jr-tokai',       'JR東海',           '["東海旅客鉄道"]',          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('meitetsu',       '名古屋鉄道',         '["名鉄"]',                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kintetsu',       '近畿日本鉄道',       '["近鉄"]',                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('nagoya-subway',  '名古屋市交通局',     '["名古屋市営地下鉄"]',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('aonami',         '名古屋臨海高速鉄道', '["あおなみ線"]',             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('linimo',         '愛知高速交通',       '["東部丘陵線","リニモ"]',   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 3) Line に operatorId 列を追加 + operator 文字列値から populate
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Line" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operator" TEXT,
    "operatorId" TEXT,
    "sourceUri" TEXT,
    "importedAt" DATETIME,
    CONSTRAINT "Line_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Line" ("id", "kind", "name", "operator", "operatorId", "sourceUri", "importedAt")
SELECT
    l."id",
    l."kind",
    l."name",
    l."operator",
    o."id" AS "operatorId",
    l."sourceUri",
    l."importedAt"
FROM "Line" l
LEFT JOIN "Operator" o ON o."name" = l."operator";
DROP TABLE "Line";
ALTER TABLE "new_Line" RENAME TO "Line";
CREATE UNIQUE INDEX "Line_name_key" ON "Line"("name");

-- 4) Station に operatorId と sourceQid 列を追加
CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kana" TEXT NOT NULL,
    "operatorId" TEXT,
    "sourceUri" TEXT,
    "sourceQid" TEXT,
    "importedAt" DATETIME,
    CONSTRAINT "Station_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Station" ("id", "name", "kana", "sourceUri", "importedAt")
SELECT "id", "name", "kana", "sourceUri", "importedAt" FROM "Station";
-- Wikidata 由来駅は id (Q-ID) を sourceQid にも複製する (将来 split で同 Q-ID が複数 Station に紐付くケース用)
UPDATE "new_Station" SET "sourceQid" = "id" WHERE "sourceUri" LIKE '%wikidata.org%';
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";
CREATE INDEX "Station_name_idx" ON "Station"("name");
CREATE INDEX "Station_operatorId_name_idx" ON "Station"("operatorId", "name");
CREATE INDEX "Station_sourceQid_idx" ON "Station"("sourceQid");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
