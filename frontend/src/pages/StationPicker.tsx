import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { SortableTh, type SortDir } from '../components/SortableTh'
import { UserBadge } from '../components/UserBadge'
import { useSession } from '../lib/auth'
import { useLines, type LineKind } from '../lib/lines'
import { useOperators } from '../lib/operators'
import {
  applyKind,
  applyLine,
  applyOperator,
  visibleKinds,
  visibleLines,
  visibleOperatorIds,
} from '../lib/cascade'

type ApiStation = {
  id: string
  name: string
  kana: string
  /** US-030: 駅番号 (例: "CA68")。手動作成 / 番号未設定駅は空文字。 */
  code: string
  lines: Array<{ id: string; name: string; kind: LineKind; operator: string | null }>
}

type ApiResponse = { stations: ApiStation[] }

type SortColumn = 'kind' | 'kana' | 'code'

// US-030: 種別ソート時の優先順 (電車 < 地下鉄 < バス < その他)。
// 駅が複数路線に接続する場合は priority が最小の kind を sort key にする。
const KIND_ORDER: Record<LineKind, number> = {
  train: 0,
  subway: 1,
  bus: 2,
  other: 3,
}

const KIND_TAG_CLASS: Record<LineKind, string> = {
  train: 'tag tag-train',
  subway: 'tag tag-subway',
  bus: 'tag tag-bus',
  other: 'tag tag-other',
}

const KIND_LABEL: Record<LineKind, string> = {
  train: '電車',
  subway: '地下鉄',
  bus: 'バス',
  other: 'その他',
}

function isOpenedAsPopup(): boolean {
  try {
    return Boolean(window.opener && !window.opener.closed)
  } catch {
    return false
  }
}

const VALID_KINDS: ReadonlySet<string> = new Set(['train', 'subway', 'bus', 'other'])

export function StationPicker() {
  const { data: session, isPending } = useSession()
  // US-016: 経路登録/編集 popup から ?kind=...&line=...&q=...&operator=... を受け取り初期値にする
  const [searchParams] = useSearchParams()
  const initialKind = searchParams.get('kind') ?? ''
  const initialLine = searchParams.get('line') ?? ''
  const initialOperator = searchParams.get('operator') ?? ''
  const initialQ = searchParams.get('q') ?? ''
  const [q, setQ] = useState(initialQ)
  const [operator, setOperator] = useState<string>(initialOperator)
  const [kind, setKind] = useState<'' | LineKind>(
    VALID_KINDS.has(initialKind) ? (initialKind as LineKind) : '',
  )
  const [lineId, setLineId] = useState(initialLine)
  const [stations, setStations] = useState<ApiStation[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const linesState = useLines({ enabled: !!session })
  const operatorsState = useOperators({ enabled: !!session })

  // US-050 / US-052: cascade 用データ (Operator.kinds 込み)
  const cascadeData = useMemo(
    () => ({
      lines: (linesState.lines ?? []).map((l) => ({
        id: l.id,
        kind: l.kind,
        operatorId: l.operatorId,
      })),
      operators: (operatorsState.operators ?? []).map((o) => ({
        id: o.id,
        kinds: o.kinds,
      })),
    }),
    [linesState.lines, operatorsState.operators],
  )

  function onChangeOperator(op: string) {
    const next = applyOperator({ operator, kind, line: lineId }, op, cascadeData)
    setOperator(next.operator)
    setKind(next.kind)
    setLineId(next.line)
  }
  function onChangeKind(k: '' | LineKind) {
    const next = applyKind({ operator, kind, line: lineId }, k, cascadeData)
    setOperator(next.operator)
    setKind(next.kind)
    setLineId(next.line)
  }
  function onChangeLine(lid: string) {
    const next = applyLine({ operator, kind, line: lineId }, lid, cascadeData)
    setOperator(next.operator)
    setKind(next.kind)
    setLineId(next.line)
  }

  const visibleOpIds = useMemo(
    () => visibleOperatorIds({ kind, line: lineId }, cascadeData),
    [kind, lineId, cascadeData],
  )
  // US-052: 種別 dropdown を operator.kinds + line で絞り込み
  const visibleKindSet = useMemo(
    () => visibleKinds({ operator, line: lineId }, cascadeData),
    [operator, lineId, cascadeData],
  )
  const visibleLineList = useMemo(
    () => visibleLines({ operator, kind }, linesState.lines ?? []),
    [operator, kind, linesState.lines],
  )

  // US-030: ソート状態。null の間は API の既定順 (name asc) を維持。
  const [sortBy, setSortBy] = useState<SortColumn | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function handleSort(col: SortColumn) {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  const sortedStations = useMemo<ApiStation[] | null>(() => {
    if (!stations) return null
    if (!sortBy) return stations
    const arr = [...stations]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'kind') {
        const ka =
          a.lines.length === 0
            ? 99
            : Math.min(...a.lines.map((l) => KIND_ORDER[l.kind]))
        const kb =
          b.lines.length === 0
            ? 99
            : Math.min(...b.lines.map((l) => KIND_ORDER[l.kind]))
        cmp = ka - kb
      } else if (sortBy === 'kana') {
        cmp = a.kana.localeCompare(b.kana, 'ja')
      } else {
        // code: 空文字は常に末尾扱い (昇降ともに)
        const ea = a.code === ''
        const eb = b.code === ''
        if (ea && !eb) return 1
        if (!ea && eb) return -1
        cmp = a.code.localeCompare(b.code, 'en')
      }
      if (cmp === 0) return 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [stations, sortBy, sortDir])

  // US-016 自動検索フラグ。初期 URL に条件があれば、認証確定後 1 度だけ自動実行する。
  const autoSearchedRef = useRef(false)

  async function executeSearch(
    qVal: string,
    kindVal: '' | LineKind,
    lineIdVal: string,
    operatorVal: string = '',
  ) {
    setError(null)
    setSearched(true)
    if (!qVal.trim() && !kindVal && !lineIdVal && !operatorVal) {
      setError('駅名・運営会社・種別・路線のいずれかを入力または選択してください')
      setStations([])
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (qVal.trim()) params.set('q', qVal.trim())
      if (operatorVal) params.set('operator', operatorVal)
      if (kindVal) params.set('kind', kindVal)
      if (lineIdVal) params.set('line', lineIdVal)
      const res = await fetch(`http://localhost:3000/api/stations?${params}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!res.ok) {
        setError('駅マスタの取得に失敗しました。再読み込みをお試しください')
        setStations([])
        return
      }
      const body = (await res.json()) as ApiResponse
      setStations(body.stations)
    } catch {
      setError('駅マスタの取得に失敗しました。再読み込みをお試しください')
      setStations([])
    } finally {
      setLoading(false)
    }
  }

  // US-016: 認証確定後に URL 条件があれば 1 回だけ自動検索
  useEffect(() => {
    if (isPending || !session) return
    if (autoSearchedRef.current) return
    if (!initialQ && !initialKind && !initialLine && !initialOperator) return
    autoSearchedRef.current = true
    void executeSearch(
      initialQ,
      VALID_KINDS.has(initialKind) ? (initialKind as LineKind) : '',
      initialLine,
      initialOperator,
    )
  }, [isPending, session, initialQ, initialKind, initialLine, initialOperator])

  if (!isPending && !session) {
    return <Navigate to="/login" replace />
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    await executeSearch(q, kind, lineId, operator)
  }

  function handleClear() {
    setQ('')
    setOperator('')
    setKind('')
    setLineId('')
    setStations(null)
    setSearched(false)
    setError(null)
  }

  function handlePick(name: string) {
    if (isOpenedAsPopup()) {
      try {
        window.opener!.postMessage(
          { type: 'station-pick', name },
          window.location.origin,
        )
      } catch {
        // postMessage 失敗時は単に閉じる
      }
      window.close()
    }
    // 単独画面で叩かれた場合は何もしない (将来 routes 一覧へ navigate して
    // 値を引き継ぐ等の拡張余地あり)。
  }

  function handleClose() {
    if (isOpenedAsPopup()) {
      window.close()
    }
  }

  const popupMode = isOpenedAsPopup()

  return (
    <div className="shell shell--wide">
      <div className="head">
        {/* US-062: popup ダイアログでは UserBadge (プロフィール編集リンク) を出さない */}
        {!popupMode && <UserBadge />}
        <div className="brand">Station Master</div>
        <h1>駅マスタ参照</h1>
        <p>
          {popupMode
            ? '駅を選択すると呼出元のフォームに反映されます'
            : 'キーワード・種別・路線で駅 / 停留所を検索できます'}
        </p>
      </div>

      <div className="body">
        <form className="search-row" onSubmit={handleSearch} noValidate>
          <div className="group">
            <label htmlFor="picker-q">駅名 / よみがな</label>
            <input
              id="picker-q"
              type="text"
              placeholder="しぶや / 渋谷"
              maxLength={30}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {/* US-050: 運営会社 → 種別 → 路線 順 + cascade */}
          <div className="group group--narrow">
            <label htmlFor="picker-operator">運営会社</label>
            <select
              id="picker-operator"
              value={operator}
              onChange={(e) => onChangeOperator(e.target.value)}
            >
              <option value="">すべての会社</option>
              {(operatorsState.operators ?? [])
                .filter((op) => visibleOpIds.size === 0 || visibleOpIds.has(op.id))
                .map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="group group--narrow">
            <label htmlFor="picker-kind">種別</label>
            <select
              id="picker-kind"
              value={kind}
              onChange={(e) => onChangeKind(e.target.value as '' | LineKind)}
            >
              <option value="">すべて</option>
              {(['train', 'subway', 'bus', 'other'] as const)
                .filter(
                  (k) =>
                    kind === k || visibleKindSet.size === 0 || visibleKindSet.has(k),
                )
                .map((k) => (
                  <option key={k} value={k}>
                    {{ train: '電車', subway: '地下鉄', bus: 'バス', other: 'その他' }[k]}
                  </option>
                ))}
            </select>
          </div>
          <div className="group">
            <label htmlFor="picker-line">路線</label>
            <select
              id="picker-line"
              value={lineId}
              onChange={(e) => onChangeLine(e.target.value)}
            >
              <option value="">すべての路線</option>
              {visibleLineList.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '検索中…' : '検索'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClear}
            disabled={loading}
          >
            クリア
          </button>
        </form>

        {error && <div className="banner is-shown">{error}</div>}

        {searched && sortedStations && sortedStations.length === 0 && !error && (
          <div className="empty">
            該当する駅が見つかりませんでした。条件を変えてお試しください
          </div>
        )}

        {sortedStations && sortedStations.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-num">#</th>
                  <SortableTh
                    label="種別"
                    column="kind"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <th>駅名 / 停留所</th>
                  <SortableTh
                    label="よみがな"
                    column="kana"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTh
                    label="駅番号"
                    column="code"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <th>主要路線</th>
                  <th className="col-actions">選択</th>
                </tr>
              </thead>
              <tbody>
                {sortedStations.map((s, i) => {
                  // 接続する路線の種別ユニーク集合 (表示用タグ)
                  const kinds = Array.from(new Set(s.lines.map((l) => l.kind)))
                  return (
                    <tr key={s.id}>
                      <td className="col-num">{i + 1}</td>
                      <td>
                        {kinds.map((k) => (
                          <span key={k} className={KIND_TAG_CLASS[k]}>
                            {KIND_LABEL[k]}
                          </span>
                        ))}
                      </td>
                      <td>{s.name}</td>
                      <td>{s.kana}</td>
                      <td>{s.code === '' ? <span className="hint">—</span> : <code>{s.code}</code>}</td>
                      <td>{s.lines.map((l) => l.name).join(', ')}</td>
                      <td>
                        <div className="col-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handlePick(s.name)}
                            aria-label={`${s.name} を選択`}
                          >
                            選択
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div
          className="actions actions--no-divider"
          style={{ marginTop: '24px' }}
        >
          <button type="button" className="btn btn-ghost" onClick={handleClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * US-030: ソート可能な <th>。クリックで該当列ソート ON / 同列を再度クリックで方向反転。
 * ソート中の列は ▲ (asc) / ▼ (desc) を表示する。
 */
// US-055: SortableTh は frontend/src/components/SortableTh.tsx に共通化済
