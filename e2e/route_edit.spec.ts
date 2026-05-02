import { test, expect, type Page } from '@playwright/test'

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const TEST_EMAIL = `e2e-edit-${RUN_TAG}@example.com`
const TEST_PASSWORD = 'TestE2E1234'
const TEST_NAME = 'E2E Edit User'

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

test.describe('US-006 経路編集フロー', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('一覧の「編集」リンクから /routes/:id/edit に到達し既存値が pre-fill される', async ({
    page,
  }) => {
    const name = `E2EEditFlow-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '渋谷',
      to: '神田',
      fare: '320',
    })

    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /編集/ }).click()

    await expect(page).toHaveURL(/\/routes\/[^/]+\/edit$/)
    await expect(
      page.getByRole('heading', { name: '通勤経路の編集' }),
    ).toBeVisible()
    // 既存値プリフィル
    await expect(page.getByLabel('経路名')).toHaveValue(name)
    await expect(page.getByLabel('区間1 出発駅')).toHaveValue('渋谷')
    await expect(page.getByLabel('区間1 到着駅')).toHaveValue('神田')
    await expect(page.getByLabel('区間1 運賃')).toHaveValue('320')
  })

  test('差分なし状態では更新ボタン / リセットボタンが disabled', async ({
    page,
  }) => {
    const name = `E2EDirty-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '渋谷',
      to: '神田',
      fare: '320',
    })
    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /編集/ }).click()
    await expect(page).toHaveURL(/\/routes\/[^/]+\/edit$/)

    await expect(
      page.getByRole('button', { name: '更新する' }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'リセット' }),
    ).toBeDisabled()
  })

  test('変更を加えて更新ボタンを押すと /routes/:id に通知バナー付きで戻る', async ({
    page,
  }) => {
    const before = `E2EUpdateBefore-${RUN_TAG}`
    const after = `E2EUpdateAfter-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name: before,
      from: '渋谷',
      to: '神田',
      fare: '320',
    })

    const row = page.locator('table tbody tr', { hasText: before })
    await row.getByRole('link', { name: /編集/ }).click()
    await expect(page).toHaveURL(/\/routes\/[^/]+\/edit$/)

    // 名前を変えて運賃を変更
    await page.getByLabel('経路名').fill(after)
    await page.getByLabel('区間1 運賃').fill('500')

    await page.getByRole('button', { name: '更新する' }).click()

    // /routes/:id に遷移
    await expect(page).toHaveURL(/\/routes\/[^/]+$/)
    await expect(page.getByText('経路を更新しました')).toBeVisible()
    // 更新後の値が詳細画面に出る
    await expect(page.getByText(after, { exact: true })).toBeVisible()
  })

  test('リセットボタンで取得時の状態に戻る', async ({ page }) => {
    const name = `E2EReset-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '渋谷',
      to: '神田',
      fare: '320',
    })

    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /編集/ }).click()

    // 編集
    await page.getByLabel('経路名').fill('一時的な変更')
    await page.getByLabel('区間1 運賃').fill('999')

    // confirm を accept してリセット
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'リセット' }).click()

    await expect(page.getByLabel('経路名')).toHaveValue(name)
    await expect(page.getByLabel('区間1 運賃')).toHaveValue('320')
    await expect(
      page.getByRole('button', { name: '更新する' }),
    ).toBeDisabled()
  })

  test('未ログインで /routes/:id/edit に直接アクセスすると /login にリダイレクト', async ({
    page,
  }) => {
    await page.goto('/routes/anything/edit')
    await expect(page).toHaveURL('/login')
  })

  test('存在しない id の編集画面では「該当の経路が見つかりませんでした」が表示される', async ({
    page,
  }) => {
    await loginViaUi(page)
    await page.goto('/routes/nonexistent-id-xyz/edit')
    await expect(
      page.getByText('該当の経路が見つかりませんでした'),
    ).toBeVisible()
  })

  test('詳細画面の「編集」リンクからも /routes/:id/edit に到達できる', async ({
    page,
  }) => {
    const name = `E2EFromDetail-${RUN_TAG}`
    await loginViaUi(page)
    await registerRouteViaUi(page, {
      name,
      from: '池袋',
      to: '東京',
      fare: '210',
    })
    const row = page.locator('table tbody tr', { hasText: name })
    await row.getByRole('link', { name: /詳細/ }).click()
    await expect(page).toHaveURL(/\/routes\/[^/]+$/)

    // 詳細画面の「編集」 (accessible name は exact "編集")
    await page.getByRole('link', { name: '編集', exact: true }).click()
    await expect(page).toHaveURL(/\/routes\/[^/]+\/edit$/)
    await expect(
      page.getByRole('heading', { name: '通勤経路の編集' }),
    ).toBeVisible()
  })
})
