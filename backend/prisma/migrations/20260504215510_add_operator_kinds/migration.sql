-- US-052: Operator に kinds 列 (運営する路線種別の JSON 配列) を追加。
-- 各画面の 種別 dropdown を operator で絞り込むために使う。

ALTER TABLE "Operator" ADD COLUMN "kinds" TEXT NOT NULL DEFAULT '[]';

-- 既存の Line.kind から派生して各 operator の kinds 配列を初期投入する。
-- SQLite GROUP_CONCAT(DISTINCT) で重複除去。Line を持たない operator は '[]' のまま。
UPDATE "Operator" SET "kinds" = (
  SELECT COALESCE(
    '[' || GROUP_CONCAT(DISTINCT '"' || "kind" || '"') || ']',
    '[]'
  )
  FROM "Line" WHERE "Line"."operatorId" = "Operator"."id"
)
WHERE EXISTS (SELECT 1 FROM "Line" WHERE "Line"."operatorId" = "Operator"."id");
