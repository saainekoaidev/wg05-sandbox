import { test, expect, type Page } from '@playwright/test'

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const TEST_EMAIL = `e2e-account-${RUN_TAG}@example.com`
const TEST_PASSWORD = 'TestE2E1234'
const TEST_NAME = 'E2E Account User'

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

test.describe('US-008 プロフィール設定フロー', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('一覧フッタの「ユーザー: ...」リンクから /account に遷移し pre-fill される', async ({
    page,
  }) => {
    await loginViaUi(page)
    await page
      .getByRole('link', { name: 'アカウント設定を開く' })
      .click()
    await expect(page).toHaveURL('/account')

    await expect(
      page.getByRole('heading', { name: 'プロフィール設定' }),
    ).toBeVisible()

    // email は read-only で pre-fill される
    await expect(page.getByLabel('メールアドレス')).toHaveValue(TEST_EMAIL)
    await expect(page.getByLabel('メールアドレス')).toHaveAttribute(
      'readonly',
      '',
    )

    // 初期表示: name は signup 時の値
    await expect(page.getByLabel(/お名前/)).toHaveValue(TEST_NAME)
    // postalCode は新規ユーザでは空
    await expect(page.getByLabel('郵便番号')).toHaveValue('')
  })

  test('氏名 + 郵便番号を更新すると通知バナーが表示され, 再読込後も保持される', async ({
    page,
  }) => {
    await loginViaUi(page)
    await page.goto('/account')
    await expect(
      page.getByRole('heading', { name: 'プロフィール設定' }),
    ).toBeVisible()

    const newName = `E2EUpdated-${RUN_TAG}`
    await page.getByLabel(/お名前/).fill(newName)
    await page.getByLabel('郵便番号').fill('1500001')

    // 7桁数字入力時にハイフン入りプレビュー表示
    await expect(page.getByText(/150-0001/)).toBeVisible()

    await page.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByText('プロフィールを更新しました')).toBeVisible()

    // 再読込で値が永続化されている
    await page.reload()
    await expect(page.getByLabel(/お名前/)).toHaveValue(newName)
    await expect(page.getByLabel('郵便番号')).toHaveValue('1500001')

    // 一覧フッタの表示は email のままなので変わらない (US-008 の対象外)
    await page.getByRole('link', { name: '経路一覧に戻る' }).click()
    await expect(page).toHaveURL('/routes')
  })

  test('氏名空欄で保存しようとするとフィールドエラーが出て遷移しない', async ({
    page,
  }) => {
    await loginViaUi(page)
    await page.goto('/account')
    await page.getByLabel(/お名前/).fill('')
    await page.getByRole('button', { name: '保存する' }).click()

    await expect(page.getByText('氏名を入力してください')).toBeVisible()
    await expect(page).toHaveURL('/account')
  })

  test('郵便番号は半角数字以外を弾き 7 桁を超える入力はトリムされる', async ({
    page,
  }) => {
    await loginViaUi(page)
    await page.goto('/account')

    const input = page.getByLabel('郵便番号')

    // 1. 英字混入は除去される (maxLength=7 で切られた後 onChange が数字のみフィルタ)
    await input.fill('abc1234')
    await expect(input).toHaveValue('1234')

    // 2. 8桁数字は maxLength=7 でブラウザ側で 7 桁に切られる
    await input.fill('')
    await input.fill('12345678')
    await expect(input).toHaveValue('1234567')
  })

  test('未ログインで /account に直接アクセスすると /login にリダイレクトされる', async ({
    page,
  }) => {
    await page.goto('/account')
    await expect(page).toHaveURL('/login')
  })
})
