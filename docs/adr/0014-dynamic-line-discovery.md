# 0014 4 県内鉄道路線の動的発見と駅番号 audit レポート

## Status
**Superseded by [ADR 0015](0015-revert-line-scope.md)** (US-044)。

§A の動的路線発見部分は撤回され, ADR 0007 のホワイトリスト 14 路線 + 5 OTHER_OPERATORS スコープに戻された。本文書の §D (audit レポート出力) のみが ADR 0015 に引き継がれる。

撤回の理由は, ADR 0007 の凍結スコープを承認なく拡張したことが「ルール違反」とのレビューを受けたこと, および動的取り込みの結果 1200 駅 / 88 路線まで膨れ上がりサンドボックス想定の規模を超えたこと。本 ADR 自体は履歴として残し, 将来再検討する場合の出発点とする。

(以下は当時の Accepted 状態の記述として残す)

## Context
ADR 0007 では取り込み対象路線を:
- `JR_LINE_QIDS`: 14 路線 (Q-ID ホワイトリスト, JR東海管轄)
- `OTHER_OPERATORS`: 5 社 (P127/P137 ベース; 名鉄, 近鉄, 名古屋市交通局, 名古屋臨海高速鉄道, 愛知高速交通)

として固定していた。Wikidata 全件監査の結果, 4 県内に **駅番号 (P296) を持つ駅が 2 駅以上紐付いている鉄道路線** が約 90 路線存在しており, 上記 19 路線のスコープから **約 70 路線が漏れている** ことが判明。

具体的に取り込まれていない路線の例:
- 第三セクター鉄道: 長良川鉄道越美南線 (40 駅), 愛知環状鉄道線 (22 駅), 樽見鉄道樽見線 (19 駅), 伊豆急行線 (16 駅), 天竜浜名湖鉄道天竜浜名湖線 (21 駅), 遠州鉄道鉄道線 (18 駅), 伊豆箱根鉄道駿豆線 (13 駅), 三岐線 (15 駅), 明知線 (11 駅), 養老線 (4 駅), 伊賀鉄道伊賀線 (2 駅), 衣浦臨海鉄道, 静岡清水線, 大井川本線, etc.
- JR支線で operator 紐付けが弱いもの: 中央本線 名古屋地区 (Q11363767, 6 駅) — Wikidata で別 Q-ID として存在
- 新幹線: 東海道新幹線 (10 駅), 中央新幹線 (1 駅)
- バス系を除いた多数

ユーザレビュー (US-043) で「全路線の駅の網羅性と駅番号の完全付番を自動で実現してほしい。漏れた駅は手動補正リストとして別出力」という要件が提示された。

## Decision

### A. 動的路線発見 (`fetchAllRegionalLines`)

新たな路線取得関数を追加する:

```sparql
SELECT DISTINCT ?line ?lineLabel ?operator ?operatorLabel
       (COUNT(DISTINCT ?station) AS ?stationCount)
WHERE {
  VALUES ?pref { wd:Q80434 wd:Q131277 wd:Q128196 wd:Q131320 }
  ?station wdt:P31/wdt:P279* wd:Q55488 ;
           wdt:P131* ?pref ;
           wdt:P81 ?line .
  ?line wdt:P31/wdt:P279* wd:Q728937 .   # 鉄道路線のみ (バス・モノレール除外)
  FILTER NOT EXISTS { ?line wdt:P576 ?dissolved }   # 廃線除外
  OPTIONAL { ?line (wdt:P127|wdt:P137) ?operator }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja". }
}
GROUP BY ?line ?lineLabel ?operator ?operatorLabel
HAVING (COUNT(DISTINCT ?station) >= 2)
```

仕様:
- `?line wdt:P31/wdt:P279* wd:Q728937` で「鉄道路線」(およびその下位概念) のみに絞る。バス路線・モノレール・ガイドウェイバスは除外。
- 廃線 (P576 = 廃止日あり) は除外。
- 駅 2 件以上の閾値で「ノイズ路線」を除外。
- operator (P127 = 所有者 / P137 = 運営者) の片方が取れれば採用、なければ "" (空文字)。

`fetchOtherLines` を `fetchAllRegionalLines` に置き換える形で実装するが, 以下を維持:
- JR_LINE_QIDS と重複する Q-ID (および LINE_ALIASES の alias QID) は新規取得対象から除外。
- `DENY_LINE_QIDS` (廃線 denylist) はそのまま除外フィルタとして適用。
- 既知 OTHER_OPERATORS の社名マッピングは引き続き使う (operator Q-ID → 表示名)。

### B. kind 推定

動的発見した路線の kind は以下で判定:
- operator Q-ID が `名古屋市交通局 (Q841951)` → `subway`
- operator Q-ID が他 → `train`
- operator 不明 → `train` (安全側)

bus / monorail は §A の SPARQL フィルタで既に除外されているため対象外。

### C. LINE_ALIASES 拡張

中央本線 (Q1078110 ← Q11363767) のような, 主路線 Q-ID と地区版 Q-ID の階層関係も alias マップに追加する。当面は監査結果から発覚したものを手動追加。

### D. audit レポート出力

import 終了時に以下を `docs/audit/missing-station-codes.md` に出力:

```md
# 駅番号 未付番駅の audit レポート

生成日時: 2026-05-04T05:00:00.000Z
取込ベース: Wikidata (commit hash etc.)

## サマリ
- 全 Station: 1500
- 全 StationLine: 1800
- 駅番号付番済 link: 1620 (90.0%)
- 未付番 link: 180 駅×路線

## 未付番リスト

| 駅名 | 路線 | Wikidata 駅 ID |
| --- | --- | --- |
| 刈谷 | JR東海道線 (名古屋地区) | Q871055 |
| 刈谷 | 名鉄三河線 | Q871055 |
| ... |
```

スクリプト終了時に書き込み, git に commit する。手動補正必要な駅の即時参照リストとして利用する。

### テスト
- `fetchAllRegionalLines` が適切に重複除去・kind 判定・operator 取得することを unit test
- audit レポート出力が想定形式になることを軽い integration test (out file 生成のみ)

## Consequences

### 利益
- 取り込み駅数が **大幅増加** (推定 800 → 1500+)。実用的なマスタになる。
- 第三セクター・私鉄の駅番号も自動取得されるため, 駅番号付番率も上昇 (推定 60% → 80%+)。
- 監査レポートにより手動補正が必要な駅を即座に把握でき, 残作業量が見える化される。
- 動的発見なので将来路線追加 (新規 Wikidata 編集) があれば自動的に反映される。

### 代償・リスク
- Wikidata の P31/P279* 階層判定が誤分類される路線がある可能性 (例: ガイドウェイバスを鉄道として誤取得)。実データで確認・必要なら denylist 追加。
- operator 名の表示揺らぎ (例: "東海旅客鉄道" vs "JR東海") があるかも。表示用に簡易マッピングを入れる (= JR_OPERATOR_LABELS, OTHER_OPERATOR_LABELS)。
- ADR 0007 §1 の「ホワイトリスト方式」を破る変更。範囲が広がるとリーチが増えるが, 廃線以外は容認する判断。

### 影響範囲
- ADR 0007 §1 のスコープ規定を本 ADR で上書き。
- ADR 0008/0010-0013 のロジックは引き続き動作 (canonical line として渡される set が変わるだけ)。
- DB の Line / Station / StationLine 件数が大幅増加。フロントエンドのフィルタ UI (US-031/032) が想定通り動作することを再取込後に確認する。
