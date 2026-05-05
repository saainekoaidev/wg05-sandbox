import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RouteList } from './RouteList'

const mockUseSession = vi.fn()
const mockSignOut = vi.fn()
const fetchMock = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: (...args: unknown[]) => mockSignOut(...args),
  useSession: () => mockUseSession(),
}))

// 路線マスタ (frontend/src/lib/lines.ts) は本番では US-011 取り込み待ちで空配列にしている。
// 一覧画面のレンダリングテストは「路線名」の表示確認に依存するため、テスト時のみ最小限の
// 路線データを vi.mock で注入する (本番動作には影響しない)。
vi.mock('../lib/lines', () => ({
  KIND_OPTIONS: [
    { value: 'train', label: '電車' },
    { value: 'subway', label: '地下鉄' },
    { value: 'bus', label: 'バス' },
    { value: 'other', label: 'その他' },
  ],
  // 一覧画面の路線名表示用フック (US-011 で動的化)。テスト中は固定値を返す。
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

function renderRouteList(state?: { notice?: string }) {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/routes', state: state ?? null }]}
    >
      <Routes>
        <Route path="/routes" element={<RouteList />} />
        <Route path="/routes/new" element={<div>ROUTE_REGISTER_PAGE</div>} />
        <Route
          path="/routes/:id"
          element={<div>ROUTE_DETAIL_PAGE</div>}
        />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const ROUTE_A = {
  id: 'r-a',
  name: '平日通勤',
  fromStation: '渋谷',
  toStation: '神田',
  createdAt: '2026-04-30T10:00:00Z',
  updatedAt: '2026-05-01T12:00:00Z',
  segments: [
    {
      id: 's-a-1',
      orderIndex: 1,
      kind: 'train' as const,
      lineId: 'jr-yamanote',
      fromStation: '渋谷',
      toStation: '表参道',
      fare: 160,
    },
    {
      id: 's-a-2',
      orderIndex: 2,
      kind: 'subway' as const,
      lineId: 'metro-ginza',
      fromStation: '表参道',
      toStation: '神田',
      fare: 160,
    },
  ],
}

const ROUTE_B = {
  id: 'r-b',
  name: null,
  fromStation: '池袋',
  toStation: '東京',
  createdAt: '2026-04-29T08:00:00Z',
  updatedAt: '2026-04-29T08:00:00Z',
  segments: [
    {
      id: 's-b-1',
      orderIndex: 1,
      kind: 'train' as const,
      lineId: 'jr-yamanote',
      fromStation: '池袋',
      toStation: '東京',
      fare: 220,
    },
  ],
}

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'me@example.com', name: '山田 太郎' } },
    isPending: false,
  })
  fetchMock.mockReset()
  mockSignOut.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RouteList', () => {
  it('未ログインなら /login にリダイレクトする (fetch しない)', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderRouteList()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isPending 中は何も描画せず fetch も走らない', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })
    const { container } = renderRouteList()
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ロード中は「読み込み中…」を表示し、ヘッダの UserBadge と フッタが描画される (US-019)', async () => {
    let resolve: (v: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolve = r }))
    renderRouteList()

    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
    // US-019: ヘッダ右上の UserBadge に氏名が出る (「ユーザー: 」ラベル無し)
    expect(screen.getByText('山田 太郎')).toBeInTheDocument()
    expect(screen.queryByText(/ユーザー[:：]/)).not.toBeInTheDocument()

    resolve(new Response(JSON.stringify({ routes: [] }), { status: 200 }))
    await waitFor(() => {
      expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument()
    })
  })

  it('name が空文字の場合は email にフォールバックして表示する (US-019)', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', email: 'fallback@example.com', name: '' } },
      isPending: false,
    })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [] }), { status: 200 }),
    )
    renderRouteList()
    // US-019: ヘッダ右上 UserBadge に email が表示される (name 空時のフォールバック)
    expect(
      await screen.findByText('fallback@example.com'),
    ).toBeInTheDocument()
  })

  it('0件時に空状態メッセージと新規登録誘導が表示される', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [] }), { status: 200 }),
    )
    renderRouteList()

    expect(
      await screen.findByText('まだ通勤経路が登録されていません。'),
    ).toBeInTheDocument()
    // 新規登録誘導ボタン (ヘッダ + 空状態の2箇所)
    const links = screen.getAllByRole('link', { name: '+ 新規登録' })
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const a of links) {
      expect(a).toHaveAttribute('href', '/routes/new')
    }
  })

  it('1件以上で表 (経路名 / 種別タグ / 路線サマリ / 出発→到着 / 区間数 / 合計運賃) が描画される', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
    )
    renderRouteList()

    // 経路名
    expect(await screen.findByText('平日通勤')).toBeInTheDocument()

    // 種別タグ (重複しないユニーク集合を train→subway 順で表示)
    const trainTag = screen.getByText('電車', {
      selector: 'span.tag-train',
    })
    const subwayTag = screen.getByText('地下鉄', {
      selector: 'span.tag-subway',
    })
    expect(trainTag).toBeInTheDocument()
    expect(subwayTag).toBeInTheDocument()

    // 路線サマリ ( / 区切り)
    expect(screen.getByText(/JR山手線/)).toBeInTheDocument()
    expect(screen.getByText(/銀座線/)).toBeInTheDocument()

    // 出発 → 到着
    expect(screen.getByText('渋谷 → 神田')).toBeInTheDocument()

    // 合計運賃 (160+160 = ¥320)
    expect(screen.getByText('¥320')).toBeInTheDocument()
  })

  it('経路名が null の経路は「(無題)」として表示される', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [ROUTE_B] }), { status: 200 }),
    )
    renderRouteList()
    expect(await screen.findByText('(無題)')).toBeInTheDocument()
  })

  it('行内アクション: 詳細・編集・削除がそれぞれ有効化されている', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
    )
    renderRouteList()

    const row = (await screen.findByText('平日通勤')).closest('tr')!
    const utils = within(row as HTMLElement)

    const detailLink = utils.getByRole('link', { name: /詳細/ })
    const editLink = utils.getByRole('link', { name: /編集/ })
    const deleteBtn = utils.getByRole('button', { name: /削除/ })

    expect(detailLink).toHaveAttribute('href', '/routes/r-a')
    expect(editLink).toHaveAttribute('href', '/routes/r-a/edit')
    expect(deleteBtn).not.toBeDisabled()
  })

  it('複数経路がレスポンス順 (updatedAt DESC) で表示される', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [ROUTE_A, ROUTE_B] }), {
        status: 200,
      }),
    )
    renderRouteList()

    const cells = await screen.findAllByRole('cell')
    // 1番目の「経路名」セル (= 2番目のセル) は ROUTE_A
    // 各行は 7セル (#, 経路名, 種別/路線, 出発→到着, 区間, 合計運賃, 操作) + ヘッダ
    // ヘッダは th 扱いなので role=cell には含まれない想定。
    // 雑に検証: 平日通勤 が (無題) より先に表示される
    const html = document.body.innerHTML
    const idxA = html.indexOf('平日通勤')
    const idxB = html.indexOf('(無題)')
    expect(idxA).toBeGreaterThan(-1)
    expect(idxB).toBeGreaterThan(-1)
    expect(idxA).toBeLessThan(idxB)
    expect(cells.length).toBeGreaterThanOrEqual(7 * 2)
  })

  it('401 を受けたら /login にリダイレクトする', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )
    renderRouteList()
    await waitFor(() => {
      expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    })
  })

  it('500 等のサーバエラーでバナーエラーを表示する', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Server Error', { status: 500 }),
    )
    renderRouteList()
    expect(
      await screen.findByText(
        '経路一覧の取得に失敗しました。再読み込みをお試しください',
      ),
    ).toBeInTheDocument()
  })

  it('fetch の例外でも同じバナーエラーを表示する', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    renderRouteList()
    expect(
      await screen.findByText(
        '経路一覧の取得に失敗しました。再読み込みをお試しください',
      ),
    ).toBeInTheDocument()
  })

  it('fetch は credentials=include で /api/routes を叩く', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [] }), { status: 200 }),
    )
    renderRouteList()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/api/routes')
    expect(init.credentials).toBe('include')
  })

  it('US-061: ログアウトリンクは経路一覧から除去された (アカウント画面に集約)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [] }), { status: 200 }),
    )
    renderRouteList()
    await screen.findByText('まだ通勤経路が登録されていません。')
    expect(
      screen.queryByRole('link', { name: 'ログアウト' }),
    ).not.toBeInTheDocument()
  })

  it('+ 新規登録 リンクで /routes/new に遷移する', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
    )
    renderRouteList()
    await screen.findByText('平日通勤')

    // ヘッダの「+ 新規登録」リンクは1個 (空状態でないため)
    await user.click(screen.getByRole('link', { name: '+ 新規登録' }))
    expect(screen.getByText('ROUTE_REGISTER_PAGE')).toBeInTheDocument()
  })

  it('詳細リンク押下で /routes/:id に遷移する (US-005 で有効化)', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
    )
    renderRouteList()
    await screen.findByText('平日通勤')

    await user.click(screen.getByRole('link', { name: /詳細/ }))
    expect(screen.getByText('ROUTE_DETAIL_PAGE')).toBeInTheDocument()
  })

  it('navigate state.notice があればバナーで通知が表示される (削除完了想定)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [] }), { status: 200 }),
    )
    renderRouteList({ notice: '経路を削除しました' })

    expect(
      await screen.findByText(/経路を削除しました/),
    ).toBeInTheDocument()
  })

  it('通知バナーの「×」で notice を閉じられる', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [] }), { status: 200 }),
    )
    renderRouteList({ notice: '経路を削除しました' })

    expect(
      await screen.findByText(/経路を削除しました/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '通知を閉じる' }))
    expect(
      screen.queryByText(/経路を削除しました/),
    ).not.toBeInTheDocument()
  })

  describe('削除 (US-007)', () => {
    it('削除ボタン押下で確認ダイアログを出し, キャンセルなら fetch しない', async () => {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
      )
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      try {
        renderRouteList()
        await screen.findByText('平日通勤')
        await user.click(screen.getByRole('button', { name: /削除/ }))

        expect(confirmSpy).toHaveBeenCalledWith('この経路を削除しますか?')
        // fetch は初回の一覧取得のみ
        expect(fetchMock).toHaveBeenCalledTimes(1)
        // 行はそのまま残っている
        expect(screen.getByText('平日通勤')).toBeInTheDocument()
      } finally {
        confirmSpy.mockRestore()
      }
    })

    it('OK 押下で DELETE が走り, 行が消えて成功バナーが出る', async () => {
      const user = userEvent.setup()
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ routes: [ROUTE_A, ROUTE_B] }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      try {
        renderRouteList()
        await screen.findByText('平日通勤')

        const row = screen.getByText('平日通勤').closest('tr')!
        await user.click(within(row as HTMLElement).getByRole('button', { name: /削除/ }))

        await waitFor(() => {
          expect(screen.queryByText('平日通勤')).not.toBeInTheDocument()
        })
        // 残っているのは ROUTE_B のみ
        expect(screen.getByText('(無題)')).toBeInTheDocument()
        // 成功バナー
        expect(screen.getByText(/経路を削除しました/)).toBeInTheDocument()

        // 2回目の fetch は DELETE
        const [url, init] = fetchMock.mock.calls[1]!
        expect(url).toContain('/api/routes/r-a')
        expect(init.method).toBe('DELETE')
        expect(init.credentials).toBe('include')
      } finally {
        confirmSpy.mockRestore()
      }
    })

    it('DELETE 401 なら /login にリダイレクト', async () => {
      const user = userEvent.setup()
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
        )
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      try {
        renderRouteList()
        await screen.findByText('平日通勤')
        await user.click(screen.getByRole('button', { name: /削除/ }))
        await waitFor(() => {
          expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
        })
      } finally {
        confirmSpy.mockRestore()
      }
    })

    it('DELETE 403 なら権限エラーバナーを表示し行は残る', async () => {
      const user = userEvent.setup()
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
        )
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      try {
        renderRouteList()
        await screen.findByText('平日通勤')
        await user.click(screen.getByRole('button', { name: /削除/ }))

        expect(
          await screen.findByText('この経路を削除する権限がありません'),
        ).toBeInTheDocument()
        // 行は残る
        expect(screen.getByText('平日通勤')).toBeInTheDocument()
      } finally {
        confirmSpy.mockRestore()
      }
    })

    it('DELETE 404 なら行は消し, 既に削除済みである旨のバナーを出す', async () => {
      const user = userEvent.setup()
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
        )
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      try {
        renderRouteList()
        await screen.findByText('平日通勤')
        await user.click(screen.getByRole('button', { name: /削除/ }))

        await waitFor(() => {
          expect(screen.queryByText('平日通勤')).not.toBeInTheDocument()
        })
        expect(
          screen.getByText(/該当の経路が見つかりませんでした/),
        ).toBeInTheDocument()
      } finally {
        confirmSpy.mockRestore()
      }
    })

    it('DELETE 500 なら失敗バナーを表示し行は残る', async () => {
      const user = userEvent.setup()
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      try {
        renderRouteList()
        await screen.findByText('平日通勤')
        await user.click(screen.getByRole('button', { name: /削除/ }))

        expect(
          await screen.findByText(
            '経路の削除に失敗しました。再度お試しください',
          ),
        ).toBeInTheDocument()
        expect(screen.getByText('平日通勤')).toBeInTheDocument()
      } finally {
        confirmSpy.mockRestore()
      }
    })

    it('fetch 例外でも失敗バナーを表示する', async () => {
      const user = userEvent.setup()
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ routes: [ROUTE_A] }), { status: 200 }),
        )
        .mockRejectedValueOnce(new Error('network down'))
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      try {
        renderRouteList()
        await screen.findByText('平日通勤')
        await user.click(screen.getByRole('button', { name: /削除/ }))

        expect(
          await screen.findByText(
            '経路の削除に失敗しました。再度お試しください',
          ),
        ).toBeInTheDocument()
      } finally {
        confirmSpy.mockRestore()
      }
    })
  })
})
