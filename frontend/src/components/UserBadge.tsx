import { Link } from 'react-router-dom'
import { useSession } from '../lib/auth'

/**
 * 認証中ユーザーの氏名をヘッダ右上に表示するバッジ。
 * docs/requirements.md US-019 を参照。
 *
 * - 認証情報が未確定 / 未ログインの場合は何も描画しない (ログイン/登録画面など)
 * - クリックでアカウント設定 (/account) に遷移する (US-014 の動線維持)
 * - name が空の場合は email にフォールバック
 */
export function UserBadge() {
  const { data: session, isPending } = useSession()
  if (isPending || !session) return null
  const display = session.user.name || session.user.email
  return (
    <Link
      to="/account"
      className="user-badge"
      aria-label={`アカウント設定を開く (${display})`}
    >
      {display}
    </Link>
  )
}
