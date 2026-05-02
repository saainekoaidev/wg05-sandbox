import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Register } from './Register'

const mockSignUpEmail = vi.fn()
const mockUseSession = vi.fn()

vi.mock('../lib/auth', () => ({
  signUp: { email: (...args: unknown[]) => mockSignUpEmail(...args) },
  signIn: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockSignUpEmail.mockReset()
  mockUseSession.mockReturnValue({ data: null, isPending: false })
  // window.confirm はデフォルトで OK 扱いとし、必要に応じて per-test で上書きする。
  vi.stubGlobal('confirm', vi.fn(() => true))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Register', () => {
  it('未ログイン時はフォームが描画される', () => {
    renderRegister()

    expect(
      screen.getByRole('heading', { name: 'アカウント登録' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/メールアドレス/)).toBeInTheDocument()
    expect(screen.getByLabelText(/パスワード/)).toBeInTheDocument()
    expect(screen.getByLabelText(/お名前/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '登録する' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'リセット' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'キャンセル' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ログイン' })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  it('既ログイン時は /routes へ自動リダイレクトする', () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: 'me@example.com' } },
      isPending: false,
    })

    renderRegister()

    expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'アカウント登録' }),
    ).not.toBeInTheDocument()
  })

  it('isPending 中はリダイレクトせずフォームを表示する', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })

    renderRegister()

    expect(
      screen.getByRole('heading', { name: 'アカウント登録' }),
    ).toBeInTheDocument()
  })

  it('入力した値が email / password / name の各欄に反映される', async () => {
    const user = userEvent.setup()
    renderRegister()

    const email = screen.getByLabelText(/メールアドレス/) as HTMLInputElement
    const password = screen.getByLabelText(/パスワード/) as HTMLInputElement
    const name = screen.getByLabelText(/お名前/) as HTMLInputElement

    await user.type(email, 'foo@example.com')
    await user.type(password, 'Test1234')
    await user.type(name, '山田 太郎')

    expect(email.value).toBe('foo@example.com')
    expect(password.value).toBe('Test1234')
    expect(name.value).toBe('山田 太郎')
  })

  it('「表示」ボタンでパスワード欄のマスクを切替できる', async () => {
    const user = userEvent.setup()
    renderRegister()

    const password = screen.getByLabelText(/パスワード/) as HTMLInputElement
    expect(password.type).toBe('password')

    await user.click(screen.getByRole('button', { name: '表示' }))
    expect(password.type).toBe('text')

    await user.click(screen.getByRole('button', { name: '隠す' }))
    expect(password.type).toBe('password')
  })

  it('全フィールド未入力で送信するとそれぞれエラーが出て signUp は呼ばれない', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      screen.getByText('メールアドレスを入力してください'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('パスワードを入力してください'),
    ).toBeInTheDocument()
    expect(screen.getByText('氏名を入力してください')).toBeInTheDocument()
    expect(mockSignUpEmail).not.toHaveBeenCalled()
  })

  it('メール形式不正でフィールドエラーが出る', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/メールアドレス/), 'not-an-email')
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      screen.getByText('メールアドレスの形式が正しくありません'),
    ).toBeInTheDocument()
    expect(mockSignUpEmail).not.toHaveBeenCalled()
  })

  it('パスワード桁数不足ではフィールドエラーが出る', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Aa1') // 3文字
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      screen.getByText('パスワードは8〜32文字で入力してください'),
    ).toBeInTheDocument()
    expect(mockSignUpEmail).not.toHaveBeenCalled()
  })

  it('パスワード文字種不足ではフィールドエラーが出る (英大文字なし)', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'lowercase1') // 大文字なし
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      screen.getByText(
        'パスワードは英大文字・小文字・数字をそれぞれ1文字以上含めてください',
      ),
    ).toBeInTheDocument()
    expect(mockSignUpEmail).not.toHaveBeenCalled()
  })

  it('フォーカスアウト時にバリデーションが走り対象のエラーが出る', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.click(screen.getByLabelText(/メールアドレス/))
    await user.tab()

    expect(
      screen.getByText('メールアドレスを入力してください'),
    ).toBeInTheDocument()
  })

  it('登録成功で signUp.email が正しい引数で呼ばれ /routes へ遷移する', async () => {
    const user = userEvent.setup()
    mockSignUpEmail.mockResolvedValueOnce({ data: { user: {} }, error: null })
    renderRegister()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        email: 'foo@example.com',
        password: 'Test1234',
        name: '山田 太郎',
      })
      expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
    })
  })

  it('USER_ALREADY_EXISTS では「既に登録されています」バナーを表示し /routes へ遷移しない', async () => {
    const user = userEvent.setup()
    mockSignUpEmail.mockResolvedValueOnce({
      data: null,
      error: { code: 'USER_ALREADY_EXISTS', message: 'User already exists' },
    })
    renderRegister()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'taken@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      await screen.findByText('このメールアドレスは既に登録されています'),
    ).toBeInTheDocument()
    expect(screen.queryByText('ROUTES_PAGE')).not.toBeInTheDocument()
  })

  it('その他のサーバエラーでは汎用バナーを表示する', async () => {
    const user = userEvent.setup()
    mockSignUpEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'Internal Server Error' },
    })
    renderRegister()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      await screen.findByText(/登録に失敗しました/),
    ).toBeInTheDocument()
  })

  it('signUp が例外で reject した場合も汎用バナーを表示する', async () => {
    const user = userEvent.setup()
    mockSignUpEmail.mockRejectedValueOnce(new Error('network down'))
    renderRegister()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(
      await screen.findByText(/登録に失敗しました/),
    ).toBeInTheDocument()
  })

  it('送信中はボタンが「登録中…」になり全ボタンが非活性になる', async () => {
    const user = userEvent.setup()
    let resolveSignUp: (v: unknown) => void = () => {}
    mockSignUpEmail.mockReturnValueOnce(
      new Promise((r) => {
        resolveSignUp = r
      }),
    )
    renderRegister()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.type(screen.getByLabelText(/パスワード/), 'Test1234')
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎')
    await user.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '登録中…' }),
      ).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: 'リセット' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()

    resolveSignUp({ data: { user: {} }, error: null })
    await waitFor(() => {
      expect(screen.getByText('ROUTES_PAGE')).toBeInTheDocument()
    })
  })

  it('リセットボタンで confirm OK 時に全入力とエラーがクリアされる', async () => {
    const user = userEvent.setup()
    renderRegister()

    const email = screen.getByLabelText(/メールアドレス/) as HTMLInputElement
    const password = screen.getByLabelText(/パスワード/) as HTMLInputElement
    const name = screen.getByLabelText(/お名前/) as HTMLInputElement

    await user.type(email, 'foo@example.com')
    await user.type(password, 'Test1234')
    await user.type(name, '山田 太郎')

    await user.click(screen.getByRole('button', { name: 'リセット' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(email.value).toBe('')
    expect(password.value).toBe('')
    expect(name.value).toBe('')
  })

  it('リセットボタンで confirm キャンセル時は入力が保持される', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('confirm', vi.fn(() => false))
    renderRegister()

    const email = screen.getByLabelText(/メールアドレス/) as HTMLInputElement

    await user.type(email, 'foo@example.com')
    await user.click(screen.getByRole('button', { name: 'リセット' }))

    expect(email.value).toBe('foo@example.com')
  })

  it('キャンセルボタンで入力なしなら確認なしに /login へ遷移する', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('キャンセルボタンで入力ありなら confirm OK 時のみ /login へ遷移する', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(
      screen.getByLabelText(/メールアドレス/),
      'foo@example.com',
    )
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
  })
})
