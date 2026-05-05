import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminStations } from './AdminStations'

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

// US-032: AdminStations は useLines を使うようになったので fetch ではなく hook をモック
vi.mock('../lib/lines', () => ({
  KIND_OPTIONS: [
    { value: 'train', label: '電車' },
    { value: 'subway', label: '地下鉄' },
    { value: 'bus', label: 'バス' },
    { value: 'other', label: 'その他' },
  ],
  useLines: (opts: { enabled?: boolean }) => useLinesMock(opts),
}))

// US-049: 運営会社マスタ (Operator) hook も同様にモック
vi.mock('../lib/operators', () => ({
  useOperators: (opts: { enabled?: boolean }) => useOperatorsMock(opts),
}))

function renderAdminStations(state?: { notice?: string }) {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/admin/stations', state: state ?? null }]}
    >
      <Routes>
        <Route path="/admin/stations" element={<AdminStations />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
        <Route path="/account" element={<div>ACCOUNT_PAGE</div>} />
        <Route path="/admin/lines" element={<div>ADMIN_LINES_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const ADMIN = {
  id: 'u1',
  email: 'admin@example.com',
  name: '管理者',
  postalCode: null,
  role: 'admin',
}

const NORMAL = {
  id: 'u2',
  email: 'me@example.com',
  name: '一般',
  postalCode: null,
  role: 'user',
}

const LINE_TOKAIDO = {
  id: 'jr-tokaido',
  name: 'JR東海道線',
  kind: 'train',
  operator: 'JR東海',
  routeSegmentCount: 0,
  stationCount: 2,
}

const LINE_MEITETSU = {
  id: 'meitetsu',
  name: '名鉄名古屋本線',
  kind: 'train',
  operator: '名鉄',
  routeSegmentCount: 0,
  stationCount: 1,
}

const STATION_NAGOYA = {
  id: 'stn-nagoya',
  name: '名古屋',
  kana: 'なごや',
  operatorId: 'jr-tokai',
  operatorName: 'JR東海',
  lines: [
    { id: 'jr-tokaido', name: 'JR東海道線', kind: 'train', code: 'CA68' },
    { id: 'meitetsu', name: '名鉄名古屋本線', kind: 'train', code: 'NH36' },
  ],
}

const STATION_GIFU = {
  id: 'stn-gifu',
  name: '岐阜',
  kana: 'ぎふ',
  operatorId: null,
  operatorName: null,
  lines: [{ id: 'jr-tokaido', name: 'JR東海道線', kind: 'train', code: 'CA74' }],
}

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'admin@example.com' } },
    isPending: false,
  })
  fetchMock.mockReset()
  useLinesMock.mockReset()
  // useLines のデフォルト戻り値 (各テストで上書き可能)
  useLinesMock.mockReturnValue({
    lines: [LINE_TOKAIDO, LINE_MEITETSU],
    loading: false,
    error: null,
    reload: () => {},
  })
  useOperatorsMock.mockReset()
  useOperatorsMock.mockReturnValue({
    operators: [
      { id: 'jr-tokai', name: 'JR東海', aliases: [], kinds: ['train'] },
      { id: 'meitetsu', name: '名古屋鉄道', aliases: [], kinds: ['train'] },
      { id: 'nagoya-subway', name: '名古屋市交通局', aliases: [], kinds: ['subway'] },
    ],
    loading: false,
    error: null,
    reload: () => {},
  })
  vi.stubGlobal('fetch', fetchMock)
  // US-034: テスト間でフィルタが残らないよう sessionStorage をクリア
  try {
    sessionStorage.clear()
  } catch {
    // jsdom 環境では常に成功する想定
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ヘルパ: admin で me + stations を順に返す mock セットアップ (US-026 でインラインフォーム廃止に伴い lines fetch は無くなった)
function mockAdminInitialFetch(stations: unknown[] = [], _lines: unknown[] = []) {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ stations }), { status: 200 }),
    )
}

describe('AdminStations', () => {
  it('未ログインなら /login へ', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderAdminStations()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('role=user では 403 表示', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(NORMAL), { status: 200 }),
    )
    renderAdminStations()
    expect(
      await screen.findByText(
        /このページを表示するには管理者権限が必要です/,
      ),
    ).toBeInTheDocument()
    // /api/admin/stations は呼ばれない
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('admin で 0 件は空状態 + 新規作成リンク (US-026)', async () => {
    mockAdminInitialFetch([], [])
    renderAdminStations()
    expect(
      await screen.findByText('駅マスタは現在空です。'),
    ).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: '+ 新規作成' })
    for (const a of links) {
      expect(a).toHaveAttribute('href', '/admin/stations/new')
    }
  })

  it('navigate state.notice があれば通知バナー表示 (新規/編集画面からの遷移想定)', async () => {
    mockAdminInitialFetch([], [])
    renderAdminStations({ notice: '駅を作成しました' })
    expect(await screen.findByText(/駅を作成しました/)).toBeInTheDocument()
  })

  it('admin で複数件は kana 昇順で並び、編集は /admin/stations/:id/edit リンク (US-026)', async () => {
    mockAdminInitialFetch(
      [STATION_GIFU, STATION_NAGOYA],
      [LINE_TOKAIDO, LINE_MEITETSU],
    )
    renderAdminStations()
    await screen.findByText('岐阜')

    // 岐阜 < 名古屋 (kana asc)
    const idxGifu = screen.getByText('岐阜').compareDocumentPosition(
      screen.getByText('名古屋'),
    )
    expect(idxGifu & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 名古屋の行に 2 つの路線タグ
    const rowNagoya = screen.getByText('名古屋').closest('tr')!
    expect(
      within(rowNagoya as HTMLElement).getByText('JR東海道線'),
    ).toBeInTheDocument()
    expect(
      within(rowNagoya as HTMLElement).getByText('名鉄名古屋本線'),
    ).toBeInTheDocument()

    // 編集リンクは /admin/stations/:id/edit
    const editNagoya = within(rowNagoya as HTMLElement).getByRole('link', {
      name: /駅「名古屋」を編集/,
    })
    expect(editNagoya).toHaveAttribute(
      'href',
      '/admin/stations/stn-nagoya/edit',
    )
  })

  it.skip('legacy: 新規作成 inline form (US-026 で /admin/stations/new に分離)', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([], [LINE_TOKAIDO, LINE_MEITETSU])
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'auto-1',
            name: '名古屋',
            kana: 'なごや',
            lineIds: ['jr-tokaido'],
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stations: [STATION_NAGOYA] }), {
          status: 200,
        }),
      )
    renderAdminStations()
    await screen.findByText('駅マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )

    await user.type(screen.getByLabelText(/^駅名/), '名古屋')
    await user.type(screen.getByLabelText(/よみがな/), 'なごや')

    // 路線チェックボックスを 1 つチェック
    const tokaidoBox = screen.getByLabelText(/JR東海道線/) as HTMLInputElement
    await user.click(tokaidoBox)
    expect(tokaidoBox.checked).toBe(true)

    await user.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => {
      expect(screen.getByText('駅を作成しました')).toBeInTheDocument()
    })
    // 4 番目の fetch が POST
    const [url, init] = fetchMock.mock.calls[3]!
    expect(url).toContain('/api/admin/stations')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      name: '名古屋',
      kana: 'なごや',
      lineIds: ['jr-tokaido'],
    })
  })

  it.skip('legacy: 新規作成 駅名空欄エラー (inline form)', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([], [])
    renderAdminStations()
    await screen.findByText('駅マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(screen.getByText('駅名を入力してください')).toBeInTheDocument()
  })

  it.skip('legacy: 新規作成 ID 形式違反 (inline form)', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([], [])
    renderAdminStations()
    await screen.findByText('駅マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )
    await user.type(screen.getByLabelText(/^ID$/), 'has space')
    await user.type(screen.getByLabelText(/^駅名/), '駅')
    await user.type(screen.getByLabelText(/よみがな/), 'えき')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(
      screen.getByText(
        'IDは半角英数字 + ハイフン/ドット/アンダースコアのみ使用できます',
      ),
    ).toBeInTheDocument()
  })

  it.skip('legacy: 編集 pre-fill (inline form)', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([STATION_NAGOYA], [LINE_TOKAIDO, LINE_MEITETSU])
    renderAdminStations()
    await screen.findByText('名古屋')

    await user.click(
      screen.getByRole('button', { name: /駅「名古屋」を編集/ }),
    )
    expect(screen.getByLabelText('ID')).toBeDisabled()
    expect(screen.getByLabelText('ID')).toHaveValue('stn-nagoya')
    expect(screen.getByLabelText(/^駅名/)).toHaveValue('名古屋')
    expect(screen.getByLabelText(/よみがな/)).toHaveValue('なごや')

    // 注意書き
    expect(
      screen.getByText(/既存経路に登録されている駅名文字列は/),
    ).toBeInTheDocument()

    // 既存の路線がチェック済み
    expect(
      (screen.getByLabelText(/JR東海道線/) as HTMLInputElement).checked,
    ).toBe(true)
    expect(
      (screen.getByLabelText(/名鉄名古屋本線/) as HTMLInputElement).checked,
    ).toBe(true)
  })

  it.skip('legacy: 編集 PUT (inline form)', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([STATION_NAGOYA], [LINE_TOKAIDO, LINE_MEITETSU])
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...STATION_NAGOYA, lineIds: [] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stations: [
              { ...STATION_NAGOYA, lineIds: [], lines: [] },
            ],
          }),
          { status: 200 },
        ),
      )
    renderAdminStations()
    await screen.findByText('名古屋')
    await user.click(
      screen.getByRole('button', { name: /駅「名古屋」を編集/ }),
    )

    const tokaidoBox = screen.getByLabelText(/JR東海道線/) as HTMLInputElement
    const meitetsuBox = screen.getByLabelText(/名鉄名古屋本線/) as HTMLInputElement
    await user.click(tokaidoBox)
    await user.click(meitetsuBox)
    await user.click(screen.getByRole('button', { name: '更新する' }))

    await waitFor(() => {
      expect(screen.getByText('駅を更新しました')).toBeInTheDocument()
    })
    const [url, init] = fetchMock.mock.calls[3]!
    expect(url).toContain('/api/admin/stations/stn-nagoya')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body)
    expect(body.lineIds).toEqual([])
  })

  it.skip('legacy: 400 unknown_line (inline form)', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([], [LINE_TOKAIDO])
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unknown_line' }), { status: 400 }),
    )
    renderAdminStations()
    await screen.findByText('駅マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )
    await user.type(screen.getByLabelText(/^駅名/), '名古屋')
    await user.type(screen.getByLabelText(/よみがな/), 'なごや')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(
      await screen.findByText(
        '紐付けに含まれる路線が存在しません (削除済み?)',
      ),
    ).toBeInTheDocument()
  })

  it.skip('legacy: 409 重複 (inline form)', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([], [])
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'duplicate' }), { status: 409 }),
    )
    renderAdminStations()
    await screen.findByText('駅マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )
    await user.type(screen.getByLabelText(/^ID$/), 'stn-dup')
    await user.type(screen.getByLabelText(/^駅名/), '駅')
    await user.type(screen.getByLabelText(/よみがな/), 'えき')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(
      await screen.findByText('同じIDの駅が既に登録されています'),
    ).toBeInTheDocument()
  })

  it('削除: confirm OK + 204 でリスト reload + 成功バナー', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([STATION_NAGOYA], [LINE_TOKAIDO])
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stations: [] }), { status: 200 }),
      )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      renderAdminStations()
      await screen.findByText('名古屋')
      await user.click(
        screen.getByRole('button', { name: /駅「名古屋」を削除/ }),
      )
      await waitFor(() => {
        expect(screen.getByText('駅を削除しました')).toBeInTheDocument()
      })
      // 初期 fetch 2 件 (me + stations) + DELETE で 3 件目
      const [url, init] = fetchMock.mock.calls[2]!
      expect(url).toContain('/api/admin/stations/stn-nagoya')
      expect(init.method).toBe('DELETE')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('削除: confirm キャンセルなら DELETE は呼ばれない', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([STATION_NAGOYA], [LINE_TOKAIDO])
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      renderAdminStations()
      await screen.findByText('名古屋')
      await user.click(
        screen.getByRole('button', { name: /駅「名古屋」を削除/ }),
      )
      // 初期 fetch 2 件 (me + stations) のみ
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it.skip('legacy: 路線マスタが空のとき /admin/lines 誘導 (inline form)', async () => {
    const user = userEvent.setup()
    mockAdminInitialFetch([], [])
    renderAdminStations()
    await screen.findByText('駅マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )
    expect(screen.getByText(/路線マスタが空です/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '路線マスタ管理' }),
    ).toHaveAttribute('href', '/admin/lines')
  })

  describe('US-034 フィルタ持続化 (sessionStorage)', () => {
    it('種別フィルタを変更すると sessionStorage に保存される', async () => {
      const user = userEvent.setup()
      mockAdminInitialFetch([STATION_NAGOYA, STATION_GIFU])
      renderAdminStations()
      await screen.findByText('名古屋')

      await user.selectOptions(screen.getByLabelText('種別'), 'subway')
      await waitFor(() => {
        const raw = sessionStorage.getItem('admin-stations-filter')
        expect(raw).not.toBeNull()
        // US-053: 下位 (kind) 選択は上位 (operator) に作用しない → operator は '' のまま
        expect(JSON.parse(raw!)).toEqual({
          kind: 'subway',
          line: '',
          operator: '',
        })
      })
    })

    it('sessionStorage に保存済みの値があれば mount 時に復元', async () => {
      sessionStorage.setItem(
        'admin-stations-filter',
        JSON.stringify({ kind: 'train', line: 'meitetsu' }),
      )
      mockAdminInitialFetch([STATION_NAGOYA, STATION_GIFU])
      renderAdminStations()
      await screen.findByText('名古屋')
      // 初期値が pre-fill されている
      expect((screen.getByLabelText('種別') as HTMLSelectElement).value).toBe(
        'train',
      )
      expect((screen.getByLabelText('路線') as HTMLSelectElement).value).toBe(
        'meitetsu',
      )
    })

    it('不正な保存値は無視される (クラッシュしない)', async () => {
      sessionStorage.setItem('admin-stations-filter', 'not-json{{{')
      mockAdminInitialFetch([STATION_NAGOYA])
      renderAdminStations()
      await screen.findByText('名古屋')
      expect((screen.getByLabelText('種別') as HTMLSelectElement).value).toBe('')
      expect((screen.getByLabelText('路線') as HTMLSelectElement).value).toBe('')
    })
  })

  describe('US-055 ソート', () => {
    it('駅名ヘッダクリックで駅名昇順 → 降順切替', async () => {
      const user = userEvent.setup()
      mockAdminInitialFetch([STATION_GIFU, STATION_NAGOYA])
      renderAdminStations()
      await screen.findByText('岐阜')

      const nameHeader = screen.getByRole('columnheader', { name: /駅名/ })
      // 1 回目: 昇順 (岐阜 → 名古屋)
      await user.click(nameHeader)
      const rows1 = screen.getAllByRole('row').slice(1) // header 除外
      expect(within(rows1[0]!).getByText('岐阜')).toBeInTheDocument()
      expect(within(rows1[1]!).getByText('名古屋')).toBeInTheDocument()

      // 2 回目: 降順 (名古屋 → 岐阜)
      await user.click(nameHeader)
      const rows2 = screen.getAllByRole('row').slice(1)
      expect(within(rows2[0]!).getByText('名古屋')).toBeInTheDocument()
      expect(within(rows2[1]!).getByText('岐阜')).toBeInTheDocument()
    })

    it('US-055: ID 列ではなく行番号 (#) を表示', async () => {
      mockAdminInitialFetch([STATION_NAGOYA])
      renderAdminStations()
      await screen.findByText('名古屋')
      // ID は表示されない (行番号置換済)
      expect(screen.queryByText('stn-nagoya')).not.toBeInTheDocument()
      // 行番号 1 が出る
      const rows = screen.getAllByRole('row').slice(1)
      expect(within(rows[0]!).getByText('1')).toBeInTheDocument()
    })
  })

  describe('US-051 リセットボタン', () => {
    it('リセットボタンで 運営会社 + 種別 + 路線 が全て初期化される', async () => {
      const user = userEvent.setup()
      mockAdminInitialFetch([STATION_NAGOYA, STATION_GIFU])
      renderAdminStations()
      await screen.findByText('名古屋')

      await user.selectOptions(screen.getByLabelText('運営会社'), 'jr-tokai')
      expect(
        (screen.getByLabelText('運営会社') as HTMLSelectElement).value,
      ).toBe('jr-tokai')

      await user.click(screen.getByRole('button', { name: /フィルタをリセット/ }))
      expect(
        (screen.getByLabelText('運営会社') as HTMLSelectElement).value,
      ).toBe('')
      expect((screen.getByLabelText('種別') as HTMLSelectElement).value).toBe('')
      expect((screen.getByLabelText('路線') as HTMLSelectElement).value).toBe('')
    })

    it('フィルタが全て空ならリセットボタンは disabled', async () => {
      mockAdminInitialFetch([STATION_NAGOYA])
      renderAdminStations()
      await screen.findByText('名古屋')
      expect(
        screen.getByRole('button', { name: /フィルタをリセット/ }),
      ).toBeDisabled()
    })
  })
})
