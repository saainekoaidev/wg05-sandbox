import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { useSession } from '../lib/auth'
import type { LineKind } from '../lib/lines'
import { useAdminOperators } from '../lib/operators'

const KIND_OPTIONS: ReadonlyArray<{ value: LineKind; label: string }> = [
  { value: 'train', label: '電車' },
  { value: 'subway', label: '地下鉄' },
  { value: 'bus', label: 'バス' },
  { value: 'other', label: 'その他' },
]

type ApiUser = {
  id: string
  email: string
  name: string
  postalCode: string | null
  role: 'user' | 'admin'
}

const ID_RE = /^[a-z0-9-]+$/

type Mode = 'create' | 'edit'

interface AdminOperatorFormProps {
  mode: Mode
}

/** US-049 / ADR 0019: 運営会社マスタの新規作成 / 編集画面。 */
export function AdminOperatorForm({ mode }: AdminOperatorFormProps) {
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
  const opsState = useAdminOperators({ enabled })

  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  /// aliases は カンマ区切り入力 → JSON 配列文字列に変換して送信。
  const [formAliasesInput, setFormAliasesInput] = useState('')
  /// US-052: 運営する種別の Set。チェックボックス UI で操作。
  const [formKinds, setFormKinds] = useState<Set<LineKind>>(() => new Set())
  const [prefilled, setPrefilled] = useState(false)
  const [editTargetMissing, setEditTargetMissing] = useState(false)

  useEffect(() => {
    if (mode !== 'edit' || prefilled) return
    if (!opsState.operators) return
    const target = opsState.operators.find((o) => o.id === editId)
    if (!target) {
      setEditTargetMissing(true)
      return
    }
    setFormId(target.id)
    setFormName(target.name)
    setFormAliasesInput(target.aliases.join(', '))
    setFormKinds(new Set(target.kinds))
    setPrefilled(true)
  }, [mode, editId, opsState.operators, prefilled])

  function toggleKind(k: LineKind) {
    setFormKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  type FormError = { message: string; field: string | null }
  const [formError, setFormError] = useState<FormError | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function fail(field: string | null, message: string) {
    setFormError({ message, field })
    if (field) {
      queueMicrotask(() => {
        const el = document.getElementById(`form-${field}`)
        if (!el) return
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
        if (typeof (el as HTMLElement).focus === 'function') {
          ;(el as HTMLElement).focus({ preventScroll: true })
        }
      })
    }
  }

  function inputClass(field: string, base = ''): string {
    const isError = formError?.field === field
    return [base, isError ? 'is-error' : ''].filter(Boolean).join(' ')
  }

  function buildAliasesJson(): string {
    const parts = formAliasesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return JSON.stringify(parts)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (mode === 'create') {
      if (!formId) return fail('id', 'IDを入力してください')
      if (!ID_RE.test(formId))
        return fail('id', 'IDは半角小文字英数字 + ハイフンのみ使用できます')
      if (formId.length > 40) return fail('id', 'IDは40文字以内で入力してください')
    }
    if (!formName) return fail('name', '名称を入力してください')
    if (formName.length > 80)
      return fail('name', '名称は80文字以内で入力してください')

    const aliases = buildAliasesJson()
    const kinds = JSON.stringify(Array.from(formKinds))

    setSubmitting(true)
    try {
      const url =
        mode === 'create'
          ? 'http://localhost:3000/api/admin/operators'
          : `http://localhost:3000/api/admin/operators/${editId}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const body =
        mode === 'create'
          ? { id: formId, name: formName, aliases, kinds }
          : { name: formName, aliases, kinds }

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
        setFormError({ message: '管理者権限が必要です', field: null })
        return
      }
      if (res.status === 400) {
        setFormError({ message: '入力内容に誤りがあります', field: null })
        return
      }
      if (res.status === 409) {
        return fail(
          mode === 'create' ? 'id' : 'name',
          '同じIDまたは名称が既に登録されています',
        )
      }
      if (res.status === 404) {
        setFormError({
          message: '編集対象の運営会社が見つかりませんでした (削除済み?)',
          field: null,
        })
        return
      }
      if (!res.ok) {
        setFormError({
          message: '保存に失敗しました。再度お試しください',
          field: null,
        })
        return
      }
      navigate('/admin/operators', {
        replace: true,
        state: {
          notice:
            mode === 'create'
              ? '運営会社を作成しました'
              : '運営会社を更新しました',
        },
      })
    } catch {
      setFormError({
        message: '保存に失敗しました。再度お試しください',
        field: null,
      })
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
          <h1>{mode === 'create' ? '運営会社の新規作成' : '運営会社の編集'}</h1>
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
          <h1>{mode === 'create' ? '運営会社の新規作成' : '運営会社の編集'}</h1>
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
          <h1>{mode === 'create' ? '運営会社の新規作成' : '運営会社の編集'}</h1>
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
          <h1>運営会社の編集</h1>
        </div>
        <div className="body">
          <div className="banner is-shown">該当の運営会社が見つかりませんでした</div>
          <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
            <Link to="/admin/operators" className="btn btn-ghost">
              運営会社マスタ管理に戻る
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
          <h1>運営会社の編集</h1>
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
        <div className="brand">
          {mode === 'create' ? 'Admin / New Operator' : 'Admin / Edit Operator'}
        </div>
        <h1>{mode === 'create' ? '運営会社の新規作成' : '運営会社の編集'}</h1>
        <p>
          {mode === 'create'
            ? '運営会社マスタに新しい運営会社を登録します'
            : `${formName} の内容を編集します`}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className="banner is-shown" role="alert">
            {formError.message}
          </div>
        )}

        <div className="group">
          <label htmlFor="form-id">
            ID<span className="req">必須</span>
          </label>
          <input
            type="text"
            id="form-id"
            className={inputClass('id')}
            aria-invalid={formError?.field === 'id' || undefined}
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            disabled={mode === 'edit' || submitting}
            placeholder="例: jr-tokai"
            maxLength={40}
          />
          <div className="hint">
            半角小文字英数字 + ハイフン。 作成後の変更は不可。
          </div>
        </div>

        <div className="group">
          <label htmlFor="form-name">
            名称<span className="req">必須</span>
          </label>
          <input
            type="text"
            id="form-name"
            className={inputClass('name')}
            aria-invalid={formError?.field === 'name' || undefined}
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            disabled={submitting}
            maxLength={80}
            placeholder="例: JR東海"
          />
        </div>

        <div className="group">
          <label htmlFor="form-aliases">別称 (aliases)</label>
          <input
            type="text"
            id="form-aliases"
            className={inputClass('aliases')}
            value={formAliasesInput}
            onChange={(e) => setFormAliasesInput(e.target.value)}
            disabled={submitting}
            placeholder="例: 東海旅客鉄道, JR東海"
          />
          <div className="hint">
            カンマ区切りで複数指定できます。表記揺らぎ吸収用。
          </div>
        </div>

        {/* US-052: 運営する種別をチェックボックスで選択 */}
        <div className="group">
          <label>運営する種別</label>
          <div role="group" aria-label="運営する種別" className="kind-checks" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {KIND_OPTIONS.map((opt) => (
              <label key={opt.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={formKinds.has(opt.value)}
                  onChange={() => toggleKind(opt.value)}
                  disabled={submitting}
                  aria-label={`${opt.label}を運営する`}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <div className="hint">
            この運営会社が運営する種別を選択。各画面で運営会社が選ばれた時、種別 dropdown が
            ここで指定した種別に絞り込まれます。空のままなら絞り込み無し。
          </div>
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '保存中…' : mode === 'create' ? '作成する' : '更新する'}
          </button>
          <Link to="/admin/operators" className="btn btn-ghost">
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  )
}

export function AdminOperatorNew() {
  return <AdminOperatorForm mode="create" />
}

export function AdminOperatorEdit() {
  return <AdminOperatorForm mode="edit" />
}
