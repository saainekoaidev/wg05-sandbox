import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Account } from './Account'

const mockUseSession = vi.fn()
const fetchMock = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

function renderAccount() {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/account" element={<Account />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const ME = {
  id: 'u1',
  email: 'me@example.com',
  name: '山田 太郎',
  postalCode: null as string | null,
}

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'me@example.com' } },
    isPending: false,
  })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Account', () => {
  it('未ログインなら /login にリダイレクトし fetch しない', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderAccount()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isPending 中は何も描画せず fetch も走らない', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })
    const { container } = renderAccount()
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('GET /api/users/me で取得した name/postalCode が pre-fill される', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...ME, postalCode: '1500001' }),
        { status: 200 },
      ),
    )
    renderAccount()
    expect(await screen.findByDisplayValue('山田 太郎')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1500001')).toBeInTheDocument()
    // email は readonly
    expect(screen.getByDisplayValue('me@example.com')).toHaveAttribute(
      'readonly',
    )
  })

  it('postalCode 7桁時にハイフン入りプレビューが hint に表示される', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...ME, postalCode: '1500001' }),
        { status: 200 },
      ),
    )
    renderAccount()
    await screen.findByDisplayValue('山田 太郎')
    expect(screen.getByText(/150-0001/)).toBeInTheDocument()
  })

  it('GET 401 を受けたら /login にリダイレクト', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )
    renderAccount()
    await waitFor(() => {
      expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    })
  })

  it('GET 500 等で取得エラーバナーを表示する', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    renderAccount()
    expect(
      await screen.findByText(
        'プロフィールの取得に失敗しました。再読み込みをお試しください',
      ),
    ).toBeInTheDocument()
  })

  it('氏名空欄で保存しようとするとフィールドエラーが出て fetch しない', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ME), { status: 200 }),
    )
    renderAccount()
    await screen.findByDisplayValue('山田 太郎')

    const nameInput = screen.getByLabelText(/お名前/)
    await user.clear(nameInput)
    await user.click(screen.getByRole('button', { name: '保存する' }))

    expect(screen.getByText('氏名を入力してください')).toBeInTheDocument()
    // 初回 GET 1回のみ
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('郵便番号 6 桁ではフィールドエラーが出て fetch しない', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ME), { status: 200 }),
    )
    renderAccount()
    await screen.findByDisplayValue('山田 太郎')

    // 7桁制限 maxLength=7 と数字フィルタはあるが、blur 時の検証も担保したい
    const postalInput = screen.getByLabelText('郵便番号') as HTMLInputElement
    await user.type(postalInput, '123456')
    await user.click(screen.getByRole('button', { name: '保存する' }))

    expect(
      screen.getByText(/郵便番号は半角数字7桁で入力してください/),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('正常: 氏名 + 郵便番号を保存すると PUT が credentials 付きで呼ばれ通知バナーが出る', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ME), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...ME, name: '田中 一郎', postalCode: '1500001' }),
          { status: 200 },
        ),
      )
    renderAccount()
    await screen.findByDisplayValue('山田 太郎')

    const nameInput = screen.getByLabelText(/お名前/)
    await user.clear(nameInput)
    await user.type(nameInput, '田中 一郎')
    await user.type(screen.getByLabelText('郵便番号'), '1500001')

    await user.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => {
      expect(screen.getByText('プロフィールを更新しました')).toBeInTheDocument()
    })

    // 2 回目の fetch は PUT
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toContain('/api/users/me')
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ name: '田中 一郎', postalCode: '1500001' })
  })

  it('PUT 400 を受けると入力誤りバナーを出す', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ME), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'validation_failed' }), {
          status: 400,
        }),
      )
    renderAccount()
    await screen.findByDisplayValue('山田 太郎')
    await user.click(screen.getByRole('button', { name: '保存する' }))

    expect(
      await screen.findByText('入力内容に誤りがあります。再度ご確認ください'),
    ).toBeInTheDocument()
  })

  it('PUT 401 を受けると /login にリダイレクト', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ME), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
        }),
      )
    renderAccount()
    await screen.findByDisplayValue('山田 太郎')
    await user.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => {
      expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    })
  })

  it('PUT 500 等で更新失敗バナー', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ME), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
    renderAccount()
    await screen.findByDisplayValue('山田 太郎')
    await user.click(screen.getByRole('button', { name: '保存する' }))

    expect(
      await screen.findByText(
        'プロフィールの更新に失敗しました。再度お試しください',
      ),
    ).toBeInTheDocument()
  })

  it('「経路一覧に戻る」リンクで /routes に遷移する', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ME), { status: 200 }),
    )
    renderAccount()
    await screen.findByDisplayValue('山田 太郎')

    await user.click(screen.getByRole('link', { name: '経路一覧に戻る' }))
    expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
  })

  it('「変更前に戻す」は変更がない時は何もしない (確認ダイアログ非表示)', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ME), { status: 200 }),
    )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      renderAccount()
      await screen.findByDisplayValue('山田 太郎')

      await user.click(screen.getByRole('button', { name: '変更前に戻す' }))
      expect(confirmSpy).not.toHaveBeenCalled()
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('「変更前に戻す」で確認 OK なら入力が初期値に戻る', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ME), { status: 200 }),
    )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      renderAccount()
      await screen.findByDisplayValue('山田 太郎')

      const nameInput = screen.getByLabelText(/お名前/)
      await user.clear(nameInput)
      await user.type(nameInput, 'XXX')
      expect(nameInput).toHaveValue('XXX')

      await user.click(screen.getByRole('button', { name: '変更前に戻す' }))
      expect(nameInput).toHaveValue('山田 太郎')
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
