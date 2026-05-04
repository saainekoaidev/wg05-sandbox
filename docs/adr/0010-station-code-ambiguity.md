# 0010 複数路線駅の駅番号取り込み: qualifier 拡張 + 残り 1 lineLink への補完

## Status
Accepted (US-039 で採用)。ADR 0008 (駅番号を路線ごとに保持) / ADR 0009 (電報略号フィルタ) を補完する。

## Context
ADR 0008 で `StationLine.code` に Wikidata P296 (station code) を取り込む方針を採用し、qualifier P81 (該当路線) が付いている code はその路線に、付いていない code は **全 lineLink に同じ値を流し込む** fallback で処理していた。

実データを確認したところ、複数路線駅で「両路線に同じ駅番号が併記される」現象が頻発していた。例: 千種駅 (Q863068) は 旧 import で `JR中央本線=CF03/H12 / 地下鉄東山線=CF03/H12` となり、片方は明らかに誤り。

調査の結果:

1. Wikidata では駅番号の路線対応 qualifier として **`P81` (connecting line) と `P518` (applies to part)** の **両方** が使われる。現行 import は `pq:P81` だけ見ていたため `P518` 経由の qualifier を全部見逃していた。
   - 例: 千種 P296 statement
     - `CF03` qualifier 無し
     - `H12` qualifier `P518` = `Q1132799` (東山線)

2. それでも qualifier が一切付いていない code が一定数存在する (千種の `CF03` のように)。これらは「上位レベルの statement に駅番号を 1 つだけ書く + 他の路線分は qualifier 付き statement で追加する」という Wikidata の編集パターンによるもので、結果として **未埋め lineLink が 1 件・unattached code が 1 件** という状況がよく発生する。論理的にはこの場合の対応は一意 (残った lineLink にその code を入れる) と決まる。

ユーザ要件 (US-039) として「複数路線駅の駅番号は路線ごとに 1 つ。手動補完は原則認めない」が示されたため、import 時に上記 2 を活用して可能な限り自動で正しく取り込む方針とする。

## Decision

### 1. SPARQL クエリの拡張
`fetchStationsForLines` の SPARQL に `pq:P518` も加え、両 qualifier を取得する:

```sparql
?station p:P296 ?codeStmt .
?codeStmt ps:P296 ?stationCode .
OPTIONAL { ?codeStmt pq:P81  ?qualLineByP81  }
OPTIONAL { ?codeStmt pq:P518 ?qualLineByP518 }
```

`P81` か `P518` のどちらかが指す路線が取り込み対象路線に含まれていれば、その lineLink の code として登録する。

### 2. unattached code の補完ロジック
qualifier 無し code の処理を以下に変更する。「unattached code」= qualifier が無い、または qualifier が指す路線が取り込み対象外 のもの。

- **lineLink が 1 件のみ** の駅: unattached code を全て `/` 連結でその lineLink に採用 (単独路線駅は ambiguous 不可)。
- **lineLink が複数件 + 未埋め lineLink (qualifier 付き code が 1 件も入っていない lineLink) が 1 件 + unattached code が 1 件以上**: unattached を `/` 連結で残り 1 lineLink に採用 (論理的に一意)。
- **lineLink が複数件 + 未埋め lineLink が 2 件以上 + unattached code が 1 件以上**: ambiguous なので unattached を **全部スキップ** (qualifier 付き code は採用)。
- **lineLink が複数件 + 未埋め lineLink が 0 件**: 全 lineLink に qualifier 付き code が入っているので unattached は不要としてスキップ。

### 3. テスト
`import-master-tokai.test.ts` に以下のシナリオを追加:
- 単独路線駅 + qualifier 無し → 採用
- 千種パターン (qualifier P518 付き 1 件 + unattached 1 件 + lineLink 2 件) → 補完で両 lineLink に正しい code
- 完全 unattached の複数路線駅 → 全 unattached スキップ
- qualifier P81 / P518 両方が機能することを別個に確認

### 4. 既存データ
ADR 0008 と同じく `pnpm --filter backend exec tsx scripts/import-master-tokai.ts --clean` で再取込する。

## Consequences

### 利益
- 千種, 金山, 高蔵寺, 上小田井 など複数路線駅の駅番号が正しく路線ごとに分かれる (Wikidata 側の qualifier カバレッジに応じて自動取得)。
- Wikidata の P518 qualifier も活用できるようになり、自動補完カバレッジが向上。
- 「lineLink 残 1 件 + unattached 1 件」ルールにより、Wikidata 側で qualifier が部分的にしか付いていない駅でも自動で完全補完できる。

### 代償・リスク
- 「Wikidata 側で全く qualifier が付いていない複数路線駅」は依然として駅番号空のまま。今回の対象 (東海4県) では実データを確認して影響範囲を把握する。空のまま残る駅は将来別ソース (国土数値情報 / OpenStreetMap 等) の併用を検討する余地あり。
- Wikidata 編集者が「上位 statement の P296 に 1 路線分の番号 + 他路線は qualifier 付き」というパターンと異なる書き方をしている駅があれば誤判定する可能性あり (例: unattached が 2 件で 2 lineLink 残っている場合は「どっちが先か」を決められないので両方スキップして安全側)。

### 影響範囲
- ADR 0008 §取り込み の qualifier 無し fallback を本 ADR で上書き。
- 駅マスタ参照 (S07) の駅番号表示が変わる (千種等で正しい値が出るようになる)。
- ADR 0009 (電報略号フィルタ) はそのまま維持し、本 ADR の判定の前段として動作する。
- 駅マスタ管理 (S10) の手動補完運用 (US-039 要件にあった「原則禁止」) は不要化。
