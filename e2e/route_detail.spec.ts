import { test, expect, type Page } from '@playwright/test'

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const TEST_EMAIL = `e2e-detail-${RUN_TAG}@example.com`
const TEST_PASSWORD = 'TestE2E1234'
const TEST_NAME = 'E2E Detail User'

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
  // US-057: 運営会社・種別 必須
  await page.getByLabel('区間1 運営会社').selectOption('jr-tokai')
  await page.getByLabel('区間1 種別').selectOption('train')
  await page.getByLabel('区間1 出発駅').fill(args.from)
  await page.getByLabel('区間1 到着駅').fill(args.to)
  await page.getByLabel('区間1 運賃').fill(args.fare)
  await page.getByRole('button', { name: '登録する' }).click()
  await expect(page).toHaveURL('/routes')
}

test.describe('US-005 経路詳細 / 削除フロー', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('一覧の「詳細」リンクから /routes/:id に遷移し、各項目が表示される', async ({
    page,
  }) => {
    // route 名に kanji「詳細/編集/削除」を含めると aria-label と衝突するため ASCII 名にする
    const name = `E2EDetailFlow-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '渋谷',
      to: '神田',
      fare: '320',
    })

    // 一覧で詳細リンクを押す
    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /詳細/ }).click()

    // 詳細画面の URL は /routes/<cuid>
    await expect(page).toHaveURL(/\/routes\/[^/]+$/)
    await expect(
      page.getByRole('heading', { name: '経路詳細' }),
    ).toBeVisible()

    // 各 detail 項目 (合計運賃: ¥320 は detail-row の合計運賃と segment fare の両方に出るため
    // .detail-row 配下にスコープして検証する)
    await expect(page.getByText(name, { exact: true })).toBeVisible()
    await expect(
      page.locator('.detail-row', { hasText: '合計運賃' }).getByText('¥320'),
    ).toBeVisible()
    await expect(
      page.locator('.seg-item', { hasText: '渋谷 → 神田' }),
    ).toBeVisible()
  })

  test('「一覧に戻る」リンクで /routes に戻る', async ({ page }) => {
    const name = `E2EBack-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '池袋',
      to: '東京',
      fare: '200',
    })

    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /詳細/ }).click()
    await expect(page).toHaveURL(/\/routes\/[^/]+$/)

    await page.getByRole('link', { name: '一覧に戻る' }).click()
    await expect(page).toHaveURL('/routes')
  })

  test('編集ボタンは /routes/:id/edit へのリンクとして有効化されている (US-006)', async ({
    page,
  }) => {
    const name = `E2EEditBtn-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '新宿',
      to: '東京',
      fare: '210',
    })
    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /詳細/ }).click()
    await expect(page).toHaveURL(/\/routes\/[^/]+$/)

    // 詳細画面の編集リンクは accessible name が "編集" (exact)
    await expect(
      page.getByRole('link', { name: '編集', exact: true }),
    ).toHaveAttribute('href', /\/routes\/[^/]+\/edit$/)
  })

  test('削除ボタン: confirm OK で削除され /routes に通知バナーが表示される', async ({
    page,
  }) => {
    const name = `E2EDeleteOk-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '渋谷',
      to: '神田',
      fare: '320',
    })

    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /詳細/ }).click()
    // 遷移完了を待ってから削除ボタンを掴む (list 画面の disabled 削除ボタンとの混同を防ぐ)
    await expect(page).toHaveURL(/\/routes\/[^/]+$/)
    await expect(
      page.getByRole('heading', { name: '経路詳細' }),
    ).toBeVisible()

    // window.confirm はダイアログとして扱われる: accept で進める
    page.once('dialog', (d) => {
      expect(d.message()).toBe('この経路を削除しますか?')
      d.accept()
    })
    // 詳細画面の 削除 ボタンは accessible name がそのまま「削除」(aria-label なし)
    await page.getByRole('button', { name: '削除', exact: true }).click()

    // /routes に戻り、通知バナー + 該当経路が消える
    await expect(page).toHaveURL('/routes')
    await expect(page.getByText('経路を削除しました')).toBeVisible()
    await expect(
      page.locator('table tbody tr', { hasText: name }),
    ).toHaveCount(0)
  })

  test('削除ボタン: confirm キャンセルでは何も起こらず詳細画面に留まる', async ({
    page,
  }) => {
    const name = `E2EDeleteCancel-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '品川',
      to: '東京',
      fare: '180',
    })

    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /詳細/ }).click()
    await expect(page).toHaveURL(/\/routes\/[^/]+$/)
    await expect(
      page.getByRole('heading', { name: '経路詳細' }),
    ).toBeVisible()

    page.once('dialog', (d) => d.dismiss())
    await page.getByRole('button', { name: '削除', exact: true }).click()

    // 詳細画面に留まる (URL 変化なし)
    await expect(page).toHaveURL(/\/routes\/[^/]+$/)
    await expect(
      page.getByRole('heading', { name: '経路詳細' }),
    ).toBeVisible()
  })

  test('存在しない id では「該当の経路が見つかりませんでした」が表示される', async ({
    page,
  }) => {
    await loginViaUi(page)
    await page.goto('/routes/nonexistent-id-xyz')
    await expect(
      page.getByText('該当の経路が見つかりませんでした'),
    ).toBeVisible()
  })

  test('未ログインで /routes/:id に直接アクセスすると /login にリダイレクト', async ({
    page,
  }) => {
    await page.goto('/routes/anything')
    await expect(page).toHaveURL('/login')
  })
})
