# 0017 Wikipedia 駅ナンバリング取り込みで駅番号網羅性を本格補完 + N02 のデフォルト無効化

## Status
Accepted (US-047 で採用)。ADR 0008-0013/0015 (駅番号取り込みパイプライン) と ADR 0016 (N02 従) を補完する。

## Context
US-044 (ADR 0015) で駅番号付番率は 61.9% に到達したが, 残り 345 件は Wikidata の P296 statement そのものが未登録のケースが大半 (例: JR東海名古屋駅 P296=`ナコ` 電報略号のみで CA68 未登録)。Wikidata 編集者の整備不足で本サンドボックスでは解決不能。

US-045 (ADR 0016) で N02 を従ソースとして併用したが, **N02 には駅番号 (P296相当) が含まれない**ため駅番号付番率の向上には寄与せず, むしろ N02 由来駅 (座標目的で追加された 266 件) が分母に加わり付番率は見かけ上 61.9% → 45.9% に低下した。

ユーザレビュー (US-047) で:
- 駅番号網羅性は別ソースで本格対応すべき
- N02 取り込みは US-046 (経路自動取得) の先行基盤として「デフォルト無効・必要時のみ有効化」にすべき
- audit レポートをソース別に分離して付番率を正しく見せるべき

という方針が合意された。

データソース調査の結果, **Wikipedia 駅ナンバリングページ** (https://ja.wikipedia.org/wiki/駅ナンバリング) が以下の点で最有力:
- JR 各社 + 主要私鉄 + 地下鉄の路線記号 + 駅番号がほぼ網羅
- 表構造が比較的安定 (各路線セクションごとに「路線記号 / 駅 / 駅番号」表)
- MediaWiki API で wikitext 取得可能 (API キー不要・無料)
- ライセンス CC-BY-SA (アプリ表示時に出典表記すれば商用可)

他候補 (各事業者公式サイト個別スクレイプ / OSM Overpass / DBpedia 日本 / ekispert API 等) と比較し, 1 ページにまとまっている Wikipedia ページが工数とカバレッジのバランスで最良。

## Decision

### A. N02 取り込みのデフォルト無効化

`backend/scripts/import-master-tokai.ts` の `supplementWithN02` 呼び出しを以下に変更:

- デフォルト: skip (既存の Wikidata 取り込みのみ実施)
- `--with-n02` フラグ指定時のみ有効化
- 既存 DB 内の N02 由来駅を削除する `--clean-n02` フラグも提供 (`sourceUri` が `nlftp.mlit.go.jp` を含む Station を全削除)

CLI フラグ仕様:

```
pnpm --filter backend exec tsx scripts/import-master-tokai.ts                       # Wikidata のみ
pnpm --filter backend exec tsx scripts/import-master-tokai.ts --clean               # Wikidata 由来全削除 + 取り込み
pnpm --filter backend exec tsx scripts/import-master-tokai.ts --clean --with-n02    # Wikidata + N02 取り込み (US-046 用)
pnpm --filter backend exec tsx scripts/import-master-tokai.ts --clean-n02           # N02 由来分のみ削除 (取り込みは Wikidata のみ実施)
```

`--with-n02` は将来 US-046 で経路機能を実装する際に有効化する想定。

### B. Wikipedia 駅ナンバリング取り込み

新規ファイル `backend/scripts/lib/wikipedia-numbering.ts`:

1. **取得**: MediaWiki Action API で「駅ナンバリング」ページの wikitext を取得
   - URL: `https://ja.wikipedia.org/w/api.php?action=parse&page=駅ナンバリング&prop=wikitext&format=json`
   - User-Agent ヘッダ必須 (Wikimedia 規約)
   - キャッシュ: `backend/scripts/data/wikipedia/numbering.wikitext` に保存 (gitignore)
   - 24 時間以内のキャッシュは再利用 (Wikimedia への負荷配慮)

2. **パース**: wikitext から各路線セクションの表を抽出
   - セクション構造: `===路線記号 + 駅 + 駅番号===` 形式
   - 表行から「路線記号」「駅名」「駅番号」を取り出す
   - 不安定な構造に備え, 取れなかった行はログ出力してスキップ (取り込みエラーにしない)

3. **突合**:
   - Wikipedia 「路線記号」と Wikidata Line.name から駅番号 prefix を逆引き
     (例: 路線記号 "CA" → 既存 prefix 学習で `JR東海道線 (名古屋地区)` にマッチ)
   - 「駅名 + 路線」で既存 StationLine を検索
   - 駅番号空の lineLink → Wikipedia の値で埋める (上書きはしない, 既存 qualifier 値が優先)

4. **スコープ**: ADR 0007 ホワイトリスト維持。Wikipedia 表で見つかった路線でも Line マスタに存在しなければスキップ。

5. **CLI フラグ**: デフォルト ON (= 駅番号本格補完が標準動作)。`--no-wikipedia-numbering` で無効化可能。

### C. audit レポートのソース別分離

`docs/audit/missing-station-codes.md` を以下のセクション構成にする:

```md
## サマリ
- 全 Station: N
- 全 StationLine: M
- 駅番号付番済: K (% of M)
  - うち Wikidata 由来: a
  - うち Wikipedia 駅ナンバリング由来: b
- 未付番: M - K
  - うち N02 由来駅 (構造的に空, US-046 用): n
  - うち Wikidata 駅 + 補完不能: w

## 補完不能リスト (要 upstream Wikipedia/Wikidata 編集)
[Wikidata 駅で Wikipedia ナンバリングにも掲載がないもの]

## N02 由来駅 (US-046 経路機能用, 駅番号は構造的に欠落)
[--with-n02 指定時のみ存在]
```

これにより「補完で改善しうる駅」「構造的に欠落する駅」が分離され, 利用者は本当の残作業を把握できる。

### D. テスト

- `wikipedia-numbering.test.ts`: パース単体テスト (実 wikitext のサンプル fixture)
- `import-master-tokai.test.ts`: フラグ制御 + audit ソース別分離の確認
- 実 Wikipedia 取得は CI で行わない (キャッシュ前提)

### E. 既存データへの影響

`pnpm --filter backend exec tsx scripts/import-master-tokai.ts --clean-n02` で 266 件の N02 由来駅を削除してから, 通常取り込み (Wikidata + Wikipedia ナンバリング) を実行することで、付番率改善した audit レポートが得られる。

## Consequences

### 利益
- 駅番号網羅性の本格的な補完 (推定 80%+ 付番率達成)
- N02 がデフォルト無効化されたことで, 普段の取り込み結果が ADR 0007 スコープに沿う (818 駅程度に戻る)
- audit レポートが正確に「実質的な未付番駅」を可視化
- US-046 への布石が崩れない (`--with-n02` で必要時に有効化)

### 代償・リスク
- Wikipedia 駅ナンバリングページの表構造が変更されると壊れる可能性 (CI で検出するためのフィクスチャを用意)
- Wikipedia の wikitext は HTML より緩い構造で, パースは regex/手書き必要 (テンプレート展開ライブラリ利用も検討)
- Wikipedia の駅番号情報も完璧ではない (新駅追加直後等)
- N02 取り込みは US-046 待ちになり, 当面 N02 由来駅 (266 件) は DB に存在しない

### 影響範囲
- ADR 0016 (N02 従): デフォルト無効化に修正 (Status: Accepted, Amended)
- 他 ADR (0008-0015): 駅番号取り込みパイプラインはそのまま. Wikipedia ソースはパイプラインの「最後の補完」として動作 (Wikidata の qualifier 優先, Wikipedia は不足分のみ埋める)。
- DB: 一時的に 266 件少なくなる (N02 由来駅削除分)。Wikipedia 補完で駅番号付番率は上昇予定。
