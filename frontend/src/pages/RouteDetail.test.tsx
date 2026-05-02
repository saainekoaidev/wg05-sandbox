import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { RouteDetail } from './RouteDetail'

const mockUseSession = vi.fn()
const fetchMock = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

const ROUTE = {
  id: 'r-001',
  name: '平日通勤',
  fromStation: '渋谷',
  toStation: '神田',
  createdAt: '2026-04-30T01:00:00Z',
  updatedAt: '2026-05-01T03:30:00Z',
  segments: [
    {
      id: 's-1',
      orderIndex: 1,
      kind: 'train' as const,
      lineId: 'jr-yamanote',
      fromStation: '渋谷',
      toStation: '表参道',
      fare: 160,
    },
    {
      id: 's-2',
      orderIndex: 2,
      kind: 'subway' as const,
      lineId: 'metro-ginza',
      fromStation: '表参道',
      toStation: '神田',
      fare: 160,
    },
  ],
}

// ROUTES の遷移先で受け取った state を露出するスパイ
function RoutesProbe() {
  const location = useLocation()
  const state = location.state as { notice?: string } | null
  return <div>ROUTES_PAGE notice={state?.notice ?? '(none)'}</div>
}

function renderDetail(routeId = 'r-001') {
  return render(
    <MemoryRouter initialEntries={[`/routes/${routeId}`]}>
      <Routes>
        <Route path="/routes/:id" element={<RouteDetail />} />
        <Route path="/routes" element={<RoutesProbe />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'me@example.com' } },
    isPending: false,
  })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('confirm', vi.fn(() => true))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RouteDetail', () => {
  it('未ログインなら /login にリダイレクトする', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderDetail()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isPending 中は何も描画しない', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })
    const { container } = renderDetail()
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('正常レスポンスで詳細・区間明細・合計運賃が表示される', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderDetail()

    expect(await screen.findByText('平日通勤')).toBeInTheDocument()
    expect(screen.getByText('渋谷')).toBeInTheDocument()
    expect(screen.getByText('神田')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument() // 区間数
    expect(screen.getByText('¥320')).toBeInTheDocument() // 合計運賃 (160+160)

    // segment list 内の種別タグ + 路線名
    expect(
      screen.getByText('電車', { selector: 'span.tag-train' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('地下鉄', { selector: 'span.tag-subway' }),
    ).toBeInTheDocument()
    expect(screen.getByText('JR山手線')).toBeInTheDocument()
    expect(screen.getByText('東京メトロ銀座線')).toBeInTheDocument()
    // 区間ごとの flow
    expect(screen.getByText('渋谷 → 表参道')).toBeInTheDocument()
    expect(screen.getByText('表参道 → 神田')).toBeInTheDocument()
  })

  it('経路名 null は「(無題)」として表示される', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...ROUTE, name: null }), { status: 200 }),
    )
    renderDetail()
    expect(await screen.findByText('(無題)')).toBeInTheDocument()
  })

  it('404 では「該当の経路が見つかりませんでした」を表示する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    )
    renderDetail()
    expect(
      await screen.findByText('該当の経路が見つかりませんでした'),
    ).toBeInTheDocument()
  })

  it('403 では「この経路を表示する権限がありません」を表示する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    )
    renderDetail()
    expect(
      await screen.findByText('この経路を表示する権限がありません'),
    ).toBeInTheDocument()
  })

  it('401 では /login にリダイレクトする', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )
    renderDetail()
    await waitFor(() => {
      expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    })
  })

  it('500 などの汎用エラーでバナーを表示する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Server Error', { status: 500 }),
    )
    renderDetail()
    expect(
      await screen.findByText(/経路の取得に失敗しました/),
    ).toBeInTheDocument()
  })

  it('編集ボタンは /routes/:id/edit へのリンクとして有効化されている (US-006)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderDetail()
    await screen.findByText('平日通勤')

    const editLink = screen.getByRole('link', { name: '編集' })
    expect(editLink).toHaveAttribute('href', '/routes/r-001/edit')
  })

  it('削除ボタン: confirm キャンセルで DELETE は呼ばれない', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('confirm', vi.fn(() => false))
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderDetail()
    await screen.findByText('平日通勤')

    await user.click(screen.getByRole('button', { name: '削除' }))

    // GET は呼ばれているが DELETE は呼ばれていない (fetch は1回だけ)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledWith('この経路を削除しますか?')
  })

  it('削除成功で /routes に navigate state.notice 付きで遷移する', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ROUTE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
    renderDetail()
    await screen.findByText('平日通勤')

    await user.click(screen.getByRole('button', { name: '削除' }))

    // 2回目の fetch は DELETE
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toBe('http://localhost:3000/api/routes/r-001')
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('include')

    // 遷移先で notice を確認
    await waitFor(() => {
      expect(
        screen.getByText('ROUTES_PAGE notice=経路を削除しました'),
      ).toBeInTheDocument()
    })
  })

  it('削除中はボタンが「削除中…」になり disabled', async () => {
    const user = userEvent.setup()
    let resolveDelete: (v: Response) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ROUTE), { status: 200 }),
      )
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolveDelete = r
        }),
      )
    renderDetail()
    await screen.findByText('平日通勤')

    await user.click(screen.getByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '削除中…' }),
      ).toBeDisabled()
    })

    resolveDelete(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await waitFor(() => {
      expect(
        screen.getByText('ROUTES_PAGE notice=経路を削除しました'),
      ).toBeInTheDocument()
    })
  })

  it('削除 403 でエラーバナーを表示し、/routes へ遷移しない', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ROUTE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
      )
    renderDetail()
    await screen.findByText('平日通勤')

    await user.click(screen.getByRole('button', { name: '削除' }))

    expect(
      await screen.findByText('この経路を削除する権限がありません'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/ROUTES_PAGE/)).not.toBeInTheDocument()
  })

  it('削除 404 でエラーバナーを表示し、/routes へ遷移しない', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ROUTE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
      )
    renderDetail()
    await screen.findByText('平日通勤')

    await user.click(screen.getByRole('button', { name: '削除' }))

    expect(
      await screen.findByText(
        /既に削除されている可能性があります/,
      ),
    ).toBeInTheDocument()
  })

  it('「一覧に戻る」リンクで /routes に戻る', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderDetail()
    await screen.findByText('平日通勤')

    await user.click(screen.getByRole('link', { name: '一覧に戻る' }))
    expect(screen.getByText(/ROUTES_PAGE/)).toBeInTheDocument()
  })
})
