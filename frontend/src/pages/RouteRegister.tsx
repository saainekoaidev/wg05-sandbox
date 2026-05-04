import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
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
  type CascadeData,
} from '../lib/cascade'

// ---------- 型 ----------

type SegmentField = 'fromStation' | 'toStation'

type Segment = {
  /** US-050: 区間入力時の operator 絞り込み (UI 専用, API には送らない)。 */
  operator: string
  kind: LineKind
  lineId: string // '' = 未選択 (送信時 null に変換)
  fromStation: string
  toStation: string
  fareInput: string // 入力中は文字列、送信時に number 化
}

type SegmentErrors = {
  fromStation?: string
  toStation?: string
  fare?: string
}

type FormErrors = {
  name?: string
  segments: Array<SegmentErrors>
}

type PendingTarget = {
  segmentIndex: number
  field: SegmentField
}

// ---------- 定数 / 制約 ----------

const MAX_SEGMENTS = 10
const MAX_NAME = 50
const MAX_STATION = 50
const MIN_FARE = 1
const MAX_FARE = 99999

const STATION_PICKER_NAME = 'wg05-station-picker'

function emptySegment(): Segment {
  return {
    operator: '',
    kind: 'train',
    lineId: '',
    fromStation: '',
    toStation: '',
    fareInput: '',
  }
}

function emptyErrors(segmentsLength: number): FormErrors {
  return {
    segments: Array.from({ length: segmentsLength }, () => ({})),
  }
}

// ---------- メインコンポーネント ----------

export function RouteRegister() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [segments, setSegments] = useState<Array<Segment>>(() => [emptySegment()])
  const [errors, setErrors] = useState<FormErrors>(() => emptyErrors(1))
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null)
  const linesState = useLines({ enabled: !!session })
  const operatorsState = useOperators({ enabled: !!session })

  // US-050 / US-052: cascade 用データ。区間ごとに operator/kind/line を連動。
  const cascadeData: CascadeData = useMemo(
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

  function patchCascade(idx: number, fn: (s: { operator: string; kind: LineKind; line: string }) => { operator: string; kind: '' | LineKind; line: string }) {
    setSegments((prev) =>
      prev.map((seg, i) => {
        if (i !== idx) return seg
        const next = fn({ operator: seg.operator, kind: seg.kind, line: seg.lineId })
        return {
          ...seg,
          operator: next.operator,
          // 区間種別は必須なので, '' になりそうな場合は元の kind を保持
          kind: next.kind || seg.kind,
          lineId: next.line,
        }
      }),
    )
  }

  // 駅選択 popup からの postMessage 受信
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (
        e?.data &&
        typeof e.data === 'object' &&
        e.data.type === 'station-pick' &&
        typeof e.data.name === 'string' &&
        pendingTarget
      ) {
        const { segmentIndex, field } = pendingTarget
        setSegments((prev) =>
          prev.map((s, i) =>
            i === segmentIndex ? { ...s, [field]: e.data.name } : s,
          ),
        )
        setPendingTarget(null)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [pendingTarget])

  // ----- 派生サマリ -----
  const summary = useMemo(() => {
    const first = segments[0]
    const last = segments[segments.length - 1]
    const fromStation = first?.fromStation?.trim() ?? ''
    const toStation = last?.toStation?.trim() ?? ''
    const totalFare = segments.reduce((acc, s) => {
      const v = parseInt(s.fareInput, 10)
      return acc + (Number.isFinite(v) ? v : 0)
    }, 0)
    return { fromStation, toStation, totalFare }
  }, [segments])

  // 認証ガード: セッション取得中はフォームを描画せず、未ログインなら /login へ。
  // RoutesStub と同じパターンに揃えることで E2E の再描画タイミング問題を回避する。
  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />


  // ----- バリデーション -----
  function validate(): { errors: FormErrors; ok: boolean } {
    const next: FormErrors = { segments: [] }
    let ok = true

    if (name.length > MAX_NAME) {
      next.name = `経路名は${MAX_NAME}文字以内で入力してください`
      ok = false
    }

    for (const s of segments) {
      const segErr: SegmentErrors = {}
      if (!s.fromStation.trim()) {
        segErr.fromStation = '区間ごとに出発駅を入力してください'
        ok = false
      } else if (s.fromStation.length > MAX_STATION) {
        segErr.fromStation = `駅名は${MAX_STATION}文字以内で入力してください`
        ok = false
      }
      if (!s.toStation.trim()) {
        segErr.toStation = '区間ごとに到着駅を入力してください'
        ok = false
      } else if (s.toStation.length > MAX_STATION) {
        segErr.toStation = `駅名は${MAX_STATION}文字以内で入力してください`
        ok = false
      } else if (
        s.fromStation.trim() &&
        s.fromStation.trim() === s.toStation.trim()
      ) {
        segErr.toStation = '区間内で出発駅と到着駅が同じです'
        ok = false
      }

      if (!s.fareInput) {
        segErr.fare = '区間ごとに運賃を入力してください'
        ok = false
      } else {
        const fare = parseInt(s.fareInput, 10)
        if (!Number.isFinite(fare) || String(fare) !== s.fareInput) {
          segErr.fare = '運賃は1以上の整数で入力してください'
          ok = false
        } else if (fare < MIN_FARE) {
          segErr.fare = '運賃は1以上の整数で入力してください'
          ok = false
        } else if (fare > MAX_FARE) {
          segErr.fare = `運賃は${MAX_FARE.toLocaleString()}円以下で入力してください`
          ok = false
        }
      }

      next.segments.push(segErr)
    }

    return { errors: next, ok }
  }

  // ----- ハンドラ -----
  function updateSegment(index: number, patch: Partial<Segment>) {
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function addSegment() {
    if (segments.length >= MAX_SEGMENTS) return
    setSegments((prev) => [...prev, emptySegment()])
    setErrors((prev) => ({
      ...prev,
      segments: [...prev.segments, {}],
    }))
  }

  function removeSegment(index: number) {
    if (segments.length <= 1) return
    setSegments((prev) => prev.filter((_, i) => i !== index))
    setErrors((prev) => ({
      ...prev,
      segments: prev.segments.filter((_, i) => i !== index),
    }))
  }

  const openStationPicker = useCallback(
    (segmentIndex: number, field: SegmentField) => {
      setPendingTarget({ segmentIndex, field })
      // US-016 / US-050: 区間で選択済みの運営会社/種別/路線を popup に引き継ぐ
      const seg = segments[segmentIndex]
      const params = new URLSearchParams()
      if (seg?.operator) params.set('operator', seg.operator)
      if (seg?.kind) params.set('kind', seg.kind)
      if (seg?.lineId) params.set('line', seg.lineId)
      const url = params.toString()
        ? `/stations?${params.toString()}`
        : '/stations'
      window.open(
        url,
        STATION_PICKER_NAME,
        'width=960,height=720,resizable=yes,scrollbars=yes',
      )
    },
    [segments],
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBannerError(null)

    const { errors: nextErrors, ok } = validate()
    setErrors(nextErrors)
    if (!ok) return

    setSubmitting(true)
    try {
      const body = {
        name: name.trim() || null,
        segments: segments.map((s) => ({
          kind: s.kind,
          lineId: s.lineId === '' ? null : s.lineId,
          fromStation: s.fromStation.trim(),
          toStation: s.toStation.trim(),
          fare: parseInt(s.fareInput, 10),
        })),
      }

      const res = await fetch('http://localhost:3000/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        if (res.status === 401) {
          navigate('/login', { replace: true })
          return
        }
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        const errorCode = data?.error
        if (errorCode === 'validation_failed') {
          setBannerError('入力内容に誤りがあります。各項目をご確認ください')
        } else {
          setBannerError('経路の登録に失敗しました。時間をおいて再度お試しください')
        }
        return
      }

      navigate('/routes', { replace: true })
    } catch {
      setBannerError('経路の登録に失敗しました。時間をおいて再度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

  function handleReset() {
    if (
      !name &&
      segments.length === 1 &&
      Object.values(segments[0]!).every((v) => v === '' || v === 'train')
    ) {
      return
    }
    if (!window.confirm('入力内容をリセットしますか?')) return
    setName('')
    setSegments([emptySegment()])
    setErrors(emptyErrors(1))
    setBannerError(null)
  }

  function handleCancel() {
    const dirty =
      name !== '' ||
      segments.length > 1 ||
      Object.values(segments[0]!).some((v) => v !== '' && v !== 'train')
    if (dirty && !window.confirm('入力内容を破棄して経路一覧に戻りますか?')) {
      return
    }
    navigate('/routes')
  }

  // ----- 描画 -----
  return (
    <div className="shell shell--wide">
      <div className="head">
        <UserBadge />
        <div className="brand">New Route</div>
        <h1>新規通勤経路の登録</h1>
        <p>区間を順に追加すると、出発駅と到着駅は自動で決定されます</p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {bannerError && <div className="banner is-shown">{bannerError}</div>}

        <div className="group">
          <label htmlFor="route-name">経路名</label>
          <input
            id="route-name"
            type="text"
            placeholder="平日通勤 (任意)"
            maxLength={MAX_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
          />
          <div className="hint">未入力の場合「(無題)」として保存されます</div>
          {errors.name && <div className="field-error">{errors.name}</div>}
        </div>

        <div className="divider"><span>Segments</span></div>

        <div className="segments" role="group" aria-label="区間">
          {segments.map((seg, idx) => {
            const segErr = errors.segments[idx] ?? {}
            const canRemove = segments.length > 1
            return (
              <div className="segment-card" key={idx}>
                <div className="segment-card-head">
                  <div className="segment-no">{String(idx + 1).padStart(2, '0')}</div>
                  {/* US-050: 運営会社 → 種別 → 路線 順 + cascade */}
                  <div className="group group--narrow">
                    <label>運営会社</label>
                    <select
                      aria-label={`区間${idx + 1} 運営会社`}
                      value={seg.operator}
                      onChange={(e) =>
                        patchCascade(idx, (s) => applyOperator(s, e.target.value, cascadeData))
                      }
                      disabled={submitting}
                    >
                      <option value="">(指定なし)</option>
                      {(operatorsState.operators ?? [])
                        .filter((op) => {
                          const ids = visibleOperatorIds(
                            { kind: seg.kind, line: seg.lineId },
                            cascadeData,
                          )
                          return ids.size === 0 || ids.has(op.id)
                        })
                        .map((op) => (
                          <option key={op.id} value={op.id}>
                            {op.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="group group--narrow">
                    <label>
                      種別<span className="req">必須</span>
                    </label>
                    <select
                      aria-label={`区間${idx + 1} 種別`}
                      value={seg.kind}
                      onChange={(e) =>
                        patchCascade(idx, (s) =>
                          applyKind(s, e.target.value as LineKind, cascadeData),
                        )
                      }
                      disabled={submitting}
                    >
                      {(['train', 'subway', 'bus', 'other'] as const)
                        .filter((k) => {
                          const set = visibleKinds(
                            { operator: seg.operator, line: seg.lineId },
                            cascadeData,
                          )
                          return seg.kind === k || set.size === 0 || set.has(k)
                        })
                        .map((k) => (
                          <option key={k} value={k}>
                            {{ train: '電車', subway: '地下鉄', bus: 'バス', other: 'その他' }[k]}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="group">
                    <label>路線名</label>
                    <select
                      aria-label={`区間${idx + 1} 路線名`}
                      value={seg.lineId}
                      onChange={(e) =>
                        patchCascade(idx, (s) => {
                          const next = applyLine(s, e.target.value, cascadeData)
                          // US-053 + segment data 整合性: 路線が選ばれたら種別をその路線の kind に揃える。
                          // 区間データの kind は zod required のため, 路線と整合させる必要がある。
                          const line = cascadeData.lines.find(
                            (l) => l.id === e.target.value,
                          )
                          if (line) next.kind = line.kind
                          return next
                        })
                      }
                      disabled={submitting}
                    >
                      <option value="">(未選択)</option>
                      {visibleLines(
                        { operator: seg.operator, kind: seg.kind },
                        linesState.lines ?? [],
                      ).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn-rm"
                    aria-label={`区間${idx + 1} を削除`}
                    onClick={() => removeSegment(idx)}
                    disabled={submitting || !canRemove}
                    title={canRemove ? '区間を削除' : '最低1区間は必要です'}
                  >
                    ×
                  </button>
                </div>
                <div className="segment-card-route">
                  <div className="group">
                    <label>
                      出発<span className="req">必須</span>
                    </label>
                    <div className="input-with-action">
                      <input
                        type="text"
                        aria-label={`区間${idx + 1} 出発駅`}
                        placeholder="例: 渋谷"
                        maxLength={MAX_STATION}
                        value={seg.fromStation}
                        onChange={(e) =>
                          updateSegment(idx, { fromStation: e.target.value })
                        }
                        disabled={submitting}
                      />
                      <button
                        type="button"
                        className="btn-pick"
                        onClick={() => openStationPicker(idx, 'fromStation')}
                        disabled={submitting}
                      >
                        駅選択
                      </button>
                    </div>
                    {segErr.fromStation && (
                      <div className="field-error">{segErr.fromStation}</div>
                    )}
                  </div>
                  <div className="group">
                    <label>
                      到着<span className="req">必須</span>
                    </label>
                    <div className="input-with-action">
                      <input
                        type="text"
                        aria-label={`区間${idx + 1} 到着駅`}
                        placeholder="例: 表参道"
                        maxLength={MAX_STATION}
                        value={seg.toStation}
                        onChange={(e) =>
                          updateSegment(idx, { toStation: e.target.value })
                        }
                        disabled={submitting}
                      />
                      <button
                        type="button"
                        className="btn-pick"
                        onClick={() => openStationPicker(idx, 'toStation')}
                        disabled={submitting}
                      >
                        駅選択
                      </button>
                    </div>
                    {segErr.toStation && (
                      <div className="field-error">{segErr.toStation}</div>
                    )}
                  </div>
                  <div className="group group--narrow">
                    <label>
                      運賃<span className="req">必須</span>
                    </label>
                    <input
                      type="number"
                      aria-label={`区間${idx + 1} 運賃`}
                      placeholder="160"
                      inputMode="numeric"
                      min={MIN_FARE}
                      max={MAX_FARE}
                      value={seg.fareInput}
                      onChange={(e) =>
                        updateSegment(idx, { fareInput: e.target.value })
                      }
                      disabled={submitting}
                    />
                    {segErr.fare && (
                      <div className="field-error">{segErr.fare}</div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          className="btn-add"
          onClick={addSegment}
          disabled={submitting || segments.length >= MAX_SEGMENTS}
          aria-label="区間を追加"
        >
          + 区間を追加 ({segments.length}/{MAX_SEGMENTS})
        </button>

        <div className="route-summary">
          <div className="route-flow">
            <span>
              <span className="pill-label">出発</span>
              <span
                className={`station-name${
                  summary.fromStation ? '' : ' is-empty'
                }`}
              >
                {summary.fromStation || '(未入力)'}
              </span>
            </span>
            <span className="arrow">→</span>
            <span>
              <span className="pill-label">到着</span>
              <span
                className={`station-name${
                  summary.toStation ? '' : ' is-empty'
                }`}
              >
                {summary.toStation || '(未入力)'}
              </span>
            </span>
          </div>
          <div className="total">
            合計運賃: ¥{summary.totalFare.toLocaleString()}
          </div>
        </div>

        <div className="actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? '登録中…' : '登録する'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            disabled={submitting}
          >
            リセット
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleCancel}
            disabled={submitting}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
