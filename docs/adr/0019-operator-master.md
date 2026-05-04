# 0019 運営会社マスタの導入と駅の operator 別分割

## Status
Accepted (US-049 で採用)。ADR 0007 (取り込み仕様) / ADR 0012 (同一物理駅マージ) を更新する。

## Context
これまで `Line.operator` は単純な文字列フィールド (例: "JR東海", "名古屋鉄道", "近畿日本鉄道") で, マスタ化されていなかった。これに起因する問題:

1. **駅番号やよみがな取得時の引き当て困難**: Wikipedia 記事や Wikidata で「近鉄名古屋駅」と「JR東海名古屋駅」は別エンティティだが, 我々のスキーマでは operator 情報が string で散在しており構造的な区別ができていなかった。
2. **「改札を出ない乗換え」の表現不可**: 通勤経路の 1 区間は本来「運賃が連続する範囲」であるべき。JR東海道線↔関西本線 (改札内乗換え) は 1 駅扱い, JR東海道線↔名鉄名古屋本線 (改札を出る乗換え) は 2 駅扱い という区別が必要。
3. **マスタ管理画面が無い**: 表記揺らぎ ("JR東海" vs "東海旅客鉄道") の補正手段がなかった。

ユーザレビュー (US-049) で:
> 例えば、名鉄名古屋駅で下車してJR東海の名古屋駅で乗り換える場合には、駅は同じではないので分けたいと考えます。しかし、JR東海の東海道線から関西本線に乗り換える場合には、駅は同じなので分けたくありません。改札を出て乗り換えると運賃が連続しないわけで、換言して、運賃が連続するものが通勤経路の1行になる、というイメージなのです。

という基準が示された。

## Decision

### A. Operator マスタ追加

```prisma
model Operator {
  id        String    @id              // slug (例: "jr-tokai")
  name      String    @unique          // 表示名 (例: "JR東海")
  aliases   String    @default("[]")   // JSON array of 表記揺らぎ別名
  lines     Line[]
  stations  Station[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}
```

### B. Line と Station に operator FK を追加

```prisma
model Line {
  // ... existing ...
  operator     String?      // 互換維持 (文字列). 将来削除候補
  operatorId   String?
  operatorRef  Operator?    @relation(fields: [operatorId], references: [id], onDelete: SetNull)
}

model Station {
  // ... existing ...
  operatorId   String?
  operatorRef  Operator?    @relation(fields: [operatorId], references: [id], onDelete: SetNull)
}
```

`Line.operator` 文字列は当面残す (既存ロジック・API レスポンスへの影響を抑える)。最終削除は別 US で検討。

### C. 初期データ (migration / seed)

既存 `Line.operator` の distinct 値から Operator 6 社を生成:

| id | name | aliases (JSON) |
|---|---|---|
| `jr-tokai` | JR東海 | `["東海旅客鉄道"]` |
| `meitetsu` | 名古屋鉄道 | `["名鉄"]` |
| `kintetsu` | 近畿日本鉄道 | `["近鉄"]` |
| `nagoya-subway` | 名古屋市交通局 | `["名古屋市営地下鉄"]` |
| `aonami` | 名古屋臨海高速鉄道 | `["あおなみ線"]` |
| `linimo` | 愛知高速交通 | `["東部丘陵線", "リニモ"]` |

migration 時に `Line.operatorId` を name 一致で populate。

### D. 駅の operator 別分割 (US-041 merge の修正)

**新ルール**: Station は単一 operator に属する (`Station.operatorId` は NOT NULL — 但し manual admin 駅は例外で nullable)。

Wikidata 取り込み時:
- 各 Wikidata Q-ID は SPARQL 結果の path 集合から「その Q-ID が紐付く operator 集合」を導出
- **operator が複数の場合 (例: 大曽根 Q872075 = JR + 名鉄)**: operator ごとに Station レコードを分割。Station.id は cuid 自動生成 (Q-ID は独立した `sourceQid` フィールドに保存し, 複数 Station が同じ Q-ID を共有可能)
- **operator が単一**: 1 Station レコード (現状の挙動と同じだが, operatorId が必ず set される)

ADR 0012 の merge ルールを更新:
- `(a) P138 リンク` または `(b) 同名 + 座標 < 500m` の判定はそのまま
- ただし **同一 operator のステーションペア間でのみ merge** する (operator が異なるなら merge しない)

これにより:
- 名古屋駅 → 5 レコード (JR東海 / 近鉄 / 名鉄 / 名古屋市交通局 / あおなみ)
- 大曽根駅 → 3 レコード (JR東海 / 名鉄 / 名古屋市交通局)
- 千種駅 (Q863068, JR + 地下鉄) → 2 レコード (JR東海 / 名古屋市交通局)

経路登録 (S04) では同名駅が複数候補として並ぶが, operator 表示で利用者が選択する。これにより「大府(JR) → 名鉄名古屋」のような不正な区間は登録できなくなる (改札を出る乗換えは 2 区間で表現する必要がある)。

### E. 管理画面 (S11 新設)

- `/admin/operators` 一覧 (list / create / edit / delete) — S09/S10 と同等の構成
- `/admin/operators/new` / `/admin/operators/:id/edit` フォーム
- AdminLineForm の運営会社入力欄を文字列 → Operator ドロップダウンに変更
- AdminStations 一覧に operator フィルタ追加 (現在の種別/路線フィルタと並列)

### F. API

- `GET /api/operators` (認証不要 / すべて表示用)
- `POST /api/admin/operators` (admin)
- `PUT /api/admin/operators/:id` (admin)
- `DELETE /api/admin/operators/:id` (admin, 参照 Line がある場合は 409)
- 既存 `GET /api/lines`, `GET /api/admin/stations` レスポンスに operator 情報 (id, name) を追加

### G. テスト
- Operator CRUD の routes test
- import-master-tokai.test.ts に operator 別分割パターン追加 (例: 大曽根 Q872075 が JR + 名鉄で 2 レコードに分割される)
- AdminOperators / AdminOperatorForm の React component test

## Consequences

### 利益
- **改札を出る乗換え = 別駅** という本質的なルールがデータモデルに反映される。
- Wikipedia 記事と Wikidata の operator 別エンティティを直接対応付けでき, 駅番号取得が引き当てやすい。
- 経路登録で「大府(JR) → 名鉄名古屋」のような不正区間が表現できなくなる (利用者は明示的に乗換えを 2 区間で記録)。
- Operator 表記揺らぎを aliases で吸収可能 ("東海旅客鉄道" → "JR東海" 自動正規化)。

### 代償・リスク
- **データ件数増加**: 同名駅が operator 別に分かれるため Station レコード数が増加 (推定 100-150 件増)。
- **Wikidata 由来 Q-ID と Station.id の 1:1 対応が崩れる**: 複数 Station が同じ `sourceQid` を持ちうる。Q-ID 単独で駅特定できないため `(sourceQid, operatorId)` を実質キーとする。
- **互換破壊**: `GET /api/admin/stations` レスポンスに operator フィールドが追加される (frontend 側で使う想定)。`Line.operator` 文字列は残るので古いコードは動く。
- **既存 Manual 作成駅**: `Station.operatorId` は nullable のため, 手動作成駅は operator 未設定でも存続する (admin が必要に応じて編集)。

### 影響範囲
- ADR 0007 §1 (取り込みスコープ): operator 集合は引き続き 6 社固定。Operator マスタ化により管理が容易化。
- ADR 0012 (同一物理駅マージ): merge 条件に「同一 operator」を追加。
- 駅マスタ管理 (S10), 路線マスタ管理 (S09): UI に operator 表示・フィルタ追加。
- 経路登録 (S04): 同名駅が operator 別に複数候補として並ぶ (UI 改善は別 US で検討)。
- Phase 2 (将来): `Line.operator` 文字列削除, 経路登録時に operator を明示する UI 強化等。
