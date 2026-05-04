import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AdminStationNew, AdminStationEdit } from './AdminStationForm'

const mockUseSession = vi.fn()
const fetchMock = vi.fn()
const useLinesMock = vi.fn()
const useOperatorsMock = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

vi.mock('../lib/lines', () => ({
  KIND_OPTIONS: [
    { value: 'train', label: '電車' },
    { value: 'subway', label: '地下鉄' },
    { value: 'bus', label: 'バス' },
    { value: 'other', label: 'その他' },
  ],
  useLines: (opts: { enabled?: boolean }) => useLinesMock(opts),
}))

vi.mock('../lib/operators', () => ({
  useOperators: (opts: { enabled?: boolean }) => useOperatorsMock(opts),
}))

const ADMIN = {
  id: 'u1',
  email: 'admin@example.com',
  name: '管理者',
  postalCode: null,
  role: 'admin',
}

const NORMAL = { ...ADMIN, role: 'user' }

const LINE_TOKAIDO = {
  id: 'jr-tokaido',
  name: 'JR東海道線',
  kind: 'train',
  operator: 'JR東海',
  routeSegmentCount: 0,
  stationCount: 5,
}

const STATION_NAGOYA = {
  id: 'stn-nagoya',
  name: '名古屋',
  kana: 'なごや',
  operatorId: null,
  operatorName: null,
  // US-033: 路線ごとに code を持つ
  lines: [{ id: 'jr-tokaido', name: 'JR東海道線', kind: 'train', code: 'CA68' }],
}

function NavSpy() {
  const loc = useLocation()
  const state = loc.state as { notice?: string } | null
  return (
    <div>
      ADMIN_STATIONS_PAGE notice={state?.notice ?? '(none)'}
    </div>
  )
}

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/admin/stations/new']}>
      <Routes>
        <Route path="/admin/stations/new" element={<AdminStationNew />} />
        <Route path="/admin/stations" element={<NavSpy />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
        <Route path="/admin/lines" element={<div>ADMIN_LINES_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderEdit(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/stations/${id}/edit`]}>
      <Routes>
        <Route
          path="/admin/stations/:id/edit"
          element={<AdminStationEdit />}
        />
        <Route path="/admin/stations" element={<NavSpy />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'admin@example.com', name: '管理者' } },
    isPending: false,
  })
  fetchMock.mockReset()
  useLinesMock.mockReset()
  useLinesMock.mockReturnValue({
    lines: [LINE_TOKAIDO],
    loading: false,
    error: null,
    reload: () => {},
  })
  useOperatorsMock.mockReset()
  useOperatorsMock.mockReturnValue({
    operators: [
      { id: 'jr-tokai', name: 'JR東海', aliases: [] },
      { id: 'meitetsu', name: '名古屋鉄道', aliases: [] },
    ],
    loading: false,
    error: null,
    reload: () => {},
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminStationNew (US-026 新規作成)', () => {
  it('未ログインなら /login', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderNew()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
  })

  it('一般ユーザは 403 表示', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(NORMAL), { status: 200 }),
    )
    renderNew()
    expect(
      await screen.findByText(
        /このページを表示するには管理者権限が必要です/,
      ),
    ).toBeInTheDocument()
  })

  it('admin: 駅名 + よみがな + 路線チェック + 駅番号で POST 成功 → /admin/stations へ遷移 (US-033)', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'auto-1',
            name: '岐阜',
            kana: 'ぎふ',
            lines: [{ id: 'jr-tokaido', name: 'JR東海道線', kind: 'train', code: 'CA74' }],
          }),
          { status: 201 },
        ),
      )
    renderNew()
    await screen.findByLabelText(/^駅名/)

    await user.type(screen.getByLabelText(/^駅名/), '岐阜')
    await user.type(screen.getByLabelText(/よみがな/), 'ぎふ')
    // US-033: aria-label = "JR東海道線 に接続"
    await user.click(screen.getByLabelText('JR東海道線 に接続'))
    // チェック後に駅番号 input が有効化される
    await user.type(screen.getByLabelText('JR東海道線 の駅番号'), 'CA74')
    await user.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => {
      expect(
        screen.getByText('ADMIN_STATIONS_PAGE notice=駅を作成しました'),
      ).toBeInTheDocument()
    })
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toContain('/api/admin/stations')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      name: '岐阜',
      kana: 'ぎふ',
      lineLinks: [{ lineId: 'jr-tokaido', code: 'CA74' }],
    })
  })

  it('US-033: チェック OFF にすると同行の駅番号 input が disabled + 値クリア', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderNew()
    await screen.findByLabelText(/^駅名/)

    const check = screen.getByLabelText('JR東海道線 に接続') as HTMLInputElement
    const codeInput = screen.getByLabelText(
      'JR東海道線 の駅番号',
    ) as HTMLInputElement
    expect(codeInput.disabled).toBe(true)

    // チェック ON で input が有効化
    await user.click(check)
    expect(codeInput.disabled).toBe(false)
    await user.type(codeInput, 'CA68')
    expect(codeInput.value).toBe('CA68')

    // チェック OFF で input が disabled + 値が消える
    await user.click(check)
    expect(codeInput.disabled).toBe(true)
    expect(codeInput.value).toBe('')
  })

  it('駅名空でフィールドエラー (POST 呼ばれない) + 駅名 input が is-error 強調 (US-038)', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderNew()
    await screen.findByLabelText(/^駅名/)
    await user.type(screen.getByLabelText(/よみがな/), 'てすと')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(screen.getByText('駅名を入力してください')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // US-038: 駅名 input が is-error クラス + aria-invalid を持つ
    const nameInput = screen.getByLabelText(/^駅名/) as HTMLInputElement
    expect(nameInput.className).toMatch(/is-error/)
    expect(nameInput.getAttribute('aria-invalid')).toBe('true')
    // よみがな input は影響を受けない
    const kanaInput = screen.getByLabelText(/よみがな/) as HTMLInputElement
    expect(kanaInput.className).not.toMatch(/is-error/)
  })

  it('US-038: 駅番号フォーマットエラー時は該当 line の code input が is-error 強調', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderNew()
    await screen.findByLabelText(/^駅名/)
    await user.type(screen.getByLabelText(/^駅名/), '名古屋')
    await user.type(screen.getByLabelText(/よみがな/), 'なごや')
    // チェック ON にして駅番号 input を有効化
    await user.click(screen.getByLabelText('JR東海道線 に接続'))
    const codeInput = screen.getByLabelText(
      'JR東海道線 の駅番号',
    ) as HTMLInputElement
    // fireEvent で全角カタカナを直接セット (US-037 で除外したい値が手で入った想定)
    fireEvent.change(codeInput, { target: { value: 'カカ' } })
    await user.click(screen.getByRole('button', { name: '作成する' }))

    // バナー表示
    expect(
      screen.getByText(
        /駅番号は半角英数字 \+ ハイフン\/スラッシュのみ使用できます/,
      ),
    ).toBeInTheDocument()
    // 該当 input が is-error クラス
    expect(codeInput.className).toMatch(/is-error/)
    expect(codeInput.getAttribute('aria-invalid')).toBe('true')
  })

  it('よみがな空でフィールドエラー', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderNew()
    await screen.findByLabelText(/^駅名/)
    await user.type(screen.getByLabelText(/^駅名/), '駅')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(screen.getByText('よみがなを入力してください')).toBeInTheDocument()
  })

  it('400 unknown_line でフォーム内バナー', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'unknown_line' }), {
          status: 400,
        }),
      )
    renderNew()
    await screen.findByLabelText(/^駅名/)
    await user.type(screen.getByLabelText(/^駅名/), '駅')
    await user.type(screen.getByLabelText(/よみがな/), 'えき')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(
      await screen.findByText(
        '紐付けに含まれる路線が存在しません (削除済み?)',
      ),
    ).toBeInTheDocument()
  })

  it('キャンセルリンクは /admin/stations に戻る', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderNew()
    await screen.findByLabelText(/^駅名/)
    expect(
      screen.getByRole('link', { name: 'キャンセル' }),
    ).toHaveAttribute('href', '/admin/stations')
  })
})

describe('AdminStationEdit (US-026 編集)', () => {
  it('admin: 既存駅を pre-fill (ID は disabled, 注意書き + 駅番号表示)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stations: [STATION_NAGOYA] }), {
          status: 200,
        }),
      )
    renderEdit('stn-nagoya')
    await waitFor(() => {
      expect(screen.getByLabelText(/^ID/)).toHaveValue('stn-nagoya')
    })
    expect(screen.getByLabelText(/^ID/)).toBeDisabled()
    expect(screen.getByLabelText(/^駅名/)).toHaveValue('名古屋')
    expect(screen.getByLabelText(/よみがな/)).toHaveValue('なごや')
    expect(
      screen.getByText(/既存経路に登録されている駅名文字列は/),
    ).toBeInTheDocument()
    // 既存路線がチェック済み + 駅番号も pre-fill される (US-033)
    expect(
      (screen.getByLabelText('JR東海道線 に接続') as HTMLInputElement).checked,
    ).toBe(true)
    expect(
      (screen.getByLabelText('JR東海道線 の駅番号') as HTMLInputElement).value,
    ).toBe('CA68')
  })

  it('admin: 該当 id 無しなら「該当の駅が見つかりませんでした」', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stations: [] }), { status: 200 }),
      )
    renderEdit('does-not-exist')
    expect(
      await screen.findByText('該当の駅が見つかりませんでした'),
    ).toBeInTheDocument()
  })

  it('admin: 路線チェックを外して PUT 成功 → /admin/stations へ遷移', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stations: [STATION_NAGOYA] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...STATION_NAGOYA, lines: [] }), {
          status: 200,
        }),
      )
    renderEdit('stn-nagoya')
    await waitFor(() => {
      expect(screen.getByLabelText(/^駅名/)).toHaveValue('名古屋')
    })
    await user.click(screen.getByLabelText('JR東海道線 に接続'))
    await user.click(screen.getByRole('button', { name: '更新する' }))

    await waitFor(() => {
      expect(
        screen.getByText('ADMIN_STATIONS_PAGE notice=駅を更新しました'),
      ).toBeInTheDocument()
    })
    const [url, init] = fetchMock.mock.calls[2]!
    expect(url).toContain('/api/admin/stations/stn-nagoya')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body)
    expect(body.lineLinks).toEqual([])
  })
})
