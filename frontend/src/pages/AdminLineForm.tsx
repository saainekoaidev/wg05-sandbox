import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { useSession } from '../lib/auth'
import {
  KIND_OPTIONS,
  useLines,
  type ApiLine,
  type LineKind,
} from '../lib/lines'

type ApiUser = {
  id: string
  email: string
  name: string
  postalCode: string | null
  role: 'user' | 'admin'
}

const ID_RE = /^[A-Za-z0-9._-]+$/

type Mode = 'create' | 'edit'

interface AdminLineFormProps {
  mode: Mode
}

/**
 * 路線マスタの新規作成 / 編集 専用画面 (US-025)。
 * /admin/lines/new と /admin/lines/:id/edit にマウントされる。
 *
 * - 新規 (create): 入力空のフォームで POST /api/lines → /admin/lines へ navigate
 * - 編集 (edit): id を受け取り 既存路線を pre-fill して PUT /api/lines/:id → /admin/lines へ navigate
 */
export function AdminLineForm({ mode }: AdminLineFormProps) {
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

  const enabled = me?.role === 'admin' && mode === 'edit'
  const linesState = useLines({ enabled })

  // 編集対象路線を pre-fill
  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formKind, setFormKind] = useState<LineKind>('train')
  const [formOperator, setFormOperator] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [editTargetMissing, setEditTargetMissing] = useState(false)

  useEffect(() => {
    if (mode !== 'edit' || prefilled) return
    if (!linesState.lines) return
    const target = linesState.lines.find((l: ApiLine) => l.id === editId)
    if (!target) {
      setEditTargetMissing(true)
      return
    }
    setFormId(target.id)
    setFormName(target.name)
    setFormKind(target.kind)
    setFormOperator(target.operator ?? '')
    setPrefilled(true)
  }, [mode, editId, linesState.lines, prefilled])

  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (mode === 'create') {
      if (!formId) return setFormError('IDを入力してください')
      if (!ID_RE.test(formId))
        return setFormError(
          'IDは半角英数字 + ハイフン/ドット/アンダースコアのみ使用できます',
        )
      if (formId.length > 80)
        return setFormError('IDは80文字以内で入力してください')
    }
    if (!formName) return setFormError('路線名を入力してください')
    if (formName.length > 80)
      return setFormError('路線名は80文字以内で入力してください')
    if (formOperator && formOperator.length > 80)
      return setFormError('運営会社は80文字以内で入力してください')

    setSubmitting(true)
    try {
      const url =
        mode === 'create'
          ? 'http://localhost:3000/api/lines'
          : `http://localhost:3000/api/lines/${editId}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const body =
        mode === 'create'
          ? { id: formId, name: formName, kind: formKind, operator: formOperator }
          : { name: formName, kind: formKind, operator: formOperator }

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
        setFormError('入力内容に誤りがあります')
        return
      }
      if (res.status === 409) {
        setFormError('同じIDまたは路線名が既に登録されています')
        return
      }
      if (res.status === 404) {
        setFormError('編集対象の路線が見つかりませんでした (削除済み?)')
        return
      }
      if (!res.ok) {
        setFormError('保存に失敗しました。再度お試しください')
        return
      }
      // 成功 → /admin/lines へ通知バナー付きで戻る
      navigate('/admin/lines', {
        replace: true,
        state: {
          notice: mode === 'create' ? '路線を作成しました' : '路線を更新しました',
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
          <h1>{mode === 'create' ? '路線の新規作成' : '路線の編集'}</h1>
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
          <h1>{mode === 'create' ? '路線の新規作成' : '路線の編集'}</h1>
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
          <h1>{mode === 'create' ? '路線の新規作成' : '路線の編集'}</h1>
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

  // 編集モードで対象が見つからなかった
  if (mode === 'edit' && editTargetMissing) {
    return (
      <div className="shell">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>路線の編集</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">
            該当の路線が見つかりませんでした
          </div>
          <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
            <Link to="/admin/lines" className="btn btn-ghost">
              路線マスタ管理に戻る
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // 編集モードで pre-fill 中
  if (mode === 'edit' && !prefilled) {
    return (
      <div className="shell">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>路線の編集</h1>
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
        <div className="brand">{mode === 'create' ? 'Admin / New Line' : 'Admin / Edit Line'}</div>
        <h1>{mode === 'create' ? '路線の新規作成' : '路線の編集'}</h1>
        <p>
          {mode === 'create'
            ? '路線マスタに新しい路線を登録します'
            : `${formName} の内容を編集します`}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {formError && <div className="banner is-shown">{formError}</div>}

        <div className="group">
          <label htmlFor="form-id">
            ID<span className="req">必須</span>
          </label>
          <input
            type="text"
            id="form-id"
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            disabled={mode === 'edit' || submitting}
            placeholder="例: jr-tokaido"
            maxLength={80}
          />
          <div className="hint">
            半角英数字 + ハイフン/ドット/アンダースコア。
            作成後の変更は不可 (削除→再作成で対応, ADR 0006)
          </div>
        </div>

        <div className="group">
          <label htmlFor="form-name">
            路線名<span className="req">必須</span>
          </label>
          <input
            type="text"
            id="form-name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            disabled={submitting}
            maxLength={80}
          />
        </div>

        <div className="group">
          <label htmlFor="form-kind">
            種別<span className="req">必須</span>
          </label>
          <select
            id="form-kind"
            value={formKind}
            onChange={(e) => setFormKind(e.target.value as LineKind)}
            disabled={submitting}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="group">
          <label htmlFor="form-operator">運営会社</label>
          <input
            type="text"
            id="form-operator"
            value={formOperator}
            onChange={(e) => setFormOperator(e.target.value)}
            disabled={submitting}
            maxLength={80}
            placeholder="例: JR東海"
          />
          <div className="hint">任意項目 (空欄なら未登録)</div>
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
          <Link to="/admin/lines" className="btn btn-ghost">
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  )
}

export function AdminLineNew() {
  return <AdminLineForm mode="create" />
}

export function AdminLineEdit() {
  return <AdminLineForm mode="edit" />
}
