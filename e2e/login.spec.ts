import { test, expect } from '@playwright/test'

const TEST_EMAIL = 'e2e-login@example.com'
const TEST_PASSWORD = 'TestE2E1234'
const TEST_NAME = 'E2E Login User'

// テスト用ユーザを最初に1回だけ作成する。既に存在する場合は無視する
// (better-auth は重複アドレスでの sign-up を 4xx で返すため、結果は捨ててOK)。
test.beforeAll(async ({ request }) => {
  await request.post('http://localhost:3000/api/auth/sign-up/email', {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME },
    failOnStatusCode: false,
  })
})

test.describe('US-002 ログインフロー', () => {
  test.beforeEach(async ({ context }) => {
    // 各テストはセッション無し (Cookie 無し) で開始する
    await context.clearCookies()
  })

  test('正しい認証情報で /routes に遷移しユーザ情報が表示される', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(
      page.getByRole('heading', { name: 'ログイン' }),
    ).toBeVisible()

    await page.getByLabel(/メールアドレス/).fill(TEST_EMAIL)
    await page.getByLabel(/パスワード/).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'ログイン' }).click()

    await expect(page).toHaveURL('/routes')
    await expect(page.getByText(`ユーザー: ${TEST_EMAIL}`)).toBeVisible()
  })

  test('パスワード不一致でバナーエラーが出て /login に留まる', async ({
    page,
  }) => {
    await page.goto('/login')

    await page.getByLabel(/メールアドレス/).fill(TEST_EMAIL)
    await page.getByLabel(/パスワード/).fill('WrongPassword!')
    await page.getByRole('button', { name: 'ログイン' }).click()

    await expect(
      page.getByText('メールアドレスまたはパスワードが正しくありません'),
    ).toBeVisible()
    await expect(page).toHaveURL('/login')
  })

  test('未登録メールでも同じ汎用エラーになる (情報漏洩防止)', async ({
    page,
  }) => {
    await page.goto('/login')

    await page.getByLabel(/メールアドレス/).fill('not-registered@example.com')
    await page.getByLabel(/パスワード/).fill('AnyPassword123')
    await page.getByRole('button', { name: 'ログイン' }).click()

    await expect(
      page.getByText('メールアドレスまたはパスワードが正しくありません'),
    ).toBeVisible()
    await expect(page).toHaveURL('/login')
  })

  test('未入力で送信するとフィールドエラーが出て /login に留まる', async ({
    page,
  }) => {
    await page.goto('/login')

    await page.getByRole('button', { name: 'ログイン' }).click()

    await expect(
      page.getByText('メールアドレスを入力してください'),
    ).toBeVisible()
    await expect(
      page.getByText('パスワードを入力してください'),
    ).toBeVisible()
    await expect(page).toHaveURL('/login')
  })

  test('未ログインで /routes に直接アクセスすると /login へリダイレクト', async ({
    page,
  }) => {
    await page.goto('/routes')
    await expect(page).toHaveURL('/login')
    await expect(
      page.getByRole('heading', { name: 'ログイン' }),
    ).toBeVisible()
  })

  test('ルート / にアクセスすると未ログイン時は /login へリダイレクトする', async ({
    page,
  }) => {
    // SPA の起点ルート (main.tsx) が解決し、未ログイン時はログイン画面に着地することを確認。
    // smoke 的な「アプリが起動してルーティングが動いている」最小疎通の役割も兼ねる。
    await page.goto('/')
    await expect(page).toHaveURL('/login')
    await expect(
      page.getByRole('heading', { name: 'ログイン' }),
    ).toBeVisible()
  })

  test('ログイン済みで /login にアクセスすると /routes へ自動リダイレクト', async ({
    page,
  }) => {
    // 1. まずログインしてセッション Cookie を取得
    await page.goto('/login')
    await page.getByLabel(/メールアドレス/).fill(TEST_EMAIL)
    await page.getByLabel(/パスワード/).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await expect(page).toHaveURL('/routes')

    // 2. 再度 /login を開くとリダイレクトされる
    await page.goto('/login')
    await expect(page).toHaveURL('/routes')
  })

  test('ログアウトで /login に戻り、再アクセスでも /routes に入れない', async ({
    page,
  }) => {
    // ログイン
    await page.goto('/login')
    await page.getByLabel(/メールアドレス/).fill(TEST_EMAIL)
    await page.getByLabel(/パスワード/).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await expect(page).toHaveURL('/routes')

    // ログアウト
    await page.getByRole('link', { name: 'ログアウト' }).click()
    await expect(page).toHaveURL('/login')

    // 再度 /routes へアクセスしてもログイン画面に戻る
    await page.goto('/routes')
    await expect(page).toHaveURL('/login')
  })
})
