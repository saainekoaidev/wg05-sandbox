import { test, expect, type Page } from '@playwright/test'

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const TEST_EMAIL = `e2e-list-${RUN_TAG}@example.com`
const TEST_PASSWORD = 'TestE2E1234'
const TEST_NAME = 'E2E List User'

test.beforeAll(async ({ request }) => {
  await request.post('http://localhost:3000/api/auth/sign-up/email', {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME },
    failOnStatusCode: false,
  })
})

async function loginViaUi(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/メールアドレス/).fill(TEST_EMAIL)
  await page.getByLabel(/パスワード/).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page).toHaveURL('/routes')
}

async function registerRouteViaUi(
  page: Page,
  args: { name: string; from: string; to: string; fare: string },
) {
  await page.getByRole('link', { name: '+ 新規登録' }).first().click()
  await expect(page).toHaveURL('/routes/new')
  await page.getByLabel('経路名').fill(args.name)
  await page.getByLabel('区間1 出発駅').fill(args.from)
  await page.getByLabel('区間1 到着駅').fill(args.to)
  await page.getByLabel('区間1 運賃').fill(args.fare)
  await page.getByRole('button', { name: '登録する' }).click()
  await expect(page).toHaveURL('/routes')
}

test.describe('US-004 経路一覧フロー', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('ログイン直後 (経路 0 件) は空状態メッセージと新規登録誘導が表示される', async ({
    page,
  }) => {
    await loginViaUi(page)
    await expect(
      page.getByText('まだ通勤経路が登録されていません。'),
    ).toBeVisible()
    // ヘッダ + 空状態 の少なくとも 2 箇所に新規登録ボタンが存在
    const links = page.getByRole('link', { name: '+ 新規登録' })
    await expect(links).toHaveCount(2)
  })

  test('登録した経路が一覧に出発→到着 / 合計運賃 / 種別タグ付きで表示される', async ({
    page,
  }) => {
    await loginViaUi(page)
    const name = `E2E一覧-${RUN_TAG}`
    await registerRouteViaUi(page, {
      name,
      from: '渋谷',
      to: '神田',
      fare: '320',
    })

    // 一覧に行が出る
    await expect(page.getByText(name)).toBeVisible()
    await expect(page.getByText('渋谷 → 神田')).toBeVisible()
    await expect(page.getByText('¥320')).toBeVisible()
    // 種別タグ (電車) が描画される (select option ではなくタグ要素を limit)
    await expect(
      page.locator('span.tag-train', { hasText: '電車' }),
    ).toBeVisible()
  })

  test('複数経路を登録すると updatedAt DESC で最新が先頭に並ぶ', async ({
    page,
  }) => {
    await loginViaUi(page)

    // 1件目 (古い)
    await registerRouteViaUi(page, {
      name: `E2E古い-${RUN_TAG}`,
      from: '池袋',
      to: '新宿',
      fare: '160',
    })
    // 2件目 (新しい)
    await registerRouteViaUi(page, {
      name: `E2E新しい-${RUN_TAG}`,
      from: '新宿',
      to: '東京',
      fare: '210',
    })

    // 並びを確認 (table 内の経路名セルの出現順)
    const nameCells = page.locator('table tbody tr td:nth-child(2)')
    const texts = await nameCells.allTextContents()
    const idxNew = texts.findIndex((t) => t.includes('E2E新しい'))
    const idxOld = texts.findIndex((t) => t.includes('E2E古い'))
    expect(idxNew).toBeGreaterThanOrEqual(0)
    expect(idxOld).toBeGreaterThan(idxNew)
  })

  test('行内アクション: 詳細はリンク有効化 (US-005), 編集 / 削除 は disabled', async ({
    page,
  }) => {
    await loginViaUi(page)
    // route 名に kanji の「詳細/編集/削除」を含めると aria-label と衝突して
    // セレクタが曖昧になるため ASCII 名でテスト用 route を作る
    const name = `E2EActions-${RUN_TAG}`
    await registerRouteViaUi(page, {
      name,
      from: '品川',
      to: '東京',
      fare: '180',
    })

    const row = page.locator('table tbody tr', { hasText: name })
    // US-005 で詳細遷移先が完成したため、詳細はリンクとして有効化されている
    await expect(row.getByRole('link', { name: /詳細/ })).toHaveAttribute(
      'href',
      /\/routes\/[^/]+$/,
    )
    await expect(row.getByRole('button', { name: /編集/ })).toBeDisabled()
    await expect(row.getByRole('button', { name: /削除/ })).toBeDisabled()
  })

  test('未ログインで /routes に直接アクセスすると /login にリダイレクトされる', async ({
    page,
  }) => {
    await page.goto('/routes')
    await expect(page).toHaveURL('/login')
  })

  test('ログアウトで /login に戻り, /routes に再アクセスしてもログイン画面に戻る', async ({
    page,
  }) => {
    await loginViaUi(page)
    await page.getByRole('link', { name: 'ログアウト' }).click()
    await expect(page).toHaveURL('/login')

    await page.goto('/routes')
    await expect(page).toHaveURL('/login')
  })
})
