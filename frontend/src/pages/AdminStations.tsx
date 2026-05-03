import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { type LineKind } from '../lib/lines'
import { useSession } from '../lib/auth'

type ApiUser = {
  id: string
  email: string
  name: string
  postalCode: string | null
  role: 'user' | 'admin'
}

type AdminStation = {
  id: string
  name: string
  kana: string
  lineIds: string[]
  lines: { id: string; name: string; kind: LineKind }[]
}

const KIND_TAG_CLASS: Record<LineKind, string> = {
  train: 'tag tag-train',
  subway: 'tag tag-subway',
  bus: 'tag tag-bus',
  other: 'tag tag-other',
}

export function AdminStations() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  const initialNotice =
    typeof (location.state as { notice?: unknown } | null)?.notice === 'string'
      ? ((location.state as { notice: string }).notice)
      : null
  const [notice, setNotice] = useState<string | null>(initialNotice)

  const [me, setMe] = useState<ApiUser | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [meError, setMeError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending || !session) return
    let cancelled = false
    async function load() {
      setMeLoading(true)
      setMeError(null)
      try {
        const res = await fetch('http://localhost:3000/api/users/me', {
          credentials: 'include',
        })
        if (cancelled) return
        if (res.status === 401) {
          navigate('/login', { replace: true })
          return
        }
        if (!res.ok) {
          setMeError('ユーザー情報の取得に失敗しました')
          return
        }
        setMe((await res.json()) as ApiUser)
      } catch {
        if (!cancelled) setMeError('ユーザー情報の取得に失敗しました')
      } finally {
        if (!cancelled) setMeLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isPending, session, navigate])

  const isAdmin = me?.role === 'admin'

  const [stations, setStations] = useState<AdminStation[] | null>(null)
  const [stationsLoading, setStationsLoading] = useState(false)
  const [stationsError, setStationsError] = useState<string | null>(null)
  const [stationsTick, setStationsTick] = useState(0)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function load() {
      setStationsLoading(true)
      setStationsError(null)
      try {
        const res = await fetch('http://localhost:3000/api/admin/stations', {
          credentials: 'include',
        })
        if (cancelled) return
        if (res.status === 401) {
          navigate('/login', { replace: true })
          return
        }
        if (!res.ok) {
          setStationsError('駅一覧の取得に失敗しました')
          setStations([])
          return
        }
        const body = (await res.json()) as { stations: AdminStation[] }
        setStations(body.stations)
      } catch {
        if (!cancelled) {
          setStationsError('駅一覧の取得に失敗しました')
          setStations([])
        }
      } finally {
        if (!cancelled) setStationsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isAdmin, stationsTick, navigate])

  const reloadStations = () => setStationsTick((t) => t + 1)

  const [banner, setBanner] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(station: AdminStation) {
    if (deletingId) return
    if (
      !window.confirm(
        `駅「${station.name}」を削除しますか?\n` +
          '既存経路の駅名表示は文字列のため影響を受けません。',
      )
    ) {
      return
    }
    setDeletingId(station.id)
    setBanner(null)
    setNotice(null)
    try {
      const res = await fetch(
        `http://localhost:3000/api/admin/stations/${station.id}`,
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
        setBanner('管理者権限が必要です')
        return
      }
      if (res.status === 404) {
        setBanner('該当の駅が見つかりませんでした (既に削除されている可能性があります)')
        reloadStations()
        return
      }
      if (!res.ok) {
        setBanner('駅の削除に失敗しました。再度お試しください')
        return
      }
      setNotice('駅を削除しました')
      reloadStations()
    } catch {
      setBanner('駅の削除に失敗しました。再度お試しください')
    } finally {
      setDeletingId(null)
    }
  }

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  if (meLoading) {
    return (
      <div className="shell shell--wide">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>駅マスタ管理</h1>
        </div>
        <div className="body">
          <div className="empty">読み込み中…</div>
        </div>
      </div>
    )
  }

  if (meError) {
    return (
      <div className="shell shell--wide">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>駅マスタ管理</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">{meError}</div>
        </div>
      </div>
    )
  }

  if (!me || !isAdmin) {
    return (
      <div className="shell shell--wide">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>駅マスタ管理</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">
            このページを表示するには管理者権限が必要です
          </div>
          <div
            className="actions actions--no-divider"
            style={{ marginTop: 24 }}
          >
            <Link to="/routes" className="btn btn-ghost">
              経路一覧に戻る
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shell shell--wide">
      <div className="head">
        <UserBadge />
        <div className="head-row">
          <div>
            <div className="brand">Admin / Stations</div>
            <h1>駅マスタ管理</h1>
            <p>登録済みの駅と接続路線を管理します (管理者専用)</p>
          </div>
          <div>
            <Link to="/admin/stations/new" className="btn btn-primary btn-sm">
              + 新規作成
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
        {banner && <div className="banner is-shown">{banner}</div>}
        {stationsError && <div className="banner is-shown">{stationsError}</div>}

        {stationsLoading && !stations && (
          <div className="empty">読み込み中…</div>
        )}

        {stations && stations.length === 0 && (
          <div className="empty">
            <p>駅マスタは現在空です。</p>
            <p style={{ marginTop: 12 }}>
              <Link to="/admin/stations/new" className="btn btn-primary btn-sm">
                + 新規作成
              </Link>
            </p>
          </div>
        )}

        {stations && stations.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>駅名</th>
                  <th>よみがな</th>
                  <th>接続路線</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((station) => (
                  <tr key={station.id}>
                    <td>
                      <code>{station.id}</code>
                    </td>
                    <td>{station.name}</td>
                    <td>{station.kana}</td>
                    <td>
                      <div className="tag-row">
                        {station.lines.length === 0 && (
                          <span className="hint">未接続</span>
                        )}
                        {station.lines.map((line) => (
                          <span key={line.id} className={KIND_TAG_CLASS[line.kind]}>
                            {line.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="col-actions">
                        <Link
                          to={`/admin/stations/${station.id}/edit`}
                          className="btn btn-secondary btn-sm"
                          aria-label={`駅「${station.name}」を編集`}
                        >
                          編集
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={deletingId === station.id}
                          onClick={() => handleDelete(station)}
                          aria-label={`駅「${station.name}」を削除`}
                        >
                          {deletingId === station.id ? '削除中…' : '削除'}
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

      {/* US-029: 「経路一覧へ」リンクは動線重複のため削除 (アカウント設定経由で戻れる) */}
      <div className="foot">
        <Link to="/account">アカウント設定</Link>
      </div>
    </div>
  )
}
