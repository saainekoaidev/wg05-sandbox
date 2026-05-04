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

// US-017 / US-050: cascade フィルタテスト用に複数 kind / operator の路線を返す stub
vi.mock('../lib/lines', () => ({
  KIND_OPTIONS: [
    { value: 'train', label: '電車' },
    { value: 'subway', label: '地下鉄' },
    { value: 'bus', label: 'バス' },
    { value: 'other', label: 'その他' },
  ],
  useLines: () => ({
    lines: [
      { id: 'jr-tokaido', name: 'JR東海道線', kind: 'train', operator: 'JR東海', operatorId: 'jr-tokai', operatorName: 'JR東海', routeSegmentCount: 0, stationCount: 0 },
      { id: 'meitetsu-honsen', name: '名鉄名古屋本線', kind: 'train', operator: '名鉄', operatorId: 'meitetsu', operatorName: '名古屋鉄道', routeSegmentCount: 0, stationCount: 0 },
      { id: 'higashiyama', name: '東山線', kind: 'subway', operator: '名古屋市交通局', operatorId: 'nagoya-subway', operatorName: '名古屋市交通局', routeSegmentCount: 0, stationCount: 0 },
      { id: 'meijo', name: '名城線', kind: 'subway', operator: '名古屋市交通局', operatorId: 'nagoya-subway', operatorName: '名古屋市交通局', routeSegmentCount: 0, stationCount: 0 },
    ],
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../lib/operators', () => ({
  useOperators: () => ({
    operators: [
      { id: 'jr-tokai', name: 'JR東海', aliases: [] },
      { id: 'meitetsu', name: '名古屋鉄道', aliases: [] },
      { id: 'nagoya-subway', name: '名古屋市交通局', aliases: [] },
    ],
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

function renderPicker(initialPath = '/stations') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
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
      code: 'JY20',
      lines: [
        { id: 'jr-yamanote', name: 'JR山手線', kind: 'train', operator: 'JR東日本' },
        { id: 'metro-fukutoshin', name: '東京メトロ副都心線', kind: 'subway', operator: '東京メトロ' },
      ],
    },
  ],
}

// US-030: ソートテスト用に複数駅を返すレスポンス
// API の order 既定 (name asc) で渋谷 → 新宿 → 池袋 の順とする。
//  - kind: 渋谷=train+subway, 新宿=train, 池袋=subway
//  - kana: しぶや / しんじゅく / いけぶくろ
//  - code: JY20 / JY17 / "" (池袋は空)
const SORT_SAMPLE = {
  stations: [
    {
      id: 'stn-shibuya',
      name: '渋谷',
      kana: 'しぶや',
      code: 'JY20',
      lines: [
        { id: 'jr-yamanote', name: 'JR山手線', kind: 'train', operator: 'JR東日本' },
        { id: 'metro-fukutoshin', name: '東京メトロ副都心線', kind: 'subway', operator: '東京メトロ' },
      ],
    },
    {
      id: 'stn-shinjuku',
      name: '新宿',
      kana: 'しんじゅく',
      code: 'JY17',
      lines: [
        { id: 'jr-yamanote', name: 'JR山手線', kind: 'train', operator: 'JR東日本' },
      ],
    },
    {
      id: 'stn-ikebukuro',
      name: '池袋',
      kana: 'いけぶくろ',
      code: '',
      lines: [
        { id: 'metro-marunouchi', name: '東京メトロ丸ノ内線', kind: 'subway', operator: '東京メトロ' },
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
        '駅名・運営会社・種別・路線のいずれかを入力または選択してください',
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

  describe('US-017 種別↔路線 cascade フィルタ', () => {
    it('種別=電車 を選ぶと路線セレクトの選択肢が train 路線のみになる', async () => {
      const user = userEvent.setup()
      renderPicker()
      await user.selectOptions(screen.getByLabelText('種別'), 'train')
      const lineSelect = screen.getByLabelText('路線') as HTMLSelectElement
      const optTexts = Array.from(lineSelect.options).map((o) => o.text)
      expect(optTexts).toEqual([
        'すべての路線',
        'JR東海道線',
        '名鉄名古屋本線',
      ])
    })

    it('種別=地下鉄 を選ぶと路線セレクトの選択肢が subway 路線のみになる', async () => {
      const user = userEvent.setup()
      renderPicker()
      await user.selectOptions(screen.getByLabelText('種別'), 'subway')
      const lineSelect = screen.getByLabelText('路線') as HTMLSelectElement
      const optTexts = Array.from(lineSelect.options).map((o) => o.text)
      expect(optTexts).toEqual(['すべての路線', '東山線', '名城線'])
    })

    it('種別=すべて (空文字) なら路線リストは全件表示', async () => {
      const user = userEvent.setup()
      renderPicker()
      // 一旦 train を選ぶ
      await user.selectOptions(screen.getByLabelText('種別'), 'train')
      // 戻す
      await user.selectOptions(screen.getByLabelText('種別'), '')
      const lineSelect = screen.getByLabelText('路線') as HTMLSelectElement
      expect(lineSelect.options.length).toBe(5) // すべての路線 + 4 件
    })

    it('路線を選ぶと種別がその路線の kind に自動で揃う', async () => {
      const user = userEvent.setup()
      renderPicker()
      const kindSelect = screen.getByLabelText('種別') as HTMLSelectElement
      const lineSelect = screen.getByLabelText('路線') as HTMLSelectElement
      // 初期は両方 ""
      expect(kindSelect.value).toBe('')
      expect(lineSelect.value).toBe('')

      // 地下鉄路線 (東山線) を選ぶ
      await user.selectOptions(lineSelect, 'higashiyama')
      expect(kindSelect.value).toBe('subway')
      expect(lineSelect.value).toBe('higashiyama')
    })

    it('種別を変更して現在選択中の路線と矛盾するときは路線がクリアされる', async () => {
      const user = userEvent.setup()
      renderPicker()
      const kindSelect = screen.getByLabelText('種別') as HTMLSelectElement
      const lineSelect = screen.getByLabelText('路線') as HTMLSelectElement

      // 電車路線 (JR東海道線) を選ぶ → 種別=電車に揃う
      await user.selectOptions(lineSelect, 'jr-tokaido')
      expect(kindSelect.value).toBe('train')
      expect(lineSelect.value).toBe('jr-tokaido')

      // 種別を 地下鉄 に変更 → JR東海道線 (電車) と矛盾するため路線クリア
      await user.selectOptions(kindSelect, 'subway')
      expect(kindSelect.value).toBe('subway')
      expect(lineSelect.value).toBe('')
    })

    it('種別を変更しても路線がその種別と整合する場合は路線をクリアしない', async () => {
      const user = userEvent.setup()
      renderPicker()
      const kindSelect = screen.getByLabelText('種別') as HTMLSelectElement
      const lineSelect = screen.getByLabelText('路線') as HTMLSelectElement

      // 電車路線を選ぶ
      await user.selectOptions(lineSelect, 'jr-tokaido')
      // 種別 = 電車 (同じ) に再選択
      await user.selectOptions(kindSelect, 'train')
      expect(lineSelect.value).toBe('jr-tokaido')
    })
  })

  describe('US-016 popup から条件を引き継いで自動検索', () => {
    it('?kind=train で開いた時、種別が pre-fill され自動検索される', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ stations: [] }), { status: 200 }),
      )
      renderPicker('/stations?kind=train')
      // 種別が pre-fill
      await waitFor(() => {
        expect(
          (screen.getByLabelText('種別') as HTMLSelectElement).value,
        ).toBe('train')
      })
      // 自動検索が走り、API が呼ばれた
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const [url] = fetchMock.mock.calls[0]!
      expect(url).toContain('kind=train')
    })

    it('?kind=train&line=jr-tokaido で開いた時、両方 pre-fill + 自動検索', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ stations: [] }), { status: 200 }),
      )
      renderPicker('/stations?kind=train&line=jr-tokaido')
      await waitFor(() => {
        expect((screen.getByLabelText('種別') as HTMLSelectElement).value).toBe(
          'train',
        )
        expect((screen.getByLabelText('路線') as HTMLSelectElement).value).toBe(
          'jr-tokaido',
        )
      })
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const [url] = fetchMock.mock.calls[0]!
      expect(url).toContain('kind=train')
      expect(url).toContain('line=jr-tokaido')
    })

    it('?q=渋 で開いた時、キーワードが pre-fill + 自動検索', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ stations: [] }), { status: 200 }),
      )
      renderPicker('/stations?q=' + encodeURIComponent('渋'))
      await waitFor(() => {
        expect(
          (screen.getByLabelText('駅名 / よみがな') as HTMLInputElement).value,
        ).toBe('渋')
      })
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    })

    it('URL クエリ無しでは自動検索しない', async () => {
      renderPicker('/stations')
      // 短いラグの後でも fetch が呼ばれていないこと
      await new Promise((r) => setTimeout(r, 100))
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('不正な kind 値 (?kind=spaceship) は無視される (空に倒す)', async () => {
      renderPicker('/stations?kind=spaceship')
      await new Promise((r) => setTimeout(r, 100))
      expect((screen.getByLabelText('種別') as HTMLSelectElement).value).toBe(
        '',
      )
      // 不正 kind のみだと有効条件が無いので自動検索しない
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('US-030 種別 / よみがな / 駅番号 ソート', () => {
    async function renderWithSortSample() {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(SORT_SAMPLE), { status: 200 }),
      )
      renderPicker()
      await user.type(screen.getByLabelText('駅名 / よみがな'), 'a')
      await user.click(screen.getByRole('button', { name: '検索' }))
      await screen.findByText('渋谷')
      return user
    }

    function getRowOrder(): string[] {
      // tbody の各行の駅名セル (3 列目: # / 種別 / 駅名) を抽出
      const rows = Array.from(document.querySelectorAll('tbody tr'))
      return rows.map((tr) => {
        const cells = tr.querySelectorAll('td')
        return (cells[2]?.textContent ?? '').trim()
      })
    }

    it('駅番号列 (code) が表示される。空文字の駅は em-dash 表示', async () => {
      await renderWithSortSample()
      // テーブルヘッダに「駅番号」が出ている
      expect(
        screen.getByRole('columnheader', { name: /駅番号/ }),
      ).toBeInTheDocument()
      // 渋谷の code セルに JY20 が表示
      expect(screen.getByText('JY20')).toBeInTheDocument()
      expect(screen.getByText('JY17')).toBeInTheDocument()
    })

    it('「よみがな」列をクリックすると昇順ソートする', async () => {
      const user = await renderWithSortSample()
      await user.click(
        screen.getByRole('columnheader', { name: /よみがな/ }),
      )
      // いけぶくろ < しぶや < しんじゅく
      expect(getRowOrder()).toEqual(['池袋', '渋谷', '新宿'])
    })

    it('「よみがな」列を再度クリックすると降順ソートする', async () => {
      const user = await renderWithSortSample()
      const header = screen.getByRole('columnheader', { name: /よみがな/ })
      await user.click(header) // asc
      await user.click(header) // desc
      expect(getRowOrder()).toEqual(['新宿', '渋谷', '池袋'])
    })

    it('「駅番号」列ソート時、空 code の駅は昇順でも末尾に並ぶ', async () => {
      const user = await renderWithSortSample()
      await user.click(screen.getByRole('columnheader', { name: /駅番号/ }))
      // JY17 < JY20 < (空文字=末尾)
      expect(getRowOrder()).toEqual(['新宿', '渋谷', '池袋'])
    })

    it('「駅番号」列を降順にしても空 code の駅は末尾に並ぶ', async () => {
      const user = await renderWithSortSample()
      const header = screen.getByRole('columnheader', { name: /駅番号/ })
      await user.click(header)
      await user.click(header) // desc
      // JY20 > JY17 > (空文字=末尾固定)
      expect(getRowOrder()).toEqual(['渋谷', '新宿', '池袋'])
    })

    it('「種別」列ソートで電車を先頭に並べる (train < subway 優先順)', async () => {
      const user = await renderWithSortSample()
      await user.click(screen.getByRole('columnheader', { name: /種別/ }))
      // 渋谷 (train+subway → train) / 新宿 (train) / 池袋 (subway)
      // 渋谷と新宿はどちらも train priority=0 → 配列内の元の順序 (渋谷→新宿) を保つ
      expect(getRowOrder()).toEqual(['渋谷', '新宿', '池袋'])
    })

    it('aria-sort 属性が active 列で ascending / descending に切り替わる', async () => {
      const user = await renderWithSortSample()
      const kanaHeader = screen.getByRole('columnheader', { name: /よみがな/ })
      expect(kanaHeader.getAttribute('aria-sort')).toBe('none')
      await user.click(kanaHeader)
      expect(kanaHeader.getAttribute('aria-sort')).toBe('ascending')
      await user.click(kanaHeader)
      expect(kanaHeader.getAttribute('aria-sort')).toBe('descending')
    })
  })
})
