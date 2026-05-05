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
    // US-057: 運営会社・種別 必須
    await page.getByLabel('区間1 運営会社').selectOption('jr-tokai')
    await page.getByLabel('区間1 種別').selectOption('train')
    await page.getByLabel('区間1 出発駅').fill('渋谷')
    await page.getByLabel('区間1 到着駅').fill('神田')
    await page.getByLabel('区間1 運賃').fill('200')

    await page.getByRole('button', { name: '登録する' }).click()
    await expect(page).toHaveURL('/routes')
  })

  test('複数区間で登録できる (合計運賃が動的に更新される)', async ({ page }) => {
    await loginAndGoToRouteRegister(page)

    await page.getByLabel('区間1 運営会社').selectOption('jr-tokai')
    await page.getByLabel('区間1 種別').selectOption('train')
    await page.getByLabel('区間1 出発駅').fill('渋谷')
    await page.getByLabel('区間1 到着駅').fill('表参道')
    await page.getByLabel('区間1 運賃').fill('160')
    // 合計が反映されている
    await expect(page.getByText('合計運賃: ¥160')).toBeVisible()

    await page.getByRole('button', { name: /区間を追加/ }).click()
    await page.getByLabel('区間2 運営会社').selectOption('jr-tokai')
    await page.getByLabel('区間2 種別').selectOption('train')
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

  // US-011 (東海4県マスタ取り込み) 完了で再有効化。検索キーワードを東京圏 (渋谷) から
  // 東海圏 (名古屋) に変更している。
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
    // US-016: 区間で選択済みの kind/line が URL クエリに付くため $ ではなく \\b 区切りで判定
    await expect(popup).toHaveURL(/\/stations(\?|$)/)
    await expect(
      popup.getByRole('heading', { name: '駅マスタ参照' }),
    ).toBeVisible()

    // popup 内で駅名検索 → 選択 (東海4県取り込み済みの「名古屋」駅を使用)
    // US-065: 検索ボタンは廃止, 入力後 blur (Tab) で client-side filter を適用
    await popup.getByLabel('駅名 / よみがな').fill('名古屋')
    await popup.keyboard.press('Tab')
    // 名古屋駅は事業者ごとに複数 (JR / 名鉄 / 近鉄 / 地下鉄 / あおなみ) 存在するため
    // 最初に見つかる行を選ぶ
    await expect(popup.getByText('名古屋', { exact: true }).first()).toBeVisible()
    await popup
      .getByRole('button', { name: '名古屋 を選択' })
      .first()
      .click()

    // popup から postMessage を受けて親フォームの 区間1 出発駅 に「名古屋」が入る。
    await expect(page.getByLabel('区間1 出発駅')).toHaveValue('名古屋', {
      timeout: 10_000,
    })
  })
})
