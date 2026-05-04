import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminOperators } from './AdminOperators'

const mockUseSession = vi.fn()
const fetchMock = vi.fn()
const useAdminOperatorsMock = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

vi.mock('../lib/operators', () => ({
  useAdminOperators: (opts: { enabled?: boolean }) => useAdminOperatorsMock(opts),
}))

const ADMIN = {
  id: 'u1',
  email: 'admin@example.com',
  name: '管理者',
  postalCode: null,
  role: 'admin',
}

const NORMAL = { ...ADMIN, role: 'user' }

const OP_JR = {
  id: 'jr-tokai',
  name: 'JR東海',
  aliases: ['東海旅客鉄道'],
  lineCount: 14,
  stationCount: 200,
}

const OP_FREE = {
  id: 'tmp-free',
  name: 'TmpFree',
  aliases: [],
  lineCount: 0,
  stationCount: 0,
}

function renderAdminOperators() {
  return render(
    <MemoryRouter initialEntries={['/admin/operators']}>
      <Routes>
        <Route path="/admin/operators" element={<AdminOperators />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/routes" element={<div>ROUTES_PAGE</div>} />
        <Route path="/account" element={<div>ACCOUNT_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'admin@example.com' } },
    isPending: false,
  })
  fetchMock.mockReset()
  useAdminOperatorsMock.mockReset()
  useAdminOperatorsMock.mockReturnValue({
    operators: [OP_JR, OP_FREE],
    loading: false,
    error: null,
    reload: () => {},
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AdminOperators (US-049)', () => {
  it('未ログインなら /login', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderAdminOperators()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
  })

  it('一般ユーザは 403 表示', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(NORMAL), { status: 200 }),
    )
    renderAdminOperators()
    expect(
      await screen.findByText(/このページを表示するには管理者権限が必要です/),
    ).toBeInTheDocument()
  })

  it('admin: 一覧表示 + 件数同梱 + 削除ボタンは件数 0 のときのみ有効', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(ADMIN), { status: 200 }),
    )
    renderAdminOperators()
    await screen.findByText('JR東海')
    expect(screen.getByText('TmpFree')).toBeInTheDocument()
    // JR東海 は参照中なので削除ボタン disabled
    const jrDelete = screen.getByRole('button', { name: /JR東海.+削除/ })
    expect(jrDelete).toBeDisabled()
    // TmpFree は free なので削除ボタン enabled
    const freeDelete = screen.getByRole('button', { name: /TmpFree.+削除/ })
    expect(freeDelete).not.toBeDisabled()
  })

  it('admin: 削除確認 → DELETE 呼び出し', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ADMIN), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    renderAdminOperators()
    await screen.findByText('TmpFree')
    await user.click(screen.getByRole('button', { name: /TmpFree.+削除/ }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toContain('/api/admin/operators/tmp-free')
    expect(init.method).toBe('DELETE')
  })
})
