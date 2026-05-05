import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RouteRegister } from './RouteRegister'

const mockUseSession = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

// useLines stub: /api/lines の fetch がテストの fetchMock に取られないよう module 側でモック。
vi.mock('../lib/lines', () => ({
  KIND_OPTIONS: [
    { value: 'train', label: '電車' },
    { value: 'subway', label: '地下鉄' },
    { value: 'bus', label: 'バス' },
    { value: 'other', label: 'その他' },
  ],
  useLines: () => ({
    lines: [
      { id: 'jr-yamanote', name: 'JR山手線', kind: 'train', operator: 'JR東日本', operatorId: 'jr-east', operatorName: 'JR東日本', routeSegmentCount: 0, stationCount: 0 },
      { id: 'metro-ginza', name: '東京メトロ銀座線', kind: 'subway', operator: '東京メトロ', operatorId: 'metro', operatorName: '東京メトロ', routeSegmentCount: 0, stationCount: 0 },
    ],
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

// US-049 / US-050: operator マスタ stub
vi.mock('../lib/operators', () => ({
  useOperators: () => ({
    operators: [
      { id: 'jr-east', name: 'JR東日本', aliases: [], kinds: ['train'] },
      { id: 'metro', name: '東京メトロ', aliases: [], kinds: ['subway'] },
    ],
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

function renderRouteRegister() {
  return render(
    <MemoryRouter initialEntries={['/routes/new']}>
      <Routes>
        <Route path="/routes/new" element={<RouteRegister />} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const fetchMock = vi.fn()
const openMock = vi.fn(() => null as unknown as Window | null)

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

describe('RouteRegister', () => {
  it('未ログインなら /login にリダイレクトする', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderRouteRegister()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
  })

  it('既ログインならフォームを描画する (見出し / 主要ボタン / + 区間を追加)', () => {
    renderRouteRegister()
    expect(
      screen.getByRole('heading', { name: '新規通勤経路の登録' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('経路名')).toBeInTheDocument()
    expect(screen.getByLabelText('区間1 種別')).toBeInTheDocument()
    expect(screen.getByLabelText('区間1 路線名')).toBeInTheDocument()
    expect(screen.getByLabelText('区間1 出発駅')).toBeInTheDocument()
    expect(screen.getByLabelText('区間1 到着駅')).toBeInTheDocument()
    expect(screen.getByLabelText('区間1 運賃')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '登録する' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /区間を追加/ }),
    ).toBeInTheDocument()
  })

  it('区間が1件しか無いときは削除ボタンが非活性 (最低1区間ガード)', () => {
    renderRouteRegister()
    expect(
      screen.getByRole('button', { name: '区間1 を削除' }),
    ).toBeDisabled()
  })

  it('区間追加ボタンで2件目が描画され、削除すると1件に戻る', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    await user.click(screen.getByRole('button', { name: /区間を追加/ }))
    expect(screen.getByLabelText('区間2 種別')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '区間1 を削除' }),
    ).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: '区間2 を削除' }))
    expect(screen.queryByLabelText('区間2 種別')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '区間1 を削除' }),
    ).toBeDisabled()
  })

  it('区間が10件に達したら追加ボタンが非活性 (上限ガード)', async () => {
    const user = userEvent.setup()
    renderRouteRegister()
    const addBtn = screen.getByRole('button', { name: /区間を追加/ })
    for (let i = 0; i < 9; i++) await user.click(addBtn)
    expect(screen.getByLabelText('区間10 種別')).toBeInTheDocument()
    expect(addBtn).toBeDisabled()
  })

  it('入力に応じて派生サマリ (出発 / 到着 / 合計運賃) が更新される', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    await user.type(screen.getByLabelText('区間1 出発駅'), '渋谷')
    await user.type(screen.getByLabelText('区間1 到着駅'), '表参道')
    await user.type(screen.getByLabelText('区間1 運賃'), '160')
    expect(screen.getByText('渋谷')).toBeInTheDocument()
    expect(screen.getByText('表参道')).toBeInTheDocument()
    expect(screen.getByText('合計運賃: ¥160')).toBeInTheDocument()

    // 区間追加して合計が積み上がる
    await user.click(screen.getByRole('button', { name: /区間を追加/ }))
    await user.type(screen.getByLabelText('区間2 出発駅'), '表参道')
    await user.type(screen.getByLabelText('区間2 到着駅'), '神田')
    await user.type(screen.getByLabelText('区間2 運賃'), '170')

    expect(screen.getByText('合計運賃: ¥330')).toBeInTheDocument()
    // 到着駅は 最終区間の到着 になる
    expect(screen.getByText('神田')).toBeInTheDocument()
  })

  it('未入力で送信するとフィールドエラーが出て fetch は呼ばれない', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      screen.getByText('区間ごとに出発駅を入力してください'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('区間ごとに到着駅を入力してください'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('区間ごとに運賃を入力してください'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('区間内で出発駅と到着駅が同じならフィールドエラー', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    await user.type(screen.getByLabelText('区間1 出発駅'), '渋谷')
    await user.type(screen.getByLabelText('区間1 到着駅'), '渋谷')
    await user.type(screen.getByLabelText('区間1 運賃'), '160')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      screen.getByText('区間内で出発駅と到着駅が同じです'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('駅選択ボタン押下で window.open が station-picker 名で呼ばれる (US-016)', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    // US-057: 区間の初期 kind は '' (指定なし) なので URL は ?kind なし
    const pickButtons = screen.getAllByRole('button', { name: '駅選択' })
    await user.click(pickButtons[0]!)

    expect(openMock).toHaveBeenCalledTimes(1)
    const args = openMock.mock.calls[0]!
    expect(args[0]).toBe('/stations')
    expect(args[1]).toBe('wg05-station-picker')
  })

  it('US-016: 種別と路線が両方選択されている状態で駅選択を押すと両方が URL に含まれる', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    // 区間1 の路線を変更 → applyLine wrapper が kind=train を hard-set する
    const lineSelect = screen.getByRole('combobox', {
      name: '区間1 路線名',
    }) as HTMLSelectElement
    await user.selectOptions(lineSelect, 'jr-yamanote')

    await user.click(
      screen.getAllByRole('button', { name: '駅選択' })[0]!,
    )
    expect(openMock).toHaveBeenCalledTimes(1)
    const url = openMock.mock.calls[0]![0]
    expect(url).toContain('kind=train')
    expect(url).toContain('line=jr-yamanote')
  })

  it('postMessage (station-pick) を受けると対象の駅入力欄に値が反映される', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    // 区間1 出発駅 用に picker を開く (pendingTarget をセット)
    await user.click(screen.getAllByRole('button', { name: '駅選択' })[0]!)

    // popup から駅名が postMessage で届く
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'station-pick', name: '新宿' },
      }),
    )

    await waitFor(() => {
      expect(screen.getByLabelText('区間1 出発駅')).toHaveValue('新宿')
    })
  })

  it('送信成功で POST /api/routes が credentials 付きで呼ばれ /routes に遷移する', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'r1' }), { status: 201 }),
    )
    renderRouteRegister()

    await user.type(screen.getByLabelText('経路名'), '平日通勤')
    // US-057: 運営会社 + 種別 必須
    await user.selectOptions(screen.getByLabelText('区間1 運営会社'), 'jr-east')
    await user.selectOptions(screen.getByLabelText('区間1 種別'), 'train')
    await user.type(screen.getByLabelText('区間1 出発駅'), '渋谷')
    await user.type(screen.getByLabelText('区間1 到着駅'), '神田')
    await user.type(screen.getByLabelText('区間1 運賃'), '200')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:3000/api/routes')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      name: '平日通勤',
      segments: [
        {
          kind: 'train',
          fromStation: '渋谷',
          toStation: '神田',
          fare: 200,
        },
      ],
    })
    expect(body.segments[0].lineId).toBeNull()

    await waitFor(() => {
      expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
    })
  })

  it('送信時 401 を受けたら /login へリダイレクトする', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )
    renderRouteRegister()

    await user.selectOptions(screen.getByLabelText('区間1 運営会社'), 'jr-east')
    await user.selectOptions(screen.getByLabelText('区間1 種別'), 'train')
    await user.type(screen.getByLabelText('区間1 出発駅'), '渋谷')
    await user.type(screen.getByLabelText('区間1 到着駅'), '神田')
    await user.type(screen.getByLabelText('区間1 運賃'), '200')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => {
      expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    })
  })

  it('送信時 400 (validation_failed) ならバナーエラーを出して /routes へ遷移しない', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'validation_failed' }), {
        status: 400,
      }),
    )
    renderRouteRegister()

    await user.selectOptions(screen.getByLabelText('区間1 運営会社'), 'jr-east')
    await user.selectOptions(screen.getByLabelText('区間1 種別'), 'train')
    await user.type(screen.getByLabelText('区間1 出発駅'), '渋谷')
    await user.type(screen.getByLabelText('区間1 到着駅'), '神田')
    await user.type(screen.getByLabelText('区間1 運賃'), '200')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      await screen.findByText(/入力内容に誤りがあります/),
    ).toBeInTheDocument()
    expect(screen.queryByText('ROUTES_PAGE')).not.toBeInTheDocument()
  })

  it('送信中はボタンが「登録中…」になり全アクションが非活性になる', async () => {
    const user = userEvent.setup()
    let resolve: (v: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r
      }),
    )
    renderRouteRegister()

    await user.selectOptions(screen.getByLabelText('区間1 運営会社'), 'jr-east')
    await user.selectOptions(screen.getByLabelText('区間1 種別'), 'train')
    await user.type(screen.getByLabelText('区間1 出発駅'), '渋谷')
    await user.type(screen.getByLabelText('区間1 到着駅'), '神田')
    await user.type(screen.getByLabelText('区間1 運賃'), '200')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '登録中…' }),
      ).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: 'リセット' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()

    resolve(new Response(JSON.stringify({ id: 'r2' }), { status: 201 }))
    await waitFor(() => {
      expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
    })
  })

  it('キャンセルボタン (入力ありで confirm OK) で /routes に戻る', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    await user.type(screen.getByLabelText('経路名'), '平日通勤')
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
  })

  it('リセットボタン (confirm OK) で全フィールドが初期状態に戻り、合計も 0 円になる', async () => {
    const user = userEvent.setup()
    renderRouteRegister()

    await user.type(screen.getByLabelText('経路名'), 'X')
    await user.type(screen.getByLabelText('区間1 出発駅'), '渋谷')
    await user.type(screen.getByLabelText('区間1 到着駅'), '神田')
    await user.type(screen.getByLabelText('区間1 運賃'), '200')

    await user.click(screen.getByRole('button', { name: 'リセット' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(screen.getByLabelText('経路名')).toHaveValue('')
    expect(screen.getByLabelText('区間1 出発駅')).toHaveValue('')
    expect(screen.getByLabelText('区間1 到着駅')).toHaveValue('')
    expect(screen.getByText('合計運賃: ¥0')).toBeInTheDocument()
  })

  describe('US-020 種別↔路線 cascade フィルタ (区間)', () => {
    it('種別=電車 のとき路線セレクトの選択肢は train 路線のみ', async () => {
      const user = userEvent.setup()
      renderRouteRegister()
      // US-057: 区間の初期 kind は '' なので明示選択する
      const kindSelect = screen.getByRole('combobox', {
        name: '区間1 種別',
      }) as HTMLSelectElement
      await user.selectOptions(kindSelect, 'train')
      const lineSelect = screen.getByRole('combobox', {
        name: '区間1 路線名',
      }) as HTMLSelectElement
      const opts = Array.from(lineSelect.options).map((o) => o.text)
      expect(opts).toEqual(['(未選択)', 'JR山手線'])
    })

    it('種別を地下鉄に変えると路線セレクトに subway 路線のみ', async () => {
      const user = userEvent.setup()
      renderRouteRegister()
      const kindSelect = screen.getByRole('combobox', {
        name: '区間1 種別',
      }) as HTMLSelectElement
      await user.selectOptions(kindSelect, 'subway')
      const lineSelect = screen.getByRole('combobox', {
        name: '区間1 路線名',
      }) as HTMLSelectElement
      const opts = Array.from(lineSelect.options).map((o) => o.text)
      expect(opts).toEqual(['(未選択)', '東京メトロ銀座線'])
    })

    it('地下鉄路線を選ぶと種別が地下鉄に自動で揃う', async () => {
      const user = userEvent.setup()
      renderRouteRegister()
      const kindSelect = screen.getByRole('combobox', {
        name: '区間1 種別',
      }) as HTMLSelectElement
      // 一旦 種別 = 地下鉄 にして metro-ginza を選択肢に出す
      await user.selectOptions(kindSelect, 'subway')
      const lineSelect = screen.getByRole('combobox', {
        name: '区間1 路線名',
      }) as HTMLSelectElement
      await user.selectOptions(lineSelect, 'metro-ginza')
      expect(kindSelect.value).toBe('subway')
      expect(lineSelect.value).toBe('metro-ginza')
    })

    it('種別を変えて現在選択中の路線が矛盾するならクリアされる', async () => {
      const user = userEvent.setup()
      renderRouteRegister()
      const kindSelect = screen.getByRole('combobox', {
        name: '区間1 種別',
      }) as HTMLSelectElement
      const lineSelect = screen.getByRole('combobox', {
        name: '区間1 路線名',
      }) as HTMLSelectElement
      // 電車 + JR山手線
      await user.selectOptions(lineSelect, 'jr-yamanote')
      expect(lineSelect.value).toBe('jr-yamanote')
      // 種別を地下鉄に → 山手線 (train) が矛盾するためクリア
      await user.selectOptions(kindSelect, 'subway')
      expect(kindSelect.value).toBe('subway')
      expect(lineSelect.value).toBe('')
    })
  })
})

// 派生サマリ・タグ表示の補助検証
describe('RouteRegister (派生サマリ / 補助)', () => {
  it('未入力時の派生サマリは「(未入力)」を薄く表示する', () => {
    renderRouteRegister()
    const summary = screen.getByText('合計運賃: ¥0').closest('.route-summary')!
    expect(within(summary as HTMLElement).getAllByText('(未入力)').length).toBe(2)
  })
})
