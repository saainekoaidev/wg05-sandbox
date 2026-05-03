import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminLines } from './AdminLines'

const mockUseSession = vi.fn()
const fetchMock = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

function renderAdminLines() {
  return render(
    <MemoryRouter initialEntries={['/admin/lines']}>
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
  routeSegmentCount: 0,
  stationCount: 5,
}

const LINE_B = {
  id: 'metro-meijo',
  name: '名古屋市営地下鉄名城線',
  kind: 'subway',
  operator: '名古屋市交通局',
  routeSegmentCount: 2, // 削除不可ケース
  stationCount: 12,
}

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'admin@example.com' } },
    isPending: false,
  })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
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
    // /api/lines は呼ばれない (admin チェックで早期 return)
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

  it('admin で 0 件なら空状態 + 新規作成ボタン', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [] }), { status: 200 }),
      )
    renderAdminLines()
    expect(
      await screen.findByText('路線マスタは現在空です。'),
    ).toBeInTheDocument()
    // ヘッダ + 空状態 で 2 つ
    expect(
      screen.getAllByRole('button', { name: '+ 新規作成' }).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('admin でデータがあれば table にレンダリングされる', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [LINE_A, LINE_B] }), {
          status: 200,
        }),
      )
    renderAdminLines()
    expect(await screen.findByText('JR東海道線')).toBeInTheDocument()
    expect(screen.getByText('名古屋市営地下鉄名城線')).toBeInTheDocument()
    // 削除ボタンが、参照件数 > 0 の路線では disabled
    const rowB = screen.getByText('名古屋市営地下鉄名城線').closest('tr')!
    const deleteB = within(rowB as HTMLElement).getByRole('button', {
      name: /路線「名古屋市営地下鉄名城線」を削除/,
    })
    expect(deleteB).toBeDisabled()
    // 参照 0 件は有効
    const rowA = screen.getByText('JR東海道線').closest('tr')!
    const deleteA = within(rowA as HTMLElement).getByRole('button', {
      name: /路線「JR東海道線」を削除/,
    })
    expect(deleteA).not.toBeDisabled()
  })

  it('新規作成: ID 形式違反でフィールドエラー', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [] }), { status: 200 }),
      )
    renderAdminLines()
    await screen.findByText('路線マスタは現在空です。')
    await user.click(
      screen.getAllByRole('button', { name: '+ 新規作成' })[0]!,
    )
    await user.type(screen.getByLabelText(/^ID/), 'has space')
    await user.type(screen.getByLabelText(/^路線名/), 'X')
    await user.click(screen.getByRole('button', { name: '作成する' }))
    expect(
      screen.getByText(
        'IDは半角英数字 + ハイフン/ドット/アンダースコアのみ使用できます',
      ),
    ).toBeInTheDocument()
    // POST は呼ばれない
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('新規作成: 正常 → POST 成功 → reload + 成功バナー', async () => {
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

  it('新規作成: 409 (重複) なら duplicate バナーがフォーム内に出る', async () => {
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

  it('編集: 既存値が pre-fill され, ID は disabled', async () => {
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

  it('編集: PUT 成功で reload + 成功バナー', async () => {
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
    // LINE_A は参照0件だが、サーバが他の経由で 409 を返したケースをシミュレート
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [LINE_A] }), { status: 200 }),
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
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [LINE_A] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [] }), { status: 200 }),
      )
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
      const [url, init] = fetchMock.mock.calls[2]!
      expect(url).toContain('/api/lines/jr-tokaido')
      expect(init.method).toBe('DELETE')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('削除: confirm キャンセルなら DELETE が呼ばれない', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lines: [LINE_A] }), { status: 200 }),
      )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      renderAdminLines()
      await screen.findByText('JR東海道線')
      await user.click(
        screen.getByRole('button', { name: /路線「JR東海道線」を削除/ }),
      )
      // /api/users/me + /api/lines のみで DELETE は呼ばれない
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
