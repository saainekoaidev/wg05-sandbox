import { Link, Navigate, useNavigate } from 'react-router-dom'
import { signOut, useSession } from '../lib/auth'

/**
 * US-002 のログイン成功遷移先として用意した最小スタブ。
 * US-004 (経路一覧) の本実装で置き換える前提。
 * US-003 着手時に、新規登録への導線として「+ 新規登録」リンクを追加した。
 */
export function RoutesStub() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  async function handleLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell shell--wide">
      <div className="head">
        <div className="head-row">
          <div>
            <div className="brand">Routes</div>
            <h1>通勤経路一覧</h1>
            <p>(US-004 の実装で本画面に差し替え予定)</p>
          </div>
          <div>
            <Link to="/routes/new" className="btn btn-primary btn-sm">
              + 新規登録
            </Link>
          </div>
        </div>
      </div>

      <div className="body">
        <div className="empty">
          ログイン成功。ようこそ {session.user.email} さん。
        </div>
      </div>

      <div className="foot foot--split">
        <span>ユーザー: {session.user.email}</span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            handleLogout()
          }}
        >
          ログアウト
        </a>
      </div>
    </div>
  )
}
