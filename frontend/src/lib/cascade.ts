/**
 * 運営会社 (operator) / 種別 (kind) / 路線 (line) の 3 軸セレクトの cascade ルール (US-050)。
 *
 * - operator を選ぶと kind / line がその operator のものに絞り込まれる
 * - kind を選ぶと operator が紐づくものに自動選択 (候補 1 件時) + line が kind 一致のものに絞り込まれる
 * - line を選ぶと operator と kind がその line の値に hard-set
 *
 * 既存値が新条件と矛盾する場合はクリアする (auto-narrow + clear strategy)。
 *
 * 設計判断:
 * - 既存値の保持か破棄かは「絞り込み後の選択肢に存在するなら保持, しなければ破棄」で統一
 * - kind→operator の自動選択は候補 1 件のみに限定 (複数候補なら何もしない)
 * - line→operator/kind は線が一意に決まるので必ず hard-set
 */
import type { LineKind } from './lines'

export type CascadeLine = {
  id: string
  kind: LineKind
  operatorId: string | null
}

export type CascadeData = {
  lines: ReadonlyArray<CascadeLine>
}

export type CascadeState = {
  operator: string // '' = すべて
  kind: '' | LineKind
  line: string // '' = すべて
}

/** operator を変更したときの新しい state を返す。 */
export function applyOperator(
  s: CascadeState,
  operator: string,
  data: CascadeData,
): CascadeState {
  const next: CascadeState = { ...s, operator }
  if (!operator) return next
  const opLines = data.lines.filter((l) => l.operatorId === operator)
  if (next.kind && !opLines.some((l) => l.kind === next.kind)) next.kind = ''
  if (next.line && !opLines.some((l) => l.id === next.line)) next.line = ''
  return next
}

/** kind を変更したときの新しい state を返す。候補 1 件なら operator 自動選択。 */
export function applyKind(
  s: CascadeState,
  kind: '' | LineKind,
  data: CascadeData,
): CascadeState {
  const next: CascadeState = { ...s, kind }
  if (!kind) return next
  // 既存 operator が kind 不在ならクリア
  if (next.operator) {
    const opLines = data.lines.filter((l) => l.operatorId === next.operator)
    if (!opLines.some((l) => l.kind === kind)) next.operator = ''
  }
  // operator 自動選択 (候補 1 件のみ)
  if (!next.operator) {
    const candOps = new Set(
      data.lines
        .filter((l) => l.kind === kind && l.operatorId)
        .map((l) => l.operatorId as string),
    )
    if (candOps.size === 1) next.operator = candOps.values().next().value as string
  }
  // 既存 line が kind 不一致ならクリア
  if (next.line) {
    const cur = data.lines.find((l) => l.id === next.line)
    if (!cur || cur.kind !== kind) next.line = ''
  }
  return next
}

/** line を変更したときの新しい state を返す。operator と kind を hard-set。 */
export function applyLine(
  s: CascadeState,
  lineId: string,
  data: CascadeData,
): CascadeState {
  const next: CascadeState = { ...s, line: lineId }
  if (!lineId) return next
  const line = data.lines.find((l) => l.id === lineId)
  if (!line) return next
  next.kind = line.kind
  if (line.operatorId) next.operator = line.operatorId
  return next
}

/** operator フィルタの dropdown に出すべき operator id 集合 (kind / line と整合するもの)。 */
export function visibleOperatorIds(
  s: Pick<CascadeState, 'kind' | 'line'>,
  data: CascadeData,
): Set<string> {
  let lines = data.lines
  if (s.line) {
    const cur = lines.find((l) => l.id === s.line)
    return new Set(cur?.operatorId ? [cur.operatorId] : [])
  }
  if (s.kind) lines = lines.filter((l) => l.kind === s.kind)
  return new Set(
    lines.filter((l) => l.operatorId).map((l) => l.operatorId as string),
  )
}

/** kind dropdown に出すべき kind 集合。 */
export function visibleKinds(
  s: Pick<CascadeState, 'operator' | 'line'>,
  data: CascadeData,
): Set<LineKind> {
  let lines = data.lines
  if (s.line) {
    const cur = lines.find((l) => l.id === s.line)
    return new Set(cur ? [cur.kind] : [])
  }
  if (s.operator) lines = lines.filter((l) => l.operatorId === s.operator)
  return new Set(lines.map((l) => l.kind))
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
