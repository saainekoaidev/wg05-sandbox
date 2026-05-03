import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { signOut, useSession } from '../lib/auth'
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

type ApiResponse = { routes: ApiRoute[] }

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

const KIND_ORDER: ReadonlyArray<LineKind> = ['train', 'subway', 'bus', 'other']

const LINE_BY_ID = new Map(LINES.map((l) => [l.id, l]))

function uniqueKinds(segments: ApiSegment[]): LineKind[] {
  const set = new Set<LineKind>(segments.map((s) => s.kind))
  return KIND_ORDER.filter((k) => set.has(k))
}

function uniqueLineNames(segments: ApiSegment[]): string {
  const names: string[] = []
  for (const s of segments) {
    if (!s.lineId) continue
    const line = LINE_BY_ID.get(s.lineId)
    if (line && !names.includes(line.name)) names.push(line.name)
  }
  return names.join(' / ')
}

function totalFare(segments: ApiSegment[]): number {
  return segments.reduce((acc, s) => acc + s.fare, 0)
}

export function RouteList() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  // 削除完了などの通知バナーは前画面 (RouteDetail) からの navigate state で受け取る。
  // 1度きりの表示にするため初期値だけ拾い、画面内アクションでは更新しない。
  const initialNotice =
    typeof (location.state as { notice?: unknown } | null)?.notice === 'string'
      ? ((location.state as { notice: string }).notice)
      : null
  const [notice, setNotice] = useState<string | null>(initialNotice)
  const [routes, setRoutes] = useState<ApiRoute[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 認証確定後に一度だけ /api/routes を取得する。
  useEffect(() => {
    if (isPending || !session) return
    let cancelled = false
    async function fetchRoutes() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('http://localhost:3000/api/routes', {
          credentials: 'include',
        })
        if (cancelled) return
        if (res.status === 401) {
          navigate('/login', { replace: true })
          return
        }
        if (!res.ok) {
          setError('経路一覧の取得に失敗しました。再読み込みをお試しください')
          setRoutes([])
          return
        }
        const body = (await res.json()) as ApiResponse
        setRoutes(body.routes)
      } catch {
        if (!cancelled) {
          setError('経路一覧の取得に失敗しました。再読み込みをお試しください')
          setRoutes([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchRoutes()
    return () => {
      cancelled = true
    }
  }, [isPending, session, navigate])

  // 派生データ (テーブル表示用)
  const derived = useMemo(() => {
    if (!routes) return null
    return routes.map((r) => ({
      route: r,
      displayName: r.name || '(無題)',
      kinds: uniqueKinds(r.segments),
      lines: uniqueLineNames(r.segments),
      total: totalFare(r.segments),
    }))
  }, [routes])

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  async function handleLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // 一覧から経路を削除する。設計書 §6.1 / §4 の文言を踏襲。
  async function handleDelete(routeId: string) {
    if (deletingId) return
    if (!window.confirm('この経路を削除しますか?')) return
    setDeletingId(routeId)
    setDeleteError(null)
    try {
      const res = await fetch(`http://localhost:3000/api/routes/${routeId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (res.status === 403) {
        setDeleteError('この経路を削除する権限がありません')
        return
      }
      if (res.status === 404) {
        // 既に削除されている可能性: ローカル状態からも除去して整合させる
        setRoutes((prev) => (prev ? prev.filter((r) => r.id !== routeId) : prev))
        setDeleteError(
          '該当の経路が見つかりませんでした (既に削除されている可能性があります)',
        )
        return
      }
      if (!res.ok) {
        setDeleteError('経路の削除に失敗しました。再度お試しください')
        return
      }
      // 成功: ローカル状態から除去 + 通知バナー表示
      setRoutes((prev) => (prev ? prev.filter((r) => r.id !== routeId) : prev))
      setNotice('経路を削除しました')
    } catch {
      setDeleteError('経路の削除に失敗しました。再度お試しください')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="shell shell--wide">
      <div className="head">
        <div className="head-row">
          <div>
            <div className="brand">Routes</div>
            <h1>通勤経路一覧</h1>
            <p>登録済みの通勤経路を確認 / 編集 / 削除できます</p>
          </div>
          <div>
            <Link to="/routes/new" className="btn btn-primary btn-sm">
              + 新規登録
            </Link>
          </div>
        </div>
      </div>

      <div className="body">
        {notice && (
          <div className="banner banner--success is-shown" role="status">
            {notice}{' '}
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="通知を閉じる"
              style={{
                marginLeft: 8,
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 'inherit',
              }}
            >
              ×
            </button>
          </div>
        )}

        {loading && <div className="empty">読み込み中…</div>}

        {error && <div className="banner is-shown">{error}</div>}

        {deleteError && (
          <div className="banner is-shown" role="alert">
            {deleteError}{' '}
            <button
              type="button"
              onClick={() => setDeleteError(null)}
              aria-label="エラーを閉じる"
              style={{
                marginLeft: 8,
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 'inherit',
              }}
            >
              ×
            </button>
          </div>
        )}

        {!loading && !error && derived && derived.length === 0 && (
          <div className="empty">
            <p>まだ通勤経路が登録されていません。</p>
            <p style={{ marginTop: 12 }}>
              <Link to="/routes/new" className="btn btn-primary btn-sm">
                + 新規登録
              </Link>
            </p>
          </div>
        )}

        {!loading && derived && derived.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-num">#</th>
                  <th>経路名</th>
                  <th>種別 / 路線</th>
                  <th>出発 → 到着</th>
                  <th className="col-num">区間</th>
                  <th className="col-num">合計運賃</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {derived.map((d, i) => (
                  <tr key={d.route.id}>
                    <td className="col-num">{i + 1}</td>
                    <td>{d.displayName}</td>
                    <td>
                      <div className="cell-stack">
                        <div className="tag-row">
                          {d.kinds.map((k) => (
                            <span key={k} className={KIND_TAG_CLASS[k]}>
                              {KIND_LABEL[k]}
                            </span>
                          ))}
                        </div>
                        {d.lines && (
                          <div className="line-list">{d.lines}</div>
                        )}
                      </div>
                    </td>
                    <td>
                      {d.route.fromStation} → {d.route.toStation}
                    </td>
                    <td className="col-num">{d.route.segments.length}</td>
                    <td className="col-num">¥{d.total.toLocaleString()}</td>
                    <td>
                      <div className="col-actions">
                        <Link
                          to={`/routes/${d.route.id}`}
                          className="btn btn-secondary btn-sm"
                          aria-label={`経路「${d.displayName}」の詳細`}
                        >
                          詳細
                        </Link>
                        <Link
                          to={`/routes/${d.route.id}/edit`}
                          className="btn btn-secondary btn-sm"
                          aria-label={`経路「${d.displayName}」を編集`}
                        >
                          編集
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={deletingId === d.route.id}
                          aria-label={`経路「${d.displayName}」を削除`}
                          onClick={() => handleDelete(d.route.id)}
                        >
                          {deletingId === d.route.id ? '削除中…' : '削除'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="foot foot--split">
        <Link to="/account" aria-label="アカウント設定を開く">
          ユーザー: {session.user.email}
        </Link>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            handleLogout()
          }}
        >
          ログアウト
        </a>
      </div>
    </div>
  )
}
