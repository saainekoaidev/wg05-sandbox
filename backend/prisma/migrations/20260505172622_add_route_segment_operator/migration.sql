-- US-059: RouteSegment.operatorId を追加 (新規区間で必須, 既存は nullable)。
-- SQLite では既存の RouteSegment テーブルを再構築する必要がある (FK 列追加のため)。

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_RouteSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "lineId" TEXT,
    "operatorId" TEXT,
    "fromStation" TEXT NOT NULL,
    "toStation" TEXT NOT NULL,
    "fare" INTEGER NOT NULL,
    CONSTRAINT "RouteSegment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RouteSegment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RouteSegment_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 既存データを移行 (operatorId は line 経由で派生して投入)
INSERT INTO "new_RouteSegment" ("id", "routeId", "orderIndex", "kind", "lineId", "operatorId", "fromStation", "toStation", "fare")
SELECT
    rs."id",
    rs."routeId",
    rs."orderIndex",
    rs."kind",
    rs."lineId",
    l."operatorId" AS "operatorId",
    rs."fromStation",
    rs."toStation",
    rs."fare"
FROM "RouteSegment" rs
LEFT JOIN "Line" l ON l."id" = rs."lineId";

DROP TABLE "RouteSegment";
ALTER TABLE "new_RouteSegment" RENAME TO "RouteSegment";

CREATE INDEX "RouteSegment_routeId_orderIndex_idx" ON "RouteSegment"("routeId", "orderIndex");
CREATE INDEX "RouteSegment_lineId_idx" ON "RouteSegment"("lineId");
CREATE INDEX "RouteSegment_operatorId_idx" ON "RouteSegment"("operatorId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
