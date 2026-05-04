# 0011 駅番号 prefix から路線を動的学習して unattached code を自動割当

## Status
Accepted (US-040 で採用)。ADR 0010 (qualifier 拡張 + 残り 1 lineLink 補完) の続編。

## Context
ADR 0010 の対応で「未埋め lineLink が 1 件 + unattached code が 1 件以上」のケースは自動補完できるようになったが、「未埋め lineLink ≥ 2 + unattached ≥ 1」(= **両 unfilled + 両 unattached**) のケースは依然として ambiguous として全部スキップしていた。

実データで該当する駅の例:

- **大曽根駅 (Q872075)**:
  - 接続路線: 中央本線(名古屋地区) / 名鉄瀬戸線
  - P296 statement: `CF04` (qualifier 無し) / `ST06` (qualifier 無し)
  - 旧挙動: 両 lineLink が空 (人が見れば `CF04`=中央線, `ST06`=瀬戸線 と判別可能)

ユーザレビューで「prefix を見れば人間にとって自明に区別がつくのに自動取り込みで空のままなのは捜索が甘い」という指摘を受けた。

実際, 駅ナンバリングは **路線記号 (英字) + 連番 (数字)** の構造を持つことが日本の鉄道事業者では慣例化している:

- JR東海道線 (名古屋地区): `CA` + 数字 (CA13, CA68, CA74, ...)
- JR中央本線 (名古屋地区): `CF` + 数字 (CF03, CF04, CF09, ...)
- 名鉄名古屋本線: `NH` + 数字 (NH34, NH36, ...)
- 名鉄瀬戸線: `ST` + 数字 (ST06, ...)
- 地下鉄東山線: `H` + 数字 (H12, ...)
- 地下鉄名城線: `M` + 数字 (M01, M12, ...)
- 地下鉄名港線: `E` + 数字 (E01, ...)
- 地下鉄桜通線: `S` + 数字
- 地下鉄鶴舞線: `T` + 数字
- 名鉄犬山線: `IY` + 数字
- あおなみ線: `AN` + 数字 (AN01, ...)

つまり code の英字 prefix で路線を一意に特定できるパターンがほとんど。

## Decision

import 処理を 2 パス構成にする。

### 第 1 パス: prefix 学習
全 SPARQL 結果行を走査し、qualifier (P81 / P518) で **明示的に取り込み対象路線** に紐付いた code から **路線ID → prefix 集合 (Map<lineId, Set<string>>)** を構築する。prefix は code の数字より前の英字部分 (大文字統一)。

```ts
function codePrefix(code: string): string {
  const m = code.match(/^([A-Za-z]+)/)
  return m ? m[1].toUpperCase() : ''
}
```

例:
- 千種 `H12` (qP518=東山線) → `prefixesByLine[東山線].add('H')`
- 大曽根 `M12` (qP518=名城線) → `prefixesByLine[名城線].add('M')`
- 金山 `NH34` (qP81=名鉄名古屋本線) → `prefixesByLine[名鉄名古屋本線].add('NH')`

### 第 2 パス: unattached 割当 (新ロジック)

各駅について:
1. qualifier 付き code は ADR 0008 の通り該当 lineLink に格納 (変更なし)
2. unattached code については以下の優先順で割り当てる:
   - **(a) prefix で一意に決まる場合**: code の prefix が該当駅の未埋め lineLink のいずれか 1 つの prefix 集合に一致 → そこに割当
   - **(b) ADR 0010 §1 §2**: lineLink が 1 件のみ → 全部採用 / 未埋め lineLink が 1 件 → 残り 1 件に集約
   - **(c) ADR 0010 §3**: それ以外 (prefix で見分けられない + 未埋め複数 + unattached 複数) → 全部スキップ

prefix が複数 lineLink にマッチする場合 (例えば 系統が 1 つの記号を共有しているような特殊ケース): 一意に決まらない場合は (a) でなく (b)/(c) の判定に進む。安全側。

純数字 code (例: 高蔵寺の `23`) は prefix 空文字となるため (a) は機能しない。(b)/(c) で処理。

### テスト
`import-master-tokai.test.ts` に以下を追加:
- 大曽根パターン: 1 駅で 2 unattached + 2 unfilled lineLink。事前に他駅から prefix が学習済みなら個別の lineLink に振り分けされる
- 学習データが無い prefix の場合は (b)/(c) にフォールバック
- 純数字 code が prefix では判定不能で fallback に流れる

### 既存データ
ADR 0008/0010 と同じく `--clean` 再取込で補正。

## Consequences

### 利益
- 大曽根, 上小田井, 高蔵寺等の「両 unattached + 両 unfilled」駅でも自動補完が効く (Wikidata 上で別駅から prefix が学習されている限り)。
- 学習データは Wikidata 内で完結するため、**外部 mapping や手動 mapping は持たない** (新路線追加時もメンテ不要)。
- 路線記号体系を持たない事業者 (将来追加されるかもしれない) では学習データが空になり、安全側 (ADR 0010) にフォールバック。

### 代償・リスク
- 「同じ prefix を異なる事業者が使う」ケースが出ると誤判定する可能性 (例: JR の `H` 線と 地下鉄東山線 `H` が同じ prefix)。実データで衝突が確認されたら `Set` ベースの一意判定で曖昧になり (a) はスキップされる安全側挙動になる (= 旧来の ambiguous スキップにフォールバック)。
- prefix が 1 文字 (`H`, `M`, `T`, `S`, `E`) の路線がいくつかあり、衝突リスクが少し高い。実装では「prefix が複数 lineLink にマッチした場合は (a) を見送る」ことで誤割当を防ぐ。

### 影響範囲
- ADR 0010 §3 の「ambiguous → 全部スキップ」ルールを上書きし、prefix 一致するものは救う。
- ADR 0010 §1 §2 の挙動は変更なし。
- ADR 0009 (電報略号フィルタ) はそのまま (本 ADR の前段で動作)。
