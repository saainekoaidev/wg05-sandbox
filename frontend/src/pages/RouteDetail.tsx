import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useSession } from '../lib/auth'
import { LINES, type LineKind } from '../lib/lines'

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

const KIND_LABEL: Record<LineKind, string> = {
  train: '電車',
  subway: '地下鉄',
  bus: 'バス',
  other: 'その他',
}

const KIND_TAG_CLASS: Record<LineKind, string> = {
  train: 'tag tag-train',
  subway: 'tag tag-subway',
  bus: 'tag tag-bus',
  other: 'tag tag-other',
}

const LINE_BY_ID = new Map(LINES.map((l) => [l.id, l]))

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; route: ApiRoute }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export function RouteDetail() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const params = useParams<{ id: string }>()
  const id = params.id ?? ''

  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // 認証確定後に詳細を取得
  useEffect(() => {
    if (isPending || !session || !id) return
    let cancelled = false
    async function load() {
      setState({ kind: 'loading' })
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
          setState({ kind: 'forbidden' })
          return
        }
        if (res.status === 404) {
          setState({ kind: 'not_found' })
          return
        }
        if (!res.ok) {
          setState({ kind: 'error' })
          return
        }
        const route = (await res.json()) as ApiRoute
        setState({ kind: 'ok', route })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isPending, session, id, navigate])

  const totalFare = useMemo(() => {
    if (state.kind !== 'ok') return 0
    return state.route.segments.reduce((acc, s) => acc + s.fare, 0)
  }, [state])

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  async function handleDelete() {
    if (state.kind !== 'ok') return
    // 設計書 §6.1 / §4 の文言を踏襲
    if (!window.confirm('この経路を削除しますか?')) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(
        `http://localhost:3000/api/routes/${state.route.id}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      )
      if (res.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (res.status === 403) {
        setDeleteError('この経路を削除する権限がありません')
        return
      }
      if (res.status === 404) {
        setDeleteError(
          '該当の経路が見つかりませんでした (既に削除されている可能性があります)',
        )
        return
      }
      if (!res.ok) {
        setDeleteError('経路の削除に失敗しました。再度お試しください')
        return
      }
      // 設計書 §7: 削除完了メッセージは画面遷移後にバナー表示する (state 経由)
      navigate('/routes', {
        replace: true,
        state: { notice: '経路を削除しました' },
      })
    } catch {
      setDeleteError('経路の削除に失敗しました。再度お試しください')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="shell shell--wide">
      <div className="head">
        <div className="brand">Route Detail</div>
        <h1>経路詳細</h1>
        <p>登録済み経路の詳細情報を確認できます</p>
      </div>

      <div className="body">
        {state.kind === 'loading' && <div className="empty">読み込み中…</div>}

        {state.kind === 'not_found' && (
          <>
            <div className="banner is-shown">
              該当の経路が見つかりませんでした
            </div>
            <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
              <Link to="/routes" className="btn btn-ghost">
                一覧に戻る
              </Link>
            </div>
          </>
        )}

        {state.kind === 'forbidden' && (
          <>
            <div className="banner is-shown">
              この経路を表示する権限がありません
            </div>
            <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
              <Link to="/routes" className="btn btn-ghost">
                一覧に戻る
              </Link>
            </div>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <div className="banner is-shown">
              経路の取得に失敗しました。再読み込みをお試しください
            </div>
            <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
              <Link to="/routes" className="btn btn-ghost">
                一覧に戻る
              </Link>
            </div>
          </>
        )}

        {state.kind === 'ok' && (
          <>
            {deleteError && <div className="banner is-shown">{deleteError}</div>}

            <div className="detail">
              <div className="detail-row">
                <div className="label">経路名</div>
                <div className="value">{state.route.name || '(無題)'}</div>
              </div>
              <div className="detail-row">
                <div className="label">出発駅</div>
                <div className="value">{state.route.fromStation}</div>
              </div>
              <div className="detail-row">
                <div className="label">到着駅</div>
                <div className="value">{state.route.toStation}</div>
              </div>
              <div className="detail-row">
                <div className="label">区間数</div>
                <div className="value">{state.route.segments.length}</div>
              </div>
              <div className="detail-row">
                <div className="label">合計運賃</div>
                <div className="value">¥{totalFare.toLocaleString()}</div>
              </div>
              <div className="detail-row">
                <div className="label">登録日時</div>
                <div className="value">
                  {formatDateTime(state.route.createdAt)}
                </div>
              </div>
              <div className="detail-row">
                <div className="label">更新日時</div>
                <div className="value">
                  {formatDateTime(state.route.updatedAt)}
                </div>
              </div>
            </div>

            <div className="section-divider">
              <span>Segments</span>
            </div>

            <div className="segment-list">
              {state.route.segments.map((seg) => {
                const line = seg.lineId ? LINE_BY_ID.get(seg.lineId) : undefined
                return (
                  <div className="seg-item" key={seg.id}>
                    <div className="seg-no">
                      {String(seg.orderIndex).padStart(2, '0')}
                    </div>
                    <div className="seg-body">
                      <div className="seg-line-row">
                        <span className={KIND_TAG_CLASS[seg.kind]}>
                          {KIND_LABEL[seg.kind]}
                        </span>
                        {line && <span className="seg-line">{line.name}</span>}
                      </div>
                      <div className="seg-flow">
                        {seg.fromStation} → {seg.toStation}
                      </div>
                    </div>
                    <div className="seg-fare">¥{seg.fare.toLocaleString()}</div>
                  </div>
                )
              })}
            </div>

            <div className="actions">
              {/*
               * 編集画面 (US-006) は別 US で実装予定のため disabled + title で明示。
               * 削除は本 US-005 内で実装し、確認ダイアログ + DELETE → 一覧へ navigate state 経由でバナー表示。
               */}
              <button
                type="button"
                className="btn btn-primary"
                disabled
                title="編集画面は US-006 で実装予定です"
              >
                編集
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? '削除中…' : '削除'}
              </button>
              <Link to="/routes" className="btn btn-ghost">
                一覧に戻る
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
