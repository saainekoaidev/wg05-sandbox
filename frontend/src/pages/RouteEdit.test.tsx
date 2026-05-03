import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { RouteEdit } from './RouteEdit'

const mockUseSession = vi.fn()
const fetchMock = vi.fn()
const openMock = vi.fn(() => null as unknown as Window | null)

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
  useLines: () => ({
    lines: [
      { id: 'jr-yamanote', name: 'JR山手線', kind: 'train', operator: null, routeSegmentCount: 0, stationCount: 0 },
      { id: 'metro-ginza', name: '東京メトロ銀座線', kind: 'subway', operator: null, routeSegmentCount: 0, stationCount: 0 },
    ],
    loading: false,
    error: null,
    reload: () => {},
  }),
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

const ROUTE_NEWER = {
  ...ROUTE,
  name: '別の人が更新済み',
  updatedAt: '2026-05-02T10:00:00Z',
  segments: [
    {
      id: 's-new',
      orderIndex: 1,
      kind: 'train' as const,
      lineId: 'jr-yamanote',
      fromStation: '渋谷',
      toStation: '神田',
      fare: 320,
    },
  ],
}

function DetailProbe() {
  const location = useLocation()
  const state = location.state as { notice?: string } | null
  return <div>DETAIL_PAGE notice={state?.notice ?? '(none)'}</div>
}

function renderEdit(routeId = 'r-001') {
  return render(
    <MemoryRouter initialEntries={[`/routes/${routeId}/edit`]}>
      <Routes>
        <Route path="/routes/:id/edit" element={<RouteEdit />} />
        <Route path="/routes/:id" element={<DetailProbe />} />
        <Route path="/routes" element={<div>LIST_PAGE</div>} />
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
  openMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('open', openMock)
  vi.stubGlobal('confirm', vi.fn(() => true))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RouteEdit', () => {
  it('未ログインなら /login にリダイレクトする', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderEdit()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('200 でフォームに既存データがプリフィルされる', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderEdit()

    await waitFor(() => {
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤')
    })
    expect(screen.getByLabelText('区間1 出発駅')).toHaveValue('渋谷')
    expect(screen.getByLabelText('区間1 到着駅')).toHaveValue('表参道')
    expect(screen.getByLabelText('区間1 運賃')).toHaveValue(160)
    expect(screen.getByLabelText('区間2 出発駅')).toHaveValue('表参道')
    expect(screen.getByLabelText('区間2 到着駅')).toHaveValue('神田')
  })

  it('404 では「該当の経路が見つかりませんでした」を表示する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    )
    renderEdit()
    expect(
      await screen.findByText('該当の経路が見つかりませんでした'),
    ).toBeInTheDocument()
  })

  it('403 では「この経路を編集する権限がありません」を表示する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    )
    renderEdit()
    expect(
      await screen.findByText('この経路を編集する権限がありません'),
    ).toBeInTheDocument()
  })

  it('差分なしの状態では更新ボタン / リセットボタンが disabled', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    expect(screen.getByRole('button', { name: '更新する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'リセット' })).toBeDisabled()
  })

  it('入力を変更すると更新ボタン / リセットボタンが活性化する', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    await user.clear(screen.getByLabelText('経路名'))
    await user.type(screen.getByLabelText('経路名'), '平日新通勤')

    expect(screen.getByRole('button', { name: '更新する' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'リセット' })).not.toBeDisabled()
  })

  it('リセットボタン (confirm OK) でスナップショット (取得時状態) に戻る', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    await user.clear(screen.getByLabelText('経路名'))
    await user.type(screen.getByLabelText('経路名'), '変更後')
    await user.clear(screen.getByLabelText('区間1 運賃'))
    await user.type(screen.getByLabelText('区間1 運賃'), '999')

    await user.click(screen.getByRole('button', { name: 'リセット' }))

    expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤')
    expect(screen.getByLabelText('区間1 運賃')).toHaveValue(160)
  })

  it('更新成功で PUT /api/routes/:id が呼ばれ /routes/:id へ state.notice 付きで遷移', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ROUTE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...ROUTE, name: 'updated' }), {
          status: 200,
        }),
      )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    await user.clear(screen.getByLabelText('経路名'))
    await user.type(screen.getByLabelText('経路名'), 'updated')
    await user.click(screen.getByRole('button', { name: '更新する' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toBe('http://localhost:3000/api/routes/r-001')
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body as string)
    expect(body.name).toBe('updated')
    expect(body.updatedAt).toBe(ROUTE.updatedAt)
    expect(body.segments).toHaveLength(2)

    await waitFor(() => {
      expect(
        screen.getByText('DETAIL_PAGE notice=経路を更新しました'),
      ).toBeInTheDocument()
    })
  })

  it('409 conflict ではバナー + 最新値で再描画 (snapshot 更新, 遷移しない)', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ROUTE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'conflict',
            message:
              '他の場所で更新されたため最新の状態を再読込しました。再度ご確認ください',
            current: ROUTE_NEWER,
          }),
          { status: 409 },
        ),
      )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    await user.clear(screen.getByLabelText('経路名'))
    await user.type(screen.getByLabelText('経路名'), '自分の編集')
    await user.click(screen.getByRole('button', { name: '更新する' }))

    expect(
      await screen.findByText(/最新の状態を再読込/),
    ).toBeInTheDocument()
    // form は最新値で再描画される
    expect(screen.getByLabelText('経路名')).toHaveValue('別の人が更新済み')
    // 遷移していない
    expect(screen.queryByText(/DETAIL_PAGE/)).not.toBeInTheDocument()
    // 再描画後は再び差分なし状態 → 更新ボタン disabled
    expect(screen.getByRole('button', { name: '更新する' })).toBeDisabled()
  })

  it('送信時 401 で /login にリダイレクト', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ROUTE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
        }),
      )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    await user.clear(screen.getByLabelText('経路名'))
    await user.type(screen.getByLabelText('経路名'), 'x')
    await user.click(screen.getByRole('button', { name: '更新する' }))

    await waitFor(() => {
      expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    })
  })

  it('送信時 403 でエラーバナー', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ROUTE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
      )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    await user.clear(screen.getByLabelText('経路名'))
    await user.type(screen.getByLabelText('経路名'), 'x')
    await user.click(screen.getByRole('button', { name: '更新する' }))

    expect(
      await screen.findByText('この経路を編集する権限がありません'),
    ).toBeInTheDocument()
  })

  it('未入力 (区間 出発駅を空にして送信) でフィールドエラーが出て PUT は呼ばれない', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    await user.clear(screen.getByLabelText('区間1 出発駅'))
    await user.click(screen.getByRole('button', { name: '更新する' }))

    expect(
      screen.getByText('区間ごとに出発駅を入力してください'),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1) // 初期 GET だけ
  })

  it('キャンセルボタン (差分ありで confirm OK) で /routes/:id に戻る', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE), { status: 200 }),
    )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('経路名')).toHaveValue('平日通勤'),
    )

    await user.clear(screen.getByLabelText('経路名'))
    await user.type(screen.getByLabelText('経路名'), 'dirty')
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText(/DETAIL_PAGE/)).toBeInTheDocument()
    })
  })

  it('区間追加で 1区間 → 2区間になる + 削除で戻せる', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...ROUTE, segments: [ROUTE.segments[0]] }), {
        status: 200,
      }),
    )
    renderEdit()
    await waitFor(() =>
      expect(screen.getByLabelText('区間1 出発駅')).toHaveValue('渋谷'),
    )

    await user.click(screen.getByRole('button', { name: /区間を追加/ }))
    expect(screen.getByLabelText('区間2 出発駅')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '区間2 を削除' }))
    expect(screen.queryByLabelText('区間2 出発駅')).not.toBeInTheDocument()
  })
})
