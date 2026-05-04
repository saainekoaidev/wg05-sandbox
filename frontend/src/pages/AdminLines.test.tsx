import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminLines } from './AdminLines'

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

function renderAdminLines(state?: { notice?: string }) {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/admin/lines', state: state ?? null }]}
    >
      <Routes>
        <Route path="/admin/lines" element={<AdminLines />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
        <Route path="/account" element={<div>ACCOUNT_PAGE</div>} />
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

const LINE_A = {
  id: 'jr-tokaido',
  name: 'JR東海道線',
  kind: 'train',
  operator: 'JR東海',
  operatorId: 'jr-tokai',
  operatorName: 'JR東海',
  routeSegmentCount: 0,
  stationCount: 5,
}

const LINE_B = {
  id: 'metro-meijo',
  name: '名古屋市営地下鉄名城線',
  kind: 'subway',
  operator: '名古屋市交通局',
  operatorId: 'nagoya-subway',
  operatorName: '名古屋市交通局',
  routeSegmentCount: 2, // 削除不可ケース
  stationCount: 12,
}

const OPERATORS = [
  { id: 'jr-tokai', name: 'JR東海', aliases: [], kinds: ['train'] },
  { id: 'nagoya-subway', name: '名古屋市交通局', aliases: [], kinds: ['subway'] },
]

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'admin@example.com' } },
    isPending: false,
  })
  fetchMock.mockReset()
  useLinesMock.mockReset()
  useLinesMock.mockReturnValue({
    lines: [LINE_A, LINE_B],
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

describe('AdminLines', () => {
  it('未ログインなら /login にリダイレクト', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderAdminLines()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isPending 中は何も描画しない', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })
    const { container } = renderAdminLines()
    expect(container).toBeEmptyDOMElement()
  })

  it('role=user なら 403 相当の表示で経路一覧へのリンクが出る', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(NORMAL), { status: 200 }),
    )
    renderAdminLines()
    expect(
      await screen.findByText(
        /このページを表示するには管理者権限が必要です/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '経路一覧に戻る' }),
    ).toHaveAttribute('href', '/routes')
    // /api/users/me のみ。useLines / useOperators は admin チェックで disable。
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('GET /api/users/me が 401 なら /login にリダイレクト', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )
    renderAdminLines()
    await waitFor(() => {
      expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    })
  })

  it('admin で 0 件なら空状態 + 新規作成リンク (US-025)', async () => {
    useLinesMock.mockReturnValue({
      lines: [], loading: false, error: null, reload: () => {},
    })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderAdminLines()
    expect(
      await screen.findByText('路線マスタは現在空です。'),
    ).toBeInTheDocument()
    // 新規作成は Link になっており href が /admin/lines/new
    const links = screen.getAllByRole('link', { name: '+ 新規作成' })
    expect(links.length).toBeGreaterThanOrEqual(1)
    for (const a of links) {
      expect(a).toHaveAttribute('href', '/admin/lines/new')
    }
  })

  it('admin でデータがあれば table にレンダリングされ、編集は /admin/lines/:id/edit リンク (US-025)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderAdminLines()
    expect(await screen.findByText('JR東海道線')).toBeInTheDocument()
    expect(screen.getByText('名古屋市営地下鉄名城線')).toBeInTheDocument()

    // 編集は Link
    const rowA = screen.getByText('JR東海道線').closest('tr')!
    const editA = within(rowA as HTMLElement).getByRole('link', {
      name: /路線「JR東海道線」を編集/,
    })
    expect(editA).toHaveAttribute('href', '/admin/lines/jr-tokaido/edit')

    // 削除は引き続きボタン (参照件数 > 0 の路線では disabled)
    const rowB = screen.getByText('名古屋市営地下鉄名城線').closest('tr')!
    const deleteB = within(rowB as HTMLElement).getByRole('button', {
      name: /路線「名古屋市営地下鉄名城線」を削除/,
    })
    expect(deleteB).toBeDisabled()
    // 参照 0 件は有効
    const deleteA = within(rowA as HTMLElement).getByRole('button', {
      name: /路線「JR東海道線」を削除/,
    })
    expect(deleteA).not.toBeDisabled()
  })

  it('navigate state.notice があれば通知バナー表示 (新規/編集画面からの遷移想定)', async () => {
    useLinesMock.mockReturnValue({
      lines: [], loading: false, error: null, reload: () => {},
    })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderAdminLines({ notice: '路線を作成しました' })
    expect(
      await screen.findByText(/路線を作成しました/),
    ).toBeInTheDocument()
  })

  // (旧 inline form テストは US-025 で AdminLineForm.test.tsx に移行)
  it.skip('legacy: 新規作成 (inline form)', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(LINE_A), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [LINE_A] }), { status: 200 }),
      )
    renderAdminLines()
    await screen.findByText('路線マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )
    await user.type(screen.getByLabelText(/^ID/), 'jr-tokaido')
    await user.type(screen.getByLabelText(/^路線名/), 'JR東海道線')
    await user.type(screen.getByLabelText(/運営会社/), 'JR東海')
    await user.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => {
      expect(screen.getByText('路線を作成しました')).toBeInTheDocument()
    })
    // リクエスト確認
    const [url, init] = fetchMock.mock.calls[2]!
    expect(url).toContain('/api/lines')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      id: 'jr-tokaido',
      name: 'JR東海道線',
      kind: 'train',
      operator: 'JR東海',
    })
  })

  it.skip('legacy: 新規作成 409 重複 (inline form)', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'duplicate' }), { status: 409 }),
      )
    renderAdminLines()
    await screen.findByText('路線マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )
    await user.type(screen.getByLabelText(/^ID/), 'dup')
    await user.type(screen.getByLabelText(/^路線名/), 'X')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(
      await screen.findByText(
        '同じIDまたは路線名が既に登録されています',
      ),
    ).toBeInTheDocument()
  })

  it.skip('legacy: 編集 pre-fill (inline form)', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [LINE_A] }), { status: 200 }),
      )
    renderAdminLines()
    await screen.findByText('JR東海道線')

    await user.click(
      screen.getByRole('button', { name: /路線「JR東海道線」を編集/ }),
    )
    expect(screen.getByLabelText(/^ID/)).toBeDisabled()
    expect(screen.getByLabelText(/^ID/)).toHaveValue('jr-tokaido')
    expect(screen.getByLabelText(/^路線名/)).toHaveValue('JR東海道線')
    expect(screen.getByLabelText(/運営会社/)).toHaveValue('JR東海')
  })

  it.skip('legacy: 編集 PUT 成功 (inline form)', async () => {
    const user = userEvent.setup()
    const updated = { ...LINE_A, name: 'JR東海道線 (改称)' }
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [LINE_A] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(updated), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [updated] }), { status: 200 }),
      )
    renderAdminLines()
    await screen.findByText('JR東海道線')
    await user.click(
      screen.getByRole('button', { name: /路線「JR東海道線」を編集/ }),
    )
    const nameInput = screen.getByLabelText(/^路線名/)
    await user.clear(nameInput)
    await user.type(nameInput, 'JR東海道線 (改称)')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitFor(() => {
      expect(screen.getByText('路線を更新しました')).toBeInTheDocument()
    })
    // PUT が /api/lines/jr-tokaido に飛ぶ
    const [url, init] = fetchMock.mock.calls[2]!
    expect(url).toContain('/api/lines/jr-tokaido')
    expect(init.method).toBe('PUT')
  })

  it('削除: 参照ありで 409 を受けるとバナーに件数が出る', async () => {
    const user = userEvent.setup()
    useLinesMock.mockReturnValue({
      lines: [LINE_A], loading: false, error: null, reload: () => {},
    })
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'in_use', referenceCount: 3 }),
          { status: 409 },
        ),
      )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      renderAdminLines()
      await screen.findByText('JR東海道線')
      await user.click(
        screen.getByRole('button', { name: /路線「JR東海道線」を削除/ }),
      )
      expect(
        await screen.findByText(
          /この路線は 3 件の経路で使用中のため削除できません/,
        ),
      ).toBeInTheDocument()
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('削除: 確認 OK + 204 → reload + 成功バナー', async () => {
    const user = userEvent.setup()
    useLinesMock.mockReturnValue({
      lines: [LINE_A], loading: false, error: null, reload: () => {},
    })
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      renderAdminLines()
      await screen.findByText('JR東海道線')
      await user.click(
        screen.getByRole('button', { name: /路線「JR東海道線」を削除/ }),
      )
      await waitFor(() => {
        expect(screen.getByText('路線を削除しました')).toBeInTheDocument()
      })
      const [url, init] = fetchMock.mock.calls[1]!
      expect(url).toContain('/api/lines/jr-tokaido')
      expect(init.method).toBe('DELETE')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('削除: confirm キャンセルなら DELETE が呼ばれない', async () => {
    const user = userEvent.setup()
    useLinesMock.mockReturnValue({
      lines: [LINE_A], loading: false, error: null, reload: () => {},
    })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      renderAdminLines()
      await screen.findByText('JR東海道線')
      await user.click(
        screen.getByRole('button', { name: /路線「JR東海道線」を削除/ }),
      )
      // /api/users/me のみで DELETE は呼ばれない
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      confirmSpy.mockRestore()
    }
  })

  describe('US-034 / US-050 フィルタ持続化 (sessionStorage)', () => {
    it('種別フィルタを変更すると sessionStorage に保存される', async () => {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      renderAdminLines()
      await screen.findByText('JR東海道線')

      // US-050: ラベルを「種別」に統一
      await user.selectOptions(screen.getByLabelText('種別'), 'subway')
      await waitFor(() => {
        const raw = sessionStorage.getItem('admin-lines-filter')
        expect(raw).not.toBeNull()
        // US-053: 下位 (kind) 選択は上位 (operator) に作用しない → operator は '' のまま
        expect(JSON.parse(raw!)).toEqual({ operator: '', kind: 'subway' })
      })
    })

    it('sessionStorage に保存済みの値があれば mount 時に復元', async () => {
      sessionStorage.setItem(
        'admin-lines-filter',
        JSON.stringify({ operator: '', kind: 'subway' }),
      )
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      renderAdminLines()
      await screen.findByText('名古屋市営地下鉄名城線')
      // US-050: 種別 select が地下鉄に復元されている
      expect(
        (screen.getByLabelText('種別') as HTMLSelectElement).value,
      ).toBe('subway')
      // フィルタの結果 train 路線 (JR東海道線) は表示されない
      expect(screen.queryByText('JR東海道線')).not.toBeInTheDocument()
    })

    it('US-050: 運営会社フィルタを選ぶと該当 operator の路線のみ一覧に残る', async () => {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      renderAdminLines()
      await screen.findByText('JR東海道線')

      // 運営会社=JR東海 を選ぶと line 表は JR のみ
      await user.selectOptions(screen.getByLabelText('運営会社'), 'jr-tokai')
      expect(screen.queryByText('名古屋市営地下鉄名城線')).not.toBeInTheDocument()
      expect(screen.getByText('JR東海道線')).toBeInTheDocument()
    })

    it('US-051 / US-053: リセットボタンで運営会社+種別が全て初期化される', async () => {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      renderAdminLines()
      await screen.findByText('JR東海道線')

      // US-053: 種別=subway を選ぶが, 下位 → 上位 への作用はしないので operator は '' のまま。
      // (auto-select は廃止)
      await user.selectOptions(screen.getByLabelText('種別'), 'subway')
      expect(
        (screen.getByLabelText('運営会社') as HTMLSelectElement).value,
      ).toBe('')
      expect((screen.getByLabelText('種別') as HTMLSelectElement).value).toBe(
        'subway',
      )

      // リセットボタンを押す
      await user.click(screen.getByRole('button', { name: /フィルタをリセット/ }))
      expect(
        (screen.getByLabelText('運営会社') as HTMLSelectElement).value,
      ).toBe('')
      expect((screen.getByLabelText('種別') as HTMLSelectElement).value).toBe('')
      // 全件表示に戻る
      expect(screen.getByText('JR東海道線')).toBeInTheDocument()
      expect(screen.getByText('名古屋市営地下鉄名城線')).toBeInTheDocument()
    })

    it('US-051: フィルタが全て空ならリセットボタンは disabled', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      renderAdminLines()
      await screen.findByText('JR東海道線')
      expect(
        screen.getByRole('button', { name: /フィルタをリセット/ }),
      ).toBeDisabled()
    })
  })
})
