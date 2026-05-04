import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { useLines, type LineKind } from '../lib/lines'
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
  /** US-033: 路線ごとに code (駅番号) を持つ */
  lines: { id: string; name: string; kind: LineKind; code: string }[]
}

const KIND_TAG_CLASS: Record<LineKind, string> = {
  train: 'tag tag-train',
  subway: 'tag tag-subway',
  bus: 'tag tag-bus',
  other: 'tag tag-other',
}

// US-034: フィルタ保存キー。sessionStorage は新規/編集画面に遷移しても残るが,
// タブを閉じれば消えるためログアウト後に持ち越さない。
const FILTER_KEY = 'admin-stations-filter'
const VALID_KINDS = new Set(['', 'train', 'subway', 'bus', 'other'])

type StoredFilter = { kind: '' | LineKind; line: string }

function readAdminStationsFilter(): StoredFilter {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY)
    if (raw === null) return { kind: '', line: '' }
    const parsed = JSON.parse(raw) as { kind?: unknown; line?: unknown }
    const kind =
      typeof parsed.kind === 'string' && VALID_KINDS.has(parsed.kind)
        ? (parsed.kind as '' | LineKind)
        : ''
    const line = typeof parsed.line === 'string' ? parsed.line : ''
    return { kind, line }
  } catch {
    return { kind: '', line: '' }
  }
}

function writeAdminStationsFilter(f: StoredFilter): void {
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(f))
  } catch {
    // 容量超過等は無視
  }
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

  // US-032: 種別 + 路線フィルタ。US-034: 値は sessionStorage に保存し新規/編集
  // から戻ってきたときに復元する。一覧 fetch は mount 時 useEffect で実行されるため
  // 復元と同時に最新状態が表示される。
  const linesState = useLines({ enabled: isAdmin })
  const initialFilter = useMemo(() => readAdminStationsFilter(), [])
  const [kindFilter, setKindFilter] = useState<'' | LineKind>(
    initialFilter.kind,
  )
  const [lineFilter, setLineFilter] = useState<string>(initialFilter.line)
  useEffect(() => {
    writeAdminStationsFilter({ kind: kindFilter, line: lineFilter })
  }, [kindFilter, lineFilter])

  const filteredStations = useMemo(() => {
    if (!stations) return null
    if (!kindFilter && !lineFilter) return stations
    return stations.filter((s) => {
      if (lineFilter) {
        if (!s.lines.some((l) => l.id === lineFilter)) return false
      }
      if (kindFilter) {
        if (!s.lines.some((l) => l.kind === kindFilter)) return false
      }
      return true
    })
  }, [stations, kindFilter, lineFilter])

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
          <>
            {/* US-032: 種別 + 路線フィルタ (cascade) */}
            <div className="search-row" style={{ marginBottom: 16 }}>
              <div className="group group--narrow">
                <label htmlFor="admin-stns-kind">種別</label>
                <select
                  id="admin-stns-kind"
                  value={kindFilter}
                  onChange={(e) => {
                    const newKind = e.target.value as '' | LineKind
                    setKindFilter(newKind)
                    if (newKind && lineFilter) {
                      const cur = (linesState.lines ?? []).find(
                        (l) => l.id === lineFilter,
                      )
                      if (cur && cur.kind !== newKind) setLineFilter('')
                    }
                  }}
                >
                  <option value="">すべて</option>
                  <option value="train">電車</option>
                  <option value="subway">地下鉄</option>
                  <option value="bus">バス</option>
                  <option value="other">その他</option>
                </select>
              </div>
              <div className="group">
                <label htmlFor="admin-stns-line">路線</label>
                <select
                  id="admin-stns-line"
                  value={lineFilter}
                  onChange={(e) => {
                    const newLine = e.target.value
                    setLineFilter(newLine)
                    if (newLine) {
                      const cur = (linesState.lines ?? []).find(
                        (l) => l.id === newLine,
                      )
                      if (cur) setKindFilter(cur.kind)
                    }
                  }}
                >
                  <option value="">すべての路線</option>
                  {(linesState.lines ?? [])
                    .filter((l) => !kindFilter || l.kind === kindFilter)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="hint" style={{ alignSelf: 'center' }}>
                {filteredStations?.length ?? 0} / {stations.length} 件
              </div>
            </div>

            {filteredStations && filteredStations.length === 0 && (
              <div className="empty">
                該当する駅がありません。フィルタを変更してください。
              </div>
            )}

            {filteredStations && filteredStations.length > 0 && (
              <div className="table-wrap">
                <table className="admin-stations-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>駅名</th>
                      <th>よみがな</th>
                      <th>接続路線 / 駅番号</th>
                      <th className="col-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStations.map((station) => (
                      <tr key={station.id}>
                        <td className="admin-stn-id">
                          <code>{station.id}</code>
                        </td>
                        <td className="admin-stn-name">{station.name}</td>
                        <td className="admin-stn-kana">{station.kana}</td>
                        <td className="admin-stn-lines">
                          {station.lines.length === 0 ? (
                            <span className="hint">未接続</span>
                          ) : (
                            <div className="tag-row admin-stn-lines__row">
                              {station.lines.map((line) => (
                                <span
                                  key={line.id}
                                  className={KIND_TAG_CLASS[line.kind]}
                                  title={`${line.name}${line.code ? ` (駅番号: ${line.code})` : ''}`}
                                >
                                  {line.name}
                                  {line.code && (
                                    <span style={{ marginLeft: 4, opacity: 0.85 }}>
                                      [{line.code}]
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
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
          </>
        )}
      </div>

      {/* US-029: 「経路一覧へ」リンクは動線重複のため削除 (アカウント設定経由で戻れる) */}
      <div className="foot">
        <Link to="/account">アカウント設定</Link>
      </div>
    </div>
  )
}
