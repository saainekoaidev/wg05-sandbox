import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { signUp, useSession } from '../lib/auth'

type FieldErrors = {
  email?: string
  password?: string
  name?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validatePassword(p: string): string | undefined {
  if (!p) return 'パスワードを入力してください'
  if (p.length < 8 || p.length > 32) {
    return 'パスワードは8〜32文字で入力してください'
  }
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p)) {
    return 'パスワードは英大文字・小文字・数字をそれぞれ1文字以上含めてください'
  }
  return undefined
}

export function Register() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
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
    else if (email.length > 256)
      next.email = 'メールアドレスは256文字以内で入力してください'
    else if (!EMAIL_RE.test(email))
      next.email = 'メールアドレスの形式が正しくありません'

    const pwdErr = validatePassword(password)
    if (pwdErr) next.password = pwdErr

    if (!name) next.name = '氏名を入力してください'
    else if (name.length > 50) next.name = '氏名は50文字以内で入力してください'

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
      const result = await signUp.email({ email, password, name })
      if (result.error) {
        // better-auth は重複メアド時に `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` を返す。
        // 将来コードが微変動しても拾えるよう prefix で判定する。
        const code = (result.error as { code?: string }).code
        if (code?.startsWith('USER_ALREADY_EXISTS')) {
          setBannerError('このメールアドレスは既に登録されています')
        } else {
          setBannerError(
            '登録に失敗しました。時間をおいて再度お試しください',
          )
        }
        return
      }
      // better-auth は sign-up 成功時に自動でセッションを発行するため、
      // そのまま認証必須の経路一覧画面へ遷移できる。
      navigate('/routes', { replace: true })
    } catch {
      setBannerError('登録に失敗しました。時間をおいて再度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

  function handleReset() {
    if (!email && !password && !name) return
    if (!window.confirm('入力内容をリセットしますか?')) return
    setEmail('')
    setPassword('')
    setName('')
    setErrors({})
    setBannerError(null)
  }

  function handleCancel() {
    if (
      (email || password || name) &&
      !window.confirm('入力内容を破棄してログイン画面に戻りますか?')
    ) {
      return
    }
    navigate('/login')
  }

  return (
    <div className="shell">
      <div className="head">
        <div className="brand">User Registration</div>
        <h1>アカウント登録</h1>
        <p>必要事項をご入力のうえ「登録する」ボタンを押してください</p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {bannerError && <div className="banner is-shown">{bannerError}</div>}

        {/* アカウント情報 */}
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
            maxLength={256}
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
              autoComplete="new-password"
              minLength={8}
              maxLength={32}
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
          <div className="hint">
            英大文字・小文字・数字をそれぞれ1文字以上含めてください
          </div>
          {errors.password && (
            <div className="field-error">{errors.password}</div>
          )}
        </div>

        <div className="divider">
          <span>Profile</span>
        </div>

        {/* ユーザー基本情報 */}
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
            onBlur={() => setErrors((p) => ({ ...p, name: validate().name }))}
            disabled={submitting}
          />
          {errors.name && <div className="field-error">{errors.name}</div>}
        </div>

        {/*
         * 郵便番号フィールドは設計書 (screen_design_register.md §8)
         * の「住所欄の有無」が未確定であり、かつ Prisma User モデルに postalCode 列を
         * 持たないため本実装では省略する。住所/郵便番号を保持する判断が出た時点で
         * Prisma スキーマ拡張 + 本フォームへの追加を行う。
         */}

        <div className="actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? '登録中…' : '登録する'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            disabled={submitting}
          >
            リセット
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleCancel}
            disabled={submitting}
          >
            キャンセル
          </button>
        </div>
      </form>

      <div className="foot">
        すでにアカウントをお持ちの方は<Link to="/login">ログイン</Link>
      </div>
    </div>
  )
}
