import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UserBadge } from './UserBadge'

const mockUseSession = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

function renderBadge() {
  return render(
    <MemoryRouter>
      <UserBadge />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseSession.mockReset()
})

describe('UserBadge (US-019)', () => {
  it('isPending 中は何も描画しない', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })
    const { container } = renderBadge()
    expect(container).toBeEmptyDOMElement()
  })

  it('未ログインなら何も描画しない (ログイン/登録画面で使われた場合のフォールバック)', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    const { container } = renderBadge()
    expect(container).toBeEmptyDOMElement()
  })

  it('認証済みなら user.name を /account へのリンクとして描画する', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', email: 'me@example.com', name: '山田 太郎' } },
      isPending: false,
    })
    renderBadge()
    const link = screen.getByRole('link', { name: /アカウント設定を開く/ })
    expect(link).toHaveAttribute('href', '/account')
    expect(link).toHaveTextContent('山田 太郎')
  })

  it('name が空なら email にフォールバック', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', email: 'fb@example.com', name: '' } },
      isPending: false,
    })
    renderBadge()
    expect(screen.getByText('fb@example.com')).toBeInTheDocument()
  })

  it('「ユーザー：」のラベルは表示されない (US-019 仕様)', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', email: 'me@example.com', name: '山田 太郎' } },
      isPending: false,
    })
    renderBadge()
    expect(screen.queryByText(/ユーザー[:：]/)).not.toBeInTheDocument()
  })
})
