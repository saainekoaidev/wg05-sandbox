import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Login } from './Login'

// `../lib/auth` の signIn / useSession を差し替える。
// 各テストの中で mockSignInEmail / mockUseSession の挙動を上書きする。
const mockSignInEmail = vi.fn()
const mockUseSession = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: (...args: unknown[]) => mockSignInEmail(...args) },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

// Login をルーティング付きで描画するヘルパ。
// ログイン成功時の <Navigate to="/routes"> 遷移と <Link to="/register"> を併せて検証できるよう
// 遷移先には識別用テキストを配置する。
function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
        <Route path="/register" element={<div>REGISTER_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockSignInEmail.mockReset()
  // 既定: 未ログイン
  mockUseSession.mockReturnValue({ data: null, isPending: false })
})

describe('Login', () => {
  it('未ログイン時はフォームが描画される', () => {
    renderLogin()

    expect(
      screen.getByRole('heading', { name: 'ログイン' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/メールアドレス/)).toBeInTheDocument()
    expect(screen.getByLabelText(/パスワード/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'クリア' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '新規登録' })).toHaveAttribute(
      'href',
      '/register',
    )
  })

  it('既ログイン時は /routes へ自動リダイレクトする', () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: 'me@example.com' } },
      isPending: false,
    })

    renderLogin()

    expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'ログイン' }),
    ).not.toBeInTheDocument()
  })

  it('セッション取得中 (isPending) はリダイレクトせずフォームを表示する', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })

    renderLogin()

    expect(
      screen.getByRole('heading', { name: 'ログイン' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('ROUTES_PAGE')).not.toBeInTheDocument()
  })

  it('入力した値が email / password の各欄に反映される', async () => {
    const user = userEvent.setup()
    renderLogin()

    const email = screen.getByLabelText(/メールアドレス/) as HTMLInputElement
    const password = screen.getByLabelText(/パスワード/) as HTMLInputElement

    await user.type(email, 'foo@example.com')
    await user.type(password, 'Test1234')

    expect(email.value).toBe('foo@example.com')
    expect(password.value).toBe('Test1234')
  })

  it('「表示」ボタンでパスワード欄のマスクを切替できる', async () => {
    const user = userEvent.setup()
    renderLogin()

    const password = screen.getByLabelText(/パスワード/) as HTMLInputElement
    expect(password.type).toBe('password')

    await user.click(screen.getByRole('button', { name: '表示' }))
    expect(password.type).toBe('text')

    await user.click(screen.getByRole('button', { name: '隠す' }))
    expect(password.type).toBe('password')
  })

  it('未入力で送信するとフィールドエラーが出て signIn は呼ばれない', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(
      screen.getByText('メールアドレスを入力してください'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('パスワードを入力してください'),
    ).toBeInTheDocument()
    expect(mockSignInEmail).not.toHaveBeenCalled()
    expect(screen.queryByText('ROUTES_PAGE')).not.toBeInTheDocument()
  })

  it('メールアドレスが形式不正なら送信せずエラーを出す', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText(/メールアドレス/), 'not-an-email')
    await user.type(screen.getByLabelText(/パスワード/), 'whatever')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(
      screen.getByText('メールアドレスの形式が正しくありません'),
    ).toBeInTheDocument()
    expect(mockSignInEmail).not.toHaveBeenCalled()
  })

  it('フォーカスアウト時にもバリデーションが走り対象のエラーが出る', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByLabelText(/メールアドレス/))
    await user.tab()

    expect(
      screen.getByText('メールアドレスを入力してください'),
    ).toBeInTheDocument()
  })

  it('認証成功で signIn.email が正しい引数で呼ばれ /routes へ遷移する', async () => {
    const user = userEvent.setup()
    mockSignInEmail.mockResolvedValueOnce({ data: { user: {} }, error: null })
    renderLogin()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(mockSignInEmail).toHaveBeenCalledWith({
        email: 'foo@example.com',
        password: 'Test1234',
      })
      expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
    })
  })

  it('認証失敗 (result.error) でバナーエラーを表示し /routes へは遷移しない', async () => {
    const user = userEvent.setup()
    mockSignInEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid email or password' },
    })
    renderLogin()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'WrongPwd')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(
      await screen.findByText(
        'メールアドレスまたはパスワードが正しくありません',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('ROUTES_PAGE')).not.toBeInTheDocument()
  })

  it('signIn が例外で reject した場合は通信エラー用のバナーを表示する', async () => {
    const user = userEvent.setup()
    mockSignInEmail.mockRejectedValueOnce(new Error('network down'))
    renderLogin()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(
      await screen.findByText(
        'ログインに失敗しました。時間をおいて再度お試しください',
      ),
    ).toBeInTheDocument()
  })

  it('送信中はボタンが「ログイン中…」になり全ボタンが非活性になる', async () => {
    const user = userEvent.setup()
    let resolveSignIn: (v: unknown) => void = () => {}
    mockSignInEmail.mockReturnValueOnce(
      new Promise((r) => {
        resolveSignIn = r
      }),
    )
    renderLogin()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'ログイン中…' }),
      ).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: 'クリア' })).toBeDisabled()

    resolveSignIn({ data: { user: {} }, error: null })
    await waitFor(() => {
      expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
    })
  })

  it('クリアボタンで入力値とエラー表示がリセットされる', async () => {
    const user = userEvent.setup()
    renderLogin()

    const email = screen.getByLabelText(/メールアドレス/) as HTMLInputElement
    const password = screen.getByLabelText(/パスワード/) as HTMLInputElement

    await user.type(email, 'foo@example.com')
    await user.type(password, 'Test1234')

    // 一度バリデーションエラーを表示させてからクリアする
    await user.clear(email)
    await user.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(
      screen.getByText('メールアドレスを入力してください'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'クリア' }))

    expect(email.value).toBe('')
    expect(password.value).toBe('')
    expect(
      screen.queryByText('メールアドレスを入力してください'),
    ).not.toBeInTheDocument()
  })
})
