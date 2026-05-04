# 0018 個別路線 Wikipedia 記事の駅一覧表で全駅の駅番号を補完

## Status
Accepted (US-048 で採用)。ADR 0017 (Wikipedia 駅ナンバリングページ取り込み) を補完する。

## Context
ADR 0017 で Wikipedia 駅ナンバリングページから駅番号を補完取り込みする仕組みを入れたが, 検証の結果ナンバリングページは **路線あたり始終点・主要駅 (3-4 駅程度) のみ** を箇条書きで記載しており, 中間駅 (例: 名古屋駅 CA68, 中京競馬場前 NH24, 多治見駅 CF12 等) を補完できなかった。

ユーザレビューで「JR東海道線(名古屋地区)の最も主要な名古屋駅の駅番号が空」「中京競馬場前も比較的重要な駅なのに空」「駅番号が空欄になっている路線×駅についてはすべて同じ対応をして駅番号を補完してほしい」という強い指摘を受けた。

調査の結果, **個別の路線 Wikipedia 記事には駅一覧 wikitable** (= 駅名 + 駅番号 + 営業キロ等の表) が存在することがわかった。例えば「東海道線 (名古屋地区)」記事には CA42 (豊橋) ～ CA83 (米原) までの全 42 駅が表形式で記載されている。

## Decision

### A. 路線記事 fetcher

新規 `backend/scripts/lib/wikipedia-line-pages.ts`:

- `getJaWikipediaTitle(qid)`: Wikidata `wbgetentities` API (`sitefilter=jawiki`) で Q-ID から ja.wikipedia 記事タイトルを取得
- `fetchPageWikitext(title)`: MediaWiki `parse&prop=wikitext` API で wikitext 取得
- `fetchLineArticle(qid, cacheDir)`: 上記 2 つを連結 + 7 日 TTL キャッシュ (`backend/scripts/data/wikipedia/lines/<qid>.json`)
- `parseStationCodesFromLineArticle(wikitext)`: wikitext 内の全 wikitable をパースして `{ stationName, prefix, code }` を抽出

### B. 表パーサ修正

ADR 0017 の `parseTableRows` は `!` ヘッダ行を skip していたが, 路線記事の駅一覧表は `!CA68 / |[[名古屋駅]]` 形式 (= ヘッダセルに駅番号、データセルに駅名) を採用するため, **`!` セルもデータセルとして扱う** よう修正。テンプレート `{{...}}` の除去ロジックも追加 (例: `[[名古屋駅]] {{JR特定都区市内|名}}` → `名古屋駅`)。

### C. 補完ロジック

`supplementFromLineArticles` 関数を `import-master-tokai.ts` に追加し, US-047 の Wikipedia ナンバリング取り込みの直後に実行。フロー:

1. 駅番号空の lineLink を持つ Line のみ対象に絞る (50 路線弱)
2. 各 Line の Q-ID で `fetchLineArticle` を呼ぶ
3. 記事内 wikitable をパースして `{ stationName, prefix, code }` を取得
4. 駅名正規化 (末尾「駅」除去) で DB の Station と突合し, 空 code を Wikipedia 値で埋める
5. 既存 code は上書きしない (Wikidata 由来の qualifier 値は信頼度が高い)

### D. テスト

`wikipedia-line-pages.test.ts`: 12 件のユニットテスト
- `!CODE / |[[駅]]` 形式パース
- `|CODE | [[駅]]` 形式パース
- テンプレート除去 (`{{JR特定都区市内|名}}`)
- 属性付きセル (`style="..." | 値`)
- 数値セル除外
- 複数 prefix 混在
- fetcher のキャッシュ優先 / 新規 fetch シーケンス

## Consequences

### 利益
- **駅番号付番率が大幅向上** (US-047 後 64.3% → US-048 後 71.9%, +91 件補完)
- 名古屋駅 = JR東海道線 CA68 / JR中央本線 CF00 等の主要駅が正しく付番
- 中京競馬場前 = NH24 等の中間駅も補完
- 各路線記事は数百 KB なので 50 路線程度なら数十秒で完走

### 代償・リスク
- Wikipedia 路線記事の表形式は記事ごとに微妙にばらつくため, 取りこぼしは残る (主に駅名表記の差異)
- 残った未付番駅は信号場・貨物駅・廃駅・Wikidata の P81 誤接続等の構造的問題で本サンドボックスでは解消不能
- キャッシュ TTL 7 日設定: 短くすると Wikimedia 負荷増, 長くすると鮮度低下のトレードオフ

### 影響範囲
- ADR 0017 の `parseTableRows` を拡張 (`!` セルもデータ扱い + テンプレート除去)
- `import-master-tokai.ts` の main() に supplementFromLineArticles を組込み
- 駅番号付番率の最終到達点として 71.9% を達成。残るは upstream Wikidata / Wikipedia 編集の問題。
