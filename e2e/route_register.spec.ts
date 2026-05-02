import { test, expect, type Page } from '@playwright/test'

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const TEST_EMAIL = `e2e-route-${RUN_TAG}@example.com`
const TEST_PASSWORD = 'TestE2E1234'
const TEST_NAME = 'E2E Route User'

// テストユーザを最初に作成 (既存なら無視)。 sign-up は同時に sign-in も行うため、
// 各テストでログインを取り直す手間が省ける形になっている。
test.beforeAll(async ({ request }) => {
  await request.post('http://localhost:3000/api/auth/sign-up/email', {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME },
    failOnStatusCode: false,
  })
})

async function loginAndGoToRouteRegister(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/メールアドレス/).fill(TEST_EMAIL)
  await page.getByLabel(/パスワード/).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page).toHaveURL('/routes')
  // 経路一覧 (US-004) には 0件時にヘッダ + 空状態の 2箇所に「+ 新規登録」があるため、
  // 先頭 (ヘッダ右) を明示的に選ぶ。
  await page.getByRole('link', { name: '+ 新規登録' }).first().click()
  await expect(page).toHaveURL('/routes/new')
}

test.describe('US-003 経路登録フロー', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('ログイン後、経路一覧の「+ 新規登録」リンクから /routes/new に到達する', async ({
    page,
  }) => {
    await loginAndGoToRouteRegister(page)
    await expect(
      page.getByRole('heading', { name: '新規通勤経路の登録' }),
    ).toBeVisible()
  })

  test('未ログインで /routes/new に直接アクセスすると /login にリダイレクトされる', async ({
    page,
  }) => {
    await page.goto('/routes/new')
    await expect(page).toHaveURL('/login')
  })

  test('1区間で登録すると /routes に遷移する', async ({ page }) => {
    await loginAndGoToRouteRegister(page)

    await page.getByLabel('経路名').fill(`E2E通勤-${RUN_TAG}`)
    await page.getByLabel('区間1 出発駅').fill('渋谷')
    await page.getByLabel('区間1 到着駅').fill('神田')
    await page.getByLabel('区間1 運賃').fill('200')

    await page.getByRole('button', { name: '登録する' }).click()
    await expect(page).toHaveURL('/routes')
  })

  test('複数区間で登録できる (合計運賃が動的に更新される)', async ({ page }) => {
    await loginAndGoToRouteRegister(page)

    await page.getByLabel('区間1 出発駅').fill('渋谷')
    await page.getByLabel('区間1 到着駅').fill('表参道')
    await page.getByLabel('区間1 運賃').fill('160')
    // 合計が反映されている
    await expect(page.getByText('合計運賃: ¥160')).toBeVisible()

    await page.getByRole('button', { name: /区間を追加/ }).click()
    await page.getByLabel('区間2 出発駅').fill('表参道')
    await page.getByLabel('区間2 到着駅').fill('神田')
    await page.getByLabel('区間2 運賃').fill('170')
    await expect(page.getByText('合計運賃: ¥330')).toBeVisible()

    await page.getByRole('button', { name: '登録する' }).click()
    await expect(page).toHaveURL('/routes')
  })

  test('区間1件のとき削除ボタンは非活性 (最低1区間ガード)', async ({ page }) => {
    await loginAndGoToRouteRegister(page)
    await expect(
      page.getByRole('button', { name: '区間1 を削除' }),
    ).toBeDisabled()
  })

  test('未入力で送信するとフィールドエラーが出て /routes に遷移しない', async ({
    page,
  }) => {
    await loginAndGoToRouteRegister(page)
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(
      page.getByText('区間ごとに出発駅を入力してください'),
    ).toBeVisible()
    await expect(
      page.getByText('区間ごとに到着駅を入力してください'),
    ).toBeVisible()
    await expect(
      page.getByText('区間ごとに運賃を入力してください'),
    ).toBeVisible()
    await expect(page).toHaveURL('/routes/new')
  })

  test('駅選択ボタンでポップアップが開き、選択した駅名が親フォームに反映される', async ({
    page,
    context,
  }) => {
    await loginAndGoToRouteRegister(page)

    // popup を待ち受けてから駅選択ボタンをクリック
    const popupPromise = context.waitForEvent('page')
    await page
      .locator('text=駅選択')
      .first()
      .click()
    const popup = await popupPromise
    await popup.waitForLoadState()
    await expect(popup).toHaveURL(/\/stations$/)
    await expect(
      popup.getByRole('heading', { name: '駅マスタ参照' }),
    ).toBeVisible()

    // popup 内で検索 → 選択
    await popup.getByLabel('駅名 / よみがな').fill('渋')
    await popup.getByRole('button', { name: '検索' }).click()
    await expect(popup.getByText('渋谷', { exact: true })).toBeVisible()
    await popup.getByRole('button', { name: '渋谷 を選択' }).click()

    // popup から postMessage を受けて親フォームの 区間1 出発駅 に「渋谷」が入る。
    // popup の close イベントは Playwright の捕捉タイミング次第で取りこぼす場合があるため、
    // 親側の値変化を最終アサーションに置く。
    await expect(page.getByLabel('区間1 出発駅')).toHaveValue('渋谷', {
      timeout: 10_000,
    })
  })
})
