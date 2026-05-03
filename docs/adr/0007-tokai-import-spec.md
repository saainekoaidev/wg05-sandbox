# 0007 東海4県マスタ取り込み詳細仕様 (Wikidata SPARQL)

## Status
Proposed (2026-05-03) — US-011 実装前にレビュー要

## Context

[ADR 0005](0005-master-data-source.md) で「Wikidata SPARQL を一次ソースとして採用」「one-shot 取り込み」までは確定したが、以下を「US-011 実装フェーズで確定する」と保留していた:

- 取り込み対象事業者の絞り込み
- `Line.sourceUri` / `importedAt` 列の要否
- 再取り込み時の差分マージ戦略
- `kind` ヒューリスティクスの具体ルール
- 静岡県の JR 東日本管轄をどう扱うか

[US-012](../requirements.md) (路線マスタ管理) / [US-013](../requirements.md) (駅マスタ管理) で管理者画面が完成し, **マスタは空 + admin が手動作成も可能** という状態で取り込み実装に入れる。本 ADR で具体仕様を確定する。

なお, 本サンドボックスの利用想定が **名古屋圏の通勤** であることから, 利用者要望により取り込み対象事業者を絞ることになった (バックログ運用ログ参照)。広域 JR 線は経路を構成し得るため含めるが、静岡県西部のローカル私鉄 (静岡鉄道, 遠州鉄道等) や三重県南部のローカル線 (伊勢鉄道, 三岐鉄道等) は **対象外**。

## Decision

### 1. 対象スコープ (ハイブリッド allowlist)

**JR は「路線単位の Q-ID ホワイトリスト」**, **その他事業者は「事業者単位の P127/P137 ベース」** のハイブリッドで定義する。理由は §3 参照。

#### 1.1 JR (路線ホワイトリスト, 14 路線)

利用者指定 (JR東海 公式 Web の「在来線のご案内」記載 13 路線 + 子会社 1 路線):

| Q-ID | 路線 | 備考 |
|---|---|---|
| Q11527981 | 東海道線 (静岡地区) | 熱海〜豊橋 |
| Q11235139 | 東海道線 (名古屋地区) | 豊橋〜米原 |
| Q1078110 | 中央本線 | JR東海管轄区間 (塩尻〜名古屋); 4県内駅は岐阜/愛知のみ |
| Q1199703 | 関西本線 | |
| Q582803 | 紀勢本線 | |
| Q1188357 | 高山本線 | |
| Q871587 | 武豊線 | |
| Q771305 | 飯田線 | |
| Q870995 | 太多線 | |
| Q667927 | 御殿場線 | |
| Q162747 | 身延線 | |
| Q872023 | 参宮線 | |
| Q5359442 | 名松線 | |
| Q7862680 | JR東海交通事業城北線 | JR東海子会社の運営。利用者により対象指定 |

> 新幹線 (東海道新幹線 Q660895, 中央新幹線 Q876490) および「東海道本線 (Q1190152)」「中央本線 (Q1078110) を含まない全線エンティティ」は **対象外**。利用者要望により在来線の地区別エンティティに限定する。
> JR西日本 / JR東日本も **対象外**。

#### 1.2 その他事業者 (運営者ベース, 全路線)

| 順位 | 事業者 | Wikidata Q-ID | 略称 |
|---|---|---|---|
| 1 | 名古屋鉄道 | Q30850 | 名鉄 |
| 2 | 近畿日本鉄道 | Q1531085 | 近鉄 |
| 3 | 名古屋市交通局 | Q841951 | 名古屋市営地下鉄 |
| 4 | 名古屋臨海高速鉄道 | Q10855964 | あおなみ線 |
| 5 | 愛知高速交通 | Q11073857 | リニモ (東部丘陵線) |

該当事業者の P127 (owner) / P137 (operator) で取得。順序が同一路線の operator 優先順位を決める (§3.6 参照)。

#### 1.3 路線 Q-ID denylist (廃線除外)

Wikidata 側に廃止日 (P576) が設定されておらず自動除外できない廃線は以下の固定リストで除外:

| Q-ID | 路線 | 廃止年 |
|---|---|---|
| Q7476121 | 名鉄モンキーパークモノレール線 | 2008 |
| Q11415803 | 名鉄鏡島線 | 1964 |

合計 **約 49 路線** 取り込み見込み (JR 14 + 名鉄 20 + 近鉄 7 + 地下鉄 6 + あおなみ 1 + リニモ 1)。バスは対象外。

> Q-ID はすべて 2026-05-03 時点の Wikidata。スクリプト先頭に定数として集約し, 変動時は明示的に書き換える方針。

> Wikidata Q-ID は 2026-05-03 時点の値。スクリプト先頭にコンスタントとして集約し, 変動時は明示的に書き換える方針 (動的に Q-ID を解決しない)。

### 2. 対象県

- 愛知県 (Q123057)
- 岐阜県 (Q123058)
- 三重県 (Q123185)
- 静岡県 (Q124300)

### 3. 取り込み単位

#### 3.1 路線取得 (ハイブリッド)

JR と それ以外で取得方式を分ける:

- **JR (§1.1 ホワイトリスト 14 路線)**: SPARQL の `VALUES ?line { ... }` で 14 個の Q-ID を直接指定
  - operator は **JR東海 (Q513679) に固定** で登録 (Wikidata 上で複数 operator (JR東海/JR西日本/JR東日本) を持つ路線でも、本サンドボックスでは JR東海として一本化)
- **その他事業者 (§1.2 名鉄・近鉄・地下鉄・あおなみ・リニモ)**: `?line (wdt:P127|wdt:P137) ?operator` の OR マッチ
  - P127 は owner, P137 は operator。公営線 (あおなみ線/リニモ) は P137 のみを持つため両方を OR でマッチ

両方とも `?line wdt:P31/wdt:P279* wd:Q728937` (鉄道路線サブクラス) で限定。

#### 3.2 駅取得

各路線について, 4 県のいずれかに属する **鉄道駅エンティティ** を取得:

- `?station wdt:P31/wdt:P279* wd:Q55488` (railway station) で限定
  - 列車種別エンティティ (例: 寝台特急はやぶさ Q1059249) の混入を排除 (実測検証済み)
- `?station wdt:P81 ?line` で路線リンク
- `?station wdt:P131*` で県を再帰解決し, 4 県のいずれかに絞る

#### 3.3 路線除外条件

- **対象県内駅が 0 件**: 除外 (4 県外路線)
- **対象県内駅が 1 件のみ**: 取り込みスキップ + 警告ログ (近隣県の駅を 1 件だけ持つ Wikidata ノイズ対策)
- **`wdt:P576` (廃止日) が設定済み**: 除外
- **§1.3 denylist (Q7476121, Q11415803) に含まれる**: 除外
- **新幹線・全線エンティティ**: §1.1 ホワイトリストに含まれていないため自動除外

#### 3.4 同一路線が複数事業者で取れる場合

§1.2 事業者ベースでの取得時のみ問題化する。allowlist に書いた **順序** で先頭の operator を採用 (1:1 に正規化)。

> JR 部分はホワイトリスト方式のため operator は常に JR東海 で固定 (§3.1)。

#### 3.5 StationLine の同期

駅の所属路線 (P81) のうち, **本 ADR の §1.1/1.2 で取り込まれた路線への接続のみ** を `StationLine` テーブルに含める。allowlist 外事業者の路線への接続は除外。

### 4. Line.id / Station.id

- **Line.id**: Wikidata Q-ID を文字列としてそのまま採用 (例: `Q1129155`)
- **Station.id**: 同上 (例: `Q1224451`)
- 手動作成された Line/Station (US-012/013 経由) は管理者が指定した任意 id (cuid 自動採番含む) を維持。**Q-ID とのコンフリクト責任は管理者にある** (実害が出るのは admin が誤って `Q...` 形式の id を手動作成した上で同じ Q-ID が Wikidata から取り込まれた場合のみ。upsert で上書きされる)

### 5. schema 拡張

新規マイグレーション `add_master_source_metadata`:

```prisma
model Line {
  ...
  /// Wikidata 等の取り込み元 URI。手動作成は NULL。
  sourceUri  String?
  /// 取り込み実行時刻。手動作成は NULL。
  importedAt DateTime?
}

model Station {
  ...
  sourceUri  String?
  importedAt DateTime?
}
```

すべて `?` (NULL 許容) なので **破壊的変更ではない**。手動作成は両方 NULL のまま, インポート分には値が入る。これにより `WHERE sourceUri IS NOT NULL` で Wikidata 由来分だけを安全に再ロード対象にできる。

### 6. kind ヒューリスティクス

|  運営会社 | kind |
|---|---|
| 名古屋市交通局 (Q11648001) | `subway` |
| その他全事業者 (JR/名鉄/近鉄/あおなみ線/リニモ) | `train` |

リニモは厳密には磁気浮上方式だが, UI 用途では `train` で十分実用的 (admin が必要に応じて `other` に変更可能)。あおなみ線は普通鉄道として `train`。

> 路線名・駅名から推測する複雑な regex 判定は採用しない (Wikidata 表記揺れの吸収負担が大きいため)。運営会社 ID が明確に取れる allowlist 方式の利点を活かす。

### 7. 差分マージ戦略 (再実行時)

**通常実行 (デフォルト)**: upsert by id

- 既存 (id 一致) → `name` / `kind` / `operator` / `sourceUri` / `importedAt` を更新
- 新規 → create
- **Wikidata 側で消えた id は DELETE しない** (手動補正された情報や、まだ依存している経路を尊重する)
- 手動分 (`sourceUri IS NULL`) は **一切触らない**
- StationLine も同様に upsert: 該当 station についての `sourceUri NOT NULL` の Line とのリンクのみ全置換

**`--clean` オプション付き**:

- スクリプト先頭で `Line/Station WHERE sourceUri NOT NULL` を全削除 (StationLine は cascade)
- そのうえで clean import
- テスト環境や「Wikidata 側のスキーマ変更で id が変わったので作り直したい」ケース用

### 8. 静岡県の JR 東日本

**含めない**。allowlist から JR 東日本 (Q103982) を除外したため, 熱海以東の静岡県内駅 (熱海, 来宮等) は対象外となる。

> 熱海駅は JR東海と JR東日本の境界駅で両社が乗り入れる。JR東日本管轄ではなくなるため駅自体は対象から外れるが, JR東海管轄の東海道本線で熱海駅まで来るルートは依然取り込まれる (= 熱海駅も Wikidata 上の P81 で東海道本線につながっていれば取り込み対象)。実機の挙動はインポート結果で確認する。

### 9. 取り込み方式

- one-shot バッチ (定期同期なし)
- スクリプト: `backend/scripts/import-master-tokai.ts`
- 実行コマンド: `pnpm --filter backend exec tsx scripts/import-master-tokai.ts [--clean]`
- SPARQL endpoint: `https://query.wikidata.org/sparql`
- HTTP ヘッダ: `User-Agent: WG05Sandbox/1.0 (https://github.com/saainekoaidev/wg05-sandbox; education sandbox)` (Wikidata 利用規約準拠)
- レスポンスは JSON (`Accept: application/sparql-results+json`)
- タイムアウト/リトライ: 簡易リトライ 1 回まで。それ以上は人手介入で

完了後の stdout 出力 (例):

```
== Tokai master import (Wikidata) ==
Operator filter: 8 (JR東海, JR東日本, JR西日本, 名鉄, 近鉄, 名古屋市交通局, 名古屋臨海高速鉄道, 愛知高速交通)
Prefecture filter: 4 (愛知, 岐阜, 三重, 静岡)

Lines:        51 (created: 51, updated: 0)
Stations:    862 (created: 862, updated: 0)
StationLine: 1923

Done in 12.4s.
```

### 10. CI で実行しない

本番取り込みは CI ワークフローで実行しない (Wikidata への外部呼び出し / 結果に変動性がある / 重い)。

backend ユニットテストでは Wikidata 呼び出しを **モックする**:
- 取り込みスクリプトの SPARQL 呼出部 (`fetchSparql`) を関数として export
- テストでは `fetchSparql` を vi.mock してフィクスチャ JSON を返させ, DB への upsert ロジックのみを検証
- 実 SPARQL の動作確認はローカル手動実行で行う

### 11. routes 系画面の動的化 (US-011 のスコープに含める)

取り込みと併せて以下も同 PR で実施:

- `frontend/src/lib/lines.ts` から **`LINES` 静的配列を削除** (現状空配列のため互換破壊にならない)
- `RouteRegister.tsx` / `RouteEdit.tsx` / `RouteList.tsx` / `RouteDetail.tsx` / `StationPicker.tsx` を `useLines()` ベースに切替
- 既存テストファイルの `vi.mock('../lib/lines', () => ({ LINES: [...] }))` を `useLines` モックに置換
- e2e の `route_register.spec.ts:109` (`test.fixme` で skip 中の駅選択 popup テスト) を再有効化

これは US-011 の実利を確保するため (取り込んだ路線が UI で見える) に必須であり、別 US に切り出す合理性が無い。

## Consequences

### 利点
- 取り込みスコープが明確化され, 期待件数 (約 50 路線 / 800〜1,000 駅) から SQLite でも無理なく収まる
- Wikidata Q-ID と手動 id が共存できるため, 将来管理者が補正した情報を再取り込みで上書きしない
- リニモ・あおなみ線まで含めることで名古屋圏の通勤需要をほぼ網羅
- `sourceUri` 列により「Wikidata 由来か / 管理者手動作成か」が DB 上で識別でき, 部分的な clean import が可能

### 代償・リスク
- Wikidata の精度依存。誤情報や欠損があれば管理者が US-012/013 で手動補正する前提
- リニモを `train` 扱いにしたため, 種別フィルタで「電車のみ」を選んだときにリニモが混在する。UX 上の違和感は許容
- JR 西日本 (関西本線亀山以西) は数路線・数駅しか含まれないため, 「JR東海以外も入っているのか?」と利用者が混乱する可能性。スクリプトの取り込みサマリで明示する
- 路線・駅の合計件数が 1,000 近くになり, [/admin/stations](../ui-screens/screen_design_admin_stations.md) のページング無し一覧は重くなる可能性。本 ADR では UI 改善は対象外 (別 US で検討)
- バス対象外のため, バス利用の通勤経路は引き続き「種別=バス + 路線=未選択」で自由入力
- Wikidata 上の路線分類 (新交通システム, 鋼索鉄道, etc.) は本 ADR では `train` に統合してしまうため, 厳密性を求める利用者には不十分

### 将来検討余地
- バスマスタの取り込み (GTFS-JP)
- 一覧画面のページング・検索
- 取り込みデータの出典明示 (UI フッタ等への Wikidata クレジット表示)
- 監視: `importedAt` を使って「N 日以上更新が止まっている路線がある」ような警告
- 全国スコープへの拡張時の SQLite 継続可否再検討 (ADR 0005 でも言及済み)

## 関連 Issue
- [#20 US-011](https://github.com/saainekoaidev/wg05-sandbox/issues/20)
