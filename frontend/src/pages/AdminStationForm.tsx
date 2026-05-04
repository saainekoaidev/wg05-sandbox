import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { UserBadge } from '../components/UserBadge'
import { useSession } from '../lib/auth'
import { useLines, type ApiLine, type LineKind } from '../lib/lines'
import { useOperators } from '../lib/operators'

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
  /** US-049: 運営会社マスタ ID (任意)。 */
  operatorId: string | null
  operatorName: string | null
  /** US-033: 路線ごとに code を持つ */
  lines: { id: string; name: string; kind: LineKind; code: string }[]
}

const ID_RE = /^[A-Za-z0-9._-]+$/
// US-033: 駅番号 (路線ごと) のクライアント検証用。空文字許容。
const CODE_RE = /^[A-Za-z0-9/-]*$/
const CODE_MAX = 30

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
  const operatorsState = useOperators({ enabled: isAdmin })

  // 編集モードでは GET /api/admin/stations/:id 単体取得 API は無いので、
  // GET /api/admin/stations 全件取得 + find で対象駅を pre-fill する。
  const [editTargetMissing, setEditTargetMissing] = useState(false)
  const [prefilled, setPrefilled] = useState(false)

  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formKana, setFormKana] = useState('')
  /// US-049 / ADR 0019: 運営会社マスタ ID (任意)。
  const [formOperatorId, setFormOperatorId] = useState('')
  /// US-050: 路線ピッカーの種別フィルタ (UI 専用)。
  const [linePickerKind, setLinePickerKind] = useState<'' | LineKind>('')
  // US-033: チェック済み lineId → 駅番号 code の Map。
  // チェックを外すと entry を削除し駅番号入力もクリアされる。
  const [formLineCodes, setFormLineCodes] = useState<Map<string, string>>(
    () => new Map(),
  )

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
        setFormOperatorId(target.operatorId ?? '')
        const initialMap = new Map<string, string>()
        for (const l of target.lines) initialMap.set(l.id, l.code)
        setFormLineCodes(initialMap)
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

  // US-038: エラー位置 (どの input が悪いか) を field 識別子で持たせ、
  // バナー表示 + 該当 input のハイライト + scroll/focus に使う。
  // field の規約: 'id' | 'name' | 'kana' | `code:<lineId>` | null (場所特定不能)
  type FormError = { message: string; field: string | null }
  const [formError, setFormError] = useState<FormError | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /**
   * US-038: エラーをセットして該当 input にスクロール + フォーカス。
   * field が null (= 場所特定不能なエラー) なら何もしない。
   */
  function fail(field: string | null, message: string) {
    setFormError({ message, field })
    if (field) {
      // 次の paint で focus したいので microtask 後に実行
      queueMicrotask(() => {
        const el = document.getElementById(fieldDomId(field))
        if (!el) return
        // jsdom では scrollIntoView が未実装。ブラウザでだけ実行する。
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
        if (typeof (el as HTMLElement).focus === 'function') {
          ;(el as HTMLElement).focus({ preventScroll: true })
        }
      })
    }
  }

  /** field 識別子 → DOM の id 属性。`code:<lineId>` は line-picker の input を指す。 */
  function fieldDomId(field: string): string {
    if (field.startsWith('code:')) {
      return `line-picker-code-${field.slice('code:'.length)}`
    }
    if (field === 'id') return 'form-id'
    if (field === 'name') return 'form-name'
    if (field === 'kana') return 'form-kana'
    return ''
  }

  /** US-038: input/select に付与するクラスを組み立てる。エラー対象なら is-error を追加。 */
  function inputClass(field: string, base = ''): string {
    const isError = formError?.field === field
    return [base, isError ? 'is-error' : ''].filter(Boolean).join(' ')
  }

  function toggleLine(lineId: string) {
    setFormLineCodes((prev) => {
      const next = new Map(prev)
      if (next.has(lineId)) {
        // US-033: チェック OFF で同行の駅番号入力もクリア
        next.delete(lineId)
      } else {
        next.set(lineId, '')
      }
      return next
    })
  }

  function setLineCode(lineId: string, code: string) {
    setFormLineCodes((prev) => {
      // チェックされていない行に code を入れることはない (UI 側で input が disabled)
      if (!prev.has(lineId)) return prev
      const next = new Map(prev)
      next.set(lineId, code)
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (mode === 'create' && formId) {
      if (!ID_RE.test(formId))
        return fail(
          'id',
          'IDは半角英数字 + ハイフン/ドット/アンダースコアのみ使用できます',
        )
      if (formId.length > 80)
        return fail('id', 'IDは80文字以内で入力してください')
    }
    if (!formName) return fail('name', '駅名を入力してください')
    if (formName.length > 50)
      return fail('name', '駅名は50文字以内で入力してください')
    if (!formKana) return fail('kana', 'よみがなを入力してください')
    if (formKana.length > 80)
      return fail('kana', 'よみがなは80文字以内で入力してください')

    // US-033: 駅番号 (code) のクライアント側検証。
    // US-038: 違反した最初の lineId を field に載せて該当 input を強調する。
    for (const [lineId, code] of formLineCodes) {
      if (code.length > CODE_MAX) {
        return fail(
          `code:${lineId}`,
          `駅番号は ${CODE_MAX} 文字以内で入力してください`,
        )
      }
      if (code && !CODE_RE.test(code)) {
        return fail(
          `code:${lineId}`,
          '駅番号は半角英数字 + ハイフン/スラッシュのみ使用できます',
        )
      }
    }

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
        operatorId: formOperatorId || null,
        lineLinks: Array.from(formLineCodes.entries()).map(([lineId, code]) => ({
          lineId,
          code,
        })),
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
        // サーバ側の権限拒否は input 単位の問題ではないので field=null
        setFormError({ message: '管理者権限が必要です', field: null })
        return
      }
      if (res.status === 400) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        if (errBody.error === 'unknown_line') {
          setFormError({
            message: '紐付けに含まれる路線が存在しません (削除済み?)',
            field: null,
          })
        } else {
          setFormError({ message: '入力内容に誤りがあります', field: null })
        }
        return
      }
      if (res.status === 404) {
        setFormError({
          message: '編集対象の駅が見つかりませんでした (削除済み?)',
          field: null,
        })
        return
      }
      if (res.status === 409) {
        return fail('id', '同じIDの駅が既に登録されています')
      }
      if (!res.ok) {
        setFormError({
          message: '保存に失敗しました。再度お試しください',
          field: null,
        })
        return
      }
      navigate('/admin/stations', {
        replace: true,
        state: {
          notice: mode === 'create' ? '駅を作成しました' : '駅を更新しました',
        },
      })
    } catch {
      setFormError({ message: '保存に失敗しました。再度お試しください', field: null })
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
        {formError && (
          <div className="banner is-shown" role="alert">
            {formError.message}
          </div>
        )}

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
              className={inputClass('id')}
              aria-invalid={formError?.field === 'id' || undefined}
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
            className={inputClass('name')}
            aria-invalid={formError?.field === 'name' || undefined}
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
            className={inputClass('kana')}
            aria-invalid={formError?.field === 'kana' || undefined}
            value={formKana}
            onChange={(e) => setFormKana(e.target.value)}
            disabled={submitting}
            maxLength={80}
            placeholder="例: なごや"
          />
        </div>

        <div className="group">
          <label htmlFor="form-operatorId">運営会社</label>
          <select
            id="form-operatorId"
            className={inputClass('operatorId')}
            aria-invalid={formError?.field === 'operatorId' || undefined}
            value={formOperatorId}
            onChange={(e) => setFormOperatorId(e.target.value)}
            disabled={submitting || !operatorsState.operators}
          >
            <option value="">— 未登録 —</option>
            {operatorsState.operators?.map((op) => (
              <option key={op.id} value={op.id}>
                {op.name}
              </option>
            ))}
          </select>
          <div className="hint">
            駅の運営会社を選択。同一駅名でも運営会社が異なれば別駅として扱います
            (改札を出る乗換え = 別駅)。
          </div>
        </div>

        {/* US-050: 種別 → 路線 (運営会社は上の運営会社 select で兼ねる) */}
        <div className="group">
          <label htmlFor="line-picker-kind">種別 (路線一覧の絞り込み)</label>
          <select
            id="line-picker-kind"
            value={linePickerKind}
            onChange={(e) => setLinePickerKind(e.target.value as '' | LineKind)}
            disabled={submitting}
          >
            <option value="">すべて</option>
            <option value="train">電車</option>
            <option value="subway">地下鉄</option>
            <option value="bus">バス</option>
            <option value="other">その他</option>
          </select>
          <div className="hint">
            運営会社・種別の組み合わせで路線一覧を絞り込めます。チェック済みの路線は絞り込み外でも表示されます。
          </div>
        </div>

        <div className="group">
          <label>接続路線 / 駅番号</label>
          {linesState.lines && linesState.lines.length === 0 && (
            <div className="hint">
              路線マスタが空です。先に
              <Link to="/admin/lines">路線マスタ管理</Link>
              で路線を登録してください。
            </div>
          )}
          {linesState.lines && linesState.lines.length > 0 && (
            <div
              className="line-picker"
              role="group"
              aria-label="接続路線と駅番号の選択"
            >
              {linesState.lines
                .filter((line: ApiLine) => {
                  // 既にチェック済みの行は絞り込みに関係なく必ず表示する
                  if (formLineCodes.has(line.id)) return true
                  if (formOperatorId && line.operatorId !== formOperatorId) return false
                  if (linePickerKind && line.kind !== linePickerKind) return false
                  return true
                })
                .map((line: ApiLine) => {
                const checked = formLineCodes.has(line.id)
                const code = formLineCodes.get(line.id) ?? ''
                const codeFieldId = `code:${line.id}`
                const isCodeError = formError?.field === codeFieldId
                return (
                  <div key={line.id} className="line-picker__row">
                    {/* US-033: チェック列はチェックボックス本体程度の最小幅 */}
                    <input
                      type="checkbox"
                      className="line-picker__check"
                      checked={checked}
                      onChange={() => toggleLine(line.id)}
                      disabled={submitting}
                      aria-label={`${line.name} に接続`}
                    />
                    <span className={KIND_TAG_CLASS[line.kind]}>
                      {KIND_LABEL[line.kind]}
                    </span>
                    <span className="line-picker__name">{line.name}</span>
                    <input
                      type="text"
                      id={`line-picker-code-${line.id}`}
                      className={
                        'line-picker__code' + (isCodeError ? ' is-error' : '')
                      }
                      aria-invalid={isCodeError || undefined}
                      value={code}
                      onChange={(e) => setLineCode(line.id, e.target.value)}
                      placeholder="駅番号 (例: CA68)"
                      maxLength={CODE_MAX}
                      disabled={submitting || !checked}
                      aria-label={`${line.name} の駅番号`}
                    />
                  </div>
                )
              })}
            </div>
          )}
          <div className="hint" style={{ marginTop: 6 }}>
            ※ チェックを外すと駅番号もクリアされます。駅番号は半角英数字 + ハイフン/スラッシュ のみ ({CODE_MAX} 文字以内)。
          </div>
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
