import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
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

type AdminStation = {
  id: string
  name: string
  kana: string
  lineIds: string[]
  lines: { id: string; name: string; kind: LineKind }[]
}

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; station: AdminStation }

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

const ID_RE = /^[A-Za-z0-9._-]+$/

export function AdminStations() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

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

  // role 確定 + admin 時のみ /api/lines + /api/admin/stations を取得
  const enabled = me?.role === 'admin'
  const linesState = useLines({ enabled })

  const [stations, setStations] = useState<AdminStation[] | null>(null)
  const [stationsLoading, setStationsLoading] = useState(false)
  const [stationsError, setStationsError] = useState<string | null>(null)
  const [stationsTick, setStationsTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
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
  }, [enabled, stationsTick, navigate])

  const reloadStations = () => setStationsTick((t) => t + 1)

  // フォーム状態
  const [mode, setMode] = useState<FormMode>({ kind: 'closed' })
  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formKana, setFormKana] = useState('')
  const [formLineIds, setFormLineIds] = useState<Set<string>>(new Set())
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [banner, setBanner] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function openCreate() {
    setMode({ kind: 'create' })
    setFormId('')
    setFormName('')
    setFormKana('')
    setFormLineIds(new Set())
    setFormError(null)
  }

  function openEdit(station: AdminStation) {
    setMode({ kind: 'edit', station })
    setFormId(station.id)
    setFormName(station.name)
    setFormKana(station.kana)
    setFormLineIds(new Set(station.lineIds))
    setFormError(null)
  }

  function closeForm() {
    setMode({ kind: 'closed' })
    setFormError(null)
  }

  function toggleLine(lineId: string) {
    setFormLineIds((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (mode.kind === 'closed') return

    if (mode.kind === 'create' && formId) {
      if (!ID_RE.test(formId))
        return setFormError(
          'IDは半角英数字 + ハイフン/ドット/アンダースコアのみ使用できます',
        )
      if (formId.length > 80)
        return setFormError('IDは80文字以内で入力してください')
    }
    if (!formName) return setFormError('駅名を入力してください')
    if (formName.length > 50)
      return setFormError('駅名は50文字以内で入力してください')
    if (!formKana) return setFormError('よみがなを入力してください')
    if (formKana.length > 80)
      return setFormError('よみがなは80文字以内で入力してください')

    setSubmitting(true)
    try {
      const url =
        mode.kind === 'create'
          ? 'http://localhost:3000/api/admin/stations'
          : `http://localhost:3000/api/admin/stations/${mode.station.id}`
      const method = mode.kind === 'create' ? 'POST' : 'PUT'
      const body: Record<string, unknown> = {
        name: formName,
        kana: formKana,
        lineIds: Array.from(formLineIds),
      }
      if (mode.kind === 'create' && formId) body.id = formId

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (res.status === 403) {
        setFormError('管理者権限が必要です')
        return
      }
      if (res.status === 400) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        if (errBody.error === 'unknown_line') {
          setFormError('紐付けに含まれる路線が存在しません (削除済み?)')
        } else {
          setFormError('入力内容に誤りがあります')
        }
        return
      }
      if (res.status === 404) {
        setFormError('編集対象の駅が見つかりませんでした (削除済み?)')
        return
      }
      if (res.status === 409) {
        setFormError('同じIDの駅が既に登録されています')
        return
      }
      if (!res.ok) {
        setFormError('保存に失敗しました。再度お試しください')
        return
      }
      closeForm()
      setNotice(mode.kind === 'create' ? '駅を作成しました' : '駅を更新しました')
      reloadStations()
    } catch {
      setFormError('保存に失敗しました。再度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

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

  if (!me || me.role !== 'admin') {
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
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openCreate}
            >
              + 新規作成
            </button>
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
        {linesState.error && (
          <div className="banner is-shown">{linesState.error}</div>
        )}

        {(stationsLoading || linesState.loading) && !stations && (
          <div className="empty">読み込み中…</div>
        )}

        {stations && stations.length === 0 && (
          <div className="empty">
            <p>駅マスタは現在空です。</p>
            <p style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openCreate}
              >
                + 新規作成
              </button>
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
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEdit(station)}
                          aria-label={`駅「${station.name}」を編集`}
                        >
                          編集
                        </button>
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

        {mode.kind !== 'closed' && (
          <>
            <div className="divider">
              <span>{mode.kind === 'create' ? 'New Station' : 'Edit Station'}</span>
            </div>
            <form onSubmit={handleSubmit} noValidate>
              {formError && <div className="banner is-shown">{formError}</div>}

              {mode.kind === 'edit' && (
                <div className="hint" style={{ marginBottom: 12 }}>
                  ※ 駅名を変更しても、既存経路に登録されている駅名文字列は
                  自動更新されません (ADR 0006 §5)
                </div>
              )}

              {mode.kind === 'create' && (
                <div className="group">
                  <label htmlFor="form-id">ID</label>
                  <input
                    type="text"
                    id="form-id"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    disabled={submitting}
                    placeholder="例: stn-nagoya (空欄なら自動採番)"
                    maxLength={80}
                  />
                  <div className="hint">
                    任意 (空欄で cuid 自動採番)。半角英数字 + ハイフン/ドット/アンダースコア。
                    作成後の変更は不可。
                  </div>
                </div>
              )}

              {mode.kind === 'edit' && (
                <div className="group">
                  <label htmlFor="form-id-readonly">ID</label>
                  <input
                    type="text"
                    id="form-id-readonly"
                    value={formId}
                    disabled
                    readOnly
                  />
                </div>
              )}

              <div className="group">
                <label htmlFor="form-name">
                  駅名<span className="req">必須</span>
                </label>
                <input
                  type="text"
                  id="form-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  disabled={submitting}
                  maxLength={50}
                />
              </div>

              <div className="group">
                <label htmlFor="form-kana">
                  よみがな<span className="req">必須</span>
                </label>
                <input
                  type="text"
                  id="form-kana"
                  value={formKana}
                  onChange={(e) => setFormKana(e.target.value)}
                  disabled={submitting}
                  maxLength={80}
                  placeholder="例: なごや"
                />
              </div>

              <div className="group">
                <label>接続路線</label>
                {linesState.lines && linesState.lines.length === 0 && (
                  <div className="hint">
                    路線マスタが空です。先に
                    <Link to="/admin/lines">路線マスタ管理</Link>
                    で路線を登録してください。
                  </div>
                )}
                {linesState.lines && linesState.lines.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      maxHeight: 200,
                      overflow: 'auto',
                      padding: 8,
                      border: '1px solid var(--line)',
                      borderRadius: 4,
                    }}
                    role="group"
                    aria-label="接続路線の選択"
                  >
                    {linesState.lines.map((line: ApiLine) => (
                      <label
                        key={line.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      >
                        <input
                          type="checkbox"
                          checked={formLineIds.has(line.id)}
                          onChange={() => toggleLine(line.id)}
                          disabled={submitting}
                        />
                        <span className={KIND_TAG_CLASS[line.kind]}>
                          {KIND_LABEL[line.kind]}
                        </span>
                        <span>{line.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting
                    ? '保存中…'
                    : mode.kind === 'create'
                    ? '作成する'
                    : '更新する'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeForm}
                  disabled={submitting}
                >
                  キャンセル
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      <div className="foot foot--split">
        <Link to="/account">アカウント設定</Link>
        <Link to="/routes">経路一覧へ</Link>
      </div>
    </div>
  )
}
