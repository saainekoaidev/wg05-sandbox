import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { useSession } from '../lib/auth'
import { useLines, KIND_OPTIONS, type LineKind } from '../lib/lines'

// ---------- 型 ----------

type SegmentField = 'fromStation' | 'toStation'

type Segment = {
  kind: LineKind
  lineId: string // '' = 未選択 (送信時 null に変換)
  fromStation: string
  toStation: string
  fareInput: string
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

type ApiSegment = {
  id: string
  orderIndex: number
  kind: LineKind
  lineId: string | null
  fromStation: string
  toStation: string
  fare: number
}

type ApiRoute = {
  id: string
  name: string | null
  fromStation: string
  toStation: string
  createdAt: string
  updatedAt: string
  segments: ApiSegment[]
}

// ---------- 制約 ----------

const MAX_SEGMENTS = 10
const MAX_NAME = 50
const MAX_STATION = 50
const MIN_FARE = 1
const MAX_FARE = 99999
const STATION_PICKER_NAME = 'wg05-station-picker'

// API 形式 ↔ フォーム形式の変換

function toFormSegment(s: ApiSegment): Segment {
  return {
    kind: s.kind,
    lineId: s.lineId ?? '',
    fromStation: s.fromStation,
    toStation: s.toStation,
    fareInput: String(s.fare),
  }
}

type FormSnapshot = {
  name: string
  segments: Segment[]
  updatedAt: string
}

function buildSnapshot(route: ApiRoute): FormSnapshot {
  return {
    name: route.name ?? '',
    segments: route.segments.map(toFormSegment),
    updatedAt: route.updatedAt,
  }
}

// ---------- メインコンポーネント ----------

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export function RouteEdit() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const params = useParams<{ id: string }>()
  const id = params.id ?? ''

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [snapshot, setSnapshot] = useState<FormSnapshot | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string>('')
  const [errors, setErrors] = useState<FormErrors>({ segments: [] })
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [conflictBanner, setConflictBanner] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null)
  const linesState = useLines({ enabled: !!session })

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

  // 初期取得
  useEffect(() => {
    if (isPending || !session || !id) return
    let cancelled = false
    async function load() {
      setLoad({ kind: 'loading' })
      try {
        const res = await fetch(`http://localhost:3000/api/routes/${id}`, {
          credentials: 'include',
        })
        if (cancelled) return
        if (res.status === 401) {
          navigate('/login', { replace: true })
          return
        }
        if (res.status === 403) {
          setLoad({ kind: 'forbidden' })
          return
        }
        if (res.status === 404) {
          setLoad({ kind: 'not_found' })
          return
        }
        if (!res.ok) {
          setLoad({ kind: 'error' })
          return
        }
        const route = (await res.json()) as ApiRoute
        const snap = buildSnapshot(route)
        setSnapshot(snap)
        setName(snap.name)
        setSegments(snap.segments)
        setUpdatedAt(snap.updatedAt)
        setErrors({ segments: snap.segments.map(() => ({})) })
        setLoad({ kind: 'ok' })
      } catch {
        if (!cancelled) setLoad({ kind: 'error' })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isPending, session, id, navigate])

  // 派生サマリ
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

  // 差分検知 (snapshot との比較で更新ボタンの活性を制御)
  const isDirty = useMemo(() => {
    if (!snapshot) return false
    const current = JSON.stringify({ name, segments })
    const saved = JSON.stringify({ name: snapshot.name, segments: snapshot.segments })
    return current !== saved
  }, [name, segments, snapshot])

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  // ---------- バリデーション (RouteRegister と同等) ----------
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

  // ---------- フォーム操作 ----------
  function updateSegment(index: number, patch: Partial<Segment>) {
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function addSegment() {
    if (segments.length >= MAX_SEGMENTS) return
    setSegments((prev) => [
      ...prev,
      { kind: 'train', lineId: '', fromStation: '', toStation: '', fareInput: '' },
    ])
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

  // useCallback は早期 return の後ろに置けない (Rules of Hooks 違反) ため
  // 通常の関数として宣言する。再レンダ毎に再生成されるが、子コンポーネントへの
  // memoization 連鎖を組んでいない現状ではコスト無視できる。
  function openStationPicker(segmentIndex: number, field: SegmentField) {
    setPendingTarget({ segmentIndex, field })
    // US-016: 区間で選択済みの種別/路線を popup に引き継ぐ
    const seg = segments[segmentIndex]
    const params = new URLSearchParams()
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
  }

  // ---------- 送信 ----------
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
        updatedAt,
        segments: segments.map((s) => ({
          kind: s.kind,
          lineId: s.lineId === '' ? null : s.lineId,
          fromStation: s.fromStation.trim(),
          toStation: s.toStation.trim(),
          fare: parseInt(s.fareInput, 10),
        })),
      }
      const res = await fetch(`http://localhost:3000/api/routes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (res.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (res.status === 403) {
        setBannerError('この経路を編集する権限がありません')
        return
      }
      if (res.status === 404) {
        setBannerError(
          '該当の経路が見つかりませんでした (既に削除されている可能性があります)',
        )
        return
      }
      if (res.status === 409) {
        // 楽観ロック衝突: 最新値で再描画 + 警告バナー
        const data = (await res.json()) as { current: ApiRoute; message: string }
        const snap = buildSnapshot(data.current)
        setSnapshot(snap)
        setName(snap.name)
        setSegments(snap.segments)
        setUpdatedAt(snap.updatedAt)
        setErrors({ segments: snap.segments.map(() => ({})) })
        setConflictBanner(
          data.message ??
            '他の場所で更新されたため最新の状態を再読込しました。再度ご確認ください',
        )
        return
      }
      if (!res.ok) {
        setBannerError('経路の更新に失敗しました。時間をおいて再度お試しください')
        return
      }

      // 成功 → 詳細画面へ遷移 (state.notice で通知)
      navigate(`/routes/${id}`, {
        replace: true,
        state: { notice: '経路を更新しました' },
      })
    } catch {
      setBannerError('経路の更新に失敗しました。時間をおいて再度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

  function handleReset() {
    if (!snapshot) return
    if (!isDirty) return
    if (!window.confirm('編集内容を破棄して取得時の状態に戻しますか?')) return
    setName(snapshot.name)
    setSegments(snapshot.segments)
    setErrors({ segments: snapshot.segments.map(() => ({})) })
    setBannerError(null)
  }

  function handleCancel() {
    if (isDirty && !window.confirm('編集内容を破棄して経路詳細に戻りますか?')) {
      return
    }
    navigate(`/routes/${id}`)
  }

  // ---------- 描画 ----------

  if (load.kind === 'loading') {
    return (
      <div className="shell shell--wide">
        <div className="head">
          <UserBadge />
          <div className="brand">Edit Route</div>
          <h1>通勤経路の編集</h1>
        </div>
        <div className="body">
          <div className="empty">読み込み中…</div>
        </div>
      </div>
    )
  }
  if (load.kind === 'not_found' || load.kind === 'forbidden' || load.kind === 'error') {
    const msg =
      load.kind === 'not_found'
        ? '該当の経路が見つかりませんでした'
        : load.kind === 'forbidden'
          ? 'この経路を編集する権限がありません'
          : '経路の取得に失敗しました。再読み込みをお試しください'
    return (
      <div className="shell shell--wide">
        <div className="head">
          <UserBadge />
          <div className="brand">Edit Route</div>
          <h1>通勤経路の編集</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">{msg}</div>
          <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
            <Link to="/routes" className="btn btn-ghost">
              一覧に戻る
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // load.kind === 'ok'
  return (
    <div className="shell shell--wide">
      <div className="head">
        <UserBadge />
        <div className="brand">Edit Route</div>
        <h1>通勤経路の編集</h1>
        <p>必要な箇所を変更して「更新する」ボタンを押してください</p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {conflictBanner && (
          <div className="banner is-shown">{conflictBanner}</div>
        )}
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
                  <div className="group group--narrow">
                    <label>
                      種別<span className="req">必須</span>
                    </label>
                    <select
                      aria-label={`区間${idx + 1} 種別`}
                      value={seg.kind}
                      onChange={(e) => {
                        // US-020: 種別変更で現在の路線が新種別と矛盾するならクリア
                        const newKind = e.target.value as LineKind
                        const cur = (linesState.lines ?? []).find(
                          (l) => l.id === seg.lineId,
                        )
                        const patch: Partial<Segment> = { kind: newKind }
                        if (cur && cur.kind !== newKind) patch.lineId = ''
                        updateSegment(idx, patch)
                      }}
                      disabled={submitting}
                    >
                      {KIND_OPTIONS.map((k) => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="group">
                    <label>路線名</label>
                    <select
                      aria-label={`区間${idx + 1} 路線名`}
                      value={seg.lineId}
                      onChange={(e) => {
                        // US-020: 路線変更でその路線の kind を種別に自動セット
                        const newLineId = e.target.value
                        const cur = (linesState.lines ?? []).find(
                          (l) => l.id === newLineId,
                        )
                        const patch: Partial<Segment> = { lineId: newLineId }
                        if (cur) patch.kind = cur.kind
                        updateSegment(idx, patch)
                      }}
                      disabled={submitting}
                    >
                      <option value="">(未選択)</option>
                      {(linesState.lines ?? [])
                        // US-020: 現在の種別に一致する路線のみに絞る
                        .filter((l) => l.kind === seg.kind)
                        .map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
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
            disabled={submitting || !isDirty}
            title={!isDirty ? '変更がありません' : undefined}
          >
            {submitting ? '更新中…' : '更新する'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            disabled={submitting || !isDirty}
            title={!isDirty ? '変更がありません' : '取得時の状態に戻します'}
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
