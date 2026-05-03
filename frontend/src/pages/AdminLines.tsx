import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import {
  KIND_OPTIONS,
  useLines,
  type ApiLine,
  type LineKind,
} from '../lib/lines'
import { useSession } from '../lib/auth'

type ApiUser = {
  id: string
  email: string
  name: string
  postalCode: string | null
  role: 'user' | 'admin'
}

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; line: ApiLine }

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

export function AdminLines() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

  // /api/users/me で role を確認 (admin チェック)
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

  // role 確定 + admin の場合だけ /api/lines を取得する。
  const linesState = useLines({ enabled: me?.role === 'admin' })

  // 編集ダイアログ状態
  const [mode, setMode] = useState<FormMode>({ kind: 'closed' })
  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formKind, setFormKind] = useState<LineKind>('train')
  const [formOperator, setFormOperator] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [banner, setBanner] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function openCreate() {
    setMode({ kind: 'create' })
    setFormId('')
    setFormName('')
    setFormKind('train')
    setFormOperator('')
    setFormError(null)
  }

  function openEdit(line: ApiLine) {
    setMode({ kind: 'edit', line })
    setFormId(line.id)
    setFormName(line.name)
    setFormKind(line.kind)
    setFormOperator(line.operator ?? '')
    setFormError(null)
  }

  function closeForm() {
    setMode({ kind: 'closed' })
    setFormError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    // フォームが閉じている時は呼ばれない想定だが、TS の narrow のために早期リターン。
    if (mode.kind === 'closed') return

    // バリデーション
    if (mode.kind === 'create') {
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
        mode.kind === 'create'
          ? 'http://localhost:3000/api/lines'
          : `http://localhost:3000/api/lines/${mode.line.id}`
      const method = mode.kind === 'create' ? 'POST' : 'PUT'
      const body =
        mode.kind === 'create'
          ? {
              id: formId,
              name: formName,
              kind: formKind,
              operator: formOperator,
            }
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
      // 成功
      closeForm()
      setNotice(mode.kind === 'create' ? '路線を作成しました' : '路線を更新しました')
      linesState.reload()
    } catch {
      setFormError('保存に失敗しました。再度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(line: ApiLine) {
    if (deletingId) return
    if (
      !window.confirm(
        `路線「${line.name}」を削除しますか?\n参照されている経路がある場合は削除できません。`,
      )
    ) {
      return
    }
    setDeletingId(line.id)
    setBanner(null)
    setNotice(null)
    try {
      const res = await fetch(`http://localhost:3000/api/lines/${line.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.status === 401) {
        navigate('/login', { replace: true })
        return
      }
      if (res.status === 403) {
        setBanner('管理者権限が必要です')
        return
      }
      if (res.status === 404) {
        setBanner('該当の路線が見つかりませんでした (既に削除されている可能性があります)')
        linesState.reload()
        return
      }
      if (res.status === 409) {
        const body = (await res.json()) as { referenceCount: number }
        setBanner(
          `この路線は ${body.referenceCount} 件の経路で使用中のため削除できません。先に対象経路を編集してください`,
        )
        return
      }
      if (!res.ok) {
        setBanner('路線の削除に失敗しました。再度お試しください')
        return
      }
      setNotice('路線を削除しました')
      linesState.reload()
    } catch {
      setBanner('路線の削除に失敗しました。再度お試しください')
    } finally {
      setDeletingId(null)
    }
  }

  const sortedKinds = useMemo<LineKind[]>(
    () => ['train', 'subway', 'bus', 'other'],
    [],
  )

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  if (meLoading) {
    return (
      <div className="shell shell--wide">
        <div className="head">
          <UserBadge />
          <div className="brand">Admin</div>
          <h1>路線マスタ管理</h1>
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
          <h1>路線マスタ管理</h1>
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
          <h1>路線マスタ管理</h1>
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
            <div className="brand">Admin / Lines</div>
            <h1>路線マスタ管理</h1>
            <p>登録済みの路線を確認・追加・編集・削除できます (管理者専用)</p>
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
        {linesState.error && (
          <div className="banner is-shown">{linesState.error}</div>
        )}

        {linesState.loading && !linesState.lines && (
          <div className="empty">読み込み中…</div>
        )}

        {linesState.lines && linesState.lines.length === 0 && (
          <div className="empty">
            <p>路線マスタは現在空です。</p>
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

        {linesState.lines && linesState.lines.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>路線名</th>
                  <th>種別</th>
                  <th>運営会社</th>
                  <th className="col-num">参照経路</th>
                  <th className="col-num">接続駅</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedKinds.flatMap((k) =>
                  linesState
                    .lines!.filter((l) => l.kind === k)
                    .map((line) => (
                      <tr key={line.id}>
                        <td>
                          <code>{line.id}</code>
                        </td>
                        <td>{line.name}</td>
                        <td>
                          <span className={KIND_TAG_CLASS[line.kind]}>
                            {KIND_LABEL[line.kind]}
                          </span>
                        </td>
                        <td>{line.operator ?? '—'}</td>
                        <td className="col-num">{line.routeSegmentCount}</td>
                        <td className="col-num">{line.stationCount}</td>
                        <td>
                          <div className="col-actions">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEdit(line)}
                              aria-label={`路線「${line.name}」を編集`}
                            >
                              編集
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={
                                deletingId === line.id ||
                                line.routeSegmentCount > 0
                              }
                              title={
                                line.routeSegmentCount > 0
                                  ? `経路で ${line.routeSegmentCount} 件参照中のため削除できません`
                                  : undefined
                              }
                              onClick={() => handleDelete(line)}
                              aria-label={`路線「${line.name}」を削除`}
                            >
                              {deletingId === line.id ? '削除中…' : '削除'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 編集ダイアログ (簡易: フォームをリスト下部にインライン展開) */}
        {mode.kind !== 'closed' && (
          <>
            <div className="divider">
              <span>{mode.kind === 'create' ? 'New Line' : 'Edit Line'}</span>
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
                  disabled={mode.kind === 'edit' || submitting}
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
