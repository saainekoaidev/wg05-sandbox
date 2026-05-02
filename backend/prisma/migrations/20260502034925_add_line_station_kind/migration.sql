/*
  Warnings:

  - You are about to drop the `Segment` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Route" ADD COLUMN "name" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Segment";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "RouteSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "lineId" TEXT,
    "fromStation" TEXT NOT NULL,
    "toStation" TEXT NOT NULL,
    "fare" INTEGER NOT NULL,
    CONSTRAINT "RouteSegment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RouteSegment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Line" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operator" TEXT
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kana" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StationLine" (
    "stationId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    PRIMARY KEY ("stationId", "lineId"),
    CONSTRAINT "StationLine_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StationLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RouteSegment_routeId_orderIndex_idx" ON "RouteSegment"("routeId", "orderIndex");

-- CreateIndex
CREATE INDEX "RouteSegment_lineId_idx" ON "RouteSegment"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "Line_name_key" ON "Line"("name");

-- CreateIndex
CREATE INDEX "Station_name_idx" ON "Station"("name");

-- CreateIndex
CREATE INDEX "StationLine_lineId_idx" ON "StationLine"("lineId");
