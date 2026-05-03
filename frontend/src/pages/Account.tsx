import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/auth'

type ApiUser = {
  id: string
  email: string
  name: string
  postalCode: string | null
}

type FieldErrors = {
  name?: string
  postalCode?: string
}

const POSTAL_RE = /^\d{7}$/

/**
 * 7桁数字をハイフン入りで表示する (例: 1500001 → "150-0001")。
 * docs/adr/0004-user-maintenance.md §(a) のとおり保存はハイフン無し, 表示は整形。
 */
function formatPostal(value: string): string {
  return value.length === 7 ? `${value.slice(0, 3)}-${value.slice(3)}` : value
}

export function Account() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<ApiUser | null>(null)
  const [name, setName] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 認証確定後に GET /api/users/me で現在値を取得
  useEffect(() => {
    if (isPending || !session) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setBannerError(null)
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
          setBannerError(
            'プロフィールの取得に失敗しました。再読み込みをお試しください',
          )
          return
        }
        const body = (await res.json()) as ApiUser
        setUser(body)
        setName(body.name)
        setPostalCode(body.postalCode ?? '')
      } catch {
        if (!cancelled) {
          setBannerError(
            'プロフィールの取得に失敗しました。再読み込みをお試しください',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isPending, session, navigate])

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    const trimmed = name.trim()
    if (!trimmed) next.name = '氏名を入力してください'
    else if (trimmed.length > 50) next.name = '氏名は50文字以内で入力してください'
    if (postalCode && !POSTAL_RE.test(postalCode)) {
      next.postalCode = '郵便番号は半角数字7桁で入力してください (ハイフン不要)'
    }
    return next
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBannerError(null)
    setNotice(null)
    const v = validate()
    setErrors(v)
    if (Object.keys(v).length > 0) return

    setSaving(true)
    try {
      const res = await fetch('http://localhost:3000/api/users/me', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          postalCode: postalCode || '',
        }),
      })
      if (res.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (res.status === 400) {
        setBannerError('入力内容に誤りがあります。再度ご確認ください')
        return
      }
      if (!res.ok) {
        setBannerError(
          'プロフィールの更新に失敗しました。再度お試しください',
        )
        return
      }
      const body = (await res.json()) as ApiUser
      setUser(body)
      setName(body.name)
      setPostalCode(body.postalCode ?? '')
      setNotice('プロフィールを更新しました')
    } catch {
      setBannerError(
        'プロフィールの更新に失敗しました。再度お試しください',
      )
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (!user) return
    const dirty =
      name.trim() !== user.name || (postalCode || null) !== (user.postalCode ?? null)
    if (!dirty) return
    if (!window.confirm('入力内容を変更前に戻しますか?')) return
    setName(user.name)
    setPostalCode(user.postalCode ?? '')
    setErrors({})
    setBannerError(null)
  }

  return (
    <div className="shell">
      <div className="head">
        <div className="brand">Account</div>
        <h1>プロフィール設定</h1>
        <p>登録済みのアカウント情報を確認・変更できます</p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
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
        {bannerError && <div className="banner is-shown">{bannerError}</div>}

        {loading && <div className="empty">読み込み中…</div>}

        {!loading && user && (
          <>
            <div className="group">
              <label htmlFor="email">メールアドレス</label>
              <input
                type="email"
                id="email"
                value={user.email}
                disabled
                readOnly
              />
              <div className="hint">
                メールアドレスは本サンドボックスでは変更対象外です
                (docs/adr/0004-user-maintenance.md)
              </div>
            </div>

            <div className="group">
              <label htmlFor="name">
                お名前<span className="req">必須</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                placeholder="山田 太郎"
                autoComplete="name"
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() =>
                  setErrors((p) => ({ ...p, name: validate().name }))
                }
                disabled={saving}
              />
              {errors.name && <div className="field-error">{errors.name}</div>}
            </div>

            <div className="group">
              <label htmlFor="postalCode">郵便番号</label>
              <input
                type="text"
                id="postalCode"
                name="postalCode"
                placeholder="1500001"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={7}
                value={postalCode}
                onChange={(e) =>
                  setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 7))
                }
                onBlur={() =>
                  setErrors((p) => ({ ...p, postalCode: validate().postalCode }))
                }
                disabled={saving}
              />
              <div className="hint">
                半角数字 7 桁 (ハイフン不要)。空欄のまま保存すると登録解除します。
                {postalCode && POSTAL_RE.test(postalCode) && (
                  <> 表示形式: {formatPostal(postalCode)}</>
                )}
              </div>
              {errors.postalCode && (
                <div className="field-error">{errors.postalCode}</div>
              )}
            </div>

            <div className="actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? '保存中…' : '保存する'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleReset}
                disabled={saving}
              >
                変更前に戻す
              </button>
              <Link to="/routes" className="btn btn-ghost">
                経路一覧に戻る
              </Link>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
