import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { useLines, type ApiLine, type LineKind } from '../lib/lines'
import { useSession } from '../lib/auth'

type ApiUser = {
  id: string
  email: string
  name: string
  postalCode: string | null
  role: 'user' | 'admin'
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

export function AdminLines() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  // 新規/編集画面 (US-025) からの通知バナーを 1 度だけ拾う。
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

  const linesState = useLines({ enabled: me?.role === 'admin' })

  const [banner, setBanner] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(line: ApiLine) {
    if (deletingId) return
    if (
      !window.confirm(
        `路線「${line.name}」を削除しますか?\n参照されている経路がある場合は削除できません。`,
      )
    ) {
      return
    }
    setDeletingId(line.id)
    setBanner(null)
    setNotice(null)
    try {
      const res = await fetch(`http://localhost:3000/api/lines/${line.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (res.status === 403) {
        setBanner('管理者権限が必要です')
        return
      }
      if (res.status === 404) {
        setBanner('該当の路線が見つかりませんでした (既に削除されている可能性があります)')
        linesState.reload()
        return
      }
      if (res.status === 409) {
        const body = (await res.json()) as { referenceCount: number }
        setBanner(
          `この路線は ${body.referenceCount} 件の経路で使用中のため削除できません。先に対象経路を編集してください`,
        )
        return
      }
      if (!res.ok) {
        setBanner('路線の削除に失敗しました。再度お試しください')
        return
      }
      setNotice('路線を削除しました')
      linesState.reload()
    } catch {
      setBanner('路線の削除に失敗しました。再度お試しください')
    } finally {
      setDeletingId(null)
    }
  }

  const sortedKinds = useMemo<LineKind[]>(
    () => ['train', 'subway', 'bus', 'other'],
    [],
  )

  // US-031: 種別フィルタ
  const [kindFilter, setKindFilter] = useState<'' | LineKind>('')
  const filteredLines = useMemo(() => {
    if (!linesState.lines) return null
    if (!kindFilter) return linesState.lines
    return linesState.lines.filter((l) => l.kind === kindFilter)
  }, [linesState.lines, kindFilter])

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  if (meLoading) {
    return (
      <div className="shell shell--wide">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>路線マスタ管理</h1>
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
          <h1>路線マスタ管理</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">{meError}</div>
        </div>
      </div>
    )
  }

  if (!me || me.role !== 'admin') {
    return (
      <div className="shell shell--wide">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>路線マスタ管理</h1>
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
            <div className="brand">Admin / Lines</div>
            <h1>路線マスタ管理</h1>
            <p>登録済みの路線を確認・追加・編集・削除できます (管理者専用)</p>
          </div>
          <div>
            <Link to="/admin/lines/new" className="btn btn-primary btn-sm">
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
        {linesState.error && (
          <div className="banner is-shown">{linesState.error}</div>
        )}

        {linesState.loading && !linesState.lines && (
          <div className="empty">読み込み中…</div>
        )}

        {linesState.lines && linesState.lines.length === 0 && (
          <div className="empty">
            <p>路線マスタは現在空です。</p>
            <p style={{ marginTop: 12 }}>
              <Link to="/admin/lines/new" className="btn btn-primary btn-sm">
                + 新規作成
              </Link>
            </p>
          </div>
        )}

        {linesState.lines && linesState.lines.length > 0 && (
          <>
            {/* US-031: 種別フィルタ */}
            <div className="search-row" style={{ marginBottom: 16 }}>
              <div className="group group--narrow">
                <label htmlFor="admin-lines-kind">種別で絞り込み</label>
                <select
                  id="admin-lines-kind"
                  value={kindFilter}
                  onChange={(e) =>
                    setKindFilter(e.target.value as '' | LineKind)
                  }
                >
                  <option value="">すべて</option>
                  <option value="train">電車</option>
                  <option value="subway">地下鉄</option>
                  <option value="bus">バス</option>
                  <option value="other">その他</option>
                </select>
              </div>
              <div className="hint" style={{ alignSelf: 'center' }}>
                {filteredLines?.length ?? 0} / {linesState.lines.length} 件
              </div>
            </div>

            {filteredLines && filteredLines.length === 0 && (
              <div className="empty">
                該当する路線がありません。フィルタを変更してください。
              </div>
            )}

            {filteredLines && filteredLines.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>路線名</th>
                      <th>種別</th>
                      <th>運営会社</th>
                      <th className="col-num">参照経路</th>
                      <th className="col-num">接続駅</th>
                      <th className="col-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedKinds.flatMap((k) =>
                      filteredLines
                        .filter((l) => l.kind === k)
                        .map((line) => (
                      <tr key={line.id}>
                        <td>
                          <code>{line.id}</code>
                        </td>
                        <td>{line.name}</td>
                        <td>
                          <span className={KIND_TAG_CLASS[line.kind]}>
                            {KIND_LABEL[line.kind]}
                          </span>
                        </td>
                        <td>{line.operator ?? '—'}</td>
                        <td className="col-num">{line.routeSegmentCount}</td>
                        <td className="col-num">{line.stationCount}</td>
                        <td>
                          <div className="col-actions">
                            <Link
                              to={`/admin/lines/${line.id}/edit`}
                              className="btn btn-secondary btn-sm"
                              aria-label={`路線「${line.name}」を編集`}
                            >
                              編集
                            </Link>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={
                                deletingId === line.id ||
                                line.routeSegmentCount > 0
                              }
                              title={
                                line.routeSegmentCount > 0
                                  ? `経路で ${line.routeSegmentCount} 件参照中のため削除できません`
                                  : undefined
                              }
                              onClick={() => handleDelete(line)}
                              aria-label={`路線「${line.name}」を削除`}
                            >
                              {deletingId === line.id ? '削除中…' : '削除'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )),
                )}
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
