import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { signIn, useSession } from '../lib/auth'

type FieldErrors = {
  email?: string
  password?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Login() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!isPending && session) {
    return <Navigate to="/routes" replace />
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!email) next.email = 'メールアドレスを入力してください'
    else if (!EMAIL_RE.test(email)) next.email = 'メールアドレスの形式が正しくありません'
    if (!password) next.password = 'パスワードを入力してください'
    return next
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBannerError(null)
    const v = validate()
    setErrors(v)
    if (Object.keys(v).length > 0) return

    setSubmitting(true)
    try {
      const result = await signIn.email({ email, password })
      if (result.error) {
        setBannerError('メールアドレスまたはパスワードが正しくありません')
        return
      }
      navigate('/routes', { replace: true })
    } catch {
      setBannerError('ログインに失敗しました。時間をおいて再度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

  function handleClear() {
    setEmail('')
    setPassword('')
    setErrors({})
    setBannerError(null)
  }

  return (
    <div className="shell">
      <div className="head">
        <div className="brand">Sign In</div>
        <h1>ログイン</h1>
        <p>登録済みのメールアドレスとパスワードでログインしてください</p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {bannerError && <div className="banner is-shown">{bannerError}</div>}

        <div className="group">
          <label htmlFor="email">
            メールアドレス<span className="req">必須</span>
          </label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="example@domain.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, email: validate().email }))}
            disabled={submitting}
          />
          {errors.email && <div className="field-error">{errors.email}</div>}
        </div>

        <div className="group">
          <label htmlFor="password">
            パスワード<span className="req">必須</span>
          </label>
          <div className="pwd-wrap">
            <input
              type={showPwd ? 'text' : 'password'}
              id="password"
              name="password"
              placeholder="半角英数記号 8〜32文字"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() =>
                setErrors((p) => ({ ...p, password: validate().password }))
              }
              disabled={submitting}
            />
            <button
              type="button"
              className="pwd-toggle"
              onClick={() => setShowPwd((v) => !v)}
              disabled={submitting}
            >
              {showPwd ? '隠す' : '表示'}
            </button>
          </div>
          {errors.password && (
            <div className="field-error">{errors.password}</div>
          )}
        </div>

        <div className="actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? 'ログイン中…' : 'ログイン'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClear}
            disabled={submitting}
          >
            クリア
          </button>
        </div>
      </form>

      <div className="foot">
        アカウントをお持ちでない方は<Link to="/register">新規登録</Link>
      </div>
    </div>
  )
}
