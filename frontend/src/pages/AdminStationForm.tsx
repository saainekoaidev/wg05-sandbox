import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { useSession } from '../lib/auth'
import { useLines, type ApiLine, type LineKind } from '../lib/lines'

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

const ID_RE = /^[A-Za-z0-9._-]+$/

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

type Mode = 'create' | 'edit'

interface AdminStationFormProps {
  mode: Mode
}

/**
 * 駅マスタの新規作成 / 編集 専用画面 (US-026)。
 * /admin/stations/new と /admin/stations/:id/edit にマウント。
 */
export function AdminStationForm({ mode }: AdminStationFormProps) {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const params = useParams<{ id: string }>()
  const editId = mode === 'edit' ? (params.id ?? '') : ''

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
  const linesState = useLines({ enabled: isAdmin })

  // 編集モードでは GET /api/admin/stations/:id 単体取得 API は無いので、
  // GET /api/admin/stations 全件取得 + find で対象駅を pre-fill する。
  const [editTargetMissing, setEditTargetMissing] = useState(false)
  const [prefilled, setPrefilled] = useState(false)

  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formKana, setFormKana] = useState('')
  const [formLineIds, setFormLineIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (mode !== 'edit' || prefilled || !isAdmin) return
    let cancelled = false
    async function load() {
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
          setEditTargetMissing(true)
          return
        }
        const body = (await res.json()) as { stations: AdminStation[] }
        const target = body.stations.find((s) => s.id === editId)
        if (!target) {
          setEditTargetMissing(true)
          return
        }
        setFormId(target.id)
        setFormName(target.name)
        setFormKana(target.kana)
        setFormLineIds(new Set(target.lineIds))
        setPrefilled(true)
      } catch {
        if (!cancelled) setEditTargetMissing(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [mode, editId, isAdmin, prefilled, navigate])

  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
    if (mode === 'create' && formId) {
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
        mode === 'create'
          ? 'http://localhost:3000/api/admin/stations'
          : `http://localhost:3000/api/admin/stations/${editId}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const body: Record<string, unknown> = {
        name: formName,
        kana: formKana,
        lineIds: Array.from(formLineIds),
      }
      if (mode === 'create' && formId) body.id = formId

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
      navigate('/admin/stations', {
        replace: true,
        state: {
          notice: mode === 'create' ? '駅を作成しました' : '駅を更新しました',
        },
      })
    } catch {
      setFormError('保存に失敗しました。再度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  if (meLoading) {
    return (
      <div className="shell">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>{mode === 'create' ? '駅の新規作成' : '駅の編集'}</h1>
        </div>
        <div className="body">
          <div className="empty">読み込み中…</div>
        </div>
      </div>
    )
  }

  if (meError) {
    return (
      <div className="shell">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>{mode === 'create' ? '駅の新規作成' : '駅の編集'}</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">{meError}</div>
        </div>
      </div>
    )
  }

  if (!me || me.role !== 'admin') {
    return (
      <div className="shell">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>{mode === 'create' ? '駅の新規作成' : '駅の編集'}</h1>
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

  if (mode === 'edit' && editTargetMissing) {
    return (
      <div className="shell">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>駅の編集</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">該当の駅が見つかりませんでした</div>
          <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
            <Link to="/admin/stations" className="btn btn-ghost">
              駅マスタ管理に戻る
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'edit' && !prefilled) {
    return (
      <div className="shell">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>駅の編集</h1>
        </div>
        <div className="body">
          <div className="empty">読み込み中…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="head">
        <UserBadge />
        <div className="brand">{mode === 'create' ? 'Admin / New Station' : 'Admin / Edit Station'}</div>
        <h1>{mode === 'create' ? '駅の新規作成' : '駅の編集'}</h1>
        <p>
          {mode === 'create'
            ? '駅マスタに新しい駅を登録します'
            : `${formName} の内容を編集します`}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {formError && <div className="banner is-shown">{formError}</div>}

        {mode === 'edit' && (
          <div className="hint" style={{ marginBottom: 12 }}>
            ※ 駅名を変更しても、既存経路に登録されている駅名文字列は
            自動更新されません (ADR 0006 §5)
          </div>
        )}

        {mode === 'create' ? (
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
        ) : (
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
                maxHeight: 240,
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
              : mode === 'create'
              ? '作成する'
              : '更新する'}
          </button>
          <Link to="/admin/stations" className="btn btn-ghost">
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  )
}

export function AdminStationNew() {
  return <AdminStationForm mode="create" />
}

export function AdminStationEdit() {
  return <AdminStationForm mode="edit" />
}
