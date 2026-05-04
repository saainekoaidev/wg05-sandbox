# 0013 取り込み対象路線に親エンティティ (P361) のエイリアスを許容する

## Status
Accepted (US-042 で採用)。ADR 0007 (東海4県マスタ取り込み仕様) を補完。

## Context
ADR 0007 の `JR_LINE_QIDS` ホワイトリストは, 各路線を 1 つの Wikidata Q-ID で表現していた。例えば JR 東海道本線については以下を採用:

- `Q11527981` = 東海道線 (静岡地区) 熱海〜豊橋
- `Q11235139` = 東海道線 (名古屋地区) 豊橋〜米原

ところが Wikidata 上では同じ路線が **階層的** に表現されており, 「東海道本線 (全国)」を表す上位エンティティ `Q1190152` も存在する。実データを確認すると:

- 金山駅 (Q124429659) の P81 (所属路線) = `Q1078110` (中央本線) + **`Q1190152` (東海道本線・全国版)** の 2 件のみ。地区版 Q11235139 は紐付いていない。
- 金山駅 P296: `CF01` (qualifier=Q1078110), `CA66` (qualifier=Q1190152), `ナヤ` (電報略号)。

現行 import の `VALUES ?targetLine { ${JR_LINE_QIDS} }` は `Q1190152` を含まないため, 金山駅の **JR東海道線接続が完全に拾われない** 結果になっていた (CA66 駅番号もろとも)。同様の問題が他の駅にもある可能性が高い。

ユーザレビューで「データの網羅性を完全なものにしてほしい」という要件 (US-042) が示された。

## Decision

### 路線エイリアスマップ
取り込み対象路線ごとに「エイリアス Q-ID 集合」を明示マップで持つ。エイリアスは「Wikidata 上で別 Q-ID として表現されているが, 我々の取り込みでは canonical 路線として扱いたいもの」を指す。

```ts
type LineAliasRule = {
  qid: string
  /** disambiguation: 駅座標経度がこの値以下のときだけマップ */
  lonMax?: number
  /** disambiguation: 駅座標経度がこの値以上のときだけマップ */
  lonMin?: number
}

const LINE_ALIASES: Record<string, LineAliasRule[]> = {
  // 東海道線 名古屋地区: 親 (Q1190152) のうち豊橋以西分を取り込む
  'Q11235139': [{ qid: 'Q1190152', lonMax: 137.4 }],
  // 東海道線 静岡地区: 親 (Q1190152) のうち豊橋以東分を取り込む
  'Q11527981': [{ qid: 'Q1190152', lonMin: 137.4 }],
  // 他の路線は P361 (part of) なし or 駅側で十分紐付いているため当面 alias 不要。
  // 再取込結果から取り漏れが見つかれば追加していく iterative 運用。
}
```

### SPARQL クエリの拡張
`fetchStationsForLines` の `VALUES ?targetLine` にエイリアス Q-ID も含める:

```ts
const aliasQids = Object.values(LINE_ALIASES).flat().map((r) => r.qid)
const allTargets = new Set([...JR_LINE_QIDS, ...OTHER_OPERATORS.map((o)=>...), ...aliasQids])
```

これで駅が `P81 = Q1190152` のみ持つ場合でも `?targetLine` のマッチに引っかかり、駅情報が取得される。

### canonical 化処理
駅 row の lineQid (P81 値) が「エイリアスとして登録された Q-ID」だった場合、ルックアップして canonical line ID に正規化する:

```ts
function resolveCanonicalLine(
  lineQid: string,
  stationCoord: { lon: number; lat: number } | null,
): string | null {
  if (jrLineSet.has(lineQid) || otherLineSet.has(lineQid)) return lineQid
  // alias から候補を取り出す
  const candidates = []
  for (const [canonical, rules] of Object.entries(LINE_ALIASES)) {
    for (const r of rules) {
      if (r.qid === lineQid) candidates.push({ canonical, rule: r })
    }
  }
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0].canonical
  // disambiguation: 座標で絞る
  if (stationCoord) {
    for (const c of candidates) {
      if (c.rule.lonMax !== undefined && stationCoord.lon > c.rule.lonMax) continue
      if (c.rule.lonMin !== undefined && stationCoord.lon < c.rule.lonMin) continue
      return c.canonical
    }
  }
  return null
}
```

P296 statement の qualifier (P81 / P518) も同じ resolve を適用する。

### 既存データ
ADR 0008 系と同じく `--clean` 再取込で補正。

### テスト
`import-master-tokai.test.ts` に以下を追加:
- 金山パターン: P81=Q1190152 のみの駅が経度 < 137.4 で Q11235139 に正規化される
- 静岡側パターン: P81=Q1190152 + 経度 > 137.4 で Q11527981 に正規化される
- 座標欠落駅 + 多義 alias は正規化失敗 (null) で skip される
- 既存の Q11235139 直接紐付けは引き続き機能する

## Consequences

### 利益
- Wikidata 上で「親エンティティだけに紐付いている駅」も拾えるようになり、データの網羅性が向上 (金山駅 + JR東海道線 = CA66 等)。
- 駅番号 P296 の qualifier も親エンティティを使うケースを救えるため, 駅番号カバレッジも改善。
- 修正は明示マップに局所化されているため, 他の路線で同様の問題が見つかれば LINE_ALIASES に追加するだけ。

### 代償・リスク
- LINE_ALIASES は手動メンテナンス。Wikidata の階層 (P361) 全部を網羅するわけではないため, 新たな取り漏れが発覚するたびに追加作業が必要。これは「完璧な自動化」ではないトレードオフ。
- 座標 disambiguation の閾値 (lon=137.4 など) はやや恣意的。境界付近の駅で誤分類のリスク。実データで境界付近の駅 (豊橋駅周辺) を念入りに検証する必要あり。
- 1 駅が両 disambiguation 範囲にまたがる場合は最初にマッチしたルールが採用される。

### 影響範囲
- ADR 0007 §3.1 の「JR ホワイトリスト 14 路線」の取り込み挙動を拡張。各路線にエイリアスを許容。
- ADR 0008/0010/0011/0012 (駅番号取り込みパイプライン) はそのまま、本 ADR で正規化された lineQid を入力として動作する。
- LINE_ALIASES は将来的に他の階層パターン (中央本線の JR東日本/東海管轄分割等) が見つかれば追加される。
