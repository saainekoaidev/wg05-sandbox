import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { useSession } from '../lib/auth'
import type { LineKind } from '../lib/lines'
import { useAdminOperators, type ApiAdminOperator } from '../lib/operators'

const KIND_LABEL: Record<LineKind, string> = {
  train: '電車',
  subway: '地下鉄',
  bus: 'バス',
  other: 'その他',
}

type ApiUser = {
  id: string
  email: string
  name: string
  postalCode: string | null
  role: 'user' | 'admin'
}

/** US-049 / ADR 0019: 運営会社マスタ管理画面。 */
export function AdminOperators() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  const initialNotice =
    typeof (location.state as { notice?: unknown } | null)?.notice === 'string'
      ? (location.state as { notice: string }).notice
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

  const opsState = useAdminOperators({ enabled: me?.role === 'admin' })

  const [banner, setBanner] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(op: ApiAdminOperator) {
    if (deletingId) return
    if (
      !window.confirm(
        `運営会社「${op.name}」を削除しますか?\n参照中の路線・駅がある場合は削除できません。`,
      )
    ) {
      return
    }
    setDeletingId(op.id)
    setBanner(null)
    setNotice(null)
    try {
      const res = await fetch(`http://localhost:3000/api/admin/operators/${op.id}`, {
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
        setBanner('該当の運営会社が見つかりませんでした')
        opsState.reload()
        return
      }
      if (res.status === 409) {
        const body = (await res.json()) as { lineCount: number; stationCount: number }
        setBanner(
          `この運営会社は路線 ${body.lineCount} 件 / 駅 ${body.stationCount} 件で参照されているため削除できません`,
        )
        return
      }
      if (!res.ok) {
        setBanner('運営会社の削除に失敗しました')
        return
      }
      setNotice('運営会社を削除しました')
      opsState.reload()
    } catch {
      setBanner('運営会社の削除に失敗しました')
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
          <h1>運営会社マスタ管理</h1>
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
          <h1>運営会社マスタ管理</h1>
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
          <h1>運営会社マスタ管理</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">
            このページを表示するには管理者権限が必要です
          </div>
          <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
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
            <div className="brand">Admin / Operators</div>
            <h1>運営会社マスタ管理</h1>
            <p>運営会社を確認・追加・編集・削除できます (管理者専用)</p>
          </div>
          <div>
            <Link to="/admin/operators/new" className="btn btn-primary btn-sm">
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
        {opsState.error && <div className="banner is-shown">{opsState.error}</div>}

        {opsState.loading && !opsState.operators && (
          <div className="empty">読み込み中…</div>
        )}

        {opsState.operators && opsState.operators.length === 0 && (
          <div className="empty">
            <p>運営会社マスタは現在空です。</p>
            <p style={{ marginTop: 12 }}>
              <Link to="/admin/operators/new" className="btn btn-primary btn-sm">
                + 新規作成
              </Link>
            </p>
          </div>
        )}

        {opsState.operators && opsState.operators.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名称</th>
                  <th>別称 (aliases)</th>
                  <th>種別</th>
                  <th className="col-num">路線</th>
                  <th className="col-num">駅</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {opsState.operators.map((op) => (
                  <tr key={op.id}>
                    <td>
                      <code>{op.id}</code>
                    </td>
                    <td>{op.name}</td>
                    <td>{op.aliases.length > 0 ? op.aliases.join(', ') : '—'}</td>
                    <td>
                      {op.kinds.length > 0
                        ? op.kinds.map((k) => KIND_LABEL[k]).join(', ')
                        : '—'}
                    </td>
                    <td className="col-num">{op.lineCount}</td>
                    <td className="col-num">{op.stationCount}</td>
                    <td>
                      <div className="col-actions">
                        <Link
                          to={`/admin/operators/${op.id}/edit`}
                          className="btn btn-secondary btn-sm"
                          aria-label={`運営会社「${op.name}」を編集`}
                        >
                          編集
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={
                            deletingId === op.id ||
                            op.lineCount > 0 ||
                            op.stationCount > 0
                          }
                          title={
                            op.lineCount > 0 || op.stationCount > 0
                              ? `路線 ${op.lineCount} 件 / 駅 ${op.stationCount} 件で参照中のため削除できません`
                              : undefined
                          }
                          onClick={() => handleDelete(op)}
                          aria-label={`運営会社「${op.name}」を削除`}
                        >
                          {deletingId === op.id ? '削除中…' : '削除'}
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

      <div className="foot">
        <Link to="/account">アカウント設定</Link>
      </div>
    </div>
  )
}
