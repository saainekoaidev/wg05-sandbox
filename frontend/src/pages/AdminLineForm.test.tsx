import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AdminLineNew, AdminLineEdit } from './AdminLineForm'

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
  operatorId: 'jr-tokai',
  operatorName: 'JR東海',
  routeSegmentCount: 0,
  stationCount: 5,
}

const OPERATORS = [
  { id: 'jr-tokai', name: 'JR東海', aliases: [], kinds: ['train'] },
  { id: 'meitetsu', name: '名古屋鉄道', aliases: [], kinds: ['train'] },
]

function NavSpy() {
  const loc = useLocation()
  const state = loc.state as { notice?: string } | null
  return (
    <div>
      ADMIN_LINES_PAGE notice={state?.notice ?? '(none)'}
    </div>
  )
}

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/admin/lines/new']}>
      <Routes>
        <Route path="/admin/lines/new" element={<AdminLineNew />} />
        <Route path="/admin/lines" element={<NavSpy />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderEdit(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/lines/${id}/edit`]}>
      <Routes>
        <Route path="/admin/lines/:id/edit" element={<AdminLineEdit />} />
        <Route path="/admin/lines" element={<NavSpy />} />
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
    operators: OPERATORS,
    loading: false,
    error: null,
    reload: () => {},
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminLineNew (US-025 新規作成)', () => {
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

  it('admin: 正常入力で POST が credentials 付きで呼ばれ /admin/lines に notice 付きで遷移', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(LINE_TOKAIDO), { status: 201 }),
      )
    renderNew()
    await screen.findByLabelText(/^ID/)

    await user.type(screen.getByLabelText(/^ID/), 'jr-test')
    await user.type(screen.getByLabelText(/^路線名/), '新しい路線')
    await user.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => {
      expect(
        screen.getByText('ADMIN_LINES_PAGE notice=路線を作成しました'),
      ).toBeInTheDocument()
    })
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toContain('/api/lines')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      id: 'jr-test',
      name: '新しい路線',
      kind: 'train',
    })
  })

  it('ID 空でフィールドエラー (POST 呼ばれない)', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderNew()
    await screen.findByLabelText(/^ID/)
    await user.type(screen.getByLabelText(/^路線名/), 'X')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(screen.getByText('IDを入力してください')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ID 形式違反でフィールドエラー', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderNew()
    await screen.findByLabelText(/^ID/)
    await user.type(screen.getByLabelText(/^ID/), 'has space')
    await user.type(screen.getByLabelText(/^路線名/), 'X')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(
      screen.getByText(
        'IDは半角英数字 + ハイフン/ドット/アンダースコアのみ使用できます',
      ),
    ).toBeInTheDocument()
  })

  it('409 重複でフォーム内バナー', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'duplicate' }), { status: 409 }),
      )
    renderNew()
    await screen.findByLabelText(/^ID/)
    await user.type(screen.getByLabelText(/^ID/), 'dup')
    await user.type(screen.getByLabelText(/^路線名/), 'X')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(
      await screen.findByText('同じIDまたは路線名が既に登録されています'),
    ).toBeInTheDocument()
  })

  it('キャンセルリンクは /admin/lines に戻る', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderNew()
    await screen.findByLabelText(/^ID/)
    expect(
      screen.getByRole('link', { name: 'キャンセル' }),
    ).toHaveAttribute('href', '/admin/lines')
  })
})

describe('AdminLineEdit (US-025 編集)', () => {
  it('admin: 既存路線を pre-fill する (ID は disabled)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderEdit('jr-tokaido')
    await waitFor(() => {
      expect(screen.getByLabelText(/^ID/)).toHaveValue('jr-tokaido')
    })
    expect(screen.getByLabelText(/^ID/)).toBeDisabled()
    expect(screen.getByLabelText(/^路線名/)).toHaveValue('JR東海道線')
    // US-049: 運営会社は dropdown (operatorId を value に持つ)
    expect(screen.getByLabelText(/運営会社/)).toHaveValue('jr-tokai')
  })

  it('admin: 該当 id が無い場合は「該当の路線が見つかりません」表示', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderEdit('does-not-exist')
    expect(
      await screen.findByText('該当の路線が見つかりませんでした'),
    ).toBeInTheDocument()
  })

  it('admin: 路線名を更新すると PUT が呼ばれ /admin/lines に遷移', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...LINE_TOKAIDO, name: '改称線' }),
          { status: 200 },
        ),
      )
    renderEdit('jr-tokaido')
    await waitFor(() => {
      expect(screen.getByLabelText(/^路線名/)).toHaveValue('JR東海道線')
    })
    await user.clear(screen.getByLabelText(/^路線名/))
    await user.type(screen.getByLabelText(/^路線名/), '改称線')
    await user.click(screen.getByRole('button', { name: '更新する' }))

    await waitFor(() => {
      expect(
        screen.getByText('ADMIN_LINES_PAGE notice=路線を更新しました'),
      ).toBeInTheDocument()
    })
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toContain('/api/lines/jr-tokaido')
    expect(init.method).toBe('PUT')
  })
})
