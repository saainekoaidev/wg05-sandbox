# 0008 駅番号 (station code) を路線ごとに保持する

## Status
Accepted (US-033 で採用)。0007 (東海4県マスタ取り込み仕様) を補完し, US-030 で導入した `Station.code` を廃止する。

## Context
US-030 では Wikidata の P296 (station code, 駅番号) を駅マスタに取り込み, 駅マスタ参照画面 (S07) のソート対象として `Station.code` を新設した。1 駅が複数の駅番号を持つケース (例: 名古屋駅 = 東海道線 CA68, 中央線 CC00, 関西線 CF00) は `/` 区切りで連結する暫定実装としていた。

その後 US-033 で「駅番号は路線ごとに採番されるものなので, 駅マスタ管理 (S10) の編集画面では路線ごとに駅番号を表示・入力できるべき」という要件が出てきた。

実体としても, 駅番号は **(駅, 路線) のペアに対して 1:1 で割り当てられる** ものであり, 駅単位の単一フィールドで `/` 連結する設計は表現上正しくない。複数 code を持つ駅で「どの code がどの路線か」が落ちてしまう。Wikidata 側でも P296 の statement に qualifier P81 (connecting line) を付けて路線との対応を表現することがあり, データ上は路線別の構造が一次表現である。

本サンドボックスでも駅マスタ管理 (S10) で人間が編集する以上, 路線ごとに code を持てる構造に変更する必要がある。

## Decision

### スキーマ
- `Station.code` (US-030 で追加) は **廃止**。
- `StationLine.code String NOT NULL DEFAULT ""` を **新設**。中間テーブル `StationLine` に code を持たせる。
- 駅単位で単一 code を保持したい場面 (S07 の駅一覧サマリ等) では `lineLinks` の code を集約してアプリ層で計算する。DB 側の生成カラムは持たない (SQLite + Prisma の制約と, 編集ロジックの単純化を優先)。

### 取り込み (US-011 の import script)
SPARQL クエリは `wdt:P296` (truthy) ではなく **statement node + qualifier** 形式で取得する:

```sparql
?station p:P296 ?codeStmt .
?codeStmt ps:P296 ?stationCode .
OPTIONAL { ?codeStmt pq:P81 ?qualifierLine . }
```

割り当てロジック:
- qualifier `pq:P81` が付いている code → その qualifier line と一致する `StationLine.code` に格納。
- qualifier が付いていない code → 当該駅のすべての lineLink に **同一の code** を格納 (Wikidata 側に路線対応情報がない場合のフォールバック)。
- 同一 (station, line) ペアに複数 code 候補が出る場合は `/` 区切りで sort 連結 (US-030 の駅単位連結ロジックを路線粒度に下ろした形)。

### API
- `GET /api/admin/stations` (S10 一覧): 各 lineLink に `{ id, name, kind, code }` を含める。
- `POST /api/admin/stations`, `PUT /api/admin/stations/:id`:
  - request body の路線指定を `lineIds: string[]` から `lineLinks: Array<{ lineId: string, code: string }>` に変更。
  - code は `string` (1〜30 文字, 半角英数 + ハイフン + スラッシュのみ許容, 空文字許容)。
- `GET /api/stations` (S07): 各駅の `code` 表示は **lineLinks の code をユニーク化して `/` 連結** で組み立て (現行の駅マスタ参照画面の表示と同じ見た目を維持)。

### UI
- 駅マスタ管理 新規 / 編集 (S10 派生):
  - 接続路線セレクトを「チェックボックス + 路線名 + 駅番号 input」の 3 列レイアウトに変更。
  - チェックボックス列の幅は最小限 (チェックボックス本体程度) に詰める。
  - チェックを外したとき, 同じ行の駅番号 input は値をクリアする (チェック ON で再入力する想定)。
- 駅マスタ参照 (S07): 駅番号列の表示は lineLinks の code 集約値 (現行と互換)。ソートは集約値 (`/` 連結文字列) の文字列比較。

### 移行 (migration)
- `prisma migrate dev` で:
  1. `StationLine.code TEXT NOT NULL DEFAULT ""` を追加。
  2. `Station.code` カラムを drop。
- 既存の `Station.code` 値は **破棄** する。再現可能なデータ (Wikidata 由来) なので `--clean` 再実行で復元する運用とする。手動で入力された駅 (sourceUri NULL) は元々 `Station.code = ""` だったため影響なし。

## Consequences

### 利益
- 駅番号の意味 (路線ごとの採番) を正しく表現できる。
- S10 で人間が路線ごとに駅番号を編集できる (今後の路線追加・改番への対応が容易)。
- Wikidata 側の qualifier データが活用できる (qualifier 付き P296 は正しい line に紐づく)。

### 代償・リスク
- US-030 で書いた `Station.code` 関連コードは 1 リリース後に廃止する形になる。マイグレーション + 取り込み再実行が必要 (運用コスト 1 回)。
- API 互換性が壊れる: `lineIds: string[]` ベースの POST/PUT は廃止し `lineLinks: Array<{ lineId, code }>` に置き換え。frontend と API を同時にリリースする必要がある (本サンドボックスは monorepo + 同時 deploy なので問題なし)。
- Wikidata の P296 qualifier データ品質に依存する: qualifier が付いていない code は全 lineLink に同じ値が入るため, 1 駅複数路線の駅で「実際は東海道線分の code しか付いてないのに中央線にも同じ値が見える」というノイズが残る。手動で S10 から修正できる前提とする。

### 影響範囲
- 0007 (東海4県マスタ取り込み仕様) §5: `Station.code` の記述を `StationLine.code` に読み替え。本 ADR で上書きする。
- US-030 で追加したテスト (Station.code 関連) は本 ADR の方針に合わせて書き直す。
