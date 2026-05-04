/**
 * 運営会社 (operator) / 種別 (kind) / 路線 (line) の 3 軸セレクトの cascade ルール (US-050 / US-052)。
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
 *
 * US-052: operator が運営する kinds は Operator.kinds (CascadeOperator.kinds) を SoT とし,
 * 各画面で操作する。空配列の operator は kinds 絞り込みなし (全 kinds と整合とみなす)。
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

/** kind を変更したときの新しい state を返す。候補 1 件なら operator 自動選択。 */
export function applyKind(
  s: CascadeState,
  kind: '' | LineKind,
  data: CascadeData,
): CascadeState {
  const next: CascadeState = { ...s, kind }
  if (!kind) return next
  // 既存 operator が kind を運営しないならクリア
  if (next.operator) {
    const opKindSet = operatorKinds(next.operator, data)
    if (opKindSet && !opKindSet.has(kind)) next.operator = ''
  }
  // operator 自動選択 (候補 1 件のみ)
  if (!next.operator && data.operators) {
    const cands = data.operators.filter((o) => o.kinds.includes(kind))
    if (cands.length === 1) next.operator = cands[0]!.id
  }
  // operators が無い場合は Line から派生して候補 operator を求める (legacy 互換)
  if (!next.operator && !data.operators) {
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
  if (s.line) {
    const cur = data.lines.find((l) => l.id === s.line)
    return new Set(cur?.operatorId ? [cur.operatorId] : [])
  }
  if (s.kind) {
    if (data.operators) {
      // US-052: Operator.kinds で判定
      return new Set(
        data.operators.filter((o) => o.kinds.includes(s.kind as LineKind)).map((o) => o.id),
      )
    }
    // legacy: Line から派生
    return new Set(
      data.lines
        .filter((l) => l.kind === s.kind && l.operatorId)
        .map((l) => l.operatorId as string),
    )
  }
  // 制約なし: operators が指定されていればその全集合, でなければ Line にある operator
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
