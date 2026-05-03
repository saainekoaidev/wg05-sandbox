import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { StationPicker } from './StationPicker'

const mockUseSession = vi.fn()
const fetchMock = vi.fn()
const closeMock = vi.fn()
const postMessageMock = vi.fn()

vi.mock('../lib/auth', () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => mockUseSession(),
}))

// useLines は固定データを返す stub。テスト本体は /api/stations 検索のみ検証するため
// 路線セレクトの選択肢は空でも問題ない。fetch を /api/lines に取られないようにモジュール側でモック。
vi.mock('../lib/lines', () => ({
  KIND_OPTIONS: [
    { value: 'train', label: '電車' },
    { value: 'subway', label: '地下鉄' },
    { value: 'bus', label: 'バス' },
    { value: 'other', label: 'その他' },
  ],
  useLines: () => ({
    lines: [],
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

function renderPicker() {
  return render(
    <MemoryRouter initialEntries={['/stations']}>
      <Routes>
        <Route path="/stations" element={<StationPicker />} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const SAMPLE_RESPONSE = {
  stations: [
    {
      id: 'stn-shibuya',
      name: '渋谷',
      kana: 'しぶや',
      lines: [
        { id: 'jr-yamanote', name: 'JR山手線', kind: 'train', operator: 'JR東日本' },
        { id: 'metro-fukutoshin', name: '東京メトロ副都心線', kind: 'subway', operator: '東京メトロ' },
      ],
    },
  ],
}

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', email: 'me@example.com' } },
    isPending: false,
  })
  fetchMock.mockReset()
  closeMock.mockClear()
  postMessageMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('close', closeMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  // window.opener を再 stub したものをリセット
  Object.defineProperty(window, 'opener', { value: null, configurable: true })
})

describe('StationPicker', () => {
  it('未ログインなら /login にリダイレクトする', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderPicker()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
  })

  it('既ログインなら検索フォームを描画する', () => {
    renderPicker()
    expect(
      screen.getByRole('heading', { name: '駅マスタ参照' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('駅名 / よみがな')).toBeInTheDocument()
    expect(screen.getByLabelText('種別')).toBeInTheDocument()
    expect(screen.getByLabelText('路線')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '検索' })).toBeInTheDocument()
  })

  it('検索条件未指定で「検索」を押すと警告バナーを出して fetch しない', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: '検索' }))

    expect(
      screen.getByText(
        '駅名・種別・路線のいずれかを入力または選択してください',
      ),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('q を入れて検索すると /api/stations が credentials 付きで呼ばれ結果が表示される', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }),
    )
    renderPicker()

    await user.type(screen.getByLabelText('駅名 / よみがな'), '渋')
    await user.click(screen.getByRole('button', { name: '検索' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/api/stations')
    expect(url).toContain('q=%E6%B8%8B') // "渋" url-encoded
    expect(init.credentials).toBe('include')

    expect(await screen.findByText('渋谷')).toBeInTheDocument()
    expect(screen.getByText('しぶや')).toBeInTheDocument()
    // 接続路線の種別タグが描画されている (select option ではなく結果行内のタグ要素を限定検証)
    expect(
      screen.getByText('電車', { selector: 'span.tag-train' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('地下鉄', { selector: 'span.tag-subway' }),
    ).toBeInTheDocument()
  })

  it('検索結果0件なら「該当する駅が見つかりませんでした」を出す', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ stations: [] }), { status: 200 }),
    )
    renderPicker()

    await user.type(screen.getByLabelText('駅名 / よみがな'), 'ZZZ')
    await user.click(screen.getByRole('button', { name: '検索' }))

    expect(
      await screen.findByText(
        '該当する駅が見つかりませんでした。条件を変えてお試しください',
      ),
    ).toBeInTheDocument()
  })

  it('API エラー時はバナーエラーを出す', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'no_filter' }), { status: 400 }),
    )
    renderPicker()

    await user.type(screen.getByLabelText('駅名 / よみがな'), '渋')
    await user.click(screen.getByRole('button', { name: '検索' }))

    expect(
      await screen.findByText(
        '駅マスタの取得に失敗しました。再読み込みをお試しください',
      ),
    ).toBeInTheDocument()
  })

  it('popup として開かれている場合、選択ボタンで opener に postMessage して window.close する', async () => {
    const user = userEvent.setup()

    // window.opener / postMessage / close を stub
    Object.defineProperty(window, 'opener', {
      value: { closed: false, postMessage: postMessageMock },
      configurable: true,
    })

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }),
    )
    renderPicker()

    await user.type(screen.getByLabelText('駅名 / よみがな'), '渋')
    await user.click(screen.getByRole('button', { name: '検索' }))

    await screen.findByText('渋谷')
    await user.click(screen.getByRole('button', { name: '渋谷 を選択' }))

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'station-pick', name: '渋谷' }),
      expect.any(String),
    )
    expect(closeMock).toHaveBeenCalled()
  })

  it('単独画面 (window.opener 無し) では選択しても postMessage / close が走らない', async () => {
    const user = userEvent.setup()
    // opener を null に固定
    Object.defineProperty(window, 'opener', {
      value: null,
      configurable: true,
    })

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }),
    )
    renderPicker()

    await user.type(screen.getByLabelText('駅名 / よみがな'), '渋')
    await user.click(screen.getByRole('button', { name: '検索' }))

    await screen.findByText('渋谷')
    await user.click(screen.getByRole('button', { name: '渋谷 を選択' }))

    expect(postMessageMock).not.toHaveBeenCalled()
    expect(closeMock).not.toHaveBeenCalled()
  })

  it('「閉じる」ボタンは popup 時に window.close を呼ぶ', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'opener', {
      value: { closed: false, postMessage: postMessageMock },
      configurable: true,
    })

    renderPicker()
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(closeMock).toHaveBeenCalled()
  })

  it('クリアボタンで検索条件と結果がリセットされる', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }),
    )
    renderPicker()

    await user.type(screen.getByLabelText('駅名 / よみがな'), '渋')
    await user.click(screen.getByRole('button', { name: '検索' }))
    await screen.findByText('渋谷')

    await user.click(screen.getByRole('button', { name: 'クリア' }))

    expect(screen.getByLabelText('駅名 / よみがな')).toHaveValue('')
    expect(screen.queryByText('渋谷')).not.toBeInTheDocument()
  })
})
