/**
 * 運営会社 (operator) / 種別 (kind) / 路線 (line) の 3 軸セレクトの cascade ルール
 * (US-050 / US-052 → US-053 で非対称化)。
 *
 * 階層: operator (上位) > kind (中位) > line (下位)
 *
 * **US-053**: 上位 → 下位は narrow するが, 下位 → 上位は何もしない (asymmetric)。
 * - operator 選択: kind / line を operator のものに narrow + 矛盾値クリア
 * - kind 選択: line を kind に narrow + 矛盾 line クリア。operator には作用しない
 * - line 選択: 何もせず line だけセット。operator / kind には作用しない
 * - dropdown 選択肢: operator 常に全件; kind は operator で narrow; line は operator + kind で narrow
 *
 * これにより「下位を先に選んだ場合, 上位はおおむね『すべての○○』が選択された状態」を保つ。
 * 利用者が下位条件を選んだあと上位を任意に追加で絞り込める。
 *
 * Form 用途 (RouteRegister/RouteEdit segment) で line→kind の hard-set が必要な場合は
 * 各画面で applyLine 後に手動で kind を補完する (data 整合性責務は cascade ライブラリでは持たない)。
 */
import type { LineKind } from './lines'

export type CascadeLine = {
  id: string
  kind: LineKind
  operatorId: string | null
}

export type CascadeOperator = {
  id: string
  /// US-052: 運営する種別。空配列 = 絞り込みなし。
  kinds: LineKind[]
}

export type CascadeData = {
  lines: ReadonlyArray<CascadeLine>
  /// US-052: 任意。空配列のときは Line から派生 (legacy 互換)。
  operators?: ReadonlyArray<CascadeOperator>
}

export type CascadeState = {
  operator: string // '' = すべて
  kind: '' | LineKind
  line: string // '' = すべて
}

/// 指定 operator の kinds を取得 (operators が無い or kinds 空のときは null = 制約なし)。
function operatorKinds(
  operatorId: string,
  data: CascadeData,
): ReadonlySet<LineKind> | null {
  if (!operatorId) return null
  const op = data.operators?.find((o) => o.id === operatorId)
  if (op && op.kinds.length > 0) return new Set(op.kinds)
  return null // 制約なし
}

/** operator を変更したときの新しい state を返す。 */
export function applyOperator(
  s: CascadeState,
  operator: string,
  data: CascadeData,
): CascadeState {
  const next: CascadeState = { ...s, operator }
  if (!operator) return next
  const opKindSet = operatorKinds(operator, data)
  // 既存 kind が operator.kinds に無いなら kind クリア
  if (next.kind && opKindSet && !opKindSet.has(next.kind)) {
    next.kind = ''
  }
  // 既存 line が operator+kind と整合しないならクリア
  if (next.line) {
    const cur = data.lines.find((l) => l.id === next.line)
    if (!cur) {
      next.line = ''
    } else {
      if (cur.operatorId !== operator) next.line = ''
      else if (next.kind && cur.kind !== next.kind) next.line = ''
    }
  }
  return next
}

/** kind を変更したときの新しい state を返す。
 * US-053: kind は operator (上位) には作用しない。line (下位) のみ整合チェック。
 */
export function applyKind(
  s: CascadeState,
  kind: '' | LineKind,
  data: CascadeData,
): CascadeState {
  const next: CascadeState = { ...s, kind }
  if (!kind) return next
  // 既存 line が kind 不一致ならクリア (上位→下位の整合)
  if (next.line) {
    const cur = data.lines.find((l) => l.id === next.line)
    if (!cur || cur.kind !== kind) next.line = ''
  }
  return next
}

/** line を変更したときの新しい state を返す。
 * US-053: line は operator/kind (上位) には作用しない。
 * data 整合性が必要な form 画面 (route segment) では呼出側で kind を補完する。
 */
export function applyLine(
  s: CascadeState,
  lineId: string,
  _data: CascadeData,
): CascadeState {
  return { ...s, line: lineId }
}

/** operator dropdown に出すべき operator id 集合。
 * US-053: kind / line (下位) は operator (上位) に作用しないため, 常に全 operator を返す。
 */
export function visibleOperatorIds(
  _s: Pick<CascadeState, 'kind' | 'line'>,
  data: CascadeData,
): Set<string> {
  if (data.operators) return new Set(data.operators.map((o) => o.id))
  return new Set(
    data.lines.filter((l) => l.operatorId).map((l) => l.operatorId as string),
  )
}

/** kind dropdown に出すべき kind 集合。
 *
 * US-052: kind 絞り込みは operator のみ参照する。
 * line は無視 (line 選択中でも kind を切り替えられるようにする, applyKind が line をクリアする)。
 */
export function visibleKinds(
  s: Pick<CascadeState, 'operator' | 'line'>,
  data: CascadeData,
): Set<LineKind> {
  if (s.operator) {
    const opKindSet = operatorKinds(s.operator, data)
    if (opKindSet) return new Set(opKindSet)
    // legacy: Line から派生
    return new Set(
      data.lines.filter((l) => l.operatorId === s.operator).map((l) => l.kind),
    )
  }
  // 制約なし: operators の全 kinds + Line にある kind
  const out = new Set<LineKind>()
  if (data.operators) {
    for (const o of data.operators) for (const k of o.kinds) out.add(k)
  }
  for (const l of data.lines) out.add(l.kind)
  return out
}

/** line dropdown に出すべき line 集合。 */
export function visibleLines<T extends CascadeLine>(
  s: Pick<CascadeState, 'operator' | 'kind'>,
  lines: ReadonlyArray<T>,
): T[] {
  return lines.filter((l) => {
    if (s.operator && l.operatorId !== s.operator) return false
    if (s.kind && l.kind !== s.kind) return false
    return true
  })
}
