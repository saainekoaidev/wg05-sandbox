import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { changePassword, useSession } from '../lib/auth'

type ApiUser = {
  id: string
  email: string
  name: string
  postalCode: string | null
}

type ProfileErrors = {
  name?: string
  postalCode?: string
}

type PasswordErrors = {
  current?: string
  next?: string
  confirm?: string
}

const POSTAL_RE = /^\d{7}$/

function formatPostal(value: string): string {
  return value.length === 7 ? `${value.slice(0, 3)}-${value.slice(3)}` : value
}

// US-001 (Register.tsx) と同じ強度ルール (ADR 0004 §パスワード変更フロー)。
function validatePasswordStrength(p: string): string | undefined {
  if (!p) return 'パスワードを入力してください'
  if (p.length < 8 || p.length > 32) {
    return 'パスワードは8〜32文字で入力してください'
  }
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p)) {
    return 'パスワードは英大文字・小文字・数字をそれぞれ1文字以上含めてください'
  }
  return undefined
}

export function Account() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

  // プロフィール
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<ApiUser | null>(null)
  const [name, setName] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({})
  const [profileBanner, setProfileBanner] = useState<string | null>(null)
  const [profileNotice, setProfileNotice] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)

  // パスワード変更 (US-009)
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNext, setPwNext] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwShow, setPwShow] = useState(false)
  const [pwErrors, setPwErrors] = useState<PasswordErrors>({})
  const [pwBanner, setPwBanner] = useState<string | null>(null)
  const [pwNotice, setPwNotice] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (isPending || !session) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setProfileBanner(null)
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
          setProfileBanner(
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
          setProfileBanner(
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

  function validateProfile(): ProfileErrors {
    const next: ProfileErrors = {}
    const trimmed = name.trim()
    if (!trimmed) next.name = '氏名を入力してください'
    else if (trimmed.length > 50) next.name = '氏名は50文字以内で入力してください'
    if (postalCode && !POSTAL_RE.test(postalCode)) {
      next.postalCode = '郵便番号は半角数字7桁で入力してください (ハイフン不要)'
    }
    return next
  }

  function validatePassword(): PasswordErrors {
    const next: PasswordErrors = {}
    if (!pwCurrent) next.current = '現在のパスワードを入力してください'
    const strength = validatePasswordStrength(pwNext)
    if (strength) next.next = strength
    else if (pwNext === pwCurrent)
      next.next = '新しいパスワードは現在のパスワードと異なるものにしてください'
    if (!pwConfirm) next.confirm = '確認用パスワードを入力してください'
    else if (pwNext && pwConfirm && pwNext !== pwConfirm)
      next.confirm = 'パスワードが一致しません'
    return next
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault()
    setProfileBanner(null)
    setProfileNotice(null)
    const v = validateProfile()
    setProfileErrors(v)
    if (Object.keys(v).length > 0) return

    setSavingProfile(true)
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
        setProfileBanner('入力内容に誤りがあります。再度ご確認ください')
        return
      }
      if (!res.ok) {
        setProfileBanner(
          'プロフィールの更新に失敗しました。再度お試しください',
        )
        return
      }
      const body = (await res.json()) as ApiUser
      setUser(body)
      setName(body.name)
      setPostalCode(body.postalCode ?? '')
      setProfileNotice('プロフィールを更新しました')
    } catch {
      setProfileBanner(
        'プロフィールの更新に失敗しました。再度お試しください',
      )
    } finally {
      setSavingProfile(false)
    }
  }

  function handleResetProfile() {
    if (!user) return
    const dirty =
      name.trim() !== user.name ||
      (postalCode || null) !== (user.postalCode ?? null)
    if (!dirty) return
    if (!window.confirm('入力内容を変更前に戻しますか?')) return
    setName(user.name)
    setPostalCode(user.postalCode ?? '')
    setProfileErrors({})
    setProfileBanner(null)
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    setPwBanner(null)
    setPwNotice(null)
    const v = validatePassword()
    setPwErrors(v)
    if (Object.keys(v).length > 0) return

    setSavingPassword(true)
    try {
      // ADR 0004 §パスワード変更フロー: revokeOtherSessions=true で他デバイスのセッションを失効
      const result = await changePassword({
        currentPassword: pwCurrent,
        newPassword: pwNext,
        revokeOtherSessions: true,
      })
      if (result.error) {
        const code = (result.error as { code?: string }).code
        // INVALID_PASSWORD / INVALID_EMAIL_OR_PASSWORD など
        if (code && /INVALID/.test(code)) {
          setPwBanner('現在のパスワードが正しくありません')
        } else {
          setPwBanner(
            'パスワードの変更に失敗しました。時間をおいて再度お試しください',
          )
        }
        return
      }
      setPwCurrent('')
      setPwNext('')
      setPwConfirm('')
      setPwErrors({})
      setPwNotice(
        'パスワードを変更しました (他のデバイスのセッションは無効化されました)',
      )
    } catch {
      setPwBanner(
        'パスワードの変更に失敗しました。時間をおいて再度お試しください',
      )
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="shell">
      <div className="head">
        <div className="brand">Account</div>
        <h1>プロフィール設定</h1>
        <p>登録済みのアカウント情報を確認・変更できます</p>
      </div>

      <form onSubmit={handleSaveProfile} noValidate>
        {profileNotice && (
          <div className="banner banner--success is-shown" role="status">
            {profileNotice}{' '}
            <button
              type="button"
              onClick={() => setProfileNotice(null)}
              aria-label="プロフィール通知を閉じる"
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
        {profileBanner && (
          <div className="banner is-shown">{profileBanner}</div>
        )}

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
                  setProfileErrors((p) => ({
                    ...p,
                    name: validateProfile().name,
                  }))
                }
                disabled={savingProfile}
              />
              {profileErrors.name && (
                <div className="field-error">{profileErrors.name}</div>
              )}
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
                  setProfileErrors((p) => ({
                    ...p,
                    postalCode: validateProfile().postalCode,
                  }))
                }
                disabled={savingProfile}
              />
              <div className="hint">
                半角数字 7 桁 (ハイフン不要)。空欄のまま保存すると登録解除します。
                {postalCode && POSTAL_RE.test(postalCode) && (
                  <> 表示形式: {formatPostal(postalCode)}</>
                )}
              </div>
              {profileErrors.postalCode && (
                <div className="field-error">{profileErrors.postalCode}</div>
              )}
            </div>

            <div className="actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingProfile}
              >
                {savingProfile ? '保存中…' : '保存する'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleResetProfile}
                disabled={savingProfile}
              >
                変更前に戻す
              </button>
            </div>
          </>
        )}
      </form>

      {!loading && user && (
        <>
          <div className="divider">
            <span>Password</span>
          </div>

          <form onSubmit={handleChangePassword} noValidate>
            {pwNotice && (
              <div className="banner banner--success is-shown" role="status">
                {pwNotice}{' '}
                <button
                  type="button"
                  onClick={() => setPwNotice(null)}
                  aria-label="パスワード通知を閉じる"
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
            {pwBanner && <div className="banner is-shown">{pwBanner}</div>}

            <div className="group">
              <label htmlFor="pwCurrent">
                現在のパスワード<span className="req">必須</span>
              </label>
              <input
                type={pwShow ? 'text' : 'password'}
                id="pwCurrent"
                name="pwCurrent"
                autoComplete="current-password"
                minLength={8}
                maxLength={32}
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                onBlur={() =>
                  setPwErrors((p) => ({
                    ...p,
                    current: validatePassword().current,
                  }))
                }
                disabled={savingPassword}
              />
              {pwErrors.current && (
                <div className="field-error">{pwErrors.current}</div>
              )}
            </div>

            <div className="group">
              <label htmlFor="pwNext">
                新しいパスワード<span className="req">必須</span>
              </label>
              <div className="pwd-wrap">
                <input
                  type={pwShow ? 'text' : 'password'}
                  id="pwNext"
                  name="pwNext"
                  autoComplete="new-password"
                  placeholder="半角英数記号 8〜32文字"
                  minLength={8}
                  maxLength={32}
                  value={pwNext}
                  onChange={(e) => setPwNext(e.target.value)}
                  onBlur={() =>
                    setPwErrors((p) => ({
                      ...p,
                      next: validatePassword().next,
                    }))
                  }
                  disabled={savingPassword}
                />
                <button
                  type="button"
                  className="pwd-toggle"
                  onClick={() => setPwShow((v) => !v)}
                  disabled={savingPassword}
                >
                  {pwShow ? '隠す' : '表示'}
                </button>
              </div>
              <div className="hint">
                英大文字・小文字・数字をそれぞれ1文字以上含めてください
              </div>
              {pwErrors.next && (
                <div className="field-error">{pwErrors.next}</div>
              )}
            </div>

            <div className="group">
              <label htmlFor="pwConfirm">
                新しいパスワード (確認)<span className="req">必須</span>
              </label>
              <input
                type={pwShow ? 'text' : 'password'}
                id="pwConfirm"
                name="pwConfirm"
                autoComplete="new-password"
                minLength={8}
                maxLength={32}
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                onBlur={() =>
                  setPwErrors((p) => ({
                    ...p,
                    confirm: validatePassword().confirm,
                  }))
                }
                disabled={savingPassword}
              />
              {pwErrors.confirm && (
                <div className="field-error">{pwErrors.confirm}</div>
              )}
            </div>

            <div className="hint">
              パスワード変更に成功すると、現在ログイン中のセッションは保持され、
              他のデバイスのセッションのみ無効化されます。
            </div>

            <div className="actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingPassword}
              >
                {savingPassword ? '変更中…' : 'パスワードを変更する'}
              </button>
            </div>
          </form>
        </>
      )}

      <div className="actions actions--no-divider" style={{ marginTop: 24 }}>
        <Link to="/routes" className="btn btn-ghost">
          経路一覧に戻る
        </Link>
      </div>
    </div>
  )
}
